// src/features/score/lib/streakComputer.ts

import { getDb } from "@/features/notes/db/client";
import { getLocalDateISO, getPreviousDay } from "./scoreComputer";

export async function computeAndStoreStreak(): Promise<number> {
  const db = await getDb();
  const today = getLocalDateISO();
  const yesterday = getPreviousDay(today);

  // Load last 90 days of daily_scores, most recent first
  const rows = await db.select<{ date: string; completed: number; total: number }[]>(
    `SELECT date, completed, total FROM daily_scores
     WHERE date <= $1
     ORDER BY date DESC
     LIMIT 90`,
    [yesterday]
  );

  let streak = 0;

  for (const row of rows) {
    if (row.total === 0) continue;           // no events that day — skip, don't break
    if (row.completed / row.total >= 0.5) {
      streak++;
    } else {
      break;                                 // streak broken
    }
  }

  return streak;
}