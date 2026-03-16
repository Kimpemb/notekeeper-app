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
  bulkUpdateSortOrder,
  getNoteById,
  recordVisit as dbRecordVisit,
  getRecentVisits,
  getSetting,
  setSetting,
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/features/notes/db/queries";
import type { Note } from "@/types";

const PINNED_SETTING_KEY = "pinned_ids";

async function loadPinnedIds(): Promise<Set<string>> {
  try {
    const raw = await getSetting(PINNED_SETTING_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function savePinnedIds(ids: Set<string>): Promise<void> {
  await setSetting(PINNED_SETTING_KEY, JSON.stringify([...ids]));
}

interface NoteStore {
  notes: Note[];
  trashedNotes: Note[];
  activeNoteId: string | null;
  pinnedIds: Set<string>;
  visitedNoteIds: string[];
  isLoading: boolean;
  error: string | null;

  activeNote: () => Note | null;
  rootNotes: () => Note[];
  childrenOf: (parentId: string) => Note[];
  pinnedNotes: () => Note[];
  unpinnedNotes: () => Note[];

  loadNotes: () => Promise<void>;
  loadTrashedNotes: () => Promise<void>;
  loadRecentVisits: () => Promise<void>;
  setActiveNote: (id: string | null) => void;
  recordVisit: (id: string) => Promise<void>;
  createNote: (input?: CreateNoteInput) => Promise<Note>;
  createChildNote: (parentId: string) => Promise<Note>;
  updateNote: (id: string, input: UpdateNoteInput) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  permanentlyDeleteNote: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  moveNote: (id: string, newParentId: string | null) => Promise<void>;
  reorderNote: (draggedId: string, targetId: string, section: "pinned" | "notes") => Promise<void>;
  refreshNote: (id: string) => Promise<void>;
  pinNote: (id: string) => Promise<void>;
  unpinNote: (id: string) => Promise<void>;
  isPinned: (id: string) => boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  pinnedIds: new Set(),
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
    return notes.filter((n) => n.parent_id === null && pinnedIds.has(n.id));
  },

  unpinnedNotes: () => {
    const { notes, pinnedIds } = get();
    return notes.filter((n) => n.parent_id === null && !pinnedIds.has(n.id));
  },

  // ─── Load ──────────────────────────────────────────────────────────────────

  loadNotes: async () => {
    set({ isLoading: true, error: null });
    try {
      const [notes, pinnedIds] = await Promise.all([getAllNotes(), loadPinnedIds()]);
      set({ notes, pinnedIds, isLoading: false });
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
      set({ visitedNoteIds: visits.map((v) => v.note_id) });
    } catch (err) {
      console.error("Failed to load recent visits:", err);
    }
  },

  setActiveNote: (id) => {
    set({ activeNoteId: id });
    if (id) get().recordVisit(id).catch(console.error);
  },

  recordVisit: async (id) => {
    await dbRecordVisit(id);
    await get().loadRecentVisits();
  },

  // ─── Create ────────────────────────────────────────────────────────────────

  createNote: async (input = {}) => {
    const title = input.title ?? nextUntitledName(get().notes);
    const note = await dbCreateNote({ ...input, title });
    set((state) => ({ notes: [...state.notes, note] }));
    get().setActiveNote(note.id);
    return note;
  },

  createChildNote: async (parentId) => {
    const title = nextUntitledName(get().notes);
    const note = await dbCreateNote({ parent_id: parentId, title });
    set((state) => ({ notes: [...state.notes, note] }));
    get().setActiveNote(note.id);
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

  // ─── Reorder (drag-and-drop) ───────────────────────────────────────────────

  reorderNote: async (draggedId, targetId, section) => {
    const { notes, pinnedIds } = get();

    // Get the ordered list for the relevant section
    const sectionNotes = notes.filter((n) =>
      n.parent_id === null &&
      (section === "pinned" ? pinnedIds.has(n.id) : !pinnedIds.has(n.id))
    );

    const draggedIndex = sectionNotes.findIndex((n) => n.id === draggedId);
    const targetIndex  = sectionNotes.findIndex((n) => n.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

    // Reorder in memory
    const reordered = [...sectionNotes];
    const [dragged] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, dragged);

    // Assign new sort_order values (0-based, stepped by 1)
    const updates = reordered.map((n, i) => ({ id: n.id, sort_order: i }));

    // Optimistic update in store
    const updatedMap = new Map(updates.map((u) => [u.id, u.sort_order]));
    set((state) => ({
      notes: state.notes.map((n) =>
        updatedMap.has(n.id) ? { ...n, sort_order: updatedMap.get(n.id)! } : n
      ).sort((a, b) => a.sort_order - b.sort_order),
    }));

    // Persist to DB
    await bulkUpdateSortOrder(updates);
  },

  // ─── Trash (soft delete) ───────────────────────────────────────────────────

  deleteNote: async (id) => {
    const { notes } = get();
    const descendants = collectDescendants(id, notes);
    const allIds = new Set([id, ...descendants]);

    await dbTrashNote(id);
    const trashedNotes = await getTrashedNotes();

    set((state) => {
      const remaining = state.notes.filter((n) => !allIds.has(n.id));
      const newPinnedIds = new Set([...state.pinnedIds].filter((pid) => !allIds.has(pid)));
      savePinnedIds(newPinnedIds).catch(console.error);
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
    const [notes, trashedNotes] = await Promise.all([getAllNotes(), getTrashedNotes()]);
    set({ notes, trashedNotes });
  },

  // ─── Permanently delete ────────────────────────────────────────────────────

  permanentlyDeleteNote: async (id) => {
    await dbPermanentlyDeleteNote(id);
    const trashedNotes = await getTrashedNotes();
    set((state) => ({
      trashedNotes,
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

  pinNote: async (id) => {
    set((state) => {
      const newPinnedIds = new Set(state.pinnedIds);
      newPinnedIds.add(id);
      savePinnedIds(newPinnedIds).catch(console.error);
      return { pinnedIds: newPinnedIds };
    });
  },

  unpinNote: async (id) => {
    set((state) => {
      const newPinnedIds = new Set(state.pinnedIds);
      newPinnedIds.delete(id);
      savePinnedIds(newPinnedIds).catch(console.error);
      return { pinnedIds: newPinnedIds };
    });
  },

  isPinned: (id) => get().pinnedIds.has(id),
}));