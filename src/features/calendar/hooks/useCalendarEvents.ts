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
  type CalendarEvent,
  type CalendarEventInput,
  type ColourState,
  type LayerKey,
} from "@/features/calendar/db/calendarQueries";
import { useCalendarStore } from "@/features/calendar/store/useCalendarStore";

export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const activeView      = useCalendarStore((s) => s.activeView);
  const selectedDate    = useCalendarStore((s) => s.selectedDate);
  const layerVisibility = useCalendarStore((s) => s.layerVisibility);
  const setYellowCount  = useCalendarStore((s) => s.setYellowCount);

  // Derive active layers from visibility map
  const activeLayers = (Object.entries(layerVisibility) as [LayerKey, boolean][])
    .filter(([, visible]) => visible)
    .map(([layer]) => layer);

  // Derive date range for the current view
  function getDateRange(): { startDate: string; endDate: string } {
    const d = new Date(selectedDate + "T00:00:00");

    if (activeView === "agenda") {
      return { startDate: selectedDate, endDate: "9999-12-31" };
    }

    if (activeView === "day") {
      return { startDate: selectedDate, endDate: selectedDate };
    }

    if (activeView === "week") {
      const day = d.getDay(); // 0=Sun
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

    return { startDate: selectedDate, endDate: "9999-12-31" };
  }

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      let loaded: CalendarEvent[];

      if (activeView === "agenda") {
        loaded = await getAgendaEvents({
          startDate: selectedDate,
          layers:    activeLayers,
        });
      } else {
        const { startDate, endDate } = getDateRange();
        loaded = await getEventsForDateRange({
          startDate,
          endDate,
          layers: activeLayers,
        });
      }

      setEvents(loaded);

      // Update yellow badge count
      const count = await getYellowEventCount();
      setYellowCount(count);
    } catch (err) {
      console.error("[useCalendarEvents] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [activeView, selectedDate, JSON.stringify(activeLayers)]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const handleCreateEvent = useCallback(
    async (input: CalendarEventInput): Promise<string> => {
      const id = await createEvent(input);
      await loadEvents();
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
    },
    [loadEvents]
  );

  const handleUpdateColourState = useCallback(
    async (id: string, state: ColourState): Promise<void> => {
      await updateColourState(id, state);
      await loadEvents();
      // TODO Phase 4: useScoreStore.getState().updateEventState(id, state)
    },
    [loadEvents]
  );

  return {
    events,
    loading,
    reload:           loadEvents,
    createEvent:      handleCreateEvent,
    updateEvent:      handleUpdateEvent,
    deleteEvent:      handleDeleteEvent,
    updateColourState: handleUpdateColourState,
  };
}