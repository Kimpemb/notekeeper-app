// src/features/ui/store/useUIStore.ts
import { create } from "zustand";
import { getSetting, setSetting } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

type Theme = "light" | "dark";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type RefreshStatus = "idle" | "reloading" | "reloaded";
export type SidebarPanel = "notes" | "search" | "tags" | "trash" | "bookmarks" | "env" | "goals" | "chatHistory" | null;
export type SplitDirection = "horizontal" | "vertical";
export type RightPanelType = "outline" | "backlinks" | "similar" | "chat" | "version" | null;

export interface Tab {
  id: string;
  noteId: string | null;
  // Per-tab back/forward history. Optional so existing tab literals stay valid;
  // a tab without history behaves as [noteId].
  history?: string[];
  historyIndex?: number;
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

const SESSION_KEY = "idemora_session";

interface SessionPersist {
  tabs: Tab[];
  activeTabId: string | null;
  pane2Tabs: Tab[];
  pane2ActiveTabId: string | null;
  splitOpen: boolean;
  splitDirection: SplitDirection;
  chatOpen1: boolean;
  chatOpen2: boolean;
  calendarOpen: boolean;
}

// ─── Per-tab navigation history helpers ──────────────────────────────────────
const HISTORY_CAP = 50;

function tabHistory(tab: Tab): { list: string[]; index: number } {
  const list = tab.history ?? (tab.noteId ? [tab.noteId] : []);
  const index = tab.historyIndex ?? list.length - 1;
  return { list, index };
}

// The tab navigated to noteId, with a history entry pushed (forward entries dropped)
function navigateTab(tab: Tab, noteId: string): Tab {
  const { list, index } = tabHistory(tab);
  if (list[index] === noteId) return { ...tab, noteId, history: list, historyIndex: index };
  const next = [...list.slice(0, index + 1), noteId].slice(-HISTORY_CAP);
  return { ...tab, noteId, history: next, historyIndex: next.length - 1 };
}

function noteExists(id: string): boolean {
  return useNoteStore.getState().notes.some((n) => n.id === id);
}

// Nearest history entry in direction dir whose note still exists, or -1
function stepIndex(list: string[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < list.length; i += dir) {
    if (noteExists(list[i])) return i;
  }
  return -1;
}

function activeTabOf(s: UIStore, pane: 1 | 2): Tab | undefined {
  return pane === 2
    ? s.pane2Tabs.find((t) => t.id === s.pane2ActiveTabId)
    : s.tabs.find((t) => t.id === s.activeTabId);
}

// Rebuild a saved tab. History is kept only when it is consistent; otherwise
// the tab falls back to a fresh single-entry history.
function restoreTab(t: any): Tab {
  const noteId: string | null = t?.noteId ?? null;
  const tab: Tab = { id: t.id, noteId };
  const h = t?.history;
  const i = t?.historyIndex;
  if (
    Array.isArray(h) &&
    h.length > 0 &&
    h.length <= HISTORY_CAP &&
    h.every((x: unknown) => typeof x === "string") &&
    Number.isInteger(i) &&
    i >= 0 &&
    i < h.length &&
    h[i] === noteId
  ) {
    return { ...tab, history: h, historyIndex: i };
  }
  return tab;
}

function saveSession(state: UIStore) {
  const persist: SessionPersist = {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    pane2Tabs: state.pane2Tabs,
    pane2ActiveTabId: state.pane2ActiveTabId,
    splitOpen: state.splitOpen,
    splitDirection: state.splitDirection,
    chatOpen1: state.chatOpen1,
    chatOpen2: state.chatOpen2,
    calendarOpen: state.calendarOpen,
  };
  setSetting(SESSION_KEY, JSON.stringify(persist)).catch(console.error);
}


function makeTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface ClosedTab {
  noteId: string;
  pane: 1 | 2;
}

/** Where Settings should open. Only the Sync section can be targeted for now. */
export interface SettingsTarget {
  section: "sync";
  /** "review" opens Sync > Needs review (the list); omitted opens the Sync screen. */
  view?: "review";
}

interface UIStore {
  // ─── Theme ────────────────────────────────────────────────────────────────
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  loadSettings: () => Promise<void>;

  // ─── Settings modal ───────────────────────────────────────────────────────
  settingsOpen: boolean;
  /** Set by openSettings(target), cleared when Settings closes. */
  settingsTarget: SettingsTarget | null;
  /** True while a sync operation (apply, bulk run, recover) runs; Settings will not close. */
  syncBusy: boolean;
  setSyncBusy: (busy: boolean) => void;
  openSettings: (target?: SettingsTarget) => void;
  closeSettings: () => void;

  // ─── Sidebar (left rail) ──────────────────────────────────────────────────
  activeSidebarPanel: SidebarPanel;
  sidebarWidth: number;
  expandedNodes: Set<string>;
  setActiveSidebarPanel: (panel: SidebarPanel) => void;
  toggleSidebarPanel: (panel: NonNullable<SidebarPanel>) => void;
  toggleNode: (id: string) => void;
  expandNode: (id: string) => void;
  collapseNode: (id: string) => void;
  collapseAll: () => void;
  collapseAllNodes: () => void;
  expandAllNodes: () => void;

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
  backlinksOpen: (pane: 1 | 2) => boolean;

  // ─── Similar notes panel — per pane ──────────────────────────────────────
  pane1SimilarOpen: boolean;
  pane2SimilarOpen: boolean;
  openSimilar: (pane: 1 | 2) => void;
  closeSimilar: (pane: 1 | 2) => void;
  similarOpen: (pane: 1 | 2) => boolean;

  // ─── Chat panel — per pane ────────────────────────────────────────────────
  chatOpen1: boolean;
  chatOpen2: boolean;
  openChat: (paneId: 1 | 2) => void;
  closeChat: (paneId: 1 | 2) => void;

  // ─── File tree panel ──────────────────────────────────────────────────────
  pane1FileTreeOpen: boolean;
  pane2FileTreeOpen: boolean;
  openFileTree: (pane: 1 | 2) => void;
  closeFileTree: (pane: 1 | 2) => void;
  toggleFileTree: (pane: 1 | 2) => void;

  // ─── Outline panel — per pane ────────────────────────────────────────────
  pane1OutlineOpen: boolean;
  pane2OutlineOpen: boolean;
  openOutline: (pane: 1 | 2) => void;
  closeOutline: (pane: 1 | 2) => void;
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

  // ─── Tags panel — per pane (right side) ────────────────────────────────────
  pane1TagsOpen: boolean;
  pane2TagsOpen: boolean;
  openTags: (pane: 1 | 2) => void;
  closeTags: (pane: 1 | 2) => void;
  toggleTags: (pane: 1 | 2) => void;
  tagsOpen: (pane: 1 | 2) => boolean;
  
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

  // ─── Calendar ─────────────────────────────────────────────────────────────
  calendarOpen: boolean;
  openCalendar: () => void;
  closeCalendar: () => void;

   

  // ─── Search ───────────────────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;

  // ─── Pending scroll ───────────────────────────────────────────────────────
  pendingScrollHeading: string | null;
  setPendingScrollHeading: (heading: string | null) => void;
  pendingScrollQuery: string | null;
  setPendingScrollQuery: (query: string | null) => void;
  pendingScrollIndex: number;
  setPendingScrollIndex: (index: number) => void;

  // ─── Tag filter ───────────────────────────────────────────────────────────
  activeTag: string | null;
  setActiveTag: (tag: string | null) => void;

  // ─── Export handlers ──────────────────────────────────────────────────────
  exportHandlers: {
    exportAll: () => Promise<void>;
    exportNoteJson: () => Promise<void>;
    exportNoteMarkdown: () => Promise<void>;
    exportNotePdf: () => Promise<void>;
    exportNoteDocx: () => Promise<void>;
  } | null;
  setExportHandlers: (handlers: {
    exportAll: () => Promise<void>;
    exportNoteJson: () => Promise<void>;
    exportNoteMarkdown: () => Promise<void>;
    exportNotePdf: () => Promise<void>;
    exportNoteDocx: () => Promise<void>;
  }) => void;

  // ─── Right Panel Management ───────────────────────────────────────────────
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  resetRightPanelsForPane: (pane: 1 | 2) => void;
  anyRightPanelActive: (pane: 1 | 2) => boolean;

  activeEditors: { 1: any; 2: any };
  setActiveEditor: (pane: 1 | 2, editor: any) => void;
  getEditorForNote: (noteId: string) => any;

  // ─── Pane 1 tabs ─────────────────────────────────────────────────────────
  tabs: Tab[];
  activeTabId: string | null;
  replaceTab: (noteId: string) => void;
  openTab: (noteId: string) => Tab;
  openEmptyTab: () => Tab;
  closeTab: (tabId: string) => void;
  closeTabsForNotes: (noteIds: Set<string>) => void;
  setActiveTab: (tabId: string) => void;
  closeActiveTab: () => void;
  cycleTab: (dir: 1 | -1) => void;
  reorderTabs: (pane: 1 | 2, fromIndex: number, toIndex: number) => void;
  goToTab: (index: number) => void;
  activeTabNoteId: () => string | null;

  // ─── Pane 2 tabs ─────────────────────────────────────────────────────────
  pane2Tabs: Tab[];
  pane2ActiveTabId: string | null;
  splitOpen: boolean;
  splitDirection: SplitDirection;
  openInSplit: (noteId: string) => void;
  closePane1: () => void;
  closePane2: () => void;
  toggleSplitDirection: () => void;
  swapPanes: () => void;
  setPane2ActiveTab: (tabId: string) => void;
  closePane2Tab: (tabId: string) => void;
  openTabInPane2: (noteId: string) => void;
  openEmptyTabInPane2: () => void;
  replacePane2Tab: (noteId: string) => void;
  activePaneId: 1 | 2;
  setActivePaneId: (pane: 1 | 2) => void;
  paneActiveNoteId: (pane: 1 | 2) => string | null;

  // ─── Canvas ─────────────────────────────────────────────────────────
 

  // ─── Closed tab history ───────────────────────────────────────────────────
  closedTabs: ClosedTab[];
  reopenClosedTab: () => void;

  // ─── Pane 2 nav history ───────────────────────────────────────────────────
  // Per-tab back/forward; pane defaults to the active pane
  paneCanGoBack: (pane?: 1 | 2) => boolean;
  paneCanGoForward: (pane?: 1 | 2) => boolean;
  paneGoBack: (pane?: 1 | 2) => void;
  paneGoForward: (pane?: 1 | 2) => void;
  paneNavigate: (dir: 1 | -1, pane?: 1 | 2) => void;

  // ─── Sidebar note selection ───────────────────────────────────────────────
  selectedNoteIds: Set<string>;
  toggleNoteSelection: (id: string) => void;
  selectNoteRange: (fromId: string, toId: string, orderedIds: string[]) => void;
  clearSelection: () => void;
  isNoteSelected: (id: string) => boolean;
}

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("idemora-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /**/ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme, persist = false) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try { localStorage.setItem("idemora-theme", theme); } catch { /**/ }
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
  
  const savedRightPanel = await getSetting("rightPanelOpen");
  if (savedRightPanel !== null) {
    set({ rightPanelOpen: savedRightPanel === "true" });
  }
  
  try {
    const raw = await getSetting(SESSION_KEY);
    if (raw) {
      const session: SessionPersist = JSON.parse(raw);
      set({
        tabs: (session.tabs ?? []).map(restoreTab),
        activeTabId: session.activeTabId ?? null,
        pane2Tabs: (session.pane2Tabs ?? []).map(restoreTab),
        pane2ActiveTabId: session.pane2ActiveTabId ?? null,
        splitOpen: session.splitOpen ?? false,
        splitDirection: session.splitDirection ?? "horizontal",
        chatOpen1: session.chatOpen1 ?? false,
        chatOpen2: session.chatOpen2 ?? false,
        calendarOpen: session.calendarOpen ?? false,
      });
    }
  } catch { /**/ }
},

    // ─── Settings modal ───────────────────────────────────────────────────────
    settingsOpen: false,
    settingsTarget: null,
    syncBusy: false,
    setSyncBusy: (busy) => set({ syncBusy: busy }),
    openSettings: (target) => {
      set({ settingsOpen: true, settingsTarget: target ?? null });
      window.dispatchEvent(new CustomEvent("idemora:overlay-opened"));
    },
    closeSettings: () =>
      set((s) => (s.syncBusy ? s : { settingsOpen: false, settingsTarget: null })),

    // ─── Sidebar (left rail) ──────────────────────────────────────────────────
    activeSidebarPanel: null,
    sidebarWidth: 240,
    expandedNodes: new Set(),

    setActiveSidebarPanel: (panel) => set({ activeSidebarPanel: panel }),

    toggleSidebarPanel: (panel) => {
      const { activeSidebarPanel } = get();
      set({ activeSidebarPanel: activeSidebarPanel === panel ? null : panel });
    },

    toggleNode: (id) => set((s) => { const next = new Set(s.expandedNodes); next.has(id) ? next.delete(id) : next.add(id); return { expandedNodes: next }; }),
    expandNode: (id) => set((s) => { const next = new Set(s.expandedNodes); next.add(id); return { expandedNodes: next }; }),
    collapseNode: (id) => set((s) => { const next = new Set(s.expandedNodes); next.delete(id); return { expandedNodes: next }; }),
    collapseAll: () => set({ expandedNodes: new Set() }),
    collapseAllNodes: () => set({ expandedNodes: new Set() }),
    expandAllNodes: () => {
      const { notes } = useNoteStore.getState();
      const parentIds = notes
        .filter((n) => notes.some((c) => c.parent_id === n.id))
        .map((n) => n.id);
      set((state) => ({ expandedNodes: new Set([...state.expandedNodes, ...parentIds]) }));
    },

    // ─── Sidebar search focus ─────────────────────────────────────────────────
    focusSidebarSearch: null,
    setFocusSidebarSearch: (fn) => set({ focusSidebarSearch: fn }),

    // ─── Command palette ──────────────────────────────────────────────────────
    paletteOpen: false,
    openPalette: () => {
      set({ paletteOpen: true });
      window.dispatchEvent(new CustomEvent("idemora:overlay-opened"));
    },
    closePalette: () => set({ paletteOpen: false }),
    togglePalette: () => {
      const next = !get().paletteOpen;
      set({ paletteOpen: next });
      if (next) window.dispatchEvent(new CustomEvent("idemora:overlay-opened"));
    },

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
    backlinksOpen: (pane) => pane === 1 ? get().pane1BacklinksOpen : get().pane2BacklinksOpen,

    // ─── Similar notes — per pane ─────────────────────────────────────────────
    pane1SimilarOpen: false,
    pane2SimilarOpen: false,
    openSimilar: (pane) => set(pane === 1 ? { pane1SimilarOpen: true } : { pane2SimilarOpen: true }),
    closeSimilar: (pane) => set(pane === 1 ? { pane1SimilarOpen: false } : { pane2SimilarOpen: false }),
    similarOpen: (pane) => pane === 1 ? get().pane1SimilarOpen : get().pane2SimilarOpen,

    // ─── Chat panel — per pane ────────────────────────────────────────────────
    chatOpen1: false,
    chatOpen2: false,
    openChat: (paneId) => {
      set(paneId === 1 ? { chatOpen1: true } : { chatOpen2: true });
      setTimeout(() => saveSession(get()), 0);
    },
    closeChat: (paneId) => {
      set(paneId === 1 ? { chatOpen1: false } : { chatOpen2: false });
      setTimeout(() => saveSession(get()), 0);
    },

    // ─── File tree ────────────────────────────────────────────────────────────
    pane1FileTreeOpen: false,
    pane2FileTreeOpen: false,
    openFileTree: (pane) => set(pane === 1 ? { pane1FileTreeOpen: true } : { pane2FileTreeOpen: true }),
    closeFileTree: (pane) => set(pane === 1 ? { pane1FileTreeOpen: false } : { pane2FileTreeOpen: false }),
    toggleFileTree: (pane) => set((s) => pane === 1 ? { pane1FileTreeOpen: !s.pane1FileTreeOpen } : { pane2FileTreeOpen: !s.pane2FileTreeOpen }),

    // ─── Outline — per pane ───────────────────────────────────────────────────
    pane1OutlineOpen: false,
    pane2OutlineOpen: false,
    openOutline: (pane) => set(pane === 1 ? { pane1OutlineOpen: true } : { pane2OutlineOpen: true }),
    closeOutline: (pane) => set(pane === 1 ? { pane1OutlineOpen: false } : { pane2OutlineOpen: false }),
    outlineOpen: (pane) => pane === 1 ? get().pane1OutlineOpen : get().pane2OutlineOpen,

    // ─── Tags — per pane (right side) ───────────────────────────────────────────
    pane1TagsOpen: false,
    pane2TagsOpen: false,
    openTags: (pane) => set(pane === 1 ? { pane1TagsOpen: true } : { pane2TagsOpen: true }),
    closeTags: (pane) => set(pane === 1 ? { pane1TagsOpen: false } : { pane2TagsOpen: false }),
    toggleTags: (pane) => set((s) => pane === 1 ? { pane1TagsOpen: !s.pane1TagsOpen } : { pane2TagsOpen: !s.pane2TagsOpen }),
    tagsOpen: (pane) => pane === 1 ? get().pane1TagsOpen : get().pane2TagsOpen,

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
    openGraph: () => {
      set({ graphOpen: true });
      window.dispatchEvent(new CustomEvent("idemora:overlay-opened"));
    },
    closeGraph: () => set({ graphOpen: false, graphFocusNoteId: null }),
    toggleGraph: () => set((s) => ({ graphOpen: !s.graphOpen })),
    graphFocusNoteId: null,
    openGraphForNote: (noteId) => {
      set({ graphOpen: true, graphFocusNoteId: noteId });
      window.dispatchEvent(new CustomEvent("idemora:overlay-opened"));
    },
    clearGraphFocusNoteId: () => set({ graphFocusNoteId: null }),
    graphViewState: { ...DEFAULT_GRAPH_STATE },
    saveGraphViewState: (state) => set((s) => ({ graphViewState: { ...s.graphViewState, ...state } })),
    resetGraphViewState: () => set({ graphViewState: {...DEFAULT_GRAPH_STATE } }),

    // ─── Calendar ─────────────────────────────────────────────────────────────
calendarOpen: false,
openCalendar: () => {
  set({ calendarOpen: true });
  window.dispatchEvent(new CustomEvent("idemora:overlay-opened"));
  setTimeout(() => saveSession(get()), 0);
},
closeCalendar: () => {
  set({ calendarOpen: false });
  setTimeout(() => saveSession(get()), 0);
},

     

    // ─── Search ───────────────────────────────────────────────────────────────
    searchQuery: "",
    setSearchQuery: (query) => set({ searchQuery: query }),
    clearSearch: () => set({ searchQuery: "" }),

    // ─── Pending scroll ───────────────────────────────────────────────────────
    pendingScrollHeading: null,
    setPendingScrollHeading: (heading) => set({ pendingScrollHeading: heading }),
    pendingScrollQuery: null,
    setPendingScrollQuery: (query) => set({ pendingScrollQuery: query }),
    pendingScrollIndex: 0,
    setPendingScrollIndex: (index) => set({ pendingScrollIndex: index }),

    // ─── Tag filter ───────────────────────────────────────────────────────────
    activeTag: null,
    setActiveTag: (tag) => set({ activeTag: tag }),

    // ─── Export handlers ──────────────────────────────────────────────────────
    exportHandlers: null,
    setExportHandlers: (handlers) => set({ exportHandlers: handlers }),

    // ─── Right Panel Management ───────────────────────────────────────────────
    rightPanelOpen: true,
    
    setRightPanelOpen: (open) => {
      set({ rightPanelOpen: open });
      setSetting("rightPanelOpen", String(open)).catch(console.error);
    },
    
    toggleRightPanel: () => {
      // Only show or hide the zone. Each panel keeps its own open/closed
      // state while hidden, so it comes back exactly as it was left.
      const newState = !get().rightPanelOpen;
      set({ rightPanelOpen: newState });
      setSetting("rightPanelOpen", String(newState)).catch(console.error);
    },
    
    resetRightPanelsForPane: (pane: 1 | 2) => {
      if (pane === 1) {
        set({
          pane1OutlineOpen: false,
          pane1BacklinksOpen: false,
          pane1SimilarOpen: false,
          chatOpen1: false,
          pane1VersionHistoryOpen: false,
          pane1TagsOpen: false,
        });
      } else {
        set({
          pane2OutlineOpen: false,
          pane2BacklinksOpen: false,
          pane2SimilarOpen: false,
          chatOpen2: false,
          pane2VersionHistoryOpen: false,
          pane2TagsOpen: false,
        });
      }
    },
    
    anyRightPanelActive: (pane: 1 | 2) => {
      const s = get();
      if (pane === 1) {
        return s.pane1OutlineOpen || s.pane1BacklinksOpen || s.pane1SimilarOpen || s.chatOpen1 || s.pane1VersionHistoryOpen || s.pane1TagsOpen;
      }
      return s.pane2OutlineOpen || s.pane2BacklinksOpen || s.pane2SimilarOpen || s.chatOpen2 || s.pane2VersionHistoryOpen || s.pane2TagsOpen;
    },

    activeEditors: { 1: null, 2: null },
    setActiveEditor: (pane, editor) => set((s) => ({ activeEditors: { ...s.activeEditors, [pane]: editor } })),
    getEditorForNote: (noteId) => {
      const s = get();
      if (s.paneActiveNoteId(1) === noteId) return s.activeEditors[1];
      if (s.paneActiveNoteId(2) === noteId) return s.activeEditors[2];
      return null;
    },

    // ─── Pane 1 tabs ─────────────────────────────────────────────────────────
    tabs: [], activeTabId: null,

    replaceTab: (noteId) => {
  const { tabs, activeTabId } = get();
  
  if (tabs.length === 0 || activeTabId === null) {
    const tab: Tab = { id: makeTabId(), noteId };
    set({ tabs: [tab], activeTabId: tab.id });
    saveSession(get());
    return;
  }
  const existing = tabs.find((t) => t.noteId === noteId);
  if (existing) {
    set({ activeTabId: existing.id });
    saveSession(get());
    return;
  }
  
  // REPLACE the current tab instead of creating a new one, recording history
  const next = tabs.map((t) => t.id === activeTabId ? navigateTab(t, noteId) : t);
  set({ tabs: next });
  saveSession(get());
},

    openTab: (noteId) => {
      const { tabs } = get();
      const tab: Tab = { id: makeTabId(), noteId };
      const next = [...tabs, tab];
      set({ tabs: next, activeTabId: tab.id });
      saveSession(get());
      // Push to note store navigation history instead
      useNoteStore.getState().setActiveNote(noteId, false);
      return tab;
    },

    openEmptyTab: () => {
      const { tabs } = get();
      const tab: Tab = { id: makeTabId(), noteId: null };
      const next = [...tabs, tab];
      set({ tabs: next, activeTabId: tab.id });
      saveSession(get());
      return tab;
    },

    closeTab: (tabId) => {
      const { tabs, activeTabId, closedTabs } = get();
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const closing = tabs[idx];
      const next = tabs.filter((t) => t.id !== tabId);
      let nextActiveTabId: string | null = activeTabId;
      if (activeTabId === tabId) {
        const neighbour = next[idx] ?? next[idx - 1] ?? null;
        nextActiveTabId = neighbour?.id ?? null;
      }
      const nextClosed = closing.noteId
        ? [...closedTabs, { noteId: closing.noteId, pane: 1 as const }].slice(-20)
        : closedTabs;
      set({ tabs: next, activeTabId: nextActiveTabId, closedTabs: nextClosed });
      saveSession(get());
    },

    closeTabsForNotes: (noteIds) => {
      const { tabs, activeTabId, pane2Tabs, pane2ActiveTabId } = get();
      const next1 = tabs.filter((t) => !t.noteId || !noteIds.has(t.noteId));
      let nextActive1 = activeTabId;
      if (activeTabId && !next1.some((t) => t.id === activeTabId)) nextActive1 = next1[next1.length - 1]?.id ?? null;
      const next2 = pane2Tabs.filter((t) => !t.noteId || !noteIds.has(t.noteId));
      let nextActive2 = pane2ActiveTabId;
      if (pane2ActiveTabId && !next2.some((t) => t.id === pane2ActiveTabId)) nextActive2 = next2[next2.length - 1]?.id ?? null;
      const splitOpen = next2.length > 0 ? get().splitOpen : false;
      set({ tabs: next1, activeTabId: nextActive1, pane2Tabs: next2, pane2ActiveTabId: nextActive2, splitOpen });
      saveSession(get());
    },

    setActiveTab: (tabId) => { set({ activeTabId: tabId }); saveSession(get()); },

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
        saveSession(get());
      } else {
        if (tabs.length < 2) return;
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx === -1) return;
        const nextId = tabs[(idx + dir + tabs.length) % tabs.length].id;
        set({ activeTabId: nextId });
        saveSession(get());
      }
    },

    // Jump to the Nth tab (0-based) of the active pane; out-of-range does nothing
    goToTab: (index) => {
      const { activePaneId, tabs, pane2Tabs } = get();
      const list = activePaneId === 2 ? pane2Tabs : tabs;
      const target = list[index];
      if (!target) return;
      set(activePaneId === 2 ? { pane2ActiveTabId: target.id } : { activeTabId: target.id });
      saveSession(get());
    },

    reorderTabs: (pane, fromIndex, toIndex) => {
      const key = pane === 1 ? "tabs" : "pane2Tabs";
      const list = [...get()[key]];
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= list.length) return;
      const to = Math.max(0, Math.min(list.length - 1, toIndex));
      const [moved] = list.splice(fromIndex, 1);
      list.splice(to, 0, moved);
      // Tabs are tracked by id, so the active tab is unaffected by the new order
      set({ [key]: list } as Partial<UIStore>);
      saveSession(get());
    },

    activeTabNoteId: () => {
      const { tabs, activeTabId } = get();
      return tabs.find((t) => t.id === activeTabId)?.noteId ?? null;
    },

    // ─── Pane 2 tabs ─────────────────────────────────────────────────────────
    pane2Tabs: [], pane2ActiveTabId: null, splitOpen: false, splitDirection: "horizontal",

    openInSplit: (noteId) => {
      const { splitOpen, pane2Tabs } = get();
      if (!splitOpen) {
        const tab: Tab = { id: makeTabId(), noteId };
        set({ splitOpen: true, pane2Tabs: [tab], pane2ActiveTabId: tab.id, activePaneId: 2 });
        saveSession(get());
      } else {
        const tab: Tab = { id: makeTabId(), noteId };
        const next = [...pane2Tabs, tab];
        set({ pane2Tabs: next, pane2ActiveTabId: tab.id, activePaneId: 2 });
        saveSession(get());
      }
    },

    closePane1: () => { get().swapPanes(); get().closePane2(); },

    closePane2: () => {
      set({
        splitOpen: false, pane2Tabs: [], pane2ActiveTabId: null, activePaneId: 1,
        pane2OutlineOpen: false, pane2BacklinksOpen: false, pane2SimilarOpen: false,
        pane2VersionHistoryOpen: false, chatOpen2: false,
      });
      saveSession(get());
    },

    toggleSplitDirection: () => {
      const next = get().splitDirection === "horizontal" ? "vertical" : "horizontal";
      set({ splitDirection: next });
      saveSession(get());
    },

    swapPanes: () => {
      const {
        tabs, activeTabId, pane2Tabs, pane2ActiveTabId,
        pane1OutlineOpen, pane2OutlineOpen,
        pane1BacklinksOpen, pane2BacklinksOpen,
        pane1SimilarOpen, pane2SimilarOpen,
        pane1VersionHistoryOpen, pane2VersionHistoryOpen,
        chatOpen1, chatOpen2,
      } = get();
      set({
        tabs: pane2Tabs, activeTabId: pane2ActiveTabId,
        pane2Tabs: tabs, pane2ActiveTabId: activeTabId,
        pane1OutlineOpen: pane2OutlineOpen, pane2OutlineOpen: pane1OutlineOpen,
        pane1BacklinksOpen: pane2BacklinksOpen, pane2BacklinksOpen: pane1BacklinksOpen,
        pane1SimilarOpen: pane2SimilarOpen, pane2SimilarOpen: pane1SimilarOpen,
        pane1VersionHistoryOpen: pane2VersionHistoryOpen, pane2VersionHistoryOpen: pane1VersionHistoryOpen,
        chatOpen1: chatOpen2, chatOpen2: chatOpen1,
      });
      saveSession(get());
    },

    setPane2ActiveTab: (tabId) => { set({ pane2ActiveTabId: tabId }); saveSession(get()); },

    closePane2Tab: (tabId) => {
      const { pane2Tabs, pane2ActiveTabId, closedTabs } = get();
      const idx = pane2Tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const closing = pane2Tabs[idx];
      const next = pane2Tabs.filter((t) => t.id !== tabId);
      if (next.length === 0) { get().closePane2(); return; }
      let nextActiveTabId = pane2ActiveTabId;
      if (pane2ActiveTabId === tabId) nextActiveTabId = (next[idx] ?? next[idx - 1])?.id ?? null;
      const nextClosed = closing.noteId
        ? [...closedTabs, { noteId: closing.noteId, pane: 2 as const }].slice(-20)
        : closedTabs;
      set({ pane2Tabs: next, pane2ActiveTabId: nextActiveTabId, closedTabs: nextClosed });
      saveSession(get());
    },

    openTabInPane2: (noteId) => {
      const { pane2Tabs } = get();
      const tab: Tab = { id: makeTabId(), noteId };
      const next = [...pane2Tabs, tab];
      set({ pane2Tabs: next, pane2ActiveTabId: tab.id });
      saveSession(get());
    },

    openEmptyTabInPane2: () => {
      const { pane2Tabs } = get();
      const tab: Tab = { id: makeTabId(), noteId: null };
      const next = [...pane2Tabs, tab];
      set({ pane2Tabs: next, pane2ActiveTabId: tab.id });
      saveSession(get());
    },

        replacePane2Tab: (noteId) => {
      const { pane2Tabs, pane2ActiveTabId } = get();
      if (pane2Tabs.length === 0 || pane2ActiveTabId === null) {
        const tab: Tab = { id: makeTabId(), noteId };
        set({ pane2Tabs: [tab], pane2ActiveTabId: tab.id });
        saveSession(get());
        return;
      }
      const existing = pane2Tabs.find((t) => t.noteId === noteId);
      if (existing) {
        set({ pane2ActiveTabId: existing.id });
        saveSession(get());
        return;
      }
      const next = pane2Tabs.map((t) => t.id === pane2ActiveTabId ? navigateTab(t, noteId) : t);
      set({ pane2Tabs: next });
      saveSession(get());
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
      const targetPane = last.pane === 2 && get().splitOpen ? 2 : activePaneId;
      if (targetPane === 2) { get().openTabInPane2(last.noteId); }
      else { get().openTab(last.noteId); }
    },

        // (per-tab back/forward: each tab keeps its own history)
    paneCanGoBack: (pane) => {
      const s = get();
      const tab = activeTabOf(s, pane ?? s.activePaneId);
      if (!tab) return false;
      const { list, index } = tabHistory(tab);
      return stepIndex(list, index, -1) !== -1;
    },
    paneCanGoForward: (pane) => {
      const s = get();
      const tab = activeTabOf(s, pane ?? s.activePaneId);
      if (!tab) return false;
      const { list, index } = tabHistory(tab);
      return stepIndex(list, index, 1) !== -1;
    },
    paneGoBack: (pane) => get().paneNavigate(-1, pane),
    paneGoForward: (pane) => get().paneNavigate(1, pane),
    // Swaps the note shown in the active tab only; never switches tabs or panes
    paneNavigate: (dir, pane) => {
      const s = get();
      const p = pane ?? s.activePaneId;
      const tab = activeTabOf(s, p);
      if (!tab) return;
      const { list, index } = tabHistory(tab);
      const target = stepIndex(list, index, dir);
      if (target === -1) return;
      const id = list[target];
      const updated: Tab = { ...tab, noteId: id, history: list, historyIndex: target };
      if (p === 2) set({ pane2Tabs: s.pane2Tabs.map((t) => (t.id === tab.id ? updated : t)) });
      else set({ tabs: s.tabs.map((t) => (t.id === tab.id ? updated : t)) });
      saveSession(get());
      useNoteStore.getState().setActiveNote(id, true);
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