// src/features/graph/store/useThoughtGraphStore.ts
//
// Mode toggle for GraphView — "notes" (default, permanent knowledge map) or
// "thought" (AI-proposed reasoning graph, design doc §1). Reset to "notes"
// on every GraphView mount by GraphView's auto-activation effect, so a
// stale "thought" mode from a previous session never leaks into a note
// that has no thought graph of its own.

import { create } from "zustand";

interface ThoughtGraphState {
  graphMode: "notes" | "thought";
  setGraphMode: (mode: "notes" | "thought") => void;
  toggleGraphMode: () => void;
}

export const useThoughtGraphStore = create<ThoughtGraphState>((set) => ({
  graphMode: "notes",
  setGraphMode: (mode) => set({ graphMode: mode }),
  toggleGraphMode: () =>
    set((s) => ({ graphMode: s.graphMode === "notes" ? "thought" : "notes" })),
}));