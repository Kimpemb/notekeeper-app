// src/features/score/lib/scoreComputer.ts

import { getDb } from "@/features/notes/db/client";
import {
  writeDailyScore,
} from "@/features/score/db/scoreQueries";
import type { ScoreEvent } from "@/features/score/store/useScoreStore";
import type { CalendarEvent } from "@/features/calendar/db/calendarQueries";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

export function getLocalDateISO(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, "0");
  const dd   = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getPreviousDay(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return getLocalDateISO(d);
}

// Used by App.tsx to schedule the midnight lock timer.
export function getMillisecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next midnight, local time
  return midnight.getTime() - now.getTime();
}

// ─── Live score (pure function, no DB) ───────────────────────────────────────

export function computeLiveScore(events: ScoreEvent[]): { completed: number; total: number } {
  const total = events.length;
  const completed = events.filter((e) => e.colourState === "green").length;
  return { completed, total };
}

// ─── Startup snapshot ─────────────────────────────────────────────────────────
//
// Idempotent: the UNIQUE index on (event_id, score_date) prevents duplicate
// rows. Safe to call multiple times (e.g. app restarted same day).
//
// Runs ONCE at startup — NOT on mutation. Events created after this runs
// are visible in the UI but do not affect today's locked total
// (anti-gaming tradeoff — see Phase 4 spec).

export async function snapshotTodayEvents(): Promise<ScoreEvent[]> {
  const db = await getDb();
  const today = getLocalDateISO();

  const events = await db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events WHERE date = $1`,
    [today]
  );

  for (const event of events) {
    await db.execute(
      `INSERT OR IGNORE INTO score_event_log
         (id, score_date, event_id, event_title, category, colour_state, locked)
       VALUES ($1,$2,$3,$4,$5,$6,0)`,
      [uuid(), today, event.id, event.title, event.category, event.colour_state]
    );
  }

  return events.map((e) => ({
    id:          e.id,
    title:       e.title,
    category:    e.category,
    colourState: e.colour_state,
  }));
}

// ─── Backfill (one-time, idempotent) ──────────────────────────────────────────
//
// Covers events created in Phases 2–3 that predate score_event_log being
// populated. locked = 1 because these days have already passed — no
// daily_scores rows are written for them; history starts from Phase 4 forward.
// Safe to call on every startup — UNIQUE index prevents duplicates, and the
// NOT IN subquery skips rows already present.

export async function backfillPastEvents(): Promise<void> {
  const db = await getDb();
  const today = getLocalDateISO();

  const pastEvents = await db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE date < $1
       AND id NOT IN (SELECT event_id FROM score_event_log)`,
    [today]
  );

  for (const event of pastEvents) {
    await db.execute(
      `INSERT OR IGNORE INTO score_event_log
         (id, score_date, event_id, event_title, category, colour_state, locked)
       VALUES ($1,$2,$3,$4,$5,$6,1)`,
      [uuid(), event.date, event.id, event.title, event.category, event.colour_state]
    );
  }

  if (pastEvents.length > 0) {
    console.log(`[scoreComputer] backfilled ${pastEvents.length} past event(s) into score_event_log`);
  }
}

// ─── Midnight lock ─────────────────────────────────────────────────────────────
//
// Locks score_event_log rows for `date` and writes the daily_scores summary row.
// streak_day = 0 in Phase 4 — real streak computation arrives in Phase 10.
//
// Called:
//   - at the scheduled midnight timer (App.tsx)
//   - at startup if yesterday's score was not yet locked
//     (handles the app being closed at midnight)

export async function lockDayAndWriteScore(date: string): Promise<void> {
  const db = await getDb();

  await db.execute(
    `UPDATE score_event_log SET locked = 1 WHERE score_date = $1`,
    [date]
  );

  const rows = await db.select<{ completed: number; total: number }[]>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN colour_state = 'green' THEN 1 ELSE 0 END) as completed
     FROM score_event_log
     WHERE score_date = $1`,
    [date]
  );

  const total     = rows[0]?.total ?? 0;
  const completed = rows[0]?.completed ?? 0;

  await writeDailyScore({
    date,
    completed,
    total,
    streak_day: 0, // Phase 10 will compute and update this
  });
}

// ─── Startup helper: was yesterday locked? ─────────────────────────────────────
//
// If the app was closed before the midnight timer fired, yesterday's
// score_event_log rows may be unlocked and daily_scores may be missing
// a row for yesterday. This is the real safety net — the setTimeout-based
// midnight scheduler is NOT sleep-safe.

export async function ensureYesterdayLocked(): Promise<void> {
  const db = await getDb();
  const today = getLocalDateISO();
  const yesterday = getPreviousDay(today);

  const existing = await db.select<{ id: string }[]>(
    `SELECT id FROM daily_scores WHERE date = $1`,
    [yesterday]
  );
  if (existing.length > 0) return; // already locked and written

  // Only write a row if yesterday actually had events logged
  const hasEvents = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM score_event_log WHERE score_date = $1`,
    [yesterday]
  );
  if ((hasEvents[0]?.count ?? 0) === 0) return;

  await lockDayAndWriteScore(yesterday);
}