// src/features/ui/lib/forgottenNotes.ts
//
// Pure helpers for the "forgotten note" banner. No React, no database, so they are
// easy to test.

export const DAY_MS = 24 * 60 * 60 * 1000;

// Picks one candidate at random from those that are not snoozed. `snoozed` maps a
// note id to the time (ms) until which it must not be suggested.
export function pickForgottenNote<T extends { id: string }>(
  candidates: T[],
  snoozed: Record<string, number>,
  now: number,
  random: () => number = Math.random
): T | null {
  const eligible = candidates.filter((c) => (snoozed[c.id] ?? 0) <= now);
  if (eligible.length === 0) return null;
  const i = Math.min(eligible.length - 1, Math.floor(random() * eligible.length));
  return eligible[i];
}

// Whole days between a timestamp and now, never negative.
export function daysSince(timestamp: number, now: number): number {
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS));
}
