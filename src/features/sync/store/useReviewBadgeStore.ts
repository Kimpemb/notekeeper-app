// src/features/sync/store/useReviewBadgeStore.ts
//
// How many notes need review, for the title-bar badge. Filled from the LOCAL queue and
// tombstone tables (reviewBadgeLive.ts), so it needs no network and is instant. Not persisted.

import { create } from "zustand";

interface ReviewBadgeStore {
  count: number;
  setCount: (n: number) => void;
}

export const useReviewBadgeStore = create<ReviewBadgeStore>((set) => ({
  count: 0,
  setCount: (n) => set((s) => (s.count === n ? s : { count: n })),
}));
