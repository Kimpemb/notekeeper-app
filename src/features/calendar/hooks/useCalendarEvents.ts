// src/features/calendar/hooks/useCalendarEvents.ts

import { useState, useEffect, useCallback } from "react";
import {
  createEvent,
  updateEvent,
  deleteEvent,
  updateColourState,
  getAgendaEvents,
  getEventsForDateRange,
  getYellowEventCount,
  getTodayBlueCount,
  type CalendarEvent,
  type CalendarEventInput,
  type ColourState,
  type LayerKey,
} from "@/features/calendar/db/calendarQueries";
import { useCalendarStore } from "@/features/calendar/store/useCalendarStore";
import { useScoreStore } from "@/features/score/store/useScoreStore";
import { getLocalDateISO } from "@/features/score/lib/scoreComputer";
import { updateScoreEventColourState } from "@/features/score/db/scoreQueries";

const AGENDA_WINDOW_DAYS = 7;

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const activeView      = useCalendarStore((s) => s.activeView);
  const selectedDate    = useCalendarStore((s) => s.selectedDate);
  const layerVisibility = useCalendarStore((s) => s.layerVisibility);
  const setYellowCount  = useCalendarStore((s) => s.setYellowCount);
  const setTodayBlueCount = useCalendarStore((s) => s.setTodayBlueCount);

  const activeLayers = (Object.entries(layerVisibility) as [LayerKey, boolean][])
    .filter(([, visible]) => visible)
    .map(([layer]) => layer);

  function getDateRange(): { startDate: string; endDate: string } {
    const d = new Date(selectedDate + "T00:00:00");

    if (activeView === "agenda") {
      return {
        startDate: selectedDate,
        endDate:   addDays(selectedDate, AGENDA_WINDOW_DAYS),
      };
    }

    if (activeView === "day") {
      return { startDate: selectedDate, endDate: selectedDate };
    }

    if (activeView === "week") {
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        startDate: monday.toISOString().split("T")[0],
        endDate:   sunday.toISOString().split("T")[0],
      };
    }

    if (activeView === "month") {
      const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
      const lastDay  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return {
        startDate: firstDay.toISOString().split("T")[0],
        endDate:   lastDay.toISOString().split("T")[0],
      };
    }

    return { startDate: selectedDate, endDate: addDays(selectedDate, AGENDA_WINDOW_DAYS) };
  }

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      let loaded: CalendarEvent[];
      const today = todayISO();

      if (activeView === "agenda") {
        const { startDate, endDate } = getDateRange();
        const isPastWindow = endDate <= today;

        if (isPastWindow) {
          // Past window: show ALL events including green (completed history visible)
          loaded = await getEventsForDateRange({
            startDate,
            endDate,
            layers: activeLayers,
          });
        } else {
          // Present/future window: getAgendaEvents excludes green globally.
          // We then merge green events back for the entire window — not just
          // today — so proactively-completed future events remain visible on
          // their scheduled date (dimmed, strikethrough, sunk to group bottom).
          const [nonGreen, windowGreen] = await Promise.all([
            getAgendaEvents({ startDate, endDate, layers: activeLayers }),
            getEventsForDateRange({
              startDate,
              endDate,
              layers: activeLayers,
            }).then((evts) => evts.filter((e) => e.colour_state === "green")),
          ]);

          // Merge, dedup by id
          const seen = new Set(nonGreen.map((e) => e.id));
          loaded = [
            ...nonGreen,
            ...windowGreen.filter((e) => !seen.has(e.id)),
          ];
        }
      } else {
        const { startDate, endDate } = getDateRange();
        loaded = await getEventsForDateRange({ startDate, endDate, layers: activeLayers });
      }

      setEvents(loaded);

      const count = await getYellowEventCount();
      setYellowCount(count);

      const blueCount = await getTodayBlueCount();
      setTodayBlueCount(blueCount);
    } catch (err) {
      console.error("[useCalendarEvents] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [activeView, selectedDate, JSON.stringify(activeLayers)]);

  // Initial load
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Reload once after app startup transitions have had time to apply.
  // applyMidnightTransitions runs async in App.tsx — this catches any
  // yellow transitions that completed after our initial load.
  useEffect(() => {
    const timer = setTimeout(() => {
      loadEvents();
    }, 1500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once on mount only

  // ── Mutations ──────────────────────────────────────────────────────────────

  const handleCreateEvent = useCallback(
    async (input: CalendarEventInput): Promise<string> => {
      const id = await createEvent(input);
      await loadEvents();

      if (input.date === getLocalDateISO()) {
        const { todayEvents, setTodayEvents } = useScoreStore.getState();
        setTodayEvents([
          ...todayEvents,
          {
            id,
            title:       input.title,
            category:    input.category ?? "personal",
            colourState: input.colour_state ?? "blue",
          },
        ]);
      }

      return id;
    },
    [loadEvents]
  );

  const handleUpdateEvent = useCallback(
    async (id: string, updates: Partial<CalendarEventInput>): Promise<void> => {
      await updateEvent(id, updates);
      await loadEvents();
    },
    [loadEvents]
  );

  const handleDeleteEvent = useCallback(
    async (id: string): Promise<void> => {
      await deleteEvent(id);
      await loadEvents();

      const { todayEvents, setTodayEvents } = useScoreStore.getState();
      if (todayEvents.some((e) => e.id === id)) {
        setTodayEvents(todayEvents.filter((e) => e.id !== id));
      }
    },
    [loadEvents]
  );

  const handleUpdateColourState = useCallback(
    async (id: string, state: ColourState): Promise<void> => {
      await updateColourState(id, state);
      await loadEvents();

      useScoreStore.getState().updateEventState(id, state);

      const today = getLocalDateISO();
      await updateScoreEventColourState(id, today, state);
    },
    [loadEvents]
  );

  return {
    events,
    loading,
    reload:            loadEvents,
    createEvent:       handleCreateEvent,
    updateEvent:       handleUpdateEvent,
    deleteEvent:       handleDeleteEvent,
    updateColourState: handleUpdateColourState,
  };
}