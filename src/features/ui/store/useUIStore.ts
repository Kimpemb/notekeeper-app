// src/features/ui/store/useUIStore.ts
import { create } from "zustand";
import { getSetting, setSetting } from "@/features/notes/db/queries";

type Theme = "light" | "dark";
type SaveStatus = "idle" | "saving" | "saved" | "error";
export type SidebarState = "closed" | "peek" | "open";

export interface Tab {
  id: string;      // stable tab uuid
  noteId: string;  // the note this tab displays
}

function makeTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface UIStore {
  // ─── Theme ────────────────────────────────────────────────────────────────
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  loadSettings: () => Promise<void>;

  // ─── Sidebar ──────────────────────────────────────────────────────────────
  sidebarState: SidebarState;
  sidebarOpen: boolean;
  sidebarWidth: number;
  expandedNodes: Set<string>;
  setSidebarState: (state: SidebarState) => void;
  toggleSidebar: () => void;
  toggleNode: (id: string) => void;
  expandNode: (id: string) => void;
  collapseNode: (id: string) => void;
  collapseAll: () => void;

  // ─── Sidebar search focus ─────────────────────────────────────────────────
  focusSidebarSearch: (() => void) | null;
  setFocusSidebarSearch: (fn: (() => void) | null) => void;

  // ─── Command palette ──────────────────────────────────────────────────────
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;

  // ─── Editor save status ───────────────────────────────────────────────────
  saveStatus: SaveStatus;
  setSaveStatus: (status: SaveStatus) => void;

  // ─── Version history panel ────────────────────────────────────────────────
  versionHistoryOpen: boolean;
  openVersionHistory: () => void;
  closeVersionHistory: () => void;

  // ─── Backlinks panel ──────────────────────────────────────────────────────
  backlinksOpen: boolean;
  openBacklinks: () => void;
  closeBacklinks: () => void;
  toggleBacklinks: () => void;

  // ─── File tree panel ──────────────────────────────────────────────────────
  fileTreeOpen: boolean;
  openFileTree: () => void;
  closeFileTree: () => void;
  toggleFileTree: () => void;

  // ─── Outline panel ────────────────────────────────────────────────────────
  outlineOpen: boolean;
  openOutline: () => void;
  closeOutline: () => void;
  toggleOutline: () => void;

  // ─── Import modal ─────────────────────────────────────────────────────────
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;

  // ─── Template picker ──────────────────────────────────────────────────────
  templatePickerOpen: boolean;
  openTemplatePicker: () => void;
  closeTemplatePicker: () => void;

  // ─── Search ───────────────────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;

  // ─── Pending scroll ───────────────────────────────────────────────────────
  pendingScrollHeading: string | null;
  setPendingScrollHeading: (heading: string | null) => void;
  pendingScrollQuery: string | null;
  setPendingScrollQuery: (query: string | null) => void;

  // ─── Tag filter ───────────────────────────────────────────────────────────
  activeTag: string | null;
  setActiveTag: (tag: string | null) => void;

  // ─── Export handlers ──────────────────────────────────────────────────────
  exportHandlers: {
    exportAll: () => Promise<void>;
    exportNoteJson: () => Promise<void>;
    exportNoteMarkdown: () => Promise<void>;
    exportNotePdf: () => Promise<void>;
  } | null;
  setExportHandlers: (handlers: {
    exportAll: () => Promise<void>;
    exportNoteJson: () => Promise<void>;
    exportNoteMarkdown: () => Promise<void>;
    exportNotePdf: () => Promise<void>;
  }) => void;

  // ─── Tabs ─────────────────────────────────────────────────────────────────
  tabs: Tab[];
  activeTabId: string | null;
  replaceTab: (noteId: string) => void;
  openTab: (noteId: string) => Tab;
  closeTab: (tabId: string) => void;
  closeTabsForNotes: (noteIds: Set<string>) => void;
  setActiveTab: (tabId: string) => void;
  closeActiveTab: () => void;
  cycleTab: (dir: 1 | -1) => void;
  activeTabNoteId: () => string | null;

  // ─── Sidebar note selection ───────────────────────────────────────────────
  // Set of noteIds currently selected in the sidebar.
  selectedNoteIds: Set<string>;
  // Toggle a single note in/out of the selection (Ctrl+click).
  toggleNoteSelection: (id: string) => void;
  // Select all notes between fromId and toId in the given flat ordered list (Shift+click).
  selectNoteRange: (fromId: string, toId: string, orderedIds: string[]) => void;
  // Clear the entire selection.
  clearSelection: () => void;
  // Convenience selector used by NoteTreeItem.
  isNoteSelected: (id: string) => boolean;
}

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("notekeeper-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /**/ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme, persist = false) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try { localStorage.setItem("notekeeper-theme", theme); } catch { /**/ }
  if (persist) setSetting("theme", theme).catch(console.error);
}

export const useUIStore = create<UIStore>((set, get) => {
  const initialTheme = getInitialTheme();
  applyTheme(initialTheme);

  return {
    // ─── Theme ────────────────────────────────────────────────────────────────
    theme: initialTheme,

    toggleTheme: () => {
      const next = get().theme === "dark" ? "light" : "dark";
      applyTheme(next, true);
      set({ theme: next });
    },

    setTheme: (theme) => {
      applyTheme(theme, true);
      set({ theme });
    },

    loadSettings: async () => {
      const theme = await getSetting("theme");
      if (theme === "light" || theme === "dark") {
        applyTheme(theme);
        set({ theme });
      }
    },

    // ─── Sidebar ──────────────────────────────────────────────────────────────
    sidebarState: "open",
    sidebarOpen: true,
    sidebarWidth: 288,
    expandedNodes: new Set(),

    setSidebarState: (state) =>
      set({ sidebarState: state, sidebarOpen: state === "open" }),

    toggleSidebar: () => {
      const { sidebarState } = get();
      const next: SidebarState = sidebarState === "open" ? "closed" : "open";
      set({ sidebarState: next, sidebarOpen: next === "open" });
    },

    toggleNode: (id) =>
      set((s) => {
        const next = new Set(s.expandedNodes);
        next.has(id) ? next.delete(id) : next.add(id);
        return { expandedNodes: next };
      }),

    expandNode: (id) =>
      set((s) => {
        const next = new Set(s.expandedNodes);
        next.add(id);
        return { expandedNodes: next };
      }),

    collapseNode: (id) =>
      set((s) => {
        const next = new Set(s.expandedNodes);
        next.delete(id);
        return { expandedNodes: next };
      }),

    collapseAll: () => set({ expandedNodes: new Set() }),

    // ─── Sidebar search focus ─────────────────────────────────────────────────
    focusSidebarSearch: null,
    setFocusSidebarSearch: (fn) => set({ focusSidebarSearch: fn }),

    // ─── Command palette ──────────────────────────────────────────────────────
    paletteOpen: false,
    openPalette: () => set({ paletteOpen: true }),
    closePalette: () => set({ paletteOpen: false }),
    togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

    // ─── Save status ──────────────────────────────────────────────────────────
    saveStatus: "idle",
    setSaveStatus: (status) => set({ saveStatus: status }),

    // ─── Version history panel ────────────────────────────────────────────────
    versionHistoryOpen: false,
    openVersionHistory: () => set({ versionHistoryOpen: true }),
    closeVersionHistory: () => set({ versionHistoryOpen: false }),

    // ─── Backlinks panel ──────────────────────────────────────────────────────
    backlinksOpen: false,
    openBacklinks: () => set({ backlinksOpen: true }),
    closeBacklinks: () => set({ backlinksOpen: false }),
    toggleBacklinks: () => set((s) => ({ backlinksOpen: !s.backlinksOpen })),

    // ─── File tree panel ──────────────────────────────────────────────────────
    fileTreeOpen: false,
    openFileTree: () => set({ fileTreeOpen: true }),
    closeFileTree: () => set({ fileTreeOpen: false }),
    toggleFileTree: () => set((s) => ({ fileTreeOpen: !s.fileTreeOpen })),

    // ─── Outline panel ────────────────────────────────────────────────────────
    outlineOpen: false,
    openOutline: () => set({ outlineOpen: true }),
    closeOutline: () => set({ outlineOpen: false }),
    toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen })),

    // ─── Import modal ─────────────────────────────────────────────────────────
    importOpen: false,
    openImport: () => set({ importOpen: true }),
    closeImport: () => set({ importOpen: false }),

    // ─── Keyboard shortcuts ───────────────────────────────────────────────────
    shortcutsOpen: false,
    openShortcuts: () => set({ shortcutsOpen: true }),
    closeShortcuts: () => set({ shortcutsOpen: false }),

    // ─── Template picker ──────────────────────────────────────────────────────
    templatePickerOpen: false,
    openTemplatePicker: () => set({ templatePickerOpen: true }),
    closeTemplatePicker: () => set({ templatePickerOpen: false }),

    // ─── Search ───────────────────────────────────────────────────────────────
    searchQuery: "",
    setSearchQuery: (query) => set({ searchQuery: query }),
    clearSearch: () => set({ searchQuery: "" }),

    // ─── Pending scroll ───────────────────────────────────────────────────────
    pendingScrollHeading: null,
    setPendingScrollHeading: (heading) => set({ pendingScrollHeading: heading }),
    pendingScrollQuery: null,
    setPendingScrollQuery: (query) => set({ pendingScrollQuery: query }),

    // ─── Tag filter ───────────────────────────────────────────────────────────
    activeTag: null,
    setActiveTag: (tag) => set({ activeTag: tag }),

    // ─── Export handlers ──────────────────────────────────────────────────────
    exportHandlers: null,
    setExportHandlers: (handlers) => set({ exportHandlers: handlers }),

    // ─── Tabs ─────────────────────────────────────────────────────────────────
    tabs: [],
    activeTabId: null,

    replaceTab: (noteId) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0 || activeTabId === null) {
        const tab: Tab = { id: makeTabId(), noteId };
        set({ tabs: [tab], activeTabId: tab.id });
        return;
      }
      const existing = tabs.find((t) => t.noteId === noteId);
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
      set({ tabs: tabs.map((t) => t.id === activeTabId ? { ...t, noteId } : t) });
    },

    openTab: (noteId) => {
      const { tabs } = get();
      const tab: Tab = { id: makeTabId(), noteId };
      set({ tabs: [...tabs, tab], activeTabId: tab.id });
      return tab;
    },

    closeTab: (tabId) => {
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const next = tabs.filter((t) => t.id !== tabId);
      let nextActiveTabId: string | null = activeTabId;
      if (activeTabId === tabId) {
        const neighbour = next[idx] ?? next[idx - 1] ?? null;
        nextActiveTabId = neighbour?.id ?? null;
      }
      set({ tabs: next, activeTabId: nextActiveTabId });
    },

    closeTabsForNotes: (noteIds) => {
      const { tabs, activeTabId } = get();
      const next = tabs.filter((t) => !noteIds.has(t.noteId));
      let nextActiveTabId = activeTabId;
      if (activeTabId) {
        const activeStillExists = next.some((t) => t.id === activeTabId);
        if (!activeStillExists) nextActiveTabId = next[next.length - 1]?.id ?? null;
      }
      set({ tabs: next, activeTabId: nextActiveTabId });
    },

    setActiveTab: (tabId) => set({ activeTabId: tabId }),

    closeActiveTab: () => {
      const { activeTabId } = get();
      if (activeTabId) get().closeTab(activeTabId);
    },

    cycleTab: (dir) => {
      const { tabs, activeTabId } = get();
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return;
      const next = (idx + dir + tabs.length) % tabs.length;
      set({ activeTabId: tabs[next].id });
    },

    activeTabNoteId: () => {
      const { tabs, activeTabId } = get();
      return tabs.find((t) => t.id === activeTabId)?.noteId ?? null;
    },

    // ─── Sidebar note selection ───────────────────────────────────────────────
    selectedNoteIds: new Set(),

    toggleNoteSelection: (id) =>
      set((s) => {
        const next = new Set(s.selectedNoteIds);
        next.has(id) ? next.delete(id) : next.add(id);
        return { selectedNoteIds: next };
      }),

    selectNoteRange: (fromId, toId, orderedIds) => {
      const fromIdx = orderedIds.indexOf(fromId);
      const toIdx   = orderedIds.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const start = Math.min(fromIdx, toIdx);
      const end   = Math.max(fromIdx, toIdx);
      const range = new Set(orderedIds.slice(start, end + 1));
      set((s) => ({ selectedNoteIds: new Set([...s.selectedNoteIds, ...range]) }));
    },

    clearSelection: () => set({ selectedNoteIds: new Set() }),

    isNoteSelected: (id) => get().selectedNoteIds.has(id),
  };
});