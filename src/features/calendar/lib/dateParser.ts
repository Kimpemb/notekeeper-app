// src/features/calendar/lib/dateParser.ts

import * as chrono from "chrono-node";

// Reference date is always start-of-day so "@tomorrow" resolves identically
// at 11:59 PM and 12:01 AM — no time-of-day drift.
function referenceDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseNaturalDate(input: string): Date | null {
  // forwardDate: true — "@next friday" always goes forward, never back
  return chrono.parseDate(input, referenceDate(), { forwardDate: true });
}

export function formatDateForChip(date: Date): string {
  // Always absolute — chip never shows "tomorrow", only "15 Jun 2026"
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function dateToISO(date: Date): string {
  // "2026-06-15" — local date, not UTC
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Extracts HH:MM from a Date if the time component is not midnight.
// chrono-node sets hours/minutes when the input includes a time expression.
export function extractTime(date: Date): string | null {
  const h = date.getHours();
  const m = date.getMinutes();
  if (h === 0 && m === 0) return null; // midnight = no explicit time given
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Strips a trailing range suffix like "-15:00" or "-3pm" from raw input
// before passing to chrono, then parses the end time to get duration.
// Returns { cleanInput, durationMins } where durationMins is null if no range.
// Matches: optional-date-text + start-time + optional(-end-time)
// Handles both "friday 14:00-15:00" and "friday14:00-15:00" (no space)
const TIME_RE = /^(.*?)(\d{1,2}:\d{2}(?:am|pm)?|\d{1,2}(?:am|pm))(?:-(\d{1,2}(?::\d{2})?(?:am|pm)?))?$/i;

export function extractTimeRange(rawInput: string): {
  cleanInput: string;
  startTimeStr: string | null;
  endTimeStr: string | null;
} {
  const match = rawInput.match(TIME_RE);
  if (!match) return { cleanInput: rawInput, startTimeStr: null, endTimeStr: null };
  return {
    cleanInput:   match[1].trim() || rawInput, // date part, fall back to full if empty
    startTimeStr: match[2].trim(),
    endTimeStr:   match[3]?.trim() ?? null,
  };
}

export function computeDurationMins(
  startTime: string,   // HH:MM
  endTimeStr: string   // e.g. "15:00" or "3pm"
): number | null {
  // Parse endTimeStr
  const end = parseEndTime(endTimeStr);
  if (!end) return null;
  const [sh, sm] = startTime.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins   = end.h * 60 + end.m;
  const diff = endMins - startMins;
  return diff > 0 ? diff : null; // ignore if end <= start
}

function parseEndTime(str: string): { h: number; m: number } | null {
  // "15:00" or "15"
  const colon = str.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) return { h: parseInt(colon[1]), m: parseInt(colon[2]) };
  // "3pm" / "3am" / "15"
  const ampm = str.match(/^(\d{1,2})(am|pm)?$/i);
  if (!ampm) return null;
  let h = parseInt(ampm[1]);
  const period = ampm[2]?.toLowerCase();
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return { h, m: 0 };
}

export function formatTimeForChip(time: string, durationMins: number | null): string {
  if (!durationMins) return time;
  const [h, m] = time.split(':').map(Number);
  const endMins = h * 60 + m + durationMins;
  const eh = Math.floor(endMins / 60) % 24;
  const em = endMins % 60;
  return `${time}–${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}