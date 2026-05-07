// src/features/ai/components/SaveNoteDialog.tsx
//
// M2 — Save dialog component
//
// Shown when the user clicks "Save to Note" in the chat panel header.
// Handles all three save modes (raw transcript / clean markdown session /
// clean markdown single response) and both destinations (sub-note / append).
//
// Clean markdown formatters are stubs here — they will be wired in M7/M8.
// For now the format radio exists in the UI but only raw transcript does
// real work; the other options fall through to raw transcript with a notice.
//
// Props
//   paneId        — which pane owns this chat (drives note lookup)
//   messages      — current chat messages (used by formatter + note name)
//   onClose       — called after save completes or user dismisses
//   onSaveSuccess — called with the saved note's id + title after a
//                   successful write (ChatPanel uses this to update the
//                   linked note indicator)

import { useState, useRef, useEffect, useCallback } from "react"
import { useNoteStore }       from "@/features/notes/store/useNoteStore"
import { useUIStore }         from "@/features/ui/store/useUIStore"
import {
  generateNoteName,
  formatRawTranscript,
  wrapForAppend,
} from "@/features/ai/lib/save/transcript"
import { getNoteById, saveManualVersion }          from "@/features/notes/db/queries"
import { formatCleanSession, formatCleanResponse, estimateTokens, getLengthBand } from "@/features/ai/lib/save/cleanMarkdown"
import { useChatSessionStore }            from "@/features/ai/store/useChatSessionStore"
import type { TranscriptMessage }         from "@/features/ai/lib/save/transcript"
import type { ChatMessage }               from "@/features/ai/lib/chat"
import { generateJSON } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { marked } from "marked"
import {
  CodeBlock, Callout, CheckList, CheckItem, Toggle, ToggleSummary, ToggleBody,
  EditorTable, TableRow, TableHeader, TableCell, ImageExtension, AttachmentExtension,
  BlockIdExtension, BlockRefNode, DataviewNode, Color, TextStyle, MultiHighlight,
} from "@/features/editor/components/Editor/extensions"
import { SubPageNode } from "@/features/editor/components/Editor/SubPageNode"
import { NoteLink }    from "@/features/editor/components/Editor/NoteLink"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SaveFormat      = "raw" | "clean_session" | "clean_response"
export type SaveDestination = "subnote" | "append"

interface Props {
  paneId:          1 | 2
  messages:        ChatMessage[]
  onClose:         () => void
  onSaveSuccess:   (noteId: string, noteTitle: string) => void
  selectedMessage?: { user: TranscriptMessage; assistant: TranscriptMessage }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTranscript(messages: ChatMessage[]): TranscriptMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

const PARSE_EXTENSIONS = [
  StarterKit.configure({ codeBlock: false }),
  Color, TextStyle, MultiHighlight,
  CodeBlock, Callout, CheckList, CheckItem,
  EditorTable, TableRow, TableHeader, TableCell,
  Toggle, ToggleSummary, ToggleBody,
  ImageExtension, AttachmentExtension,
  BlockIdExtension, BlockRefNode, DataviewNode,
  SubPageNode,
  NoteLink.configure({ onNavigate: () => {} }),
]

function markdownToContent(md: string): { content: string; plaintext: string } {
  try {
    const html = marked.parse(md) as string
    const doc  = generateJSON(html, PARSE_EXTENSIONS)
    return { content: JSON.stringify(doc), plaintext: md }
  } catch (err) {
    console.warn("[markdownToContent] parse failed:", err)
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: md }] }],
    }
    return { content: JSON.stringify(doc), plaintext: md }
  }
}

// ─── Parent picker (reused search+list pattern from MoveNoteModal) ────────────

interface ParentPickerProps {
  excludeNoteId: string | null
  value:         string | null   // "__root__" | noteId | null
  onChange:      (id: string | null) => void
}

function ParentPicker({ excludeNoteId, value, onChange }: ParentPickerProps) {
  const notes   = useNoteStore((s) => s.notes)
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
    { id: "__root__", title: "Root level", crumb: "Move to top level" },
    ...notes
      .filter((n) => !n.deleted_at && n.id !== excludeNoteId)
      .map((n) => ({ id: n.id, title: n.title, crumb: breadcrumb(n.id) })),
  ]

  const q = query.trim().toLowerCase()
  const filtered = q
    ? candidates.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.crumb.toLowerCase().includes(q)
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
      <ul className="max-h-36 overflow-y-auto py-0.5">
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

export function SaveNoteDialog({ paneId, messages, onClose, onSaveSuccess, selectedMessage }: Props) {
  const notes       = useNoteStore((s) => s.notes)
  const createNote  = useNoteStore((s) => s.createNote)
  const updateNote  = useNoteStore((s) => s.updateNote)

  const paneActiveNoteId = useUIStore((s) => s.paneActiveNoteId)

  const currentNoteId = paneActiveNoteId(paneId)
  const currentNote   = notes.find((n) => n.id === currentNoteId) ?? null

  // Auto-selection rule: default to append when current note is empty,
  // sub-note when it has content.
  const currentNoteIsEmpty =
    !currentNote ||
    !currentNote.plaintext ||
    currentNote.plaintext.trim() === ""

  const [noteName, setNoteName]           = useState(() => generateNoteName(toTranscript(messages)))
  const [destination, setDestination]     = useState<SaveDestination>(currentNoteIsEmpty ? "append" : "subnote")
  const [format, setFormat]               = useState<SaveFormat>("raw")
  const [parentId, setParentId]           = useState<string | null>(currentNoteId)
  const [showParentPicker, setShowParentPicker] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [conflictPending, setConflictPending] = useState<{
    content: string
    plaintext: string
  } | null>(null)

  // Show parent picker when no note is open
  useEffect(() => {
    if (!currentNoteId) setShowParentPicker(true)
  }, [currentNoteId])

  const parentNote = notes.find((n) => n.id === parentId) ?? null

  // ── Save handler ────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const transcript = toTranscript(messages)

      // Format selection — clean markdown formatters are stubs until M7/M8.
      // They will be wired in Phase 2. For now all formats produce raw transcript.
      let markdown: string
      let formatFallback = false

      if (format === "raw") {
        markdown = formatRawTranscript(transcript)
      } else if (format === "clean_session") {
        const result = await formatCleanSession(transcript)
        markdown      = result.markdown
        formatFallback = result.fallback
      } else {
        // clean_response
        if (selectedMessage) {
          const result = await formatCleanResponse(selectedMessage.user, selectedMessage.assistant)
          markdown      = result.markdown
          formatFallback = result.fallback
        } else {
          const result = await formatCleanSession(transcript)
          markdown      = result.markdown
          formatFallback = result.fallback
        }
      }

      if (formatFallback) {
        setError("Clean markdown unavailable — saved as raw transcript. You can reformat later.")
      }

      const { content, plaintext } = markdownToContent(markdown)

      if (destination === "subnote") {
        const session = useChatSessionStore.getState().getSession(paneId)

        // Re-save path — linked note already exists
        if (session.linkedNoteId) {
          const linkedNote = await getNoteById(session.linkedNoteId)

          if (linkedNote) {
            const lastSavedAt  = session.lastSavedAt ?? 0
            const noteUpdatedAt = linkedNote.updated_at

            // Conflict — note was manually edited after last save
            if (noteUpdatedAt > lastSavedAt) {
              setConflictPending({ content, plaintext })
              setSaving(false)
              return
            }

            // Silent overwrite — save version first, then update
            await saveManualVersion(session.linkedNoteId!)
            await updateNote(session.linkedNoteId, { content, plaintext })
            onSaveSuccess(session.linkedNoteId, linkedNote.title)
            useChatSessionStore.getState().stampSavedAt(paneId)
            onClose()
            return
          }
        }

        // First save — create new sub-note
        const resolvedParentId = parentId ?? null
        const savedNote = await createNote({
          title:     noteName.trim() || generateNoteName(transcript),
          content,
          plaintext,
          parent_id: resolvedParentId,
        })

        // Insert inline SubPageNode into the editor
        window.dispatchEvent(new CustomEvent("idemora:insert-subpage", {
          detail: { noteId: savedNote.id }
        }))

        onSaveSuccess(savedNote.id, savedNote.title)
        useChatSessionStore.getState().stampSavedAt(paneId)

      } else {
        // Append to current note under ## Chat — YYYY-MM-DD heading
        if (!currentNoteId) {
          setError("No note is open to append to.")
          setSaving(false)
          return
        }

        // wrapForAppend adds the ## Chat — YYYY-MM-DD heading before the content
        const wrapped = wrapForAppend(markdown)

        // Fetch current content from store (may be stub) or fall back to empty doc
        const existingNote  = notes.find((n) => n.id === currentNoteId)
        const existingPlain = existingNote?.plaintext ?? ""

        // Append plaintext for FTS/RAG — use wrapped so the heading is indexed too
        const newPlaintext = existingPlain + wrapped

        // For content, we append a paragraph node to the existing doc.
        // If content is unavailable (not loaded), we create a fresh doc.
        let newContent: string
        try {
          const existingContent = existingNote?.content
          if (existingContent && existingContent !== JSON.stringify({ type: "doc", content: [] })) {
            const doc = JSON.parse(existingContent)
            const appendDoc = JSON.parse(markdownToContent(wrapped).content)
            newContent = JSON.stringify({
              ...doc,
              content: [
                ...(doc.content ?? []),
                ...(appendDoc.content ?? []),
              ],
            })
          } else {
            newContent = markdownToContent(wrapped).content
          }
        } catch {
          newContent = markdownToContent(wrapped).content
        }

        await updateNote(currentNoteId, {
          content:   newContent,
          plaintext: newPlaintext,
        })

        onSaveSuccess(currentNoteId, currentNote?.title ?? "")
        useChatSessionStore.getState().stampSavedAt(paneId)
      }

      onClose()

    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.")
      setSaving(false)
    }
  }, [
    saving, messages, format, destination, parentId, noteName, selectedMessage,
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
            className="w-5 h-5 flex items-center justify-center text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-75"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">

          {/* Note name — only shown for sub-note */}
          {destination === "subnote" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
                Note name
              </label>
              <input
                value={noteName}
                onChange={(e) => setNoteName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary text-sm text-idemora-text-normal placeholder-idemora-text-muted focus:outline-none focus:ring-1 focus:ring-violet-400 transition-colors duration-100"
                placeholder="Note name…"
                autoFocus
              />
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
                label="Save as sub-note"
                description={
                  parentNote
                    ? `Under "${parentNote.title}"`
                    : "Under current note"
                }
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

          {/* Parent picker — shown when no note open or user changes target */}
          {destination === "subnote" && (showParentPicker || !currentNoteId) && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
                Parent note
              </label>
              <ParentPicker
                excludeNoteId={null}
                value={parentId}
                onChange={setParentId}
              />
            </div>
          )}

          {/* Change parent link — shown when a current note is open */}
          {destination === "subnote" && currentNoteId && !showParentPicker && (
            <button
              onClick={() => setShowParentPicker(true)}
              className="text-[11px] text-idemora-text-muted hover:text-violet-400 transition-colors duration-75"
            >
              Change parent note ↓
            </button>
          )}

          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-idemora-text-muted uppercase tracking-wide">
              Format
            </label>
            <div className="space-y-1">
              <RadioRow
                checked={format === "raw"}
                onChange={() => setFormat("raw")}
                label="Raw transcript"
                description="Turn-by-turn, lossless, always available"
              />
              <RadioRow
                checked={format === "clean_session"}
                onChange={() => setFormat("clean_session")}
                label="Clean markdown — session"
                description="Structured with headings and decisions (requires AI)"
              />
              <RadioRow
                checked={format === "clean_response"}
                onChange={() => setFormat("clean_response")}
                label="Clean markdown — single response"
                description="Save one selected response (requires AI)"
              />
            </div>
          </div>

          {/* Over-20k notice */}
          {format !== "raw" && (() => {
            const tokens = estimateTokens(formatRawTranscript(toTranscript(messages)))
            const band   = getLengthBand(tokens)
            return band === "long" ? (
              <div className="px-3 py-2 rounded-lg bg-amber-50/40 border border-amber-100">
                <p className="text-[10px] text-amber-600 leading-relaxed">
                  This is a long conversation. Clean markdown may not capture everything.
                  Raw transcript preserves the full conversation.
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
                    const session = useChatSessionStore.getState().getSession(paneId)
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
                  Save from chat — overwrite manual edits (version history preserved)
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
                    const session = useChatSessionStore.getState().getSession(paneId)
                    const resolvedParentId = session.linkedNoteId
                    const savedNote = await createNote({
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
                  Save as new sub-note — keep both
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
          <p className="text-[10px] text-idemora-text-muted">
            ⌘↵ to save · Esc to cancel
          </p>
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
  checked,
  onChange,
  label,
  description,
  disabled = false,
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
      {/* Custom radio dot */}
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