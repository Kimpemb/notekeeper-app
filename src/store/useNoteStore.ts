// src/store/useNoteStore.ts
import { create } from "zustand";
import {
  getAllNotes,
  createNote as dbCreateNote,
  updateNote as dbUpdateNote,
  deleteNote as dbDeleteNote,
  moveNote as dbMoveNote,
  getNoteById,
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/db/queries";
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
  notes: Note[];
  activeNoteId: string | null;
  pinnedIds: Set<string>;
  isLoading: boolean;
  error: string | null;

  activeNote: () => Note | null;
  rootNotes: () => Note[];
  childrenOf: (parentId: string) => Note[];
  pinnedNotes: () => Note[];
  recentNotes: () => Note[];

  loadNotes: () => Promise<void>;
  setActiveNote: (id: string | null) => void;
  createNote: (input?: CreateNoteInput) => Promise<Note>;
  createChildNote: (parentId: string) => Promise<Note>;
  updateNote: (id: string, input: UpdateNoteInput) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
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

// ─── Sort by updated_at descending ───────────────────────────────────────────

function byRecency(a: Note, b: Note): number {
  return b.updated_at - a.updated_at;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useNoteStore = create<NoteStore>((set, get) => ({
  notes: [],
  activeNoteId: null,
  pinnedIds: loadPinnedIds(),
  isLoading: false,
  error: null,

  activeNote: () => {
    const { notes, activeNoteId } = get();
    if (!activeNoteId) return null;
    return notes.find((n) => n.id === activeNoteId) ?? null;
  },

  rootNotes: () => get().notes.filter((n) => n.parent_id === null),

  childrenOf: (parentId) => get().notes.filter((n) => n.parent_id === parentId),

  // Pinned root notes — in pin order (order they were pinned)
  pinnedNotes: () => {
    const { notes, pinnedIds } = get();
    return notes
      .filter((n) => n.parent_id === null && pinnedIds.has(n.id))
      .sort(byRecency);
  },

  // Unpinned root notes — sorted by most recently updated
  recentNotes: () => {
    const { notes, pinnedIds } = get();
    return notes
      .filter((n) => n.parent_id === null && !pinnedIds.has(n.id))
      .sort(byRecency);
  },

  // ─── Load ──────────────────────────────────────────────────────────────────

  loadNotes: async () => {
    set({ isLoading: true, error: null });
    try {
      const notes = await getAllNotes();
      set({ notes, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  setActiveNote: (id) => set({ activeNoteId: id }),

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

  // ─── Delete ────────────────────────────────────────────────────────────────

  deleteNote: async (id) => {
    const { notes } = get();
    const toDelete = collectDescendants(id, notes);
    toDelete.add(id);
    await dbDeleteNote(id);
    set((state) => {
      const remaining = state.notes.filter((n) => !toDelete.has(n.id));
      // Clean up any pinned IDs that no longer exist
      const newPinnedIds = new Set([...state.pinnedIds].filter((pid) => !toDelete.has(pid)));
      savePinnedIds(newPinnedIds);
      const newActiveId =
        state.activeNoteId && toDelete.has(state.activeNoteId)
          ? remaining[0]?.id ?? null
          : state.activeNoteId;
      return { notes: remaining, activeNoteId: newActiveId, pinnedIds: newPinnedIds };
    });
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

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