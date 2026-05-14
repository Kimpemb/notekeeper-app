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

  // Close on outside click
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

  // Focus search when opening
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30)
  }, [open])

  // Escape closes dropdown only, not the whole dialog
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

  const selectedItem   = value
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

      {/* Trigger button */}
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

      {/* Floating dropdown — does not push content */}
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-lg border border-idemora-border bg-idemora-bg-primary shadow-lg overflow-hidden">

          {/* Search */}
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

          {/* List */}
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
                    {/* Checkmark for selected, spacer for others */}
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
      {/* Live description */}
      <p className="text-[10px] text-idemora-text-muted leading-relaxed px-0.5 transition-all duration-100">
        {FORMAT_DESCRIPTIONS[value]}
      </p>
    </div>
  )
}

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
  const currentNote      = notes.find((n) => n.id === currentNoteId) ?? null

  const defaultFormat: SaveFormat = selectedMessage ? "response" : "document"

  const [format, setFormat]     = useState<SaveFormat>(defaultFormat)
  const [parentId, setParentId] = useState<string | null>(currentNoteId)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [conflictPending, setConflictPending] = useState<{
    content:   string
    plaintext: string
  } | null>(null)

  // ── Note name ───────────────────────────────────────────────────────────────

  const [noteName, setNoteName]       = useState<string>(() => {
    if (selectedMessage && defaultFormat === "response") {
      return generateNoteNameFromResponse(selectedMessage.user)
    }
    return generateNoteName(toTranscript(messages))
  })
  const [nameLoading, setNameLoading] = useState(() => defaultFormat !== "response")

  useEffect(() => {
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
    if (!currentNoteId || saving) return
    setSaving(true)
    setError(null)

    try {
      const { markdown } = await buildMarkdown()
      const wrapped      = wrapForAppend(markdown)
      const existingNote = notes.find((n) => n.id === currentNoteId)

      let newContent: string
      try {
        const existingContent = existingNote?.content
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

      const existingPlain = existingNote?.plaintext ?? ""
      await updateNote(currentNoteId, { content: newContent, plaintext: existingPlain + wrapped })
      onSaveSuccess(currentNoteId, currentNote?.title ?? "")
      useChatSessionStore.getState().stampSavedAt(paneId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Append failed. Please try again.")
      setSaving(false)
    }
  }, [saving, currentNoteId, currentNote, notes, format, messages, selectedMessage, updateNote, onSaveSuccess, onClose, paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save handler ────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const { markdown, fallback } = await buildMarkdown()

      if (fallback) {
        setError("Document formatting unavailable — saved as transcript. You can reformat later.")
      }

      const { content, plaintext } = markdownToContent(markdown)
      const session = useChatSessionStore.getState().getSession(paneId)

      if (session.linkedNoteId) {
        const linkedNote = await getNoteById(session.linkedNoteId)
        if (linkedNote) {
          const lastSavedAt   = session.lastSavedAt ?? 0
          const noteUpdatedAt = linkedNote.updated_at
          if (noteUpdatedAt > lastSavedAt) {
            setConflictPending({ content, plaintext })
            setSaving(false)
            return
          }
          await saveManualVersion(session.linkedNoteId)
          await updateNote(session.linkedNoteId, { content, plaintext })
          onSaveSuccess(session.linkedNoteId, linkedNote.title)
          useChatSessionStore.getState().stampSavedAt(paneId)
          onClose()
          return
        }
      }

      const savedNote = await createNote({
        title:     noteName.trim() || generateNoteName(toTranscript(messages)),
        content,
        plaintext,
        parent_id: parentId ?? null,
      })

      window.dispatchEvent(new CustomEvent("idemora:insert-subpage", {
        detail: { noteId: savedNote.id }
      }))

      onSaveSuccess(savedNote.id, savedNote.title)
      useChatSessionStore.getState().stampSavedAt(paneId)
      onClose()

    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.")
      setSaving(false)
    }
  }, [saving, format, messages, selectedMessage, noteName, parentId, createNote, updateNote, onSaveSuccess, onClose, paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose() }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave() }
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [handleSave, onClose])

  // ── Notices ─────────────────────────────────────────────────────────────────

  const showLengthNotice = format === "document" && !selectedMessage && (() => {
    const tokens = estimateTokens(formatRawTranscript(toTranscript(messages)))
    return getLengthBand(tokens) === "long"
  })()

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
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
                onChange={(e) => setNoteName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary
                  text-sm text-idemora-text-normal placeholder-idemora-text-muted
                  focus:outline-none focus:ring-1 focus:ring-violet-400
                  transition-colors duration-100"
                placeholder="Note name…"
                autoFocus={!nameLoading}
              />
              {nameLoading && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <svg width="11" height="11" viewBox="0 0 12 12" className="animate-spin text-idemora-text-muted" fill="none">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 7" strokeLinecap="round"/>
                  </svg>
                </div>
              )}
            </div>
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
              value={parentId}
              onChange={setParentId}
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
                    const session    = useChatSessionStore.getState().getSession(paneId)
                    const linkedNote = await getNoteById(session.linkedNoteId!)
                    if (linkedNote) {
                      await saveManualVersion(session.linkedNoteId!)
                      await updateNote(session.linkedNoteId!, conflictPending)
                      onSaveSuccess(session.linkedNoteId!, linkedNote.title)
                      useChatSessionStore.getState().stampSavedAt(paneId)
                    }
                    setConflictPending(null)
                    onClose()
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium
                    bg-amber-100 text-amber-800 hover:bg-amber-200
                    transition-colors duration-75"
                >
                  Overwrite with chat version (version history preserved)
                </button>
                <button
                  onClick={() => setConflictPending(null)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium border border-idemora-border
                    text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                    transition-colors duration-75"
                >
                  Keep manual edits — cancel save
                </button>
                <button
                  onClick={async () => {
                    setSaving(true)
                    const session          = useChatSessionStore.getState().getSession(paneId)
                    const resolvedParentId = session.linkedNoteId
                    const savedNote        = await createNote({
                      title:     noteName.trim() || generateNoteName(toTranscript(messages)),
                      content:   conflictPending.content,
                      plaintext: conflictPending.plaintext,
                      parent_id: resolvedParentId,
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
                    text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                    transition-colors duration-75"
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

          {/* Append — visible bordered button, understated but unmissable */}
          <button
            onClick={handleAppend}
            disabled={!currentNoteId || saving}
            title={currentNoteId ? `Append to "${currentNote?.title}"` : "No note open"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-idemora-border
              text-[11px] text-idemora-text-muted
              hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors duration-100"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M4.5 1v5.5M2 5l2.5 2.5L7 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1.5 8h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
            </svg>
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
              onClick={handleSave}
              disabled={saving || !noteName.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white
                hover:bg-violet-600 active:scale-[0.98]
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors duration-100"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}