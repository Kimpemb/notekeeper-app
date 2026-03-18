// src/features/notes/components/Sidebar/NoteTree.tsx
import { useState, useRef, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { NoteTreeItem } from "./NoteTreeItem";
import { SearchResults } from "./SearchResults";
import type { Note } from "@/types";

function noteHasTag(tags: string | null, tag: string): boolean {
  if (!tags) return false;
  try { return (JSON.parse(tags) as string[]).includes(tag); }
  catch { return false; }
}

interface DragState {
  draggedId: string;
  section: "pinned" | "notes";
}

export function NoteTree() {
  const notes        = useNoteStore((s) => s.notes);
  const pinnedIds    = useNoteStore((s) => s.pinnedIds);
  const reorderNote  = useNoteStore((s) => s.reorderNote);
  const deleteNote   = useNoteStore((s) => s.deleteNote);
  const searchQuery  = useUIStore((s) => s.searchQuery);
  const activeTag    = useUIStore((s) => s.activeTag);
  const setActiveTag = useUIStore((s) => s.setActiveTag);
  const selectedNoteIds = useUIStore((s) => s.selectedNoteIds);
  const clearSelection  = useUIStore((s) => s.clearSelection);

  const [drag, setDrag]                 = useState<DragState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [confirmBulkTrash, setConfirmBulkTrash] = useState(false);

  // Ref shared across all NoteTreeItems for Shift+click range anchor.
  const lastSelectedIdRef = useRef<string | null>(null);

  // Clear selection on Escape.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedNoteIds.size > 0) {
        clearSelection();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedNoteIds.size, clearSelection]);

  // ── FTS5 search results view ───────────────────────────────────────────────
  if (searchQuery.trim()) {
    return <SearchResults query={searchQuery} />;
  }

  // ── Tag filter view ────────────────────────────────────────────────────────
  if (activeTag) {
    const tagged = notes.filter((n) => noteHasTag(n.tags, activeTag));
    const taggedIds = tagged.map((n) => n.id);
    return (
      <div className="px-2">
        <div className="flex items-center gap-2 px-2 pt-2 pb-1">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-600 select-none flex-1">
            #{activeTag}
          </span>
          <button
            onClick={() => setActiveTag(null)}
            className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-100"
          >
            Clear
          </button>
        </div>
        {tagged.length === 0 ? (
          <p className="px-2 py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">
            No notes tagged #{activeTag}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {tagged.map((note) => (
              <NoteTreeItem
                key={note.id}
                noteId={note.id}
                depth={0}
                flatOrderedIds={taggedIds}
                lastSelectedIdRef={lastSelectedIdRef}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Default tree view ──────────────────────────────────────────────────────
  const pinnedNotes   = notes.filter((n) => n.parent_id === null && pinnedIds.has(n.id));
  const unpinnedNotes = notes.filter((n) => n.parent_id === null && !pinnedIds.has(n.id));

  // Flat ordered list of all visible root-level IDs for Shift+click range.
  const flatOrderedIds = [...pinnedNotes, ...unpinnedNotes].map((n) => n.id);

  const selectionCount = selectedNoteIds.size;

  if (pinnedNotes.length === 0 && unpinnedNotes.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">
        No notes yet.<br />Click + to create one.
      </p>
    );
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function handleDragStart(noteId: string, section: "pinned" | "notes") {
    setDrag({ draggedId: noteId, section });
  }

  function handleDragOver(e: React.DragEvent, targetId: string, section: "pinned" | "notes") {
    e.preventDefault();
    if (!drag || drag.section !== section || drag.draggedId === targetId) return;
    setDropTargetId(targetId);
  }

  function handleDrop(e: React.DragEvent, targetId: string, section: "pinned" | "notes") {
    e.preventDefault();
    if (!drag || drag.section !== section || drag.draggedId === targetId) return;
    reorderNote(drag.draggedId, targetId, section).catch(console.error);
    setDrag(null);
    setDropTargetId(null);
  }

  function handleDragEnd() {
    setDrag(null);
    setDropTargetId(null);
  }

  function renderNote(note: Note, section: "pinned" | "notes") {
    const isDragging   = drag?.draggedId === note.id;
    const isDropTarget = dropTargetId === note.id && drag?.section === section;

    return (
      <li
        key={note.id}
        draggable
        onDragStart={() => handleDragStart(note.id, section)}
        onDragOver={(e) => handleDragOver(e, note.id, section)}
        onDrop={(e) => handleDrop(e, note.id, section)}
        onDragEnd={handleDragEnd}
        style={{ opacity: isDragging ? 0.4 : 1 }}
        className={`relative transition-opacity duration-100 ${isDropTarget ? "drop-target" : ""}`}
      >
        {isDropTarget && (
          <div className="absolute top-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full z-10 pointer-events-none" />
        )}
        <NoteTreeItem
          noteId={note.id}
          depth={0}
          flatOrderedIds={flatOrderedIds}
          lastSelectedIdRef={lastSelectedIdRef}
        />
      </li>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Bulk action bar — shown when notes are selected ─────────────────── */}
      {selectionCount > 0 && (
        <div className="mx-2 mb-1 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex items-center gap-2">
          <span className="flex-1 text-xs font-medium text-blue-700 dark:text-blue-300">
            {selectionCount} selected
          </span>

          {/* Trash selected */}
          <button
            onClick={() => setConfirmBulkTrash(true)}
            title="Move selected to trash"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-500 hover:bg-red-100 dark:hover:bg-red-950 transition-colors duration-75"
          >
            <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
              <path d="M2 3h9M5 3V2h3v1M3.5 3l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Trash
          </button>

          {/* Clear selection */}
          <button
            onClick={clearSelection}
            title="Clear selection (Esc)"
            className="w-5 h-5 flex items-center justify-center rounded text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors duration-75"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* Bulk trash confirm */}
      {confirmBulkTrash && (
        <div className="mx-2 mb-1 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 space-y-2">
          <p>Move {selectionCount} note{selectionCount !== 1 ? "s" : ""} to trash?</p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const ids = [...selectedNoteIds];
                clearSelection();
                setConfirmBulkTrash(false);
                for (const id of ids) {
                  await deleteNote(id).catch(console.error);
                }
              }}
              className="px-2.5 py-1 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors duration-75"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmBulkTrash(false)}
              className="px-2.5 py-1 rounded text-xs text-red-400 hover:bg-red-100 dark:hover:bg-red-900 transition-colors duration-75"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="px-2 space-y-0.5 flex-1">
        {pinnedNotes.length > 0 && (
          <div className="mb-1">
            <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-600 select-none">
              Pinned
            </p>
            <ul className="space-y-0.5">
              {pinnedNotes.map((note) => renderNote(note, "pinned"))}
            </ul>
          </div>
        )}

        {pinnedNotes.length > 0 && unpinnedNotes.length > 0 && (
          <div className="mx-2 border-t border-zinc-200 dark:border-zinc-800 my-1" />
        )}

        {unpinnedNotes.length > 0 && (
          <div>
            {pinnedNotes.length > 0 && (
              <p className="px-2 pt-1 pb-1 text-[10px] font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-600 select-none">
                Notes
              </p>
            )}
            <ul className="space-y-0.5">
              {unpinnedNotes.map((note) => renderNote(note, "notes"))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}