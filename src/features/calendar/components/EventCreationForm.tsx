// src/features/calendar/components/EventCreationForm.tsx

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { Note } from "@/types";
import type {
  CalendarEvent,
  CalendarEventInput,
  EventGroup,
} from "@/features/calendar/db/calendarQueries";
import { listEventGroups, createEventGroup } from "@/features/calendar/db/calendarQueries";

interface Props {
  initialDate?: string;
  initialTime?: string;
  event?: CalendarEvent | null;
  onSubmit: (input: CalendarEventInput) => Promise<void>;
  onClose: () => void;
}

// ─── Breadcrumb helper (mirrors MoveNoteModal) ────────────────────────────────

function getBreadcrumb(note: Note, notes: Note[]): string {
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

// ─── Note picker modal ────────────────────────────────────────────────────────

interface NotePickerProps {
  notes: Note[];
  onSelect: (note: Note) => void;
  onClose: () => void;
}

// Replace the entire NotePickerModal component (from "function NotePickerModal" to its closing brace)

function NotePickerModal({ notes, onSelect, onClose }: NotePickerProps) {
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

  const candidates = useMemo(() =>
    notes.filter((n) => !n.deleted_at),
    [notes]
  );

  // ── Path parsing ───────────────────────────────────────────────────────────
  // Split on the last "/" — everything before = parent query, after = title
  const slashIdx    = query.lastIndexOf("/");
  const hasSlash    = slashIdx !== -1;
  const parentQuery = hasSlash ? query.slice(0, slashIdx).trim() : "";
  const titleAfter  = hasSlash ? query.slice(slashIdx + 1).trim() : "";

  // ── Filtered notes ─────────────────────────────────────────────────────────
  const filteredNotes = useMemo(() => {
    // Location mode — "/" detected
    if (hasSlash) {
      // Empty parent segment (just "/" typed) — show all notes as location candidates
      if (!parentQuery) return candidates.slice(0, 10);

      // Match parent query against title AND full breadcrumb
      return candidates
        .map((n) => {
          const t          = n.title.toLowerCase();
          const breadcrumb = getBreadcrumb(n, notes).toLowerCase();
          const full       = breadcrumb ? `${breadcrumb} / ${t}` : t;
          const q          = parentQuery.toLowerCase();

          const score =
            t === q             ? 1 :
            t.startsWith(q)     ? 2 :
            t.includes(q)       ? 3 :
            full.includes(q)    ? 4 : 999;

          return { ...n, score };
        })
        .filter((n) => n.score < 999)
        .sort((a, b) =>
          a.score !== b.score
            ? a.score - b.score
            : a.title.localeCompare(b.title)
        )
        .slice(0, 10);
    }

    // Normal mode — no "/"
    const q = query.trim().toLowerCase();
    if (!q) {
      // Show recents
      return [...candidates]
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, 8);
    }

    return candidates
      .map((n) => {
        const t          = n.title.toLowerCase();
        const breadcrumb = getBreadcrumb(n, notes).toLowerCase();
        const score =
          t === q                ? 1 :
          t.startsWith(q)        ? 2 :
          t.includes(` ${q}`)    ? 3 :
          t.includes(q)          ? 4 :
          breadcrumb.includes(q) ? 5 : 999;
        return { ...n, score };
      })
      .filter((n) => n.score < 999)
      .sort((a, b) =>
        a.score !== b.score
          ? a.score - b.score
          : a.title.localeCompare(b.title)
      )
      .slice(0, 10);
  }, [candidates, query, hasSlash, parentQuery, notes]);

  // ── Create row visibility ──────────────────────────────────────────────────
  // Show create row when:
  //   Normal mode: query has text
  //   Location mode: title segment has text (we know what to name the note)
  const showCreateRow = hasSlash
    ? titleAfter.length > 0
    : query.trim().length > 0;

  // In location mode, the create row is per-result (inside note rows),
  // so we only add a standalone create row for the root/no-match case.
  const showRootCreateRow = showCreateRow && hasSlash && filteredNotes.length === 0;
  const showNormalCreateRow = showCreateRow && !hasSlash;

  const standaloneCreateRow = showRootCreateRow || showNormalCreateRow;
  const createRowOffset     = standaloneCreateRow ? 1 : 0;
  const totalItems          = createRowOffset + filteredNotes.length;

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    const itemEls = listRef.current?.querySelectorAll("[data-item]");
    const el = itemEls?.[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  // ── Create handler ─────────────────────────────────────────────────────────

// Replace the entire handleCreate function:
  async function handleCreate(parentId?: string) {
    const title = hasSlash ? titleAfter || "Untitled" : query.trim() || "Untitled";
    setCreating(true);
    try {
      const note = await createNote({ title, parent_id: parentId ?? null });

      // If created inside a parent, write the subPage block into the parent's
      // content document — same pattern as moveNote in useNoteStore.
      // Without this the block never appears in the parent editor.
      if (parentId) {
        const { getNoteContent, updateNote: dbUpdate } = await import(
          "@/features/notes/db/queries"
        );
        const { content } = await getNoteContent(parentId);
        if (content) {
          try {
            const doc = JSON.parse(content) as {
              type: string;
              content: unknown[];
            };
            const newBlock = {
              type: "subPage",
              attrs: { noteId: note.id, title: note.title, mode: "display" },
            };
            // Insert before the last paragraph if it's empty, otherwise append
            const last = doc.content[doc.content.length - 1] as {
              type: string;
              content?: unknown[];
            } | undefined;
            const lastIsEmptyPara =
              last?.type === "paragraph" &&
              (!last.content || last.content.length === 0);
            if (lastIsEmptyPara) {
              doc.content.splice(doc.content.length - 1, 0, newBlock);
            } else {
              doc.content.push(newBlock);
            }
            const newContent = JSON.stringify(doc);
            await dbUpdate(parentId, { content: newContent });
            // Update in-memory store so open editors see the change immediately
            useNoteStore.setState((s) => ({
              notes: s.notes.map((n) =>
                n.id === parentId
                  ? { ...n, content: newContent, updated_at: Date.now() }
                  : n
              ),
            }));
          } catch {
            // Malformed parent content — skip block insertion, note still created
          }
        }
      }

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

        // Standalone create row (index 0)
        if (standaloneCreateRow && idx === 0) {
          handleCreate();
          return;
        }

        const note = filteredNotes[idx - createRowOffset];
        if (!note) return;

        if (hasSlash && titleAfter) {
          // Location mode + title exists — create inside this note
          handleCreate(note.id);
        } else {
          // Normal mode — select existing note
          onSelectRef.current(note);
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [filteredNotes, standaloneCreateRow, createRowOffset, totalItems, hasSlash, titleAfter]);

  // ── Section label ──────────────────────────────────────────────────────────

  function getSectionLabel(): string {
    if (hasSlash) {
      if (!parentQuery) return "Select a location";
      if (filteredNotes.length === 0) return "No matching location";
      return `${filteredNotes.length} location${filteredNotes.length !== 1 ? "s" : ""}`;
    }
    if (!query.trim()) return "Recent";
    return `${filteredNotes.length} found`;
  }

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
        {/* Search input */}
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
              placeholder="Search, or type Parent / Note title to create…"
              className="flex-1 bg-transparent outline-none text-sm text-idemora-text-normal
                         placeholder-idemora-text-muted"
            />
            <kbd className="text-xs text-idemora-text-muted bg-idemora-bg-primary
                            px-1.5 py-0.5 rounded font-mono shrink-0">
              ESC
            </kbd>
          </div>

          {/* Mode hint — shown when "/" is detected */}
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
                  <span className="text-xs font-medium text-amber-400">
                    {parentQuery}
                  </span>
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

          {/* ── Standalone create row (normal mode, or location mode with no matches) ── */}
          {standaloneCreateRow && (
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
                      <>
                        Create{" "}
                        <span className="font-medium text-idemora-text-normal">
                          "{query.trim()}"
                        </span>
                        {" "}at root
                      </>
                    )}
                  </span>
                  {selectedIdx === 0 && (
                    <kbd className="ml-auto text-xs text-idemora-text-muted bg-idemora-bg-primary
                                    px-1.5 py-0.5 rounded font-mono shrink-0">↵</kbd>
                  )}
                </button>
              ) : (
                // Prominent create row — no results
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
                      <div className="w-5 h-5 rounded-md bg-idemora-bg-primary border border-idemora-border
                                      flex items-center justify-center shrink-0">
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

          {/* ── Section label ── */}
          {(filteredNotes.length > 0 || (!showCreateRow && !hasSlash)) && (
            <li className="px-4 pt-2 pb-1">
              <p className="text-[10px] uppercase tracking-widest text-idemora-text-muted font-semibold">
                {getSectionLabel()}
              </p>
            </li>
          )}

          {/* ── Empty state (no query, no notes at all) ── */}
          {filteredNotes.length === 0 && !showCreateRow && (
            <li className="px-4 py-6 text-sm text-idemora-text-muted text-center">
              No notes yet
            </li>
          )}

          {/* ── Note rows ── */}
          {filteredNotes.map((note, i) => {
            const itemIdx    = i + createRowOffset;
            const isSelected = itemIdx === selectedIdx;
            const breadcrumb = getBreadcrumb(note, notes);

            return (
              <li key={note.id} data-item>
                <div className={`flex items-center group transition-colors duration-100
                                 ${isSelected ? "bg-blue-500/10" : ""}`}>

                  {/* Main button */}
                  <button
                    onMouseEnter={() => setSelectedIdx(itemIdx)}
                    onClick={() => {
                      if (hasSlash && titleAfter) {
                        // Location mode — create inside this note
                        handleCreate(note.id);
                      } else {
                        // Normal mode — link existing note
                        onSelect(note);
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

                    {/* In location mode, show what will be created */}
                    {hasSlash && titleAfter && isSelected && (
                      <span className="text-xs text-idemora-text-muted shrink-0 ml-2">
                        create here
                      </span>
                    )}
                  </button>

                  {/* Enter hint in normal mode */}
                  {isSelected && !hasSlash && (
                    <kbd className="shrink-0 mr-3 text-xs text-idemora-text-muted
                                    bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono">
                      ↵
                    </kbd>
                  )}

                  {/* "create here" hint in location mode */}
                  {isSelected && hasSlash && titleAfter && (
                    <kbd className="shrink-0 mr-3 text-xs text-idemora-text-muted
                                    bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono">
                      ↵
                    </kbd>
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

// ─── Main form ────────────────────────────────────────────────────────────────

export function EventCreationForm({ initialDate, initialTime, event, onSubmit, onClose }: Props) {
  const allNotes = useNoteStore((s) => s.notes);

  const [title,       setTitle]       = useState(event?.title ?? "");
  const [date,        setDate]        = useState(
    event?.date ?? initialDate ?? new Date().toISOString().split("T")[0]
  );
  const [time,        setTime]        = useState(event?.time ?? initialTime ?? "");
  const [duration,    setDuration]    = useState(String(event?.duration_mins ?? ""));
  const [notes,       setNotes]       = useState(event?.notes ?? "");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  // ── Groups ─────────────────────────────────────────────────────────────────
  const [groups,       setGroups]      = useState<EventGroup[]>([]);
  const [groupId,      setGroupId]     = useState<string | null>(event?.group_id ?? null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);

  // ── Note linking ───────────────────────────────────────────────────────────
  const [linkedNoteId,    setLinkedNoteId]    = useState<string | null>(event?.linked_note_id ?? null);
  const [showNotePicker,  setShowNotePicker]  = useState(false);

  const isEditing  = !!event;
  const linkedNote     = allNotes.find((n) => n.id === linkedNoteId) ?? null;
  const linkedDeleted  = linkedNote?.deleted_at != null;

  useEffect(() => {
    listEventGroups().then(setGroups).catch(console.error);
  }, []);

  async function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await createEventGroup(name);
      const updated = await listEventGroups();
      const created = updated.find((g) => g.name === name);
      setGroups(updated);
      if (created) setGroupId(created.id);
      setNewGroupName("");
      setShowNewGroup(false);
    } catch (err) {
      console.error("[EventCreationForm] createEventGroup failed:", err);
    }
  }

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    if (!date)         { setError("Date is required.");  return; }

    setSaving(true);
    setError("");

    try {
      await onSubmit({
        title:          title.trim(),
        date,
        time:           time || null,
        duration_mins:  duration ? parseInt(duration, 10) : null,
        category:       event?.category ?? "personal",
        notes:          notes.trim() || null,
        colour_state:   event?.colour_state ?? "blue",
        group_id:       groupId,
        linked_note_id: linkedNoteId,
      });
      onClose();
    } catch (err) {
      console.error("[EventCreationForm] submit failed:", err);
      setError("Failed to save event. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Note picker modal — rendered outside the slide-in so z-index is clean */}
      {showNotePicker && (
        <NotePickerModal
          notes={allNotes}
          onSelect={(note) => {
            setLinkedNoteId(note.id);
            setShowNotePicker(false);
          }}
          onClose={() => setShowNotePicker(false)}
        />
      )}

      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div className="flex-1 bg-black/40" onClick={onClose} />

        {/* Slide-in panel */}
        <div className="w-80 h-full bg-idemora-bg-primary border-l border-idemora-border
                        flex flex-col shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border">
            <h2 className="text-sm font-semibold text-idemora-text-normal">
              {isEditing ? "Edit event" : "New event"}
            </h2>
            <button
              onClick={onClose}
              className="text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Form body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">

            {/* Title */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-idemora-text-muted">Title *</label>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="Event title"
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal placeholder-idemora-text-muted
                           focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-idemora-text-muted">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal
                           focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Time */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-idemora-text-muted">Time (optional)</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal
                           focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Duration */}
            {time && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-idemora-text-muted">
                  Duration (minutes)
                </label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="60"
                  className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                             text-sm text-idemora-text-normal placeholder-idemora-text-muted
                             focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            )}

            {/* Group */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-idemora-text-muted">Group (optional)</label>
              <select
                value={groupId ?? ""}
                onChange={(e) => setGroupId(e.target.value || null)}
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal
                           focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>

              {showNewGroup ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")  handleAddGroup();
                      if (e.key === "Escape") setShowNewGroup(false);
                    }}
                    placeholder="Group name"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-idemora-border
                               bg-idemora-bg-secondary text-sm text-idemora-text-normal
                               placeholder-idemora-text-muted focus:outline-none
                               focus:border-blue-500 transition-colors"
                  />
                  <button
                    onClick={handleAddGroup}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700
                               text-white text-xs font-medium transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowNewGroup(false)}
                    className="px-2.5 py-1.5 rounded-lg border border-idemora-border
                               text-idemora-text-muted hover:bg-idemora-bg-secondary
                               text-xs transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewGroup(true)}
                  className="self-start text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + New group
                </button>
              )}
            </div>

            {/* Linked note */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-idemora-text-muted">
                Linked note (optional)
              </label>

              {linkedNote ? (
                <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border
                                 ${linkedDeleted
                                   ? "border-red-500/20 bg-red-500/5"
                                   : "border-idemora-border bg-idemora-bg-secondary"
                                 }`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                       className={`shrink-0 mt-0.5 ${
                         linkedDeleted ? "text-red-400/50" : "text-idemora-text-muted"
                       }`}>
                    <rect x="1.5" y="1" width="9" height="10" rx="1"
                          stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor"
                          strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${
                      linkedDeleted
                        ? "text-idemora-text-muted line-through"
                        : "text-idemora-text-normal"
                    }`}>
                      {linkedNote.title}
                    </p>
                    {(() => {
                      const bc = getBreadcrumb(linkedNote, allNotes);
                      return bc ? (
                        <p className="text-xs text-idemora-text-muted truncate mt-0.5">{bc}</p>
                      ) : null;
                    })()}
                    {linkedDeleted && (
                      <p className="text-xs text-red-400/70 mt-0.5 font-medium">
                        In trash — unlink and choose another note
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setLinkedNoteId(null)}
                    className="text-idemora-text-muted hover:text-idemora-text-normal
                               transition-colors text-xs shrink-0 mt-0.5"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                /* Trigger button */
                <button
                  onClick={() => setShowNotePicker(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed
                             border-idemora-border text-sm text-idemora-text-muted
                             hover:border-blue-500/50 hover:text-idemora-text-normal
                             transition-colors text-left"
                >
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none"
                       className="shrink-0">
                    <rect x="1.5" y="1" width="9" height="10" rx="1"
                          stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor"
                          strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  Link a note…
                </button>
              )}
            </div>

            {/* Notes / description */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-idemora-text-muted">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add any details…"
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal placeholder-idemora-text-muted
                           focus:outline-none focus:border-blue-500 transition-colors resize-none"
              />
            </div>

            <p className="text-xs text-idemora-text-muted">
              Category: <span className="font-medium">Personal</span> — Notes, tasks, and goal
              events are created from their respective homes.
            </p>

            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-idemora-border flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-lg text-sm text-idemora-text-muted
                         border border-idemora-border hover:bg-idemora-bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                         bg-blue-600 hover:bg-blue-700 text-white transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : isEditing ? "Save changes" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}