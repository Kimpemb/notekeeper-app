// src/features/ai/components/SaveNoteDialog.tsx

import { useState, useRef, useEffect, useCallback } from "react"
import { useNoteStore }        from "@/features/notes/store/useNoteStore"
import { useUIStore }          from "@/features/ui/store/useUIStore"
import {
  generateNoteName,
  generateNoteNameAI,
  formatRawTranscript,
  wrapForAppend,
} from "@/features/ai/lib/save/transcript"
import { getNoteById, saveManualVersion } from "@/features/notes/db/queries"
import { formatDocument, estimateTokens, getLengthBand } from "@/features/ai/lib/save/cleanMarkdown"
import { useChatSessionStore }  from "@/features/ai/store/useChatSessionStore"
import { markdownToContent }    from "@/features/ai/lib/save/parseMarkdown"
import type { TranscriptMessage } from "@/features/ai/lib/save/transcript"
import type { ChatMessage }       from "@/features/ai/lib/chat"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SaveFormat      = "document" | "transcript"
export type SaveDestination = "subnote" | "append"

interface Props {
  paneId:        1 | 2
  messages:      ChatMessage[]
  onClose:       () => void
  onSaveSuccess: (noteId: string, noteTitle: string) => void
  selectedMessage?: { user: TranscriptMessage; assistant: TranscriptMessage }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTranscript(messages: ChatMessage[]): TranscriptMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

// ─── Parent picker ────────────────────────────────────────────────────────────

interface ParentPickerProps {
  excludeNoteId: string | null
  value:         string | null
  onChange:      (id: string | null) => void
}

function ParentPicker({ excludeNoteId, value, onChange }: ParentPickerProps) {
  const notes    = useNoteStore((s) => s.notes)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

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
    { id: "__root__", title: "Root level", crumb: "No parent — top level note" },
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

  return (
    <div className="border border-idemora-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-idemora-border">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-idemora-text-muted shrink-0">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M8 8l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          className="flex-1 bg-transparent outline-none text-xs text-idemora-text-normal placeholder-idemora-text-muted"
        />
      </div>
      <ul className="max-h-40 overflow-y-auto py-0.5">
        {filtered.length === 0 && (
          <li className="px-3 py-2 text-xs text-idemora-text-muted">No notes found</li>
        )}
        {filtered.map((item) => {
          const selected = value === item.id || (value === null && item.id === "__root__")
          return (
            <li key={item.id}>
              <button
                onClick={() => onChange(item.id === "__root__" ? null : item.id)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors duration-75 ${
                  selected
                    ? "bg-violet-50/40 text-violet-500"
                    : "text-idemora-text-normal hover:bg-idemora-bg-primary"
                }`}
              >
                <span className="font-medium">{item.title}</span>
                {item.crumb && item.id !== "__root__" && (
                  <span className="ml-1.5 text-idemora-text-muted">{item.crumb}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function SaveNoteDialog({ paneId, messages, onClose, onSaveSuccess }: Props) {
  const notes      = useNoteStore((s) => s.notes)
  const createNote = useNoteStore((s) => s.createNote)
  const updateNote = useNoteStore((s) => s.updateNote)

  const paneActiveNoteId = useUIStore((s) => s.paneActiveNoteId)
  const currentNoteId    = paneActiveNoteId(paneId)
  const currentNote      = notes.find((n) => n.id === currentNoteId) ?? null

  const currentNoteIsEmpty =
    !currentNote?.plaintext || currentNote.plaintext.trim() === ""

  const [noteName, setNoteName]       = useState(() => generateNoteName(toTranscript(messages)))
  const [nameLoading, setNameLoading] = useState(true)
  const [destination, setDestination] = useState<SaveDestination>(currentNoteIsEmpty ? "append" : "subnote")
  const [format, setFormat]           = useState<SaveFormat>("document")
  const [parentId, setParentId]       = useState<string | null>(currentNoteId)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [conflictPending, setConflictPending] = useState<{
    content:   string
    plaintext: string
  } | null>(null)

  // Generate AI note name on mount
  useEffect(() => {
    let cancelled = false
    generateNoteNameAI(toTranscript(messages)).then((name) => {
      if (!cancelled) { setNoteName(name); setNameLoading(false) }
    })
    return () => { cancelled = true }
  }, [])


  // ── Save handler ────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const transcript   = toTranscript(messages)
      let markdown:       string
      let formatFallback = false

      if (format === "document") {
        const result   = await formatDocument(transcript)
        markdown       = result.markdown
        formatFallback = result.fallback
      } else {
        markdown = formatRawTranscript(transcript)
      }

      if (formatFallback) {
        setError("Document formatting unavailable — saved as transcript. You can reformat later.")
      }

      const { content, plaintext } = markdownToContent(markdown)

      if (destination === "subnote") {
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
          title:     noteName.trim() || generateNoteName(transcript),
          content,
          plaintext,
          parent_id: parentId ?? null,
        })

        window.dispatchEvent(new CustomEvent("idemora:insert-subpage", {
          detail: { noteId: savedNote.id }
        }))

        onSaveSuccess(savedNote.id, savedNote.title)
        useChatSessionStore.getState().stampSavedAt(paneId)

      } else {
        if (!currentNoteId) {
          setError("No note is open to append to.")
          setSaving(false)
          return
        }

        const wrapped       = wrapForAppend(markdown)
        const existingNote  = notes.find((n) => n.id === currentNoteId)
        const existingPlain = existingNote?.plaintext ?? ""
        const newPlaintext  = existingPlain + wrapped

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

        await updateNote(currentNoteId, { content: newContent, plaintext: newPlaintext })
        onSaveSuccess(currentNoteId, currentNote?.title ?? "")
        useChatSessionStore.getState().stampSavedAt(paneId)
      }

      onClose()

    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.")
      setSaving(false)
    }
  }, [
    saving, messages, format, destination, parentId, noteName,
    currentNoteId, currentNote, notes, createNote, updateNote,
    onSaveSuccess, onClose, paneId,
  ])

  // ── Keyboard ────────────────────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose() }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave() }
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [handleSave, onClose])

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
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
          <div className="flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-violet-500">
              <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 4.5h5M4 6.5h5M4 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            <span className="text-sm font-semibold text-idemora-text-normal">Save to Note</span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">

          {/* Note name */}
          {destination === "subnote" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
                Note name
              </label>
              <div className="relative">
                <input
                  value={noteName}
                  onChange={(e) => setNoteName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary text-sm text-idemora-text-normal placeholder-idemora-text-muted focus:outline-none focus:ring-1 focus:ring-violet-400 transition-colors duration-100"
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
          )}

          {/* Destination */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
              Where
            </label>
            <div className="space-y-1">
              <RadioRow
                checked={destination === "subnote"}
                onChange={() => setDestination("subnote")}
                label="Save as new note"
                description="Create a standalone note anywhere in your vault"
              />
              <RadioRow
                checked={destination === "append"}
                onChange={() => setDestination("append")}
                label="Append to this note"
                description="Add below existing content"
                disabled={!currentNoteId}
              />
            </div>
          </div>

          {/* Parent picker — always visible when subnote selected */}
          {destination === "subnote" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
                Location
              </label>
              <ParentPicker
                excludeNoteId={null}
                value={parentId}
                onChange={setParentId}
              />
            </div>
          )}

          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
              Format
            </label>
            <div className="space-y-1">
              <RadioRow
                checked={format === "document"}
                onChange={() => setFormat("document")}
                label="Document"
                description="AI organises the conversation into a clean written note"
              />
              <RadioRow
                checked={format === "transcript"}
                onChange={() => setFormat("transcript")}
                label="Transcript"
                description="Turn-by-turn, lossless, always available"
              />
            </div>
          </div>

          {/* Long conversation notice */}
          {format === "document" && (() => {
            const tokens = estimateTokens(formatRawTranscript(toTranscript(messages)))
            const band   = getLengthBand(tokens)
            return band === "long" ? (
              <div className="px-3 py-2 rounded-lg bg-amber-50/40 border border-amber-100">
                <p className="text-[10px] text-amber-600 leading-relaxed">
                  Long conversation — document format may not capture everything. Transcript preserves it all.
                </p>
              </div>
            ) : null
          })()}

          {/* Conflict dialog */}
          {conflictPending && (
            <div className="space-y-2 p-3 rounded-lg border border-amber-200 bg-amber-50/40">
              <p className="text-xs font-semibold text-amber-700">
                This note has been edited since it was last saved from chat.
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
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
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors duration-75"
                >
                  Overwrite with chat version (version history preserved)
                </button>
                <button
                  onClick={() => setConflictPending(null)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium border border-idemora-border text-idemora-text-normal hover:bg-idemora-bg-primary transition-colors duration-75"
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
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium border border-idemora-border text-idemora-text-normal hover:bg-idemora-bg-primary transition-colors duration-75"
                >
                  Save as new note — keep both
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500 bg-red-50/40 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-idemora-border shrink-0">
          <p className="text-[10px] text-idemora-text-muted">⌘↵ to save · Esc to cancel</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-75"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (destination === "subnote" && !noteName.trim())}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── RadioRow ─────────────────────────────────────────────────────────────────

function RadioRow({
  checked, onChange, label, description, disabled = false,
}: {
  checked:     boolean
  onChange:    () => void
  label:       string
  description: string
  disabled?:   boolean
}) {
  return (
    <button
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors duration-75 ${
        checked
          ? "border-violet-300 bg-violet-50/30"
          : "border-idemora-border bg-idemora-bg-primary hover:border-violet-200"
      } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
        checked ? "border-violet-500" : "border-idemora-border"
      }`}>
        {checked && <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium ${checked ? "text-violet-600" : "text-idemora-text-normal"}`}>
          {label}
        </p>
        <p className="text-[10px] text-idemora-text-muted leading-relaxed">{description}</p>
      </div>
    </button>
  )
}