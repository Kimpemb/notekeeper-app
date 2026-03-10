// src/store/useUIStore.ts
// All UI state: theme, sidebar, command palette, dialogs.
// No DB calls here — pure UI concerns only.

import { create } from "zustand";

type Theme = "light" | "dark";
type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UIStore {
  // ─── Theme ────────────────────────────────────────────────────────────────
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;

  // ─── Sidebar ──────────────────────────────────────────────────────────────
  sidebarOpen: boolean;
  sidebarWidth: number;                    // px, user-resizable in future phases
  expandedNodes: Set<string>;              // note IDs that are expanded in the tree
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
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

  // ─── Search ───────────────────────────────────────────────────────────────
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
}

// Persist theme preference across launches via localStorage
function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("notekeeper-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage unavailable (unlikely in Tauri, but safe)
  }
  // Default: follow OS preference
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  try {
    localStorage.setItem("notekeeper-theme", theme);
  } catch {
    // ignore
  }
}

export const useUIStore = create<UIStore>((set, get) => {
  // Apply theme immediately on store creation (before first render)
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

    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
    },

    // ─── Sidebar ────────────────────────────────────────────────────────────
    sidebarOpen: true,
    sidebarWidth: 260,
    expandedNodes: new Set(),

    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),

    toggleNode: (id) =>
      set((s) => {
        const next = new Set(s.expandedNodes);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
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

    // ─── Search ─────────────────────────────────────────────────────────────
    searchQuery: "",
    setSearchQuery: (query) => set({ searchQuery: query }),
    clearSearch: () => set({ searchQuery: "" }),
  };
});