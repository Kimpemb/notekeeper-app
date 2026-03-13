// src/store/useUIStore.ts
// All UI state: theme, sidebar, command palette, dialogs.
// No DB calls here — pure UI concerns only.

import { create } from "zustand";

type Theme = "light" | "dark";
type SaveStatus = "idle" | "saving" | "saved" | "error";
export type SidebarState = "closed" | "peek" | "open";

interface UIStore {
  // ─── Theme ────────────────────────────────────────────────────────────────
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;

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

  // ─── Backlinks panel ─────────────────────────────────────────────────────
  backlinksOpen: boolean;
  openBacklinks: () => void;
  closeBacklinks: () => void;
  toggleBacklinks: () => void;

  // ─── Import modal ────────────────────────────────────────────────────────
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  shortcutsOpen: boolean;
  openShortcuts: () => void;
  closeShortcuts: () => void;

  // ─── Search ───────────────────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
}

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("notekeeper-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /**/ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try { localStorage.setItem("notekeeper-theme", theme); } catch { /**/ }
}

export const useUIStore = create<UIStore>((set, get) => {
  const initialTheme = getInitialTheme();
  applyTheme(initialTheme);

  return {
    // ─── Theme ──────────────────────────────────────────────────────────────
    theme: initialTheme,
    toggleTheme: () => {
      const next = get().theme === "dark" ? "light" : "dark";
      applyTheme(next);
      set({ theme: next });
    },
    setTheme: (theme) => { applyTheme(theme); set({ theme }); },

    // ─── Sidebar ────────────────────────────────────────────────────────────
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
      set((s) => { const next = new Set(s.expandedNodes); next.add(id); return { expandedNodes: next }; }),
    collapseNode: (id) =>
      set((s) => { const next = new Set(s.expandedNodes); next.delete(id); return { expandedNodes: next }; }),
    collapseAll: () => set({ expandedNodes: new Set() }),

    // ─── Command palette ────────────────────────────────────────────────────
    paletteOpen: false,
    openPalette: () => set({ paletteOpen: true }),
    closePalette: () => set({ paletteOpen: false }),
    togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

    // ─── Save status ────────────────────────────────────────────────────────
    saveStatus: "idle",
    setSaveStatus: (status) => set({ saveStatus: status }),

    // ─── Version history ────────────────────────────────────────────────────
    versionHistoryOpen: false,
    openVersionHistory: () => set({ versionHistoryOpen: true }),
    closeVersionHistory: () => set({ versionHistoryOpen: false }),

    // ─── Backlinks panel ────────────────────────────────────────────────────
    backlinksOpen: false,
    openBacklinks: () => set({ backlinksOpen: true }),
    closeBacklinks: () => set({ backlinksOpen: false }),
    toggleBacklinks: () => set((s) => ({ backlinksOpen: !s.backlinksOpen })),

    // ─── Import modal ──────────────────────────────────────────────────────
    importOpen: false,
    openImport: () => set({ importOpen: true }),
    closeImport: () => set({ importOpen: false }),

    // ─── Keyboard shortcuts ─────────────────────────────────────────────────
    shortcutsOpen: false,
    openShortcuts: () => set({ shortcutsOpen: true }),
    closeShortcuts: () => set({ shortcutsOpen: false }),

    // ─── Search ─────────────────────────────────────────────────────────────
    searchQuery: "",
    setSearchQuery: (query) => set({ searchQuery: query }),
    clearSearch: () => set({ searchQuery: "" }),
  };
});