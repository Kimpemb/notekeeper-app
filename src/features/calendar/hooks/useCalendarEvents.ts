// src/features/calendar/hooks/useCalendarEvents.ts
//
// Phase 12 changes:
//   - handleCreateEvent: after creating a recurring event, generates and persists
//     calendar_event_occurrences rows.
//   - handleUpdateEvent: if the event has recurrence AND occurrence_id is present,
//     caller must use handleEditOccurrence instead (which routes through EditModeModal).
//     For non-recurring updates, behaviour is unchanged.
//   - handleDeleteEvent: same routing — recurring events go through handleDeleteOccurrence.
//   - New: handleEditOccurrence(mode, params) and handleDeleteOccurrence(mode, ...).
//     These are called by EventDetail after the user picks a mode in EditModeModal.

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
import {
  generateOccurrences,
  persistOccurrences,
  editOccurrence,
  deleteOccurrence,
  deleteRecurringEventAll,
  type EditMode,
  type DeleteMode,
} from "@/features/calendar/hooks/useRecurrence";
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
  const [events,  setEvents]  = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const activeView        = useCalendarStore((s) => s.activeView);
  const selectedDate      = useCalendarStore((s) => s.selectedDate);
  const layerVisibility   = useCalendarStore((s) => s.layerVisibility);
  const setYellowCount    = useCalendarStore((s) => s.setYellowCount);
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
      const day    = d.getDay();
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
          loaded = await getEventsForDateRange({
            startDate,
            endDate,
            layers: activeLayers,
          });
        } else {
          const [nonGreen, windowGreen] = await Promise.all([
            getAgendaEvents({ startDate, endDate, layers: activeLayers }),
            getEventsForDateRange({ startDate, endDate, layers: activeLayers })
              .then((evts) => evts.filter((e) => e.colour_state === "green")),
          ]);
          const seen = new Set(nonGreen.map((e) => e.occurrence_id ?? e.id));
          loaded = [
            ...nonGreen,
            ...windowGreen.filter((e) => !seen.has(e.occurrence_id ?? e.id)),
          ];
        }
      } else {
        const { startDate, endDate } = getDateRange();
        loaded = await getEventsForDateRange({ startDate, endDate, layers: activeLayers });
      }

      setEvents(loaded);

      const [yCount, bCount] = await Promise.all([
        getYellowEventCount(),
        getTodayBlueCount(),
      ]);
      setYellowCount(yCount);
      setTodayBlueCount(bCount);
    } catch (err) {
      console.error("[useCalendarEvents] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [activeView, selectedDate, JSON.stringify(activeLayers)]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Catch yellow transitions that completed after initial load
  useEffect(() => {
    const timer = setTimeout(() => { loadEvents(); }, 1500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Create ─────────────────────────────────────────────────────────────────

  const handleCreateEvent = useCallback(
    async (input: CalendarEventInput): Promise<string> => {
      const id = await createEvent(input);

      // Phase 12: if recurrence is set, generate and persist occurrences
      if (input.recurrence) {
        // Build a minimal CalendarEvent shape for the generator
        const fakeEvent: CalendarEvent = {
          id,
          title:          input.title,
          date:           input.date,
          time:           input.time            ?? null,
          duration_mins:  input.duration_mins   ?? null,
          category:       input.category        ?? "personal",
          source_id:      input.source_id       ?? null,
          source_type:    input.source_type     ?? null,
          colour_state:   input.colour_state    ?? "blue",
          recurrence:     input.recurrence,
          recurrence_end: input.recurrence_end  ?? null,
          notes:          input.notes           ?? null,
          group_id:       input.group_id        ?? null,
          linked_note_id: input.linked_note_id  ?? null,
          created_at:     Date.now(),
          updated_at:     Date.now(),
          occurrence_id:  null,
        };
        const occurrences = generateOccurrences(fakeEvent);
        await persistOccurrences(occurrences);
        console.log(
          `[useCalendarEvents] created ${occurrences.length} occurrences for event ${id}`
        );
      }

      await loadEvents();

      // Score store: only add to today's live total for non-recurring events
      // (recurring events are snapshotted per occurrence at startup, not on create)
      if (!input.recurrence && input.date === getLocalDateISO()) {
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

  // ── Update (non-recurring) ─────────────────────────────────────────────────
  // For recurring events, callers should use handleEditOccurrence instead.
  // This function still works for non-recurring updates and for updating
  // parent event metadata that doesn't touch the occurrence chain.

  const handleUpdateEvent = useCallback(
    async (id: string, updates: Partial<CalendarEventInput>): Promise<void> => {
      await updateEvent(id, updates);
      await loadEvents();
    },
    [loadEvents]
  );

  // ── Delete (non-recurring) ─────────────────────────────────────────────────

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

  // ── Colour state ───────────────────────────────────────────────────────────

  const handleUpdateColourState = useCallback(
    async (id: string, state: ColourState, occurrenceId?: string | null): Promise<void> => {
      if (occurrenceId) {
        // Update the occurrence row's colour_state, not the parent event
        const { updateOccurrenceColourState } = await import(
          "@/features/calendar/db/calendarQueries"
        );
        await updateOccurrenceColourState(occurrenceId, state);
      } else {
        await updateColourState(id, state);
      }

      await loadEvents();
      useScoreStore.getState().updateEventState(id, state);

      const today = getLocalDateISO();
      await updateScoreEventColourState(id, today, state);
    },
    [loadEvents]
  );

  // ── Edit recurring occurrence (Phase 12) ──────────────────────────────────
  //
  // Called by EventDetail after the user selects a mode in EditModeModal.
  // mode: 'this' | 'this_and_future' | 'all'

  const handleEditOccurrence = useCallback(
    async (
      mode: EditMode,
      params: {
        eventId:        string;
        occurrenceId:   string;
        occurrenceDate: string;
        updates:        Partial<CalendarEventInput>;
      }
    ): Promise<void> => {
      await editOccurrence(mode, params);
      await loadEvents();
    },
    [loadEvents]
  );

  // ── Delete recurring occurrence (Phase 12) ────────────────────────────────
  //
  // Called by EventDetail after the user selects a delete mode in DeleteModeModal.
  // mode: 'this' | 'all'

  const handleDeleteOccurrence = useCallback(
    async (
      mode: DeleteMode,
      params: {
        eventId:      string;
        occurrenceId: string;
      }
    ): Promise<void> => {
      if (mode === "this") {
        await deleteOccurrence(params.occurrenceId);
      } else {
        // 'all': delete the parent event (CASCADE removes all occurrences)
        await deleteRecurringEventAll(params.eventId);

        // Remove from score store if the parent event was in today's snapshot
        const { todayEvents, setTodayEvents } = useScoreStore.getState();
        if (todayEvents.some((e) => e.id === params.eventId)) {
          setTodayEvents(todayEvents.filter((e) => e.id !== params.eventId));
        }
      }
      await loadEvents();
    },
    [loadEvents]
  );

  return {
    events,
    loading,
    reload:                loadEvents,
    createEvent:           handleCreateEvent,
    updateEvent:           handleUpdateEvent,
    deleteEvent:           handleDeleteEvent,
    updateColourState:     handleUpdateColourState,
    // Phase 12 additions
    editOccurrence:        handleEditOccurrence,
    deleteOccurrence:      handleDeleteOccurrence,
  };
}