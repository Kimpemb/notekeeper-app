// src/features/sync/lib/reviewBadgeLive.ts
//
// The live half of the conflict badge: one cheap local query, no network. Counts one row per
// note: a note with a parked queue row ('remote_ahead') and/or a conflict tombstone counts once
// (UNION removes duplicates).
//
// This is the same pair of sources listReviewCandidates() starts from. It does not ask the
// server, so in rare cases (a conflict tombstone the server has not moved past, or a hosted
// row that vanished) it can differ from the list's final length; the list is authoritative and
// the badge corrects itself on the next refresh.
//
// Never throws. Never import this file from a test: it reaches the database client.

import { getDb } from "@/features/notes/db/client";
import { useReviewBadgeStore } from "@/features/sync/store/useReviewBadgeStore";

export async function countLocalNeedReview(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM (
       SELECT note_id FROM sync_push_queue WHERE state = 'remote_ahead'
       UNION
       SELECT note_id FROM note_tombstones WHERE state = 'conflict'
     )`
  );
  return rows[0]?.n ?? 0;
}

/** Re-reads the local count and updates the badge. Safe to call often. */
export async function refreshReviewBadge(): Promise<void> {
  try {
    useReviewBadgeStore.getState().setCount(await countLocalNeedReview());
  } catch {
    // Leave the previous count; the next refresh will try again.
  }
}
