// src/features/notes/components/Sidebar/NoteTree.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { NoteTreeItem } from "./NoteTreeItem";
import type { Note } from "@/types";

type SortOrder = 
  | "alpha-asc" 
  | "alpha-desc" 
  | "modified-desc" 
  | "modified-asc" 
  | "created-desc" 
  | "created-asc";

function noteHasTag(tags: string | null, tag: string): boolean {
  if (!tags) return false;
  try { return (JSON.parse(tags) as string[]).includes(tag); }
  catch { return false; }
}

interface DragState {
  draggedId: string;
  section: "pinned" | "notes";
}

interface NoteTreeProps {
  sortOrder: SortOrder;
}

export function NoteTree({ sortOrder }: NoteTreeProps) {
  const notes        = useNoteStore((s) => s.notes);
  const pinnedIds    = useNoteStore((s) => s.pinnedIds);
  const reorderNote  = useNoteStore((s) => s.reorderNote);
  const deleteNote   = useNoteStore((s) => s.deleteNote);
  const setActive    = useNoteStore((s) => s.setActiveNote);
  const activeTag    = useUIStore((s) => s.activeTag);
  const setActiveTag = useUIStore((s) => s.setActiveTag);
  const selectedNoteIds    = useUIStore((s) => s.selectedNoteIds);
  const clearSelection     = useUIStore((s) => s.clearSelection);
  const toggleNoteSelection = useUIStore((s) => s.toggleNoteSelection);
  const replaceTab         = useUIStore((s) => s.replaceTab);

  const [drag, setDrag]                 = useState<DragState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Keyboard nav state — which item currently has sidebar focus.
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null);

  // Ref shared across all NoteTreeItems for Shift+click range anchor.
  const lastSelectedIdRef = useRef<string | null>(null);

  // Refs kept current for keydown handler to avoid stale closures.
  const focusedNoteIdRef    = useRef<string | null>(null);

  useEffect(() => { focusedNoteIdRef.current = focusedNoteId; }, [focusedNoteId]);

  // ── Sort notes function ─────────────────────────────────────────────────────
  const sortNotes = useCallback((notesArray: Note[]): Note[] => {
    return [...notesArray].sort((a, b) => {
      switch (sortOrder) {
        case "alpha-asc":
          return a.title.localeCompare(b.title);
        case "alpha-desc":
          return b.title.localeCompare(a.title);
        case "modified-desc":
          return b.updated_at - a.updated_at;
        case "modified-asc":
          return a.updated_at - b.updated_at;
        case "created-desc":
          return b.created_at - a.created_at;
        case "created-asc":
          return a.created_at - b.created_at;
        default:
          return b.updated_at - a.updated_at;
      }
    });
  }, [sortOrder]);

  // ── Delete selected notes ──────────────────────────────────────────────────
  const deleteSelectedNotes = useCallback(async () => {
    const ids = [...selectedNoteIds];
    if (ids.length === 0) return;
    
    clearSelection();
    
    for (const id of ids) {
      try {
        await deleteNote(id);
      } catch (error) {
        console.error(`Failed to delete note ${id}:`, error);
      }
    }
  }, [selectedNoteIds, clearSelection, deleteNote]);

  // ── Keyboard handler ───────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

    const { selectedNoteIds: sel } = useUIStore.getState();
    const { notes: allNotes, pinnedIds: pins } = useNoteStore.getState();

    const pinnedList   = allNotes.filter((n) => n.parent_id === null && pins.has(n.id));
    const unpinnedList = allNotes.filter((n) => n.parent_id === null && !pins.has(n.id));
    const flat         = [...pinnedList, ...unpinnedList].map((n) => n.id);

    if (flat.length === 0) return;

    if (e.key === "Delete" && sel.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      deleteSelectedNotes();
      return;
    }

    if (e.key === "Escape") {
      if (sel.size > 0) { 
        useUIStore.getState().clearSelection(); 
        return; 
      }
      if (focusedNoteIdRef.current) { 
        setFocusedNoteId(null); 
        return; 
      }
    }

    const currentFocus = focusedNoteIdRef.current ?? useNoteStore.getState().activeNoteId;
    if (!currentFocus) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

    e.preventDefault();

    const currentIdx = flat.indexOf(currentFocus);
    if (currentIdx === -1) return;

    const nextIdx = e.key === "ArrowDown"
      ? Math.min(currentIdx + 1, flat.length - 1)
      : Math.max(currentIdx - 1, 0);

    const nextId = flat[nextIdx];
    if (!nextId || nextId === currentFocus) return;

    if (e.shiftKey && sel.size > 0) {
      useUIStore.getState().toggleNoteSelection(nextId);
      lastSelectedIdRef.current = nextId;
    } else if (e.shiftKey) {
      useUIStore.getState().toggleNoteSelection(currentFocus);
      useUIStore.getState().toggleNoteSelection(nextId);
      lastSelectedIdRef.current = nextId;
    }
    setFocusedNoteId(nextId);

  }, [deleteSelectedNotes]);

  const handleEnterSpace = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

    const focused = focusedNoteIdRef.current;
    if (!focused) return;

    if (e.key === "Enter") {
      e.preventDefault();
      setActive(focused);
      replaceTab(focused);
      lastSelectedIdRef.current = focused;
    }

    if (e.key === " ") {
      e.preventDefault();
      toggleNoteSelection(focused);
      lastSelectedIdRef.current = focused;
    }
  }, [setActive, replaceTab, toggleNoteSelection]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleEnterSpace);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", handleEnterSpace);
    };
  }, [handleKeyDown, handleEnterSpace]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const sidebar = document.getElementById("sidebar-panel");
      if (sidebar && !sidebar.contains(e.target as Node)) {
        setFocusedNoteId(null);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // ── Tag filter view ────────────────────────────────────────────────────────
  if (activeTag) {
    const tagged = notes.filter((n) => noteHasTag(n.tags, activeTag));
    const taggedIds = tagged.map((n) => n.id);
    const sortedTagged = sortNotes(tagged);
    
    return (
      <div className="px-2">
        <div className="flex items-center gap-2 px-2 pt-2 pb-1">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-idemora-text-muted select-none flex-1">
            #{activeTag}
          </span>
          <button
            onClick={() => setActiveTag(null)}
            className="text-[10px] text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
          >
            Clear
          </button>
        </div>
        {sortedTagged.length === 0 ? (
          <p className="px-2 py-4 text-xs text-idemora-text-muted text-center select-none">
            No notes tagged #{activeTag}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sortedTagged.map((note) => (
              <NoteTreeItem
                key={note.id}
                noteId={note.id}
                depth={0}
                flatOrderedIds={taggedIds}
                lastSelectedIdRef={lastSelectedIdRef}
                focusedNoteId={focusedNoteId}
                setFocusedNoteId={setFocusedNoteId}
                sortOrder={sortOrder}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Default tree view ──────────────────────────────────────────────────────
  const pinnedNotes = sortNotes(notes.filter((n) => n.parent_id === null && pinnedIds.has(n.id)));
  const unpinnedNotes = sortNotes(notes.filter((n) => n.parent_id === null && !pinnedIds.has(n.id)));
  const flatOrderedIds = [...pinnedNotes, ...unpinnedNotes].map((n) => n.id);
  const selectionCount = selectedNoteIds.size;

  if (pinnedNotes.length === 0 && unpinnedNotes.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-idemora-text-muted text-center select-none">
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
          focusedNoteId={focusedNoteId}
          setFocusedNoteId={setFocusedNoteId}
          sortOrder={sortOrder}
        />
      </li>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {selectionCount > 0 && (
        <div className="mx-2 mb-1 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center gap-2">
          <span className="flex-1 text-xs font-medium text-blue-400">
            {selectionCount} selected
          </span>
          <button
            onClick={deleteSelectedNotes}
            title="Move selected to trash (Del)"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors duration-75"
          >
            <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
              <path d="M2 3h9M5 3V2h3v1M3.5 3l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Trash
          </button>
          <button
            onClick={clearSelection}
            title="Clear selection (Esc)"
            className="w-5 h-5 flex items-center justify-center rounded text-blue-400 hover:bg-blue-500/10 transition-colors duration-75"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      <div className="px-2 space-y-0.5 flex-1">
        {pinnedNotes.length > 0 && (
          <div className="mb-1">
            <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase text-idemora-text-muted select-none">
              Pinned
            </p>
            <ul className="space-y-0.5">
              {pinnedNotes.map((note) => renderNote(note, "pinned"))}
            </ul>
          </div>
        )}

        {pinnedNotes.length > 0 && unpinnedNotes.length > 0 && (
          <div className="mx-2 border-t border-idemora-border my-1" />
        )}

        {unpinnedNotes.length > 0 && (
          <div>
            {pinnedNotes.length > 0 && (
              <p className="px-2 pt-1 pb-1 text-[10px] font-semibold tracking-widest uppercase text-idemora-text-muted select-none">
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