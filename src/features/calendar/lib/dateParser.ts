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