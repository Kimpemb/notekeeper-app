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
  import type { Template } from "@/lib/templates";

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

  // ─── Daily note helpers ───────────────────────────────────────────────────────

  export function getDailyNoteTitle(date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  interface NoteStore {
    notes: Note[];
    trashedNotes: Note[];
    activeNoteId: string | null;
    pinnedIds: Set<string>;
    visitedNoteIds: string[];
    isLoading: boolean;
    error: string | null;

    // Navigation history
    navHistory: string[];
    navIndex: number;
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    goBack: () => void;
    goForward: () => void;

    activeNote: () => Note | null;
    rootNotes: () => Note[];
    childrenOf: (parentId: string) => Note[];
    pinnedNotes: () => Note[];
    unpinnedNotes: () => Note[];

    loadNotes: () => Promise<void>;
    loadTrashedNotes: () => Promise<void>;
    loadRecentVisits: () => Promise<void>;
    setActiveNote: (id: string | null, skipHistory?: boolean) => void;
    recordVisit: (id: string) => Promise<void>;

    // createNote: skips template picker (used internally / for child notes / import)
    createNote: (input?: CreateNoteInput) => Promise<Note>;
    // createNoteFromTemplate: applies a template's content and default title
    createNoteFromTemplate: (template: Template, input?: CreateNoteInput) => Promise<Note>;
    // createOrOpenDailyNote: opens today's note if it exists, else creates it from the daily template
    createOrOpenDailyNote: () => Promise<Note>;

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

  export const useNoteStore = create<NoteStore>((set, get) => ({
    notes: [],
    trashedNotes: [],
    activeNoteId: null,
    pinnedIds: new Set(),
    visitedNoteIds: [],
    isLoading: false,
    error: null,

    navHistory: [],
    navIndex: -1,

    canGoBack: () => get().navIndex > 0,

    canGoForward: () => {
      const { navHistory, navIndex } = get();
      return navIndex < navHistory.length - 1;
    },

    goBack: () => {
      const { navHistory, navIndex } = get();
      if (navIndex <= 0) return;
      const newIndex = navIndex - 1;
      const id = navHistory[newIndex];
      set({ navIndex: newIndex, activeNoteId: id });
      get().recordVisit(id).catch(console.error);
    },

    goForward: () => {
      const { navHistory, navIndex } = get();
      if (navIndex >= navHistory.length - 1) return;
      const newIndex = navIndex + 1;
      const id = navHistory[newIndex];
      set({ navIndex: newIndex, activeNoteId: id });
      get().recordVisit(id).catch(console.error);
    },

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

    setActiveNote: (id, skipHistory = false) => {
      if (!skipHistory && id) {
        set((state) => {
          const trimmed = state.navHistory.slice(0, state.navIndex + 1);
          if (trimmed[trimmed.length - 1] === id) {
            return { activeNoteId: id };
          }
          return {
            activeNoteId: id,
            navHistory: [...trimmed, id],
            navIndex: trimmed.length,
          };
        });
      } else {
        set({ activeNoteId: id });
      }
      if (id) get().recordVisit(id).catch(console.error);
    },

    recordVisit: async (id) => {
      await dbRecordVisit(id);
      await get().loadRecentVisits();
    },

    // Plain create — no template, no picker. Used by child note creation, import, etc.
    createNote: async (input = {}) => {
      const title = input.title ?? nextUntitledName(get().notes);
      const note = await dbCreateNote({ ...input, title });
      set((state) => ({ notes: [...state.notes, note] }));
      get().setActiveNote(note.id);
      return note;
    },

    // Create from a specific template
    createNoteFromTemplate: async (template, input = {}) => {
    const baseTitle = input.title ?? (template.defaultTitle || nextUntitledName(get().notes));
    const content = JSON.stringify(template.content);

    const note = await dbCreateNote({ ...input, title: baseTitle, content });

    set((state) => ({ notes: [...state.notes, note] }));

    // ❌ DO NOT set active note here
    return note;
  },

    // Open today's daily note, or create one if it doesn't exist
    createOrOpenDailyNote: async () => {
      const { notes } = get();
      const title = getDailyNoteTitle();
      const existing = notes.find((n) => n.title === title && !n.deleted_at);
      if (existing) {
        get().setActiveNote(existing.id);
        return existing;
      }
      // Lazy import to avoid circular deps at module load time
      const { daily } = await import("@/lib/templates/daily");
      return get().createNoteFromTemplate(daily, { title });
    },

    createChildNote: async (parentId) => {
      const title = nextUntitledName(get().notes);
      const note = await dbCreateNote({ parent_id: parentId, title });
      set((state) => ({ notes: [...state.notes, note] }));
      get().setActiveNote(note.id);
      return note;
    },

    updateNote: async (id, input) => {
      await dbUpdateNote(id, input);
      const updated = await getNoteById(id);
      if (!updated) return;
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? updated : n)),
      }));
    },

    reorderNote: async (draggedId, targetId, section) => {
      const { notes, pinnedIds } = get();
      const sectionNotes = notes.filter((n) =>
        n.parent_id === null &&
        (section === "pinned" ? pinnedIds.has(n.id) : !pinnedIds.has(n.id))
      );
      const draggedIndex = sectionNotes.findIndex((n) => n.id === draggedId);
      const targetIndex  = sectionNotes.findIndex((n) => n.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;
      const reordered = [...sectionNotes];
      const [dragged] = reordered.splice(draggedIndex, 1);
      reordered.splice(targetIndex, 0, dragged);
      const updates = reordered.map((n, i) => ({ id: n.id, sort_order: i }));
      const updatedMap = new Map(updates.map((u) => [u.id, u.sort_order]));
      set((state) => ({
        notes: state.notes.map((n) =>
          updatedMap.has(n.id) ? { ...n, sort_order: updatedMap.get(n.id)! } : n
        ).sort((a, b) => a.sort_order - b.sort_order),
      }));
      await bulkUpdateSortOrder(updates);
    },

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
        const newHistory = state.navHistory.filter((hid) => !allIds.has(hid));
        const newIndex = Math.min(state.navIndex, newHistory.length - 1);
        return {
          notes: remaining,
          trashedNotes,
          activeNoteId: newActiveId,
          pinnedIds: newPinnedIds,
          navHistory: newHistory,
          navIndex: newIndex,
        };
      });

      // Close any background tabs that were showing the deleted notes.
      // Import lazily to avoid a circular module dependency.
      const { useUIStore } = await import("@/features/ui/store/useUIStore");
      useUIStore.getState().closeTabsForNotes(allIds);
    },

    restoreNote: async (id) => {
      await dbRestoreNote(id);
      const [notes, trashedNotes] = await Promise.all([getAllNotes(), getTrashedNotes()]);
      set({ notes, trashedNotes });
    },

    permanentlyDeleteNote: async (id) => {
      await dbPermanentlyDeleteNote(id);
      const trashedNotes = await getTrashedNotes();
      set((state) => ({
        trashedNotes,
        activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
      }));
    },

    emptyTrash: async () => {
      await dbEmptyTrash();
      set({ trashedNotes: [] });
    },

    moveNote: async (id, newParentId) => {
      await dbMoveNote(id, newParentId);
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === id ? { ...n, parent_id: newParentId } : n
        ),
      }));
    },

    refreshNote: async (id) => {
      const updated = await getNoteById(id);
      if (!updated) return;
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? updated : n)),
      }));
    },

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