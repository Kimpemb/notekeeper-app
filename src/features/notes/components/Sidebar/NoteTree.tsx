// src/features/notes/components/Sidebar/NoteTree.tsx
import { useState } from "react";
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
  const searchQuery  = useUIStore((s) => s.searchQuery);
  const activeTag    = useUIStore((s) => s.activeTag);
  const setActiveTag = useUIStore((s) => s.setActiveTag);

  const [drag, setDrag]                 = useState<DragState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // ── FTS5 search results view ───────────────────────────────────────────────
  if (searchQuery.trim()) {
    return <SearchResults query={searchQuery} />;
  }

  // ── Tag filter view ────────────────────────────────────────────────────────
  if (activeTag) {
    const tagged = notes.filter((n) => noteHasTag(n.tags, activeTag));
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
            {tagged.map((note) => <NoteTreeItem key={note.id} noteId={note.id} depth={0} />)}
          </ul>
        )}
      </div>
    );
  }

  // ── Default tree view ──────────────────────────────────────────────────────
  const pinnedNotes   = notes.filter((n) => n.parent_id === null && pinnedIds.has(n.id));
  const unpinnedNotes = notes.filter((n) => n.parent_id === null && !pinnedIds.has(n.id));

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
        <NoteTreeItem noteId={note.id} depth={0} />
      </li>
    );
  }

  return (
    <div className="px-2 space-y-0.5">
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
  );
}