// src/store/useNoteStore.ts
// Central store for all note data. Single source of truth.
// UI components read from here; never query the DB directly.

import { create } from "zustand";
import {
  getAllNotes,
  createNote,
  updateNote,
  deleteNote,
  moveNote,
  getNoteById,
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/db/queries";
import type { Note } from "@/types";

interface NoteStore {
  // ─── State ────────────────────────────────────────────────────────────────
  notes: Note[];                  // All notes, flat array — UI builds tree from this
  activeNoteId: string | null;    // Currently open note
  isLoading: boolean;
  error: string | null;

  // ─── Derived ──────────────────────────────────────────────────────────────
  activeNote: () => Note | null;
  rootNotes: () => Note[];
  childrenOf: (parentId: string) => Note[];

  // ─── Actions ──────────────────────────────────────────────────────────────
  loadNotes: () => Promise<void>;
  setActiveNote: (id: string | null) => void;
  createNote: (input?: CreateNoteInput) => Promise<Note>;
  createChildNote: (parentId: string) => Promise<Note>;
  updateNote: (id: string, input: UpdateNoteInput) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  moveNote: (id: string, newParentId: string | null) => Promise<void>;
  refreshNote: (id: string) => Promise<void>;
}

export const useNoteStore = create<NoteStore>((set, get) => ({
  // ─── Initial state ────────────────────────────────────────────────────────
  notes: [],
  activeNoteId: null,
  isLoading: false,
  error: null,

  // ─── Derived helpers ──────────────────────────────────────────────────────

  activeNote: () => {
    const { notes, activeNoteId } = get();
    if (!activeNoteId) return null;
    return notes.find((n) => n.id === activeNoteId) ?? null;
  },

  rootNotes: () => {
    return get().notes.filter((n) => n.parent_id === null);
  },

  childrenOf: (parentId: string) => {
    return get().notes.filter((n) => n.parent_id === parentId);
  },

  // ─── Load ─────────────────────────────────────────────────────────────────

  loadNotes: async () => {
    set({ isLoading: true, error: null });
    try {
      const notes = await getAllNotes();
      set({ notes, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  // ─── Active note ──────────────────────────────────────────────────────────

  setActiveNote: (id) => {
    set({ activeNoteId: id });
  },

  // ─── Create ───────────────────────────────────────────────────────────────

  createNote: async (input = {}) => {
    const note = await createNote(input);
    set((state) => ({
      notes: [note, ...state.notes],
      activeNoteId: note.id,
    }));
    return note;
  },

  createChildNote: async (parentId: string) => {
    const note = await createNote({ parent_id: parentId });
    set((state) => ({
      notes: [note, ...state.notes],
      activeNoteId: note.id,
    }));
    return note;
  },

  // ─── Update ───────────────────────────────────────────────────────────────

  updateNote: async (id, input) => {
    await updateNote(id, input);
    // Refresh the single note in the store without a full reload
    const updated = await getNoteById(id);
    if (!updated) return;
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? updated : n)),
    }));
  },

  // ─── Delete ───────────────────────────────────────────────────────────────

  deleteNote: async (id) => {
    // Collect all descendant IDs so we can remove them from the store too
    const { notes } = get();
    const toDelete = collectDescendants(id, notes);
    toDelete.add(id);

    await deleteNote(id);

    set((state) => {
      const remaining = state.notes.filter((n) => !toDelete.has(n.id));
      const newActiveId =
        state.activeNoteId && toDelete.has(state.activeNoteId)
          ? remaining[0]?.id ?? null
          : state.activeNoteId;
      return { notes: remaining, activeNoteId: newActiveId };
    });
  },

  // ─── Move ─────────────────────────────────────────────────────────────────

  moveNote: async (id, newParentId) => {
    await moveNote(id, newParentId);
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, parent_id: newParentId } : n
      ),
    }));
  },

  // ─── Refresh single note (used by auto-save) ──────────────────────────────

  refreshNote: async (id) => {
    const updated = await getNoteById(id);
    if (!updated) return;
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? updated : n)),
    }));
  },
}));

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Collect all descendant IDs from the in-memory notes array.
 * Used to purge the store after a delete without a full DB reload.
 */
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