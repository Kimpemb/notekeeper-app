import { create } from "zustand";
import { getSetting, setSetting } from "@/features/notes/db/queries";

type Theme = "light" | "dark";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type RefreshStatus = "idle" | "reloading" | "reloaded";
export type SidebarState = "closed" | "peek" | "open";
export type SplitDirection = "horizontal" | "vertical";

export interface Tab {
  id: string;
  noteId: string;
}

export interface GraphViewState {
  zoomX: number;
  zoomY: number;
  zoomK: number;
  focusNodeId: string | null;
  searchQuery: string;
  showOrphans: boolean;
  showTagColors: boolean;
  depth: number;
}

const DEFAULT_GRAPH_STATE: GraphViewState = {
  zoomX: 0, zoomY: 0, zoomK: 0.85,
  focusNodeId: null,
  searchQuery: "",
  showOrphans: true,
  showTagColors: true,
  depth: 4,
};

const SESSION_KEY = "notekeeper_session";

interface SessionState {
  tabs: Tab[];
  activeTabId: string | null;
  pane2Tabs: Tab[];
  pane2ActiveTabId: string | null;
  splitOpen: boolean;
  splitDirection: SplitDirection;
}

function saveSession(state: SessionState) {
  setSetting(SESSION_KEY, JSON.stringify(state)).catch(console.error);
}

function makeTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface ClosedTab {
  noteId: string;
  pane: 1 | 2;
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

  // ─── Refresh status ───────────────────────────────────────────────────────
  refreshStatus: RefreshStatus;
  setRefreshStatus: (status: RefreshStatus) => void;

  // ─── Version history — per pane ───────────────────────────────────────────
  pane1VersionHistoryOpen: boolean;
  pane2VersionHistoryOpen: boolean;
  openVersionHistory: (pane: 1 | 2) => void;
  closeVersionHistory: (pane: 1 | 2) => void;
  versionHistoryOpen: (pane: 1 | 2) => boolean;

  // ─── Backlinks panel — per pane ───────────────────────────────────────────
  pane1BacklinksOpen: boolean;
  pane2BacklinksOpen: boolean;
  openBacklinks: (pane: 1 | 2) => void;
  closeBacklinks: (pane: 1 | 2) => void;
  toggleBacklinks: (pane: 1 | 2) => void;
  backlinksOpen: (pane: 1 | 2) => boolean;

  // ─── File tree panel ──────────────────────────────────────────────────────
  fileTreeOpen: boolean;
  openFileTree: () => void;
  closeFileTree: () => void;
  toggleFileTree: () => void;

  // ─── Outline panel — per pane ────────────────────────────────────────────
  pane1OutlineOpen: boolean;
  pane2OutlineOpen: boolean;
  openOutline: (pane: 1 | 2) => void;
  closeOutline: (pane: 1 | 2) => void;
  toggleOutline: (pane: 1 | 2) => void;
  outlineOpen: (pane: 1 | 2) => boolean;

  // ─── Import modal ─────────────────────────────────────────────────────────
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;

  // ─── Tips panel ───────────────────────────────────────────────────────────
  tipsOpen: boolean;
  openTips: () => void;
  closeTips: () => void;
  toggleTips: () => void;

  // ─── Graph view ───────────────────────────────────────────────────────────
  graphOpen: boolean;
  openGraph: () => void;
  closeGraph: () => void;
  toggleGraph: () => void;
  graphFocusNoteId: string | null;
  openGraphForNote: (noteId: string) => void;
  clearGraphFocusNoteId: () => void;
  graphViewState: GraphViewState;
  saveGraphViewState: (state: Partial<GraphViewState>) => void;
  resetGraphViewState: () => void;

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

  // ─── Pane 1 tabs ─────────────────────────────────────────────────────────
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

  // ─── Pane 2 tabs ─────────────────────────────────────────────────────────
  pane2Tabs: Tab[];
  pane2ActiveTabId: string | null;
  splitOpen: boolean;
  splitDirection: SplitDirection;
  openInSplit: (noteId: string) => void;
  closePane2: () => void;
  toggleSplitDirection: () => void;
  swapPanes: () => void;
  setPane2ActiveTab: (tabId: string) => void;
  closePane2Tab: (tabId: string) => void;
  openTabInPane2: (noteId: string) => void;
  activePaneId: 1 | 2;
  setActivePaneId: (pane: 1 | 2) => void;
  paneActiveNoteId: (pane: 1 | 2) => string | null;

  // ─── Closed tab history ───────────────────────────────────────────────────
  closedTabs: ClosedTab[];
  reopenClosedTab: () => void;

  // ─── Pane 2 nav history ───────────────────────────────────────────────────
pane2NavHistory: string[];
pane2NavIndex: number;
pane2CanGoBack: () => boolean;
pane2CanGoForward: () => boolean;
pane2GoBack: () => void;
pane2GoForward: () => void;
pane2PushNav: (noteId: string) => void;

  // ─── Sidebar note selection ───────────────────────────────────────────────
  selectedNoteIds: Set<string>;
  toggleNoteSelection: (id: string) => void;
  selectNoteRange: (fromId: string, toId: string, orderedIds: string[]) => void;
  clearSelection: () => void;
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
    toggleTheme: () => { const next = get().theme === "dark" ? "light" : "dark"; applyTheme(next, true); set({ theme: next }); },
    setTheme: (theme) => { applyTheme(theme, true); set({ theme }); },
    loadSettings: async () => {
      const theme = await getSetting("theme");
      if (theme === "light" || theme === "dark") { applyTheme(theme); set({ theme }); }
      try {
        const raw = await getSetting(SESSION_KEY);
        if (raw) {
          const session: SessionState = JSON.parse(raw);
          if (session.tabs?.length) {
            set({
              tabs: session.tabs,
              activeTabId: session.activeTabId,
              pane2Tabs: session.pane2Tabs ?? [],
              pane2ActiveTabId: session.pane2ActiveTabId ?? null,
              splitOpen: session.splitOpen ?? false,
              splitDirection: session.splitDirection ?? "horizontal",
            });
          }
        }
      } catch { /**/ }
    },

    // ─── Sidebar ──────────────────────────────────────────────────────────────
    sidebarState: "open", sidebarOpen: true, sidebarWidth: 288, expandedNodes: new Set(),
    setSidebarState: (state) => set({ sidebarState: state, sidebarOpen: state === "open" }),
    toggleSidebar: () => {
      const { sidebarState } = get();
      const next: SidebarState = sidebarState === "open" ? "closed" : "open";
      set({ sidebarState: next, sidebarOpen: next === "open" });
    },
    toggleNode: (id) => set((s) => { const next = new Set(s.expandedNodes); next.has(id) ? next.delete(id) : next.add(id); return { expandedNodes: next }; }),
    expandNode: (id) => set((s) => { const next = new Set(s.expandedNodes); next.add(id); return { expandedNodes: next }; }),
    collapseNode: (id) => set((s) => { const next = new Set(s.expandedNodes); next.delete(id); return { expandedNodes: next }; }),
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

    // ─── Refresh status ───────────────────────────────────────────────────────
    refreshStatus: "idle",
    setRefreshStatus: (status) => set({ refreshStatus: status }),

    // ─── Version history — per pane ───────────────────────────────────────────
    pane1VersionHistoryOpen: false,
    pane2VersionHistoryOpen: false,
    openVersionHistory: (pane) => set(pane === 1 ? { pane1VersionHistoryOpen: true } : { pane2VersionHistoryOpen: true }),
    closeVersionHistory: (pane) => set(pane === 1 ? { pane1VersionHistoryOpen: false } : { pane2VersionHistoryOpen: false }),
    versionHistoryOpen: (pane) => pane === 1 ? get().pane1VersionHistoryOpen : get().pane2VersionHistoryOpen,

    // ─── Backlinks — per pane ─────────────────────────────────────────────────
    pane1BacklinksOpen: false,
    pane2BacklinksOpen: false,
    openBacklinks: (pane) => set(pane === 1 ? { pane1BacklinksOpen: true } : { pane2BacklinksOpen: true }),
    closeBacklinks: (pane) => set(pane === 1 ? { pane1BacklinksOpen: false } : { pane2BacklinksOpen: false }),
    toggleBacklinks: (pane) => set((s) => pane === 1 ? { pane1BacklinksOpen: !s.pane1BacklinksOpen } : { pane2BacklinksOpen: !s.pane2BacklinksOpen }),
    backlinksOpen: (pane) => pane === 1 ? get().pane1BacklinksOpen : get().pane2BacklinksOpen,

    // ─── File tree ────────────────────────────────────────────────────────────
    fileTreeOpen: false,
    openFileTree: () => set({ fileTreeOpen: true }),
    closeFileTree: () => set({ fileTreeOpen: false }),
    toggleFileTree: () => set((s) => ({ fileTreeOpen: !s.fileTreeOpen })),

    // ─── Outline — per pane ───────────────────────────────────────────────────
    pane1OutlineOpen: false,
    pane2OutlineOpen: false,
    openOutline: (pane) => set(pane === 1 ? { pane1OutlineOpen: true } : { pane2OutlineOpen: true }),
    closeOutline: (pane) => set(pane === 1 ? { pane1OutlineOpen: false } : { pane2OutlineOpen: false }),
    toggleOutline: (pane) => set((s) => pane === 1 ? { pane1OutlineOpen: !s.pane1OutlineOpen } : { pane2OutlineOpen: !s.pane2OutlineOpen }),
    outlineOpen: (pane) => pane === 1 ? get().pane1OutlineOpen : get().pane2OutlineOpen,

    // ─── Import ───────────────────────────────────────────────────────────────
    importOpen: false,
    openImport: () => set({ importOpen: true }),
    closeImport: () => set({ importOpen: false }),

    // ─── Shortcuts ────────────────────────────────────────────────────────────
    shortcutsOpen: false,
    openShortcuts: () => set({ shortcutsOpen: true }),
    closeShortcuts: () => set({ shortcutsOpen: false }),

    // ─── Tips ─────────────────────────────────────────────────────────────────
    tipsOpen: false,
    openTips: () => set({ tipsOpen: true }),
    closeTips: () => set({ tipsOpen: false }),
    toggleTips: () => set((s) => ({ tipsOpen: !s.tipsOpen })),

    // ─── Graph ────────────────────────────────────────────────────────────────
    graphOpen: false,
    openGraph: () => set({ graphOpen: true }),
    closeGraph: () => set({ graphOpen: false, graphFocusNoteId: null }),
    toggleGraph: () => set((s) => ({ graphOpen: !s.graphOpen })),
    graphFocusNoteId: null,
    openGraphForNote: (noteId) => set({ graphOpen: true, graphFocusNoteId: noteId }),
    clearGraphFocusNoteId: () => set({ graphFocusNoteId: null }),
    graphViewState: { ...DEFAULT_GRAPH_STATE },
    saveGraphViewState: (state) => set((s) => ({ graphViewState: { ...s.graphViewState, ...state } })),
    resetGraphViewState: () => set({ graphViewState: { ...DEFAULT_GRAPH_STATE } }),

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

    // ─── Pane 1 tabs ─────────────────────────────────────────────────────────
    tabs: [], activeTabId: null,
    replaceTab: (noteId) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0 || activeTabId === null) {
        const tab: Tab = { id: makeTabId(), noteId };
        set({ tabs: [tab], activeTabId: tab.id });
        saveSession({ ...get(), tabs: [tab], activeTabId: tab.id });
        return;
      }
      const existing = tabs.find((t) => t.noteId === noteId);
      if (existing) { set({ activeTabId: existing.id }); saveSession({ ...get(), activeTabId: existing.id }); return; }
      const next = tabs.map((t) => t.id === activeTabId ? { ...t, noteId } : t);
      set({ tabs: next });
      saveSession({ ...get(), tabs: next });
    },
    openTab: (noteId) => {
      const { tabs } = get();
      const tab: Tab = { id: makeTabId(), noteId };
      const next = [...tabs, tab];
      set({ tabs: next, activeTabId: tab.id });
      saveSession({ ...get(), tabs: next, activeTabId: tab.id });
      return tab;
    },
    closeTab: (tabId) => {
      const { tabs, activeTabId, closedTabs } = get();
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const closing = tabs[idx];
      const next = tabs.filter((t) => t.id !== tabId);
      let nextActiveTabId: string | null = activeTabId;
      if (activeTabId === tabId) { const neighbour = next[idx] ?? next[idx - 1] ?? null; nextActiveTabId = neighbour?.id ?? null; }
      set({ tabs: next, activeTabId: nextActiveTabId, closedTabs: [...closedTabs, { noteId: closing.noteId, pane: 1 as const }].slice(-20) });
      saveSession({ ...get(), tabs: next, activeTabId: nextActiveTabId });
    },
    closeTabsForNotes: (noteIds) => {
      const { tabs, activeTabId, pane2Tabs, pane2ActiveTabId } = get();
      const next1 = tabs.filter((t) => !noteIds.has(t.noteId));
      let nextActive1 = activeTabId;
      if (activeTabId && !next1.some((t) => t.id === activeTabId)) nextActive1 = next1[next1.length - 1]?.id ?? null;
      const next2 = pane2Tabs.filter((t) => !noteIds.has(t.noteId));
      let nextActive2 = pane2ActiveTabId;
      if (pane2ActiveTabId && !next2.some((t) => t.id === pane2ActiveTabId)) nextActive2 = next2[next2.length - 1]?.id ?? null;
      const splitOpen = next2.length > 0 ? get().splitOpen : false;
      set({ tabs: next1, activeTabId: nextActive1, pane2Tabs: next2, pane2ActiveTabId: nextActive2, splitOpen });
      saveSession({ ...get(), tabs: next1, activeTabId: nextActive1, pane2Tabs: next2, pane2ActiveTabId: nextActive2, splitOpen });
    },
    setActiveTab: (tabId) => { set({ activeTabId: tabId }); saveSession({ ...get(), activeTabId: tabId }); },
    closeActiveTab: () => {
      const { activePaneId, activeTabId, pane2ActiveTabId } = get();
      if (activePaneId === 2 && pane2ActiveTabId) { get().closePane2Tab(pane2ActiveTabId); }
      else if (activeTabId) { get().closeTab(activeTabId); }
    },
    cycleTab: (dir) => {
      const { activePaneId, tabs, activeTabId, pane2Tabs, pane2ActiveTabId } = get();
      if (activePaneId === 2) {
        if (pane2Tabs.length < 2) return;
        const idx = pane2Tabs.findIndex((t) => t.id === pane2ActiveTabId);
        if (idx === -1) return;
        const nextId = pane2Tabs[(idx + dir + pane2Tabs.length) % pane2Tabs.length].id;
        set({ pane2ActiveTabId: nextId });
        saveSession({ ...get(), pane2ActiveTabId: nextId });
      } else {
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx === -1) return;
        const nextId = tabs[(idx + dir + tabs.length) % tabs.length].id;
        set({ activeTabId: nextId });
        saveSession({ ...get(), activeTabId: nextId });
      }
    },
    activeTabNoteId: () => { const { tabs, activeTabId } = get(); return tabs.find((t) => t.id === activeTabId)?.noteId ?? null; },

    // ─── Pane 2 tabs ─────────────────────────────────────────────────────────
    pane2Tabs: [], pane2ActiveTabId: null, splitOpen: false, splitDirection: "horizontal",
    openInSplit: (noteId) => {
      const { splitOpen, pane2Tabs } = get();
      if (!splitOpen) {
        const tab: Tab = { id: makeTabId(), noteId };
        set({ splitOpen: true, pane2Tabs: [tab], pane2ActiveTabId: tab.id, activePaneId: 2 });
        saveSession({ ...get(), splitOpen: true, pane2Tabs: [tab], pane2ActiveTabId: tab.id });
      } else {
        const tab: Tab = { id: makeTabId(), noteId };
        const next = [...pane2Tabs, tab];
        set({ pane2Tabs: next, pane2ActiveTabId: tab.id, activePaneId: 2 });
        saveSession({ ...get(), pane2Tabs: next, pane2ActiveTabId: tab.id });
      }
    },
    closePane2: () => {
      set({
        splitOpen: false, pane2Tabs: [], pane2ActiveTabId: null, activePaneId: 1,
        pane2OutlineOpen: false, pane2BacklinksOpen: false, pane2VersionHistoryOpen: false,
        pane2NavHistory: [], pane2NavIndex: -1,
      });
      saveSession({ ...get(), splitOpen: false, pane2Tabs: [], pane2ActiveTabId: null });
    },
    toggleSplitDirection: () => {
      const next = get().splitDirection === "horizontal" ? "vertical" : "horizontal";
      set({ splitDirection: next });
      saveSession({ ...get(), splitDirection: next });
    },
    swapPanes: () => {
      const { tabs, activeTabId, pane2Tabs, pane2ActiveTabId, pane1OutlineOpen, pane2OutlineOpen, pane1BacklinksOpen, pane2BacklinksOpen, pane1VersionHistoryOpen, pane2VersionHistoryOpen } = get();
      set({
        tabs: pane2Tabs, activeTabId: pane2ActiveTabId,
        pane2Tabs: tabs, pane2ActiveTabId: activeTabId,
        pane1OutlineOpen: pane2OutlineOpen, pane2OutlineOpen: pane1OutlineOpen,
        pane1BacklinksOpen: pane2BacklinksOpen, pane2BacklinksOpen: pane1BacklinksOpen,
        pane1VersionHistoryOpen: pane2VersionHistoryOpen, pane2VersionHistoryOpen: pane1VersionHistoryOpen,
      });
      saveSession({ ...get(), tabs: pane2Tabs, activeTabId: pane2ActiveTabId, pane2Tabs: tabs, pane2ActiveTabId: activeTabId });
    },
    setPane2ActiveTab: (tabId) => { set({ pane2ActiveTabId: tabId }); saveSession({ ...get(), pane2ActiveTabId: tabId }); },
    closePane2Tab: (tabId) => {
      const { pane2Tabs, pane2ActiveTabId, closedTabs } = get();
      const idx = pane2Tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const closing = pane2Tabs[idx];
      const next = pane2Tabs.filter((t) => t.id !== tabId);
      if (next.length === 0) { get().closePane2(); return; }
      let nextActiveTabId = pane2ActiveTabId;
      if (pane2ActiveTabId === tabId) nextActiveTabId = (next[idx] ?? next[idx - 1])?.id ?? null;
      set({ pane2Tabs: next, pane2ActiveTabId: nextActiveTabId, closedTabs: [...closedTabs, { noteId: closing.noteId, pane: 2 as const }].slice(-20) });
      saveSession({ ...get(), pane2Tabs: next, pane2ActiveTabId: nextActiveTabId });
    },
    openTabInPane2: (noteId) => {
      const { pane2Tabs } = get();
      const tab: Tab = { id: makeTabId(), noteId };
      const next = [...pane2Tabs, tab];
      set({ pane2Tabs: next, pane2ActiveTabId: tab.id });
      saveSession({ ...get(), pane2Tabs: next, pane2ActiveTabId: tab.id });
      get().pane2PushNav(noteId);
    },
    activePaneId: 1,
    setActivePaneId: (pane) => set({ activePaneId: pane }),
    paneActiveNoteId: (pane) => {
      const { tabs, activeTabId, pane2Tabs, pane2ActiveTabId } = get();
      if (pane === 2) return pane2Tabs.find((t) => t.id === pane2ActiveTabId)?.noteId ?? null;
      return tabs.find((t) => t.id === activeTabId)?.noteId ?? null;
    },

    // ─── Closed tab history ───────────────────────────────────────────────────
    closedTabs: [],
    reopenClosedTab: () => {
      const { closedTabs, activePaneId } = get();
      if (closedTabs.length === 0) return;
      const last = closedTabs[closedTabs.length - 1];
      const remaining = closedTabs.slice(0, -1);
      set({ closedTabs: remaining });
      // Reopen in the pane it was closed from, or active pane if that pane no longer exists
      const targetPane = last.pane === 2 && get().splitOpen ? 2 : activePaneId;
      if (targetPane === 2) {
        get().openTabInPane2(last.noteId);
      } else {
        get().openTab(last.noteId);
      }
    },

    // ─── Pane 2 nav history ───────────────────────────────────────────────────
    pane2NavHistory: [],
    pane2NavIndex: -1,
    pane2CanGoBack: () => get().pane2NavIndex > 0,
    pane2CanGoForward: () => get().pane2NavIndex < get().pane2NavHistory.length - 1,
    pane2GoBack: () => {
      const { pane2NavHistory, pane2NavIndex, pane2Tabs } = get();
      if (pane2NavIndex <= 0) return;
      const newIndex = pane2NavIndex - 1;
      const noteId = pane2NavHistory[newIndex];
      // Find tab with this noteId and activate it, or replace active tab
      const existing = pane2Tabs.find((t) => t.noteId === noteId);
      if (existing) {
        set({ pane2NavIndex: newIndex, pane2ActiveTabId: existing.id });
      } else {
        set((s) => ({
          pane2NavIndex: newIndex,
          pane2Tabs: s.pane2Tabs.map((t) =>
            t.id === s.pane2ActiveTabId ? { ...t, noteId } : t
          ),
        }));
      }
      saveSession({ ...get() });
    },
    pane2GoForward: () => {
      const { pane2NavHistory, pane2NavIndex, pane2Tabs } = get();
      if (pane2NavIndex >= pane2NavHistory.length - 1) return;
      const newIndex = pane2NavIndex + 1;
      const noteId = pane2NavHistory[newIndex];
      const existing = pane2Tabs.find((t) => t.noteId === noteId);
      if (existing) {
        set({ pane2NavIndex: newIndex, pane2ActiveTabId: existing.id });
      } else {
        set((s) => ({
          pane2NavIndex: newIndex,
          pane2Tabs: s.pane2Tabs.map((t) =>
            t.id === s.pane2ActiveTabId ? { ...t, noteId } : t
          ),
        }));
      }
      saveSession({ ...get() });
    },
    pane2PushNav: (noteId) => {
      set((s) => {
        const trimmed = s.pane2NavHistory.slice(0, s.pane2NavIndex + 1);
        if (trimmed[trimmed.length - 1] === noteId) return {};
        return {
          pane2NavHistory: [...trimmed, noteId],
          pane2NavIndex: trimmed.length,
        };
      });
    },

    // ─── Sidebar note selection ───────────────────────────────────────────────
    selectedNoteIds: new Set(),
    toggleNoteSelection: (id) => set((s) => { const next = new Set(s.selectedNoteIds); next.has(id) ? next.delete(id) : next.add(id); return { selectedNoteIds: next }; }),
    selectNoteRange: (fromId, toId, orderedIds) => {
      const fromIdx = orderedIds.indexOf(fromId), toIdx = orderedIds.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;
      const range = new Set(orderedIds.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1));
      set((s) => ({ selectedNoteIds: new Set([...s.selectedNoteIds, ...range]) }));
    },
    clearSelection: () => set({ selectedNoteIds: new Set() }),
    isNoteSelected: (id) => get().selectedNoteIds.has(id),
  };
});