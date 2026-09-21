// src/features/scheduler/db/schedulerStateQueries.ts
//
// Persistence for cross-call scheduler state — currently just the
// aging-recovery daily cap (see sequencer.ts, AgingRecommendationState).
//
// Single-row table: consistent with every other table in this schema,
// none of which are currently user-scoped. If/when this app gets
// multi-user support (web/mobile + accounts), that should be one
// coordinated migration across all tables done alongside auth/sync -
// not a piecemeal retrofit of just this table ahead of time.

import { getDb } from "@/features/notes/db/client";
import type { AgingRecommendationState } from "../lib/sequencer";

const ROW_ID = 1; // single fixed row, enforced by schema check constraint

export async function getAgingState(): Promise<AgingRecommendationState> {
  const db = await getDb();
  const rows = await db.select<
    { last_aging_recommendation_at: number | null; last_aging_recommended_goal_id: string | null }[]
  >(
    `SELECT last_aging_recommendation_at, last_aging_recommended_goal_id
     FROM scheduler_state WHERE id = $1`,
    [ROW_ID]
  );
  const row = rows[0];

  if (!row) {
    return { lastRecommendationAt: null, lastRecommendedGoalId: null };
  }

  return {
    lastRecommendationAt: row.last_aging_recommendation_at,
    lastRecommendedGoalId: row.last_aging_recommended_goal_id,
  };
}

export async function saveAgingState(state: AgingRecommendationState): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE scheduler_state
     SET last_aging_recommendation_at = $1, last_aging_recommended_goal_id = $2
     WHERE id = $3`,
    [state.lastRecommendationAt, state.lastRecommendedGoalId, ROW_ID]
  );
}