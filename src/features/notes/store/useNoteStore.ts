// src/features/notes/store/useNoteStore.ts
import { create } from "zustand";
import {
  getAllNotes,
  getTrashedNotes,
  createNote as dbCreateNote,
  updateNote as dbUpdateNote,
  trashNote as dbTrashNote,
  restoreNote as dbRestoreNote,
  permanentlyDeleteNote as dbPermanentlyDeleteNote,
  emptyTrash as dbEmptyTrash,
  moveNote as dbMoveNote,
  getNoteById,
  recordVisit as dbRecordVisit,
  getRecentVisits,
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/features/notes/db/queries";
import type { Note } from "@/types";

const PINNED_STORAGE_KEY = "notekeeper:pinned";

function loadPinnedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function savePinnedIds(ids: Set<string>) {
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...ids]));
}

interface NoteStore {
  notes: Note[];          // live (non-trashed) notes
  trashedNotes: Note[];   // trashed notes
  activeNoteId: string | null;
  pinnedIds: Set<string>;
  visitedNoteIds: string[];
  isLoading: boolean;
  error: string | null;

  activeNote: () => Note | null;
  rootNotes: () => Note[];
  childrenOf: (parentId: string) => Note[];
  pinnedNotes: () => Note[];
  recentNotes: () => Note[];

  loadNotes: () => Promise<void>;
  loadTrashedNotes: () => Promise<void>;
  loadRecentVisits: () => Promise<void>;
  setActiveNote: (id: string | null) => void;
  recordVisit: (id: string) => Promise<void>;
  createNote: (input?: CreateNoteInput) => Promise<Note>;
  createChildNote: (parentId: string) => Promise<Note>;
  updateNote: (id: string, input: UpdateNoteInput) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;       // now = move to trash
  restoreNote: (id: string) => Promise<void>;
  permanentlyDeleteNote: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  moveNote: (id: string, newParentId: string | null) => Promise<void>;
  refreshNote: (id: string) => Promise<void>;
  pinNote: (id: string) => void;
  unpinNote: (id: string) => void;
  isPinned: (id: string) => boolean;
}

// ─── Untitled-X helper ────────────────────────────────────────────────────────

function nextUntitledName(notes: Note[]): string {
  const pattern = /^Untitled-(\d+)$/;
  const used = new Set<number>();
  for (const note of notes) {
    const match = note.title.match(pattern);
    if (match) used.add(parseInt(match[1], 10));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Untitled-${n}`;
}

function byRecency(a: Note, b: Note): number {
  return b.updated_at - a.updated_at;
}

function collectDescendants(id: string, notes: Note[]): Set<string> {
  const result = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = notes.filter((n) => n.parent_id === current);
    for (const child of children) {
      result.add(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  trashedNotes: [],
  activeNoteId: null,
  pinnedIds: loadPinnedIds(),
  visitedNoteIds: [],
  isLoading: false,
  error: null,

  activeNote: () => {
    const { notes, activeNoteId } = get();
    if (!activeNoteId) return null;
    return notes.find((n) => n.id === activeNoteId) ?? null;
  },

  rootNotes: () => get().notes.filter((n) => n.parent_id === null),

  childrenOf: (parentId) => get().notes.filter((n) => n.parent_id === parentId),

  pinnedNotes: () => {
    const { notes, pinnedIds } = get();
    return notes
      .filter((n) => n.parent_id === null && pinnedIds.has(n.id))
      .sort(byRecency);
  },

  recentNotes: () => {
    const { notes, pinnedIds, visitedNoteIds } = get();
    const unpinned = notes.filter((n) => n.parent_id === null && !pinnedIds.has(n.id));
    console.log("[recentNotes] visitedNoteIds", visitedNoteIds);
    console.log("[recentNotes] unpinned ids", unpinned.map(n => n.id));
  // ...rest unchanged
    if (visitedNoteIds.length === 0) return unpinned.sort(byRecency);
    const unpinnedMap = new Map(unpinned.map((n) => [n.id, n]));
    const ordered: Note[] = [];
    const seen = new Set<string>();
    for (const id of visitedNoteIds) {
      const note = unpinnedMap.get(id);
      if (note) { ordered.push(note); seen.add(id); }
    }
    // append any notes never visited, sorted by recency
    const unvisited = unpinned.filter((n) => !seen.has(n.id)).sort(byRecency);
    return [...ordered, ...unvisited];
  },

  // ─── Load ──────────────────────────────────────────────────────────────────

  loadNotes: async () => {
    set({ isLoading: true, error: null });
    try {
      const notes = await getAllNotes();
      set({ notes, isLoading: false });
      await get().loadRecentVisits();
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadTrashedNotes: async () => {
    try {
      const trashedNotes = await getTrashedNotes();
      set({ trashedNotes });
    } catch (err) {
      console.error("Failed to load trash:", err);
    }
  },

  loadRecentVisits: async () => {
    try {
      const visits = await getRecentVisits(50);
      console.log("[visits] loaded", visits);
      set({ visitedNoteIds: visits.map((v) => v.note_id) });
    } catch (err) {
      console.error("Failed to load recent visits:", err);
    }
  },

  setActiveNote: (id) => {
  set({ activeNoteId: id });
    if (id) {
      console.log("[visit] recording visit for", id);
      get().recordVisit(id).catch(console.error);
    }
  },

  recordVisit: async (id) => {
    await dbRecordVisit(id);
    await get().loadRecentVisits();
  },

  // ─── Create ────────────────────────────────────────────────────────────────

  createNote: async (input = {}) => {
    const title = input.title ?? nextUntitledName(get().notes);
    const note = await dbCreateNote({ ...input, title });
    set((state) => ({
      notes: [note, ...state.notes],
      activeNoteId: note.id,
    }));
    return note;
  },

  createChildNote: async (parentId) => {
    const title = nextUntitledName(get().notes);
    const note = await dbCreateNote({ parent_id: parentId, title });
    set((state) => ({
      notes: [note, ...state.notes],
      activeNoteId: note.id,
    }));
    return note;
  },

  // ─── Update ────────────────────────────────────────────────────────────────

  updateNote: async (id, input) => {
    await dbUpdateNote(id, input);
    const updated = await getNoteById(id);
    if (!updated) return;
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? updated : n)),
    }));
  },

  // ─── Trash (soft delete) ───────────────────────────────────────────────────

  deleteNote: async (id) => {
    const { notes } = get();
    // Collect note + all descendants that will be trashed
    const descendants = collectDescendants(id, notes);
    const allIds = new Set([id, ...descendants]);

    await dbTrashNote(id);

    // Reload trashed notes to get fresh deleted_at timestamps
    const trashedNotes = await getTrashedNotes();

    set((state) => {
      const remaining = state.notes.filter((n) => !allIds.has(n.id));
      const newPinnedIds = new Set([...state.pinnedIds].filter((pid) => !allIds.has(pid)));
      savePinnedIds(newPinnedIds);
      const newActiveId =
        state.activeNoteId && allIds.has(state.activeNoteId)
          ? remaining[0]?.id ?? null
          : state.activeNoteId;
      return { notes: remaining, trashedNotes, activeNoteId: newActiveId, pinnedIds: newPinnedIds };
    });
  },

  // ─── Restore from trash ────────────────────────────────────────────────────

  restoreNote: async (id) => {
    await dbRestoreNote(id);
    // Reload both live and trashed lists
    const [notes, trashedNotes] = await Promise.all([getAllNotes(), getTrashedNotes()]);
    set({ notes, trashedNotes });
  },

  // ─── Permanently delete ────────────────────────────────────────────────────

  permanentlyDeleteNote: async (id) => {
    await dbPermanentlyDeleteNote(id);
    const trashedNotes = await getTrashedNotes();
    set((state) => ({
      trashedNotes,
      // If permanently deleting a note that somehow got re-activated
      activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
    }));
  },

  // ─── Empty trash ───────────────────────────────────────────────────────────

  emptyTrash: async () => {
    await dbEmptyTrash();
    set({ trashedNotes: [] });
  },

  // ─── Move ──────────────────────────────────────────────────────────────────

  moveNote: async (id, newParentId) => {
    await dbMoveNote(id, newParentId);
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, parent_id: newParentId } : n
      ),
    }));
  },

  // ─── Refresh single note ───────────────────────────────────────────────────

  refreshNote: async (id) => {
    const updated = await getNoteById(id);
    if (!updated) return;
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? updated : n)),
    }));
  },

  // ─── Pin / Unpin ───────────────────────────────────────────────────────────

  pinNote: (id) => {
    set((state) => {
      const newPinnedIds = new Set(state.pinnedIds);
      newPinnedIds.add(id);
      savePinnedIds(newPinnedIds);
      return { pinnedIds: newPinnedIds };
    });
  },

  unpinNote: (id) => {
    set((state) => {
      const newPinnedIds = new Set(state.pinnedIds);
      newPinnedIds.delete(id);
      savePinnedIds(newPinnedIds);
      return { pinnedIds: newPinnedIds };
    });
  },

  

  isPinned: (id) => get().pinnedIds.has(id),
}));