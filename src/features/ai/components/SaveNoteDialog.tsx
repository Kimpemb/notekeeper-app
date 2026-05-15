// src/features/ai/components/SaveNoteDialog.tsx

import { useState, useRef, useEffect, useCallback } from "react"
import { useNoteStore }       from "@/features/notes/store/useNoteStore"
import { useUIStore }         from "@/features/ui/store/useUIStore"
import {
  generateNoteName,
  generateNoteNameAI,
  generateNoteNameFromResponse,
  formatRawTranscript,
  formatSingleResponse,
  wrapForAppend,
} from "@/features/ai/lib/save/transcript"
import { getNoteById, saveManualVersion } from "@/features/notes/db/queries"
import { formatDocument, estimateTokens, getLengthBand } from "@/features/ai/lib/save/cleanMarkdown"
import { useChatSessionStore } from "@/features/ai/store/useChatSessionStore"
import { markdownToContent }   from "@/features/ai/lib/save/parseMarkdown"
import type { TranscriptMessage } from "@/features/ai/lib/save/transcript"
import type { ChatMessage }       from "@/features/ai/lib/chat"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SaveFormat = "document" | "transcript" | "response"

interface Props {
  paneId:           1 | 2
  messages:         ChatMessage[]
  onClose:          () => void
  onSaveSuccess:    (noteId: string, noteTitle: string) => void
  selectedMessage?: { user: TranscriptMessage; assistant: TranscriptMessage }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTranscript(messages: ChatMessage[]): TranscriptMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

const FORMAT_DESCRIPTIONS: Record<SaveFormat, string> = {
  document:   "AI synthesises the conversation into a clean written note",
  transcript: "Turn-by-turn record, lossless, no AI",
  response:   "Just this response, pasted as-is, no AI",
}

// ─── SubPage node preservation ────────────────────────────────────────────────
// When writing to an existing note, subPage nodes (inline subnote references)
// are not representable in markdown and therefore get dropped by the
// markdownToContent round-trip. We extract them from the existing doc before
// overwriting and re-append them so the editor still sees them.

function extractSubPageNodes(content: string): object[] {
  try {
    const doc = JSON.parse(content)
    return (doc.content ?? []).filter(
      (node: { type: string }) => node.type === "subPage"
    )
  } catch {
    return []
  }
}

function reappendSubPageNodes(docJson: string, subPageNodes: object[]): string {
  if (subPageNodes.length === 0) return docJson
  try {
    const doc = JSON.parse(docJson)
    return JSON.stringify({
      ...doc,
      content: [...(doc.content ?? []), ...subPageNodes],
    })
  } catch {
    return docJson
  }
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const LockIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-idemora-text-muted shrink-0">
    <rect x="2" y="4.5" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
    <path d="M3.5 4.5V3a1.5 1.5 0 013 0v1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
  </svg>
)

const AppendIcon = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
    <path d="M4.5 1v5.5M2 5l2.5 2.5L7 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M1.5 8h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
  </svg>
)

// ─── Location dropdown ────────────────────────────────────────────────────────

interface LocationDropdownProps {
  excludeNoteId: string | null
  value:         string | null   // null = root
  onChange:      (id: string | null) => void
}

function LocationDropdown({ excludeNoteId, value, onChange }: LocationDropdownProps) {
  const notes        = useNoteStore((s) => s.notes)
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); setQuery("") }
    }
    document.addEventListener("keydown", handleKey, true)
    return () => document.removeEventListener("keydown", handleKey, true)
  }, [open])

  function breadcrumb(noteId: string): string {
    const parts: string[] = []
    let cur = notes.find((n) => n.id === noteId)
    while (cur?.parent_id) {
      const parent = notes.find((n) => n.id === cur!.parent_id)
      if (!parent) break
      parts.unshift(parent.title)
      cur = parent
    }
    return parts.join(" / ")
  }

  const candidates = [
    { id: "__root__", title: "Root level", crumb: "" },
    ...notes
      .filter((n) => !n.deleted_at && n.id !== excludeNoteId)
      .map((n) => ({ id: n.id, title: n.title, crumb: breadcrumb(n.id) })),
  ]

  const q        = query.trim().toLowerCase()
  const filtered = q
    ? candidates.filter(
        (c) => c.title.toLowerCase().includes(q) || c.crumb.toLowerCase().includes(q)
      )
    : candidates

  const selectedItem      = value
    ? candidates.find((c) => c.id === value)
    : candidates.find((c) => c.id === "__root__")
  const hasCustomLocation = value !== null

  function select(id: string) {
    onChange(id === "__root__" ? null : id)
    setOpen(false)
    setQuery("")
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs text-left
          transition-colors duration-100
          hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
          ${open
            ? "border-violet-400 bg-idemora-bg-primary"
            : "border-idemora-border bg-idemora-bg-primary"
          }`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          className={`shrink-0 ${hasCustomLocation ? "text-violet-500" : "text-idemora-text-muted"}`}>
          <path d="M1 3.5A1.5 1.5 0 012.5 2h2l1 1.5H9.5A1.5 1.5 0 0111 5v4a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 011 9V3.5z"
            stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
        </svg>
        <span className={`flex-1 truncate ${hasCustomLocation ? "text-violet-500 font-medium" : "text-idemora-text-muted"}`}>
          {selectedItem?.title ?? "Root level"}
        </span>
        {selectedItem?.crumb && (
          <span className="text-idemora-text-muted truncate max-w-[7rem] text-[10px]">
            {selectedItem.crumb}
          </span>
        )}
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className={`shrink-0 text-idemora-text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-lg border border-idemora-border bg-idemora-bg-primary shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-idemora-border">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-idemora-text-muted shrink-0">
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 8l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="flex-1 bg-transparent outline-none text-xs text-idemora-text-normal placeholder-idemora-text-muted"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-75"
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
          <ul className="max-h-44 overflow-y-auto py-0.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-2.5 text-xs text-idemora-text-muted">No notes found</li>
            ) : filtered.map((item) => {
              const isSelected = value === item.id || (value === null && item.id === "__root__")
              return (
                <li key={item.id}>
                  <button
                    onClick={() => select(item.id)}
                    className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors duration-75
                      ${isSelected
                        ? "bg-violet-100/60 dark:bg-violet-500/20 text-violet-500"
                        : "text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
                      }`}
                  >
                    {isSelected ? (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0 text-violet-500">
                        <path d="M1.5 4.5l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <span className="w-[9px] shrink-0" />
                    )}
                    <span className="font-medium truncate">{item.title}</span>
                    {item.crumb && (
                      <span className="text-idemora-text-muted truncate text-[10px] ml-auto pl-2 shrink-0 max-w-[8rem]">
                        {item.crumb}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Segmented control ────────────────────────────────────────────────────────

interface SegmentedControlProps {
  value:        SaveFormat
  onChange:     (f: SaveFormat) => void
  showResponse: boolean
}

function SegmentedControl({ value, onChange, showResponse }: SegmentedControlProps) {
  const segments: { id: SaveFormat; label: string }[] = [
    { id: "document",   label: "Document"      },
    { id: "transcript", label: "Transcript"    },
    ...(showResponse ? [{ id: "response" as SaveFormat, label: "This response" }] : []),
  ]

  return (
    <div className="space-y-1.5">
      <div className="flex bg-idemora-bg-primary border border-idemora-border rounded-lg p-0.5 gap-0.5">
        {segments.map((seg) => (
          <button
            key={seg.id}
            onClick={() => onChange(seg.id)}
            className={`flex-1 py-1.5 text-xs rounded-md transition-colors duration-100
              ${value === seg.id
                ? "bg-violet-500 text-white font-medium"
                : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
              }`}
          >
            {seg.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-idemora-text-muted leading-relaxed px-0.5">
        {FORMAT_DESCRIPTIONS[value]}
      </p>
    </div>
  )
}

// ─── Footer button variants ───────────────────────────────────────────────────

type FooterMode = "linked" | "other-note" | "root"

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function SaveNoteDialog({
  paneId,
  messages,
  onClose,
  onSaveSuccess,
  selectedMessage,
}: Props) {
  const notes      = useNoteStore((s) => s.notes)
  const createNote = useNoteStore((s) => s.createNote)
  const updateNote = useNoteStore((s) => s.updateNote)

  const paneActiveNoteId = useUIStore((s) => s.paneActiveNoteId)
  const currentNoteId    = paneActiveNoteId(paneId)

  // ── Session linkage ─────────────────────────────────────────────────────────

  const session         = useChatSessionStore.getState().getSession(paneId)
  const linkedNoteId    = session.linkedNoteId   ?? null
  const linkedNoteTitle = session.linkedNoteTitle ?? null
  const isLinked        = !!linkedNoteId

  // ── Default format ──────────────────────────────────────────────────────────

  const defaultFormat: SaveFormat = selectedMessage ? "response" : "document"
  const [format, setFormat] = useState<SaveFormat>(defaultFormat)

  // ── Location ────────────────────────────────────────────────────────────────

  const [locationId, setLocationId] = useState<string | null>(
    linkedNoteId ?? currentNoteId
  )

  // ── Name + link-broken state ─────────────────────────────────────────────────

  const [noteName, setNoteName] = useState<string>(() => {
    if (isLinked && linkedNoteTitle)                    return linkedNoteTitle
    if (selectedMessage && defaultFormat === "response") return generateNoteNameFromResponse(selectedMessage.user)
    return generateNoteName(toTranscript(messages))
  })
  const [nameLoading, setNameLoading] = useState(!isLinked && defaultFormat !== "response")

  // linkBroken: user edited the name while a linked note was selected
  const [linkBroken, setLinkBroken] = useState(false)

  function handleNameChange(val: string) {
    setNoteName(val)
    if (isLinked && !linkBroken) setLinkBroken(true)
  }

  // Re-derive name when format changes (only if not linked / not broken)
  useEffect(() => {
    if (isLinked) return

    if (format === "response") {
      if (selectedMessage) setNoteName(generateNoteNameFromResponse(selectedMessage.user))
      setNameLoading(false)
      return
    }

    setNameLoading(true)
    let cancelled = false
    const source  = selectedMessage
      ? [selectedMessage.user, selectedMessage.assistant]
      : toTranscript(messages)
    generateNoteNameAI(source).then((name) => {
      if (!cancelled) { setNoteName(name); setNameLoading(false) }
    })
    return () => { cancelled = true }
  }, [format]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Footer mode ─────────────────────────────────────────────────────────────

  const footerMode: FooterMode = (() => {
    if (locationId === null) return "root"
    if (isLinked && !linkBroken && locationId === linkedNoteId) return "linked"
    return "other-note"
  })()

  // ── Conflict state ──────────────────────────────────────────────────────────

  const [saving, setSaving]                   = useState(false)
  const [error,  setError]                    = useState<string | null>(null)
  const [conflictPending, setConflictPending] = useState<{
    content:   string
    plaintext: string
  } | null>(null)

  // ── Build markdown ──────────────────────────────────────────────────────────

  async function buildMarkdown(): Promise<{ markdown: string; fallback: boolean }> {
    const transcript = toTranscript(messages)

    if (format === "response") {
      if (!selectedMessage) throw new Error("No message selected.")
      return { markdown: formatSingleResponse(selectedMessage.user, selectedMessage.assistant), fallback: false }
    }

    if (format === "transcript") {
      const source = selectedMessage ? [selectedMessage.user, selectedMessage.assistant] : transcript
      return { markdown: formatRawTranscript(source), fallback: false }
    }

    const source = selectedMessage ? [selectedMessage.user, selectedMessage.assistant] : transcript
    const result = await formatDocument(source)
    return { markdown: result.markdown, fallback: result.fallback }
  }

  // ── Append handler ──────────────────────────────────────────────────────────

  const handleAppend = useCallback(async () => {
    if (!locationId || saving) return
    setSaving(true)
    setError(null)

    try {
      const { markdown } = await buildMarkdown()
      const wrapped      = wrapForAppend(markdown)
      const targetNote   = notes.find((n) => n.id === locationId)

      // Preserve any subPage nodes from the existing doc — they don't survive
      // the markdown round-trip and must be re-appended after the merge.
      const existingSubPageNodes = extractSubPageNodes(targetNote?.content ?? "")

      let newContent: string
      try {
        const existingContent = targetNote?.content
        if (existingContent && existingContent !== JSON.stringify({ type: "doc", content: [] })) {
          const doc       = JSON.parse(existingContent)
          const appendDoc = JSON.parse(markdownToContent(wrapped).content)
          newContent = JSON.stringify({
            ...doc,
            content: [...(doc.content ?? []), ...(appendDoc.content ?? [])],
          })
        } else {
          newContent = markdownToContent(wrapped).content
        }
      } catch {
        newContent = markdownToContent(wrapped).content
      }

      // Re-attach preserved subPage nodes at the end.
      newContent = reappendSubPageNodes(newContent, existingSubPageNodes)

      const existingPlain = targetNote?.plaintext ?? ""
      await updateNote(locationId, { content: newContent, plaintext: existingPlain + wrapped })
      onSaveSuccess(locationId, targetNote?.title ?? "")
      useChatSessionStore.getState().stampSavedAt(paneId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Append failed. Please try again.")
      setSaving(false)
    }
  }, [saving, locationId, notes, format, messages, selectedMessage, updateNote, onSaveSuccess, onClose, paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update linked note handler ──────────────────────────────────────────────

  const handleUpdateLinked = useCallback(async () => {
    if (saving || !linkedNoteId) return
    setSaving(true)
    setError(null)

    try {
      const { markdown, fallback } = await buildMarkdown()
      if (fallback) setError("Document formatting unavailable — saved as transcript.")

      const { content: rawContent, plaintext } = markdownToContent(markdown)
      const linkedNote = await getNoteById(linkedNoteId)

      if (linkedNote) {
        const lastSavedAt   = session.lastSavedAt ?? 0
        const noteUpdatedAt = linkedNote.updated_at

        if (noteUpdatedAt > lastSavedAt) {
          setConflictPending({ content: rawContent, plaintext })
          setSaving(false)
          return
        }

        // Preserve subPage nodes from the note being overwritten.
        const existingSubPageNodes = extractSubPageNodes(linkedNote.content ?? "")
        const content = reappendSubPageNodes(rawContent, existingSubPageNodes)

        await saveManualVersion(linkedNoteId)
        await updateNote(linkedNoteId, { content, plaintext })
        onSaveSuccess(linkedNoteId, linkedNote.title)
        useChatSessionStore.getState().stampSavedAt(paneId)
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed. Please try again.")
      setSaving(false)
    }
  }, [saving, linkedNoteId, session, format, messages, selectedMessage, updateNote, onSaveSuccess, onClose, paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save as subnote / new note handler ─────────────────────────────────────

  const handleSaveNew = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const { markdown, fallback } = await buildMarkdown()
      if (fallback) setError("Document formatting unavailable — saved as transcript.")

      const { content, plaintext } = markdownToContent(markdown)

      const savedNote = await createNote({
        title:     noteName.trim() || generateNoteName(toTranscript(messages)),
        content,
        plaintext,
        parent_id: locationId ?? null,
      })

      // Insert subpage block into editor if the parent note is currently open
      const uiState = useUIStore.getState()
      const pane1NoteId = uiState.paneActiveNoteId(1)
      const pane2NoteId = uiState.paneActiveNoteId(2)
      if (locationId && (pane1NoteId === locationId || pane2NoteId === locationId)) {
        window.dispatchEvent(new CustomEvent("idemora:insert-subpage", {
          detail: { noteId: savedNote.id }
        }))
      }

      onSaveSuccess(savedNote.id, savedNote.title)
      useChatSessionStore.getState().stampSavedAt(paneId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.")
      setSaving(false)
    }
  }, [saving, locationId, noteName, format, messages, selectedMessage, createNote, onSaveSuccess, onClose, paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose() }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (footerMode === "linked")     handleUpdateLinked()
        else if (footerMode === "root")  handleSaveNew()
        else                             handleSaveNew()
      }
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [footerMode, handleUpdateLinked, handleSaveNew, onClose])

  // ── Long conversation notice ─────────────────────────────────────────────────

  const showLengthNotice = format === "document" && !selectedMessage && (() => {
    const tokens = estimateTokens(formatRawTranscript(toTranscript(messages)))
    return getLengthBand(tokens) === "long"
  })()

  // ── Derived: target note label for append button ─────────────────────────────

  const appendTargetNote = locationId ? notes.find((n) => n.id === locationId) : null

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
      data-overlay-sentinel
    >
      <div
        className="w-full max-w-sm mx-4 rounded-xl bg-idemora-bg-secondary border border-idemora-border shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
          <div className="flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-violet-500 shrink-0">
              <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 4.5h5M4 6.5h5M4 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            <span className="text-sm font-semibold text-idemora-text-normal">Save to note</span>
          </div>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted
              hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
              transition-colors duration-100"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="p-4 space-y-3 overflow-y-auto">

          {/* Note name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
              Note name
            </label>
            <div className="relative">
              <input
                value={noteName}
                onChange={(e) => handleNameChange(e.target.value)}
                className={`w-full px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary
                  text-sm placeholder-idemora-text-muted
                  focus:outline-none focus:ring-1 focus:ring-violet-400
                  transition-colors duration-100
                  ${isLinked && !linkBroken
                    ? "text-idemora-text-muted pr-8"
                    : "text-idemora-text-normal"
                  }`}
                placeholder="Note name…"
                autoFocus={!nameLoading}
              />
              {/* Lock icon — shown when linked and name not yet edited */}
              {isLinked && !linkBroken && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <LockIcon />
                </div>
              )}
              {/* AI loading spinner */}
              {nameLoading && !isLinked && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <svg width="11" height="11" viewBox="0 0 12 12" className="animate-spin text-idemora-text-muted" fill="none">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 7" strokeLinecap="round"/>
                  </svg>
                </div>
              )}
            </div>
            {/* Link-broken hint */}
            {linkBroken && (
              <p className="text-[10px] text-amber-500 px-0.5 leading-relaxed">
                Will create a new note — link to previous save broken
              </p>
            )}
          </div>

          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
              Format
            </label>
            <SegmentedControl
              value={format}
              onChange={setFormat}
              showResponse={!!selectedMessage}
            />
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
              Location
            </label>
            <LocationDropdown
              excludeNoteId={null}
              value={locationId}
              onChange={setLocationId}
            />
          </div>

          {/* Long conversation notice */}
          {showLengthNotice && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50/40 border border-amber-100">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-amber-400 shrink-0 mt-px">
                <path d="M5.5 1L10 9.5H1L5.5 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                <path d="M5.5 4.5v2M5.5 8v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
              <p className="text-[10px] text-amber-600 leading-relaxed">
                Long conversation — document format may not capture everything. Transcript preserves it all.
              </p>
            </div>
          )}

          {/* Conflict */}
          {conflictPending && (
            <div className="space-y-2 p-3 rounded-lg border border-amber-200 bg-amber-50/40">
              <div className="flex items-center gap-1.5">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-amber-500 shrink-0">
                  <path d="M5.5 1L10 9.5H1L5.5 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                  <path d="M5.5 4.5v2M5.5 8v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                </svg>
                <p className="text-xs font-semibold text-amber-700">Note edited since last save from chat</p>
              </div>
              <div className="flex flex-col gap-1.5 pt-0.5">
                <button
                  onClick={async () => {
                    setSaving(true)
                    const s          = useChatSessionStore.getState().getSession(paneId)
                    const linkedNote = await getNoteById(s.linkedNoteId!)
                    if (linkedNote) {
                      // Preserve subPage nodes even during conflict overwrite.
                      const existingSubPageNodes = extractSubPageNodes(linkedNote.content ?? "")
                      const content = reappendSubPageNodes(conflictPending.content, existingSubPageNodes)
                      await saveManualVersion(s.linkedNoteId!)
                      await updateNote(s.linkedNoteId!, { content, plaintext: conflictPending.plaintext })
                      onSaveSuccess(s.linkedNoteId!, linkedNote.title)
                      useChatSessionStore.getState().stampSavedAt(paneId)
                    }
                    setConflictPending(null)
                    onClose()
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium
                    bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors duration-75"
                >
                  Overwrite with chat version (version history preserved)
                </button>
                <button
                  onClick={() => setConflictPending(null)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium border border-idemora-border
                    text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-75"
                >
                  Keep manual edits — cancel save
                </button>
                <button
                  onClick={async () => {
                    setSaving(true)
                    const s         = useChatSessionStore.getState().getSession(paneId)
                    const savedNote = await createNote({
                      title:     noteName.trim() || generateNoteName(toTranscript(messages)),
                      content:   conflictPending.content,
                      plaintext: conflictPending.plaintext,
                      parent_id: s.linkedNoteId,
                    })
                    window.dispatchEvent(new CustomEvent("idemora:insert-subpage", {
                      detail: { noteId: savedNote.id }
                    }))
                    onSaveSuccess(savedNote.id, savedNote.title)
                    useChatSessionStore.getState().stampSavedAt(paneId)
                    setConflictPending(null)
                    onClose()
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium border border-idemora-border
                    text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-75"
                >
                  Save as new note — keep both
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50/40 border border-red-100">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-red-400 shrink-0 mt-px">
                <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M5.5 3.5v2.5M5.5 7.5v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <p className="text-xs text-red-500 leading-relaxed">{error}</p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-idemora-border shrink-0">

          {/* ── Mode A: linked note selected, name untouched ── */}
          {footerMode === "linked" && (
            <>
              <button
                onClick={handleAppend}
                disabled={saving}
                title={`Append to "${appendTargetNote?.title}"`}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px]
                  border-idemora-border text-idemora-text-muted
                  hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                  disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
              >
                <AppendIcon />
                Append
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-idemora-text-muted select-none">⌘↵</span>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs rounded-lg border border-idemora-border
                    text-idemora-text-muted
                    hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                    transition-colors duration-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateLinked}
                  disabled={saving || !noteName.trim()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white
                    hover:bg-violet-600 active:scale-[0.98]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors duration-100"
                >
                  {saving ? "Saving…" : "Update note"}
                </button>
                <button
                  onClick={handleSaveNew}
                  disabled={saving || !noteName.trim()}
                  title="Create a new subnote under the linked note"
                  className="px-3 py-1.5 text-xs rounded-lg border border-idemora-border
                    text-idemora-text-muted
                    hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                    disabled:opacity-30 disabled:cursor-not-allowed
                    transition-colors duration-100"
                >
                  Save as subnote
                </button>
              </div>
            </>
          )}

          {/* ── Mode B: any other note selected (or link broken) ── */}
          {footerMode === "other-note" && (
            <>
              <button
                onClick={handleAppend}
                disabled={saving}
                title={`Append to "${appendTargetNote?.title}"`}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px]
                  border-idemora-border text-idemora-text-muted
                  hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                  disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
              >
                <AppendIcon />
                Append to note
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-idemora-text-muted select-none">⌘↵</span>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs rounded-lg border border-idemora-border
                    text-idemora-text-muted
                    hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                    transition-colors duration-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNew}
                  disabled={saving || !noteName.trim()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white
                    hover:bg-violet-600 active:scale-[0.98]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors duration-100"
                >
                  {saving ? "Saving…" : "Save as subnote"}
                </button>
              </div>
            </>
          )}

          {/* ── Mode C: root selected ── */}
          {footerMode === "root" && (
            <>
              <div /> {/* spacer */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-idemora-text-muted select-none">⌘↵</span>
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs rounded-lg border border-idemora-border
                    text-idemora-text-muted
                    hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                    transition-colors duration-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNew}
                  disabled={saving || !noteName.trim()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white
                    hover:bg-violet-600 active:scale-[0.98]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors duration-100"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}