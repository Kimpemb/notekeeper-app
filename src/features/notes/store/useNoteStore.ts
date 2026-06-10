// src/features/notes/store/useNoteStore.ts
import { create } from "zustand";
import {
  getAllNotes,
  getAllNotesMeta,
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
  loadBookmarks,
  saveBookmarks,
  addNoteBookmark,
  removeBookmark,
  addBookmarkGroup,
  setRagExcluded as dbSetRagExcluded,
  type CreateNoteInput,
  type UpdateNoteInput,
} from "@/features/notes/db/queries";
import type { Note, BookmarkItem, NoteBookmark } from "@/types";
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
  dbSettled: boolean;
  setDbSettled: () => void;
  
  // ─── Bookmarks ──────────────────────────────────────────────────────────────
  bookmarks: BookmarkItem[];

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
  updateCanvasStateInMemory: (id: string, canvasState: string) => void;
  createNote: (input?: CreateNoteInput) => Promise<Note>;
  createNoteFromTemplate: (template: Template, input?: CreateNoteInput) => Promise<Note>;
  createOrOpenDailyNote: () => Promise<Note>;
  createChildNote: (parentId: string, title?: string) => Promise<Note>;
  createCanvasNote: (name?: string) => Promise<Note>;
  updateCanvasState: (id: string, canvasState: string) => Promise<void>;
  
  updateNote: (id: string, input: UpdateNoteInput, silent?: boolean) => Promise<void>;
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
  loadNoteContent: (id: string) => Promise<void>; // ADDED

  // ─── Bookmark actions ──────────────────────────────────────────────────────
  addBookmark: (noteId: string, groupId?: string | null) => Promise<void>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
  addBookmarkGroup: (name: string) => Promise<void>;
  removeBookmarkGroup: (groupId: string) => Promise<void>;
  renameBookmarkGroup: (groupId: string, name: string) => Promise<void>;
  toggleBookmarkGroupCollapsed: (groupId: string) => Promise<void>;
  reorderBookmarks: (draggedId: string, targetId: string) => Promise<void>;
  isBookmarked: (noteId: string) => boolean;
  getBookmarkForNote: (noteId: string) => NoteBookmark | null;
  setRagExcluded: (noteId: string, excluded: boolean, cascade?: boolean) => Promise<void>;
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
  dbSettled: false,
  setDbSettled: () => set({ dbSettled: true }),

  // ─── Bookmarks initial state ───────────────────────────────────────────────
  bookmarks: [],

  navHistory: [],
  navIndex: -1,

  canGoBack: () => get().navIndex > 0,

  canGoForward: () => {
    const { navHistory, navIndex } = get();
    return navIndex < navHistory.length - 1;
  },

  goBack: async () => {
    const { navHistory, navIndex } = get();
    if (navIndex <= 0) return;
    const newIndex = navIndex - 1;
    const id = navHistory[newIndex];
    set({ navIndex: newIndex, activeNoteId: id });
    get().recordVisit(id).catch(console.error);
    const { useUIStore } = await import("@/features/ui/store/useUIStore");
    useUIStore.getState().replaceTab(id);
  },

  goForward: async () => {
    const { navHistory, navIndex } = get();
    if (navIndex >= navHistory.length - 1) return;
    const newIndex = navIndex + 1;
    const id = navHistory[newIndex];
    set({ navIndex: newIndex, activeNoteId: id });
    get().recordVisit(id).catch(console.error);
    const { useUIStore } = await import("@/features/ui/store/useUIStore");
    useUIStore.getState().replaceTab(id);
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
    const [fetchedNotes, pinnedIds, bookmarks] = await Promise.all([
      getAllNotesMeta(),
      loadPinnedIds(),
      loadBookmarks(),
    ]);

    const normalizedNotes = fetchedNotes.map((note: Note) => ({
        ...note,
      frontmatter: note.frontmatter ?? null,
      sort_order: note.sort_order ?? 0,
      tags: note.tags ?? null,
      content: note.content ?? JSON.stringify({ type: "doc", content: [] }),
      plaintext: note.plaintext ?? "",
      is_canvas: Boolean(note.is_canvas),
      canvas_state: note.canvas_state ?? null,
    }));

    set({ notes: normalizedNotes, pinnedIds, bookmarks, isLoading: false });
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
    if (id) {
      get().recordVisit(id).catch(console.error);
      import("@/features/ui/store/useUIStore").then(({ useUIStore }) => {
        useUIStore.getState().recordClusterVisit(id);
      }).catch(console.error);
    }
  },

  recordVisit: async (id) => {
    await dbRecordVisit(id);
    await get().loadRecentVisits();
  },

  createNote: async (input = {}) => {
    const title = input.title ?? nextUntitledName(get().notes);
    const note = await dbCreateNote({ ...input, title });
    set((state) => ({ notes: [...state.notes, note] }));
    get().setActiveNote(note.id);
    return note;
  },

  createNoteFromTemplate: async (template, input = {}) => {
    const baseTitle = input.title ?? (template.defaultTitle || nextUntitledName(get().notes));
    const content = JSON.stringify(template.content);
    const note = await dbCreateNote({ ...input, title: baseTitle, content });
    set((state) => ({ notes: [...state.notes, note] }));
    return note;
  },

  createOrOpenDailyNote: async () => {
    const { notes } = get();
    const title = getDailyNoteTitle();
    const existing = notes.find((n) => n.title === title && !n.deleted_at);
    if (existing) {
      get().setActiveNote(existing.id);
      return existing;
    }
    const { daily } = await import("@/lib/templates/daily");
    return get().createNoteFromTemplate(daily, { title });
  },

  createChildNote: async (parentId, title?) => {
    const resolvedTitle = title ?? nextUntitledName(get().notes);
    const note = await dbCreateNote({ parent_id: parentId, title: resolvedTitle });
    set((state) => ({ notes: [...state.notes, note] }));
    get().setActiveNote(note.id);
    return note;
  },

  createCanvasNote: async (name = "Untitled") => {
    const note = await dbCreateNote({
      title: name,
      is_canvas: true,
      canvas_state: JSON.stringify({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),
    });
    set((state) => ({ notes: [...state.notes, note] }));
    get().setActiveNote(note.id);
    return note;
  },

  updateCanvasState: async (id, canvasState) => {
    await dbUpdateNote(id, { canvas_state: canvasState });
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, canvas_state: canvasState } : n
      ),
    }));
  },


updateCanvasStateInMemory: (id, canvasState) => {
  set((state) => ({
    notes: state.notes.map((n) =>
      n.id === id ? { ...n, canvas_state: canvasState } : n
    ),
  }));
},

updateNote: async (id, input, silent = false) => {
  if (!silent) {
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, ...input, updated_at: Date.now() } : n
      ),
    }));
  }
  await dbUpdateNote(id, input);
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
          ? null
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
  const oldParentId = get().notes.find((n) => n.id === id)?.parent_id ?? null;
  await dbMoveNote(id, newParentId);
  set((state) => ({
    notes: state.notes.map((n) =>
      n.id === id ? { ...n, parent_id: newParentId } : n
    ),
  }));

  // Persist subpage block changes to affected parents in the DB directly,
  // so the block is present even if the parent editor isn't currently open.
  const { getNoteContent, updateNote: dbUpdate } = await import("@/features/notes/db/queries");
  const movedNote = get().notes.find((n) => n.id === id);

  // Add block to destination parent
  if (newParentId) {
    const { content: destContent } = await getNoteContent(newParentId);
    if (destContent) {
      try {
        const doc = JSON.parse(destContent) as { type: string; content: unknown[] };
        const already = (doc.content ?? []).some((node) => {
          const n = node as { type: string; attrs?: { noteId?: string } };
          return (n.type === "subPage" || n.type === "pdfLink") && n.attrs?.noteId === id;
        });
        if (!already) {
          const newBlock = movedNote?.source_type === "pdf"
            ? { type: "pdfLink", attrs: { noteId: id, title: movedNote.title } }
            : { type: "subPage", attrs: { noteId: id, title: movedNote?.title ?? "Untitled", mode: "display" } };
          const last = doc.content[doc.content.length - 1] as { type: string; content?: unknown[] } | undefined;
          const lastIsEmptyPara = last?.type === "paragraph" && (!last.content || last.content.length === 0);
          if (lastIsEmptyPara) {
            doc.content.splice(doc.content.length - 1, 0, newBlock);
          } else {
            doc.content.push(newBlock);
          }
          const newContent = JSON.stringify(doc);
          await dbUpdate(newParentId, { content: newContent });
          set((state) => ({
            notes: state.notes.map((n) =>
              n.id === newParentId ? { ...n, content: newContent, updated_at: Date.now() } : n
            ),
          }));
        }
      } catch { /* malformed content — skip */ }
    }
  }

  // Remove block from source parent
  if (oldParentId) {
    const { content: srcContent } = await getNoteContent(oldParentId);
    if (srcContent) {
      try {
        const doc = JSON.parse(srcContent) as { type: string; content: unknown[] };
        const filtered = doc.content.filter((node) => {
          const n = node as { type: string; attrs?: { noteId?: string } };
          return !((n.type === "subPage" || n.type === "pdfLink") && n.attrs?.noteId === id);
        });
        if (filtered.length !== doc.content.length) {
          const newContent = JSON.stringify({ ...doc, content: filtered });
          await dbUpdate(oldParentId, { content: newContent });
          set((state) => ({
            notes: state.notes.map((n) =>
              n.id === oldParentId ? { ...n, content: newContent, updated_at: Date.now() } : n
            ),
          }));
        }
      } catch { /* malformed content — skip */ }
    }
  }

  window.dispatchEvent(
    new CustomEvent("idemora:note-moved", {
      detail: { noteId: id, oldParentId, newParentId },
    })
  );
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

  // ADDED: loadNoteContent action
  // ADDED: loadNoteContent action
loadNoteContent: async (id: string) => {
  const note = get().notes.find((n) => n.id === id);
  if (!note) return;
  const isEmpty = !note.content || 
    note.content === JSON.stringify({ type: "doc", content: [] });
  if (!isEmpty) return;
  const { getNoteContent } = await import("@/features/notes/db/queries");
  const { content, canvas_state } = await getNoteContent(id);
  set((state) => ({
    notes: state.notes.map((n) =>
      n.id === id ? { ...n, content: content ?? n.content, canvas_state: canvas_state ?? n.canvas_state } : n
    ),
  }));
},

  // ─── Bookmark actions ──────────────────────────────────────────────────────
  addBookmark: async (noteId, groupId = null) => {
    const bookmark = await addNoteBookmark(noteId, groupId);
    set((state) => {
      const already = state.bookmarks.some((b) => b.id === bookmark.id);
      if (already) return state;
      return { bookmarks: [...state.bookmarks, bookmark] };
    });
  },

  removeBookmark: async (bookmarkId) => {
    await removeBookmark(bookmarkId);
    set((state) => ({
      bookmarks: state.bookmarks.filter((b) => b.id !== bookmarkId),
    }));
  },

  addBookmarkGroup: async (name) => {
    const group = await addBookmarkGroup(name);
    set((state) => ({ bookmarks: [...state.bookmarks, group] }));
  },

  removeBookmarkGroup: async (groupId) => {
    const items = get().bookmarks.filter(
      (b) => b.id !== groupId && !(b.kind === "note" && b.groupId === groupId)
    );
    await saveBookmarks(items);
    set({ bookmarks: items });
  },

  renameBookmarkGroup: async (groupId, name) => {
    const items = get().bookmarks.map((b) =>
      b.kind === "group" && b.id === groupId ? { ...b, name } : b
    );
    await saveBookmarks(items);
    set({ bookmarks: items });
  },

  toggleBookmarkGroupCollapsed: async (groupId) => {
    const items = get().bookmarks.map((b) =>
      b.kind === "group" && b.id === groupId
        ? { ...b, collapsed: !b.collapsed }
        : b
    );
    await saveBookmarks(items);
    set({ bookmarks: items });
  },

  reorderBookmarks: async (draggedId, targetId) => {
    const items = [...get().bookmarks];
    const from = items.findIndex((b) => b.id === draggedId);
    const to   = items.findIndex((b) => b.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    const reordered = items.map((b, i) => ({ ...b, sort_order: i }));
    await saveBookmarks(reordered);
    set({ bookmarks: reordered });
  },

  isBookmarked: (noteId) =>
    get().bookmarks.some(
      (b): b is NoteBookmark => b.kind === "note" && b.noteId === noteId
    ),

  getBookmarkForNote: (noteId) =>
    (get().bookmarks.find(
      (b): b is NoteBookmark => b.kind === "note" && b.noteId === noteId
    ) ?? null),

  setRagExcluded: async (noteId, excluded, cascade = false) => {
    await dbSetRagExcluded(noteId, excluded, cascade);
    if (cascade) {
      const descendants = collectDescendants(noteId, get().notes)
      const targets = new Set([noteId, ...descendants])
      set((state) => ({
        notes: state.notes.map((n) =>
          targets.has(n.id) ? { ...n, rag_excluded: excluded ? 1 : 0 } : n
        ),
      }))
    } else {
      set((state) => ({
        notes: state.notes.map((n) =>
          n.id === noteId ? { ...n, rag_excluded: excluded ? 1 : 0 } : n
        ),
      }))
    }
  },
}));