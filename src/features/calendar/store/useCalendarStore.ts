// src/features/calendar/store/useCalendarStore.ts

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CalendarView = "month" | "week" | "day" | "agenda";
export type LayerKey = "personal" | "notes" | "tasks" | "goals" | "cde";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

interface CalendarStore {
  activeView:      CalendarView;
  selectedDate:    string;                     // ISO date: 2026-05-01
  layerVisibility: Record<LayerKey, boolean>;
  yellowCount:     number;                     // unresolved past events — sidebar badge
  todayBlueCount:  number;                     // blue events due today — sidebar badge

  setActiveView:      (view: CalendarView) => void;
  setSelectedDate:    (date: string) => void;
  toggleLayer:        (layer: LayerKey) => void;
  setYellowCount:     (count: number) => void;
  setTodayBlueCount:  (count: number) => void;
}

export const useCalendarStore = create<CalendarStore>()(
  persist(
    (set) => ({
      activeView:   "agenda",
      selectedDate: todayISO(),
      layerVisibility: {
        personal: true,
        notes:    true,
        tasks:    true,
        goals:    true,
        cde:      true,
      },
      yellowCount:    0,
      todayBlueCount: 0,

      setActiveView:      (view)  => set({ activeView: view }),
      setSelectedDate:    (date)  => set({ selectedDate: date }),
      toggleLayer:        (layer) =>
        set((s) => ({
          layerVisibility: {
            ...s.layerVisibility,
            [layer]: !s.layerVisibility[layer],
          },
        })),
      setYellowCount:     (count) => set({ yellowCount: count }),
      setTodayBlueCount:  (count) => set({ todayBlueCount: count }),
    }),
    {
      name: "idemora-calendar-store",
      partialize: (s) => ({
        activeView:      s.activeView,
        layerVisibility: s.layerVisibility,
        // selectedDate intentionally NOT persisted — always opens on today
        // yellowCount / todayBlueCount intentionally NOT persisted — always recomputed on load
      }),
    }
  )
);