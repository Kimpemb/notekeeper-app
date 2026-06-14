// src/features/calendar/lib/calendarMerge.ts

import type { CalendarEvent } from "@/features/calendar/db/calendarQueries";
import type { Goal } from "@/features/goals/db/goalQueries";

export interface GoalBanner {
  goalId:      string;
  title:       string;
  startDate:   string;
  targetDate:  string;
  colourState: "blue" | "green" | "yellow" | "red";
  progress:    number;
}

export type CalendarItem =
  | { kind: "event";  data: CalendarEvent }
  | { kind: "banner"; data: GoalBanner   };

export function getBannersForDateRange(
  goals: Goal[],
  startDate: string,
  endDate: string
): GoalBanner[] {
  return goals
    .filter((g) => g.start_date <= endDate && g.target_date >= startDate)
    .map((g) => ({
      goalId:      g.id,
      title:       g.title,
      startDate:   g.start_date,
      targetDate:  g.target_date,
      colourState: g.colour_state,
      progress:    g.progress,
    }));
}

export function mergeCalendarItems(
  events:  CalendarEvent[],
  banners: GoalBanner[]
): CalendarItem[] {
  const items: CalendarItem[] = [
    ...events.map((e): CalendarItem  => ({ kind: "event",  data: e })),
    ...banners.map((b): CalendarItem => ({ kind: "banner", data: b })),
  ];
  return items;
}