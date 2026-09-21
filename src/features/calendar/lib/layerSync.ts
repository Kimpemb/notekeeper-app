// src/features/calendar/lib/layerSync.ts

import {
  createEvent,
  updateEvent,
  deleteEvent,
  getEventBySource,
  getEventsBySourceType,
} from "@/features/calendar/db/calendarQueries";
import type { GoalMilestone } from "@/features/goals/db/goalQueries";

export async function syncMilestonesToCalendar(
  milestones: GoalMilestone[]
): Promise<void> {
  const currentIds = new Set(milestones.map((m) => m.id));

  for (const m of milestones) {
    const existing = await getEventBySource(m.id, "goal");
    if (existing) {
      if (
        existing.title         !== m.title         ||
        existing.date          !== m.date          ||
        existing.time          !== m.time          ||
        existing.duration_mins !== m.duration_mins ||
        existing.colour_state  !== m.colour_state
      ) {
        await updateEvent(existing.id, {
          title:         m.title,
          date:          m.date,
          time:          m.time,
          duration_mins: m.duration_mins,
          colour_state:  m.colour_state,
        });
      }
    } else {
      await createEvent({
        title:         m.title,
        date:          m.date,
        time:          m.time,
        duration_mins: m.duration_mins,
        category:      "goal",
        source_id:     m.id,
        source_type:   "goal",
        colour_state:  m.colour_state,
      });
    }
  }

  // Prune calendar events for milestones that no longer exist
  const goalEvents = await getEventsBySourceType("goal");
  for (const ev of goalEvents) {
    if (ev.source_id && !currentIds.has(ev.source_id)) {
      await deleteEvent(ev.id);
    }
  }
}

export function syncCDEToCalendar(): void {
  // TODO Phase 3
}