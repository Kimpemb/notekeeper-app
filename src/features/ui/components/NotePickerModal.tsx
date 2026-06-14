// src/features/ui/components/NotePickerModal.tsx
//
// Shared note picker modal — used by EventCreationForm (link a note to an event)
// and ImportModal (choose import location).
//
// Supports:
//   - Search with breadcrumb display
//   - Recent notes when query is empty
//   - Path syntax: "Parent / New note title" creates a new note inside Parent
//   - Plain search + select links an existing note

import { useState, useEffect, useRef, useMemo } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { Note } from "@/types";

// ── Breadcrumb helper ─────────────────────────────────────────────────────────

export function getBreadcrumb(note: Note, notes: Note[]): string {
  const parts: string[] = [];
  let cur: Note | undefined = note;
  while (cur?.parent_id) {
    const parent = notes.find((p) => p.id === cur!.parent_id);
    if (!parent) break;
    parts.unshift(parent.title);
    cur = parent;
  }
  return parts.join(" / ");
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface NotePickerModalProps {
  // Mode A — link existing note (EventCreationForm)
  // onSelect is called with the chosen or created note
  onSelect: (note: Note) => void;
  onClose:  () => void;

  // Mode B — location only (ImportModal)
  // When true, the create-inside flow is hidden — you're just picking a parent
  locationOnly?: boolean;
  locationOnlyPlaceholder?: string; // e.g. "Search for a parent note…"
}

export function NotePickerModal({
  onSelect,
  onClose,
  locationOnly = false,
  locationOnlyPlaceholder,
}: NotePickerModalProps) {
  const allNotes = useNoteStore((s) => s.notes);

  const [query,       setQuery]       = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [creating,    setCreating]    = useState(false);

  const createNote    = useNoteStore((s) => s.createNote);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  const inputRef       = useRef<HTMLInputElement>(null);
  const listRef        = useRef<HTMLUListElement>(null);
  const selectedIdxRef = useRef(0);
  const onCloseRef     = useRef(onClose);
  const onSelectRef    = useRef(onSelect);

  useEffect(() => { onCloseRef.current  = onClose;  }, [onClose]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

  const candidates = useMemo(
    () => allNotes.filter((n) => !n.deleted_at),
    [allNotes]
  );

  // ── Path parsing ──────────────────────────────────────────────────────────
  const slashIdx    = query.lastIndexOf("/");
  const hasSlash    = !locationOnly && slashIdx !== -1;
  const parentQuery = hasSlash ? query.slice(0, slashIdx).trim() : "";
  const titleAfter  = hasSlash ? query.slice(slashIdx + 1).trim() : "";

  // ── Filtered notes ────────────────────────────────────────────────────────
  const filteredNotes = useMemo(() => {
    if (hasSlash) {
      if (!parentQuery) return candidates.slice(0, 10);
      return candidates
        .map((n) => {
          const t          = n.title.toLowerCase();
          const breadcrumb = getBreadcrumb(n, allNotes).toLowerCase();
          const full       = breadcrumb ? `${breadcrumb} / ${t}` : t;
          const q          = parentQuery.toLowerCase();
          const score =
            t === q          ? 1 :
            t.startsWith(q)  ? 2 :
            t.includes(q)    ? 3 :
            full.includes(q) ? 4 : 999;
          return { ...n, score };
        })
        .filter((n) => n.score < 999)
        .sort((a, b) => a.score !== b.score ? a.score - b.score : a.title.localeCompare(b.title))
        .slice(0, 10);
    }

    const q = query.trim().toLowerCase();
    if (!q) {
      return [...candidates]
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, 8);
    }

    return candidates
      .map((n) => {
        const t          = n.title.toLowerCase();
        const breadcrumb = getBreadcrumb(n, allNotes).toLowerCase();
        const score =
          t === q                ? 1 :
          t.startsWith(q)        ? 2 :
          t.includes(` ${q}`)    ? 3 :
          t.includes(q)          ? 4 :
          breadcrumb.includes(q) ? 5 : 999;
        return { ...n, score };
      })
      .filter((n) => n.score < 999)
      .sort((a, b) => a.score !== b.score ? a.score - b.score : a.title.localeCompare(b.title))
      .slice(0, 10);
  }, [candidates, query, hasSlash, parentQuery, allNotes]);

  // ── Create row logic ──────────────────────────────────────────────────────
  const showCreateRow      = !locationOnly && (hasSlash ? titleAfter.length > 0 : query.trim().length > 0);
  const showRootCreateRow  = showCreateRow && hasSlash && filteredNotes.length === 0;
  const showNormalCreate   = showCreateRow && !hasSlash;
  const standaloneCreate   = showRootCreateRow || showNormalCreate;
  const createRowOffset    = standaloneCreate ? 1 : 0;
  const totalItems         = createRowOffset + filteredNotes.length;

  useEffect(() => { setSelectedIdx(0); }, [query]);
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  useEffect(() => {
    const itemEls = listRef.current?.querySelectorAll("[data-item]");
    const el = itemEls?.[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // ── Create handler ────────────────────────────────────────────────────────
  async function handleCreate(parentId?: string) {
    const title = hasSlash ? titleAfter || "Untitled" : query.trim() || "Untitled";
    setCreating(true);
    try {
      const note = await createNote({ title, parent_id: parentId ?? null });
      setActiveNote(note.id);
      onSelectRef.current(note);
    } catch (err) {
      console.error("[NotePickerModal] create failed:", err);
    } finally {
      setCreating(false);
    }
  }

  // ── Keyboard nav ──────────────────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, totalItems - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = selectedIdxRef.current;
        if (standaloneCreate && idx === 0) { handleCreate(); return; }
        const note = filteredNotes[idx - createRowOffset];
        if (!note) return;
        if (hasSlash && titleAfter) {
          handleCreate(note.id);
        } else {
          onSelectRef.current(note);
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [filteredNotes, standaloneCreate, createRowOffset, totalItems, hasSlash, titleAfter]);

  // ── Section label ─────────────────────────────────────────────────────────
  function getSectionLabel(): string {
    if (locationOnly) {
      if (!query.trim()) return "Recent";
      return filteredNotes.length > 0 ? `${filteredNotes.length} found` : "No matches";
    }
    if (hasSlash) {
      if (!parentQuery) return "Select a location";
      return filteredNotes.length > 0
        ? `${filteredNotes.length} location${filteredNotes.length !== 1 ? "s" : ""}`
        : "No matching location";
    }
    return !query.trim() ? "Recent" : `${filteredNotes.length} found`;
  }

  const placeholder = locationOnly
    ? (locationOnlyPlaceholder ?? "Search for a parent note…")
    : "Search, or type Parent / Note title to create…";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl bg-idemora-bg-secondary border border-idemora-border
                   shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "65vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex flex-col border-b border-idemora-border shrink-0">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <svg className="shrink-0 text-idemora-text-muted" width="13" height="13"
                 viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent outline-none text-sm text-idemora-text-normal
                         placeholder-idemora-text-muted"
            />
            <kbd className="text-xs text-idemora-text-muted bg-idemora-bg-primary
                            px-1.5 py-0.5 rounded font-mono shrink-0">ESC</kbd>
          </div>

          {/* Path mode hint */}
          {hasSlash && (
            <div className="flex items-center gap-2 px-3 pb-2">
              {parentQuery ? (
                <>
                  <span className="text-xs text-idemora-text-muted">Creating</span>
                  <span className="text-xs font-medium text-idemora-text-normal bg-idemora-bg-primary
                                   px-1.5 py-0.5 rounded border border-idemora-border">
                    {titleAfter || "…"}
                  </span>
                  <span className="text-xs text-idemora-text-muted">inside</span>
                  <span className="text-xs font-medium text-amber-400">{parentQuery}</span>
                </>
              ) : (
                <span className="text-xs text-idemora-text-muted">
                  Select a location for the new note
                </span>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        <ul ref={listRef} className="overflow-y-auto py-1 list-none p-0 m-0">

          {/* Standalone create row */}
          {standaloneCreate && (
            <li data-item>
              {filteredNotes.length > 0 ? (
                <button
                  onMouseEnter={() => setSelectedIdx(0)}
                  onClick={() => handleCreate()}
                  disabled={creating}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-left
                              transition-colors duration-100
                              ${selectedIdx === 0 ? "bg-blue-500/10" : "hover:bg-idemora-bg-primary"}`}
                >
                  <div className="w-4 h-4 rounded flex items-center justify-center
                                  text-idemora-text-muted shrink-0">
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                      <path d="M4.5 1v7M1 4.5h7" stroke="currentColor"
                            strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span className={`text-sm transition-colors ${
                    selectedIdx === 0 ? "text-blue-400" : "text-idemora-text-muted"
                  }`}>
                    {creating ? "Creating…" : (
                      <>Create <span className="font-medium text-idemora-text-normal">"{query}"</span></>
                    )}
                  </span>
                  {selectedIdx === 0 && (
                    <kbd className="ml-auto text-xs text-idemora-text-muted bg-idemora-bg-primary
                                    px-1.5 py-0.5 rounded font-mono shrink-0">↵</kbd>
                  )}
                </button>
              ) : (
                <div className="px-3 py-2">
                  <button
                    onMouseEnter={() => setSelectedIdx(0)}
                    onClick={() => handleCreate()}
                    disabled={creating}
                    className={`w-full flex items-center justify-between px-3 py-2.5
                                rounded-lg border border-dashed transition-all duration-150
                                ${selectedIdx === 0
                                  ? "border-blue-500/40 bg-blue-500/[0.04]"
                                  : "border-idemora-border/60 hover:border-blue-500/40"
                                }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 rounded-md bg-idemora-bg-primary border
                                      border-idemora-border flex items-center justify-center shrink-0">
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M4 1v6M1 4h6" stroke="currentColor"
                                strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <span className="text-sm text-idemora-text-muted">
                        {creating ? "Creating…" : (
                          <>
                            Create{" "}
                            <span className="font-medium text-idemora-text-normal">
                              "{hasSlash ? titleAfter : query.trim()}"
                            </span>
                            {showRootCreateRow && " at root"}
                          </>
                        )}
                      </span>
                    </div>
                    <kbd className="text-xs text-idemora-text-muted bg-idemora-bg-primary
                                    px-1.5 py-0.5 rounded font-mono shrink-0">↵</kbd>
                  </button>
                </div>
              )}
            </li>
          )}

          {/* Section label */}
          {filteredNotes.length > 0 && (
            <li className="px-4 pt-2 pb-1">
              <p className="text-[10px] uppercase tracking-widest text-idemora-text-muted font-semibold">
                {getSectionLabel()}
              </p>
            </li>
          )}

          {/* Empty state */}
          {filteredNotes.length === 0 && !showCreateRow && (
            <li className="px-4 py-6 text-sm text-idemora-text-muted text-center">
              {query.trim() ? "No notes found" : "No notes yet"}
            </li>
          )}

          {/* Note rows */}
          {filteredNotes.map((note, i) => {
            const itemIdx    = i + createRowOffset;
            const isSelected = itemIdx === selectedIdx;
            const breadcrumb = getBreadcrumb(note, allNotes);

            return (
              <li key={note.id} data-item>
                <div className={`flex items-center group transition-colors duration-100
                                 ${isSelected ? "bg-blue-500/10" : ""}`}>
                  <button
                    onMouseEnter={() => setSelectedIdx(itemIdx)}
                    onClick={() => {
                      if (hasSlash && titleAfter) {
                        handleCreate(note.id);
                      } else {
                        onSelectRef.current(note);
                      }
                    }}
                    className="flex-1 flex items-center gap-2.5 px-4 py-2.5 text-left min-w-0"
                  >
                    <svg width="13" height="13" viewBox="0 0 12 12" fill="none"
                         className="shrink-0 text-idemora-text-muted mt-0.5">
                      <rect x="1.5" y="1" width="9" height="10" rx="1"
                            stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor"
                            strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${
                        isSelected ? "text-blue-400" : "text-idemora-text-normal"
                      }`}>
                        {note.title}
                      </p>
                      {breadcrumb && (
                        <p className="text-xs text-idemora-text-muted truncate mt-0.5">
                          {breadcrumb}
                        </p>
                      )}
                    </div>
                    {hasSlash && titleAfter && isSelected && (
                      <span className="text-xs text-idemora-text-muted shrink-0 ml-2">
                        create here
                      </span>
                    )}
                  </button>

                  {isSelected && !hasSlash && (
                    <kbd className="shrink-0 mr-3 text-xs text-idemora-text-muted
                                    bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono">↵</kbd>
                  )}
                  {isSelected && hasSlash && titleAfter && (
                    <kbd className="shrink-0 mr-3 text-xs text-idemora-text-muted
                                    bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono">↵</kbd>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}