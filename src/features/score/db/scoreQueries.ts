// src/features/score/db/scoreQueries.ts

import { getDb } from "@/features/notes/db/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColourState = "blue" | "green" | "yellow" | "red";

// Row shape from score_event_log — distinct from the calendar's CalendarEvent.
// event_title/category are denormalised so history survives event deletion.
export interface ScoreEventLogRow {
  id:           string;
  score_date:   string;        // ISO: 2026-05-01
  event_id:     string;        // calendar_events.id at snapshot time
  event_title:  string;
  category:     string;        // denormalised CategoryKey
  colour_state: ColourState;
  locked:       number;        // 0 | 1 (sqlite boolean)
}

export interface DailyScore {
  id:          string;
  date:        string;         // ISO: 2026-05-01
  completed:   number;
  total:       number;
  streak_day:  number;
  created_at:  number;
}

export interface DailyScoreInput {
  id?:         string;
  date:        string;
  completed:   number;
  total:       number;
  streak_day:  number;
}

export interface CategoryBreakdownRow {
  category:  string;
  total:     number;
  completed: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

// ─── score_event_log ────────────────────────────────────────────────────────

export async function getScoreEventLogForDate(date: string): Promise<ScoreEventLogRow[]> {
  const db = await getDb();
  return db.select<ScoreEventLogRow[]>(
    `SELECT * FROM score_event_log WHERE score_date = $1`,
    [date]
  );
}

// Only updates UNLOCKED rows — locked rows are immutable (frozen at midnight).
// Returns rowsAffected so callers can detect a no-op (e.g. resolving a
// stale/locked yellow event from a previous day — see Phase 11 note).
export async function updateScoreEventColourState(
  eventId: string,
  date: string,
  state: ColourState
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE score_event_log
     SET colour_state = $1
     WHERE event_id = $2 AND score_date = $3 AND locked = 0`,
    [state, eventId, date]
  );
  return result.rowsAffected;
}

// ─── daily_scores ────────────────────────────────────────────────────────────

export async function writeDailyScore(score: DailyScoreInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO daily_scores
       (id, date, completed, total, streak_day, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      score.id ?? uuid(),
      score.date,
      score.completed,
      score.total,
      score.streak_day,
      Date.now(),
    ]
  );
}

export async function getDailyScore(date: string): Promise<DailyScore | null> {
  const db = await getDb();
  const rows = await db.select<DailyScore[]>(
    `SELECT * FROM daily_scores WHERE date = $1`,
    [date]
  );
  return rows[0] ?? null;
}

// ─── Phase 10 additions (declared now, used later) ───────────────────────────

export async function getDailyScores(startDate: string, endDate: string): Promise<DailyScore[]> {
  const db = await getDb();
  return db.select<DailyScore[]>(
    `SELECT * FROM daily_scores
     WHERE date >= $1 AND date <= $2
     ORDER BY date DESC`,
    [startDate, endDate]
  );
}

export async function getCategoryBreakdown(date: string): Promise<CategoryBreakdownRow[]> {
  const db = await getDb();
  return db.select<CategoryBreakdownRow[]>(
    `SELECT category,
       COUNT(*) as total,
       SUM(CASE WHEN colour_state = 'green' THEN 1 ELSE 0 END) as completed
     FROM score_event_log
     WHERE score_date = $1
     GROUP BY category`,
    [date]
  );
}