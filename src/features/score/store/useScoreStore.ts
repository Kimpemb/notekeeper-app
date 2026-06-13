// src/features/score/store/useScoreStore.ts

import { create } from "zustand";
import type { ColourState, CategoryKey } from "@/features/calendar/db/calendarQueries";

export interface ScoreEvent {
  id:          string;   // calendar_events.id
  title:       string;
  category:    CategoryKey;
  colourState: ColourState;
}

interface ScoreStore {
  // In-memory snapshot of today's calendar events.
  // Source of truth for LIVE display — never read from DB during normal operation.
  todayEvents: ScoreEvent[];
  setTodayEvents: (events: ScoreEvent[]) => void;

  // Updates a single event's colour state in the in-memory list.
  // Does NOT add/remove events — use setTodayEvents for that.
  updateEventState: (eventId: string, state: ColourState) => void;

  // Streak — computed in Phase 10, but the field lives here so
  // DailyScoreWidget can read it from Phase 4 onward.
  streak: number;
  setStreak: (streak: number) => void;
}

// Not persisted — todayEvents is always rebuilt from DB on app startup
// via snapshotTodayEvents(). streak is rebuilt after lockDayAndWriteScore.

export const useScoreStore = create<ScoreStore>((set) => ({
  todayEvents: [],
  setTodayEvents: (events) => set({ todayEvents: events }),

  updateEventState: (eventId, state) =>
    set((s) => ({
      todayEvents: s.todayEvents.map((e) =>
        e.id === eventId ? { ...e, colourState: state } : e
      ),
    })),

  streak: 0,
  setStreak: (streak) => set({ streak }),
}));