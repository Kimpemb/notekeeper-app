// src/features/sync/lib/pushQueue.ts
//
// Stage 4c — durable hosted-push queue (local SQLite table sync_push_queue,
// one row per note). Stores ONLY the note id plus bookkeeping: pushToHostedSync
// reads current local state at push time, so a retry always pushes the latest
// version and duplicates collapse naturally.
//
// States:
//   pending              failed; will be retried with backoff
//   parked_max_attempts  gave up after MAX_ATTEMPTS; needs manual retry or a
//                        fresh save of the note
//   remote_ahead         hosted revision is newer than local. NOT retried —
//                        retrying can't resolve a conflict. Stage 4d consumes
//                        these rows (see listRemoteAhead) as its to-reconcile list.
//
// Write helpers never throw: a broken queue must not break saving or pushing.
// Read helpers (counts / lists) propagate errors to their caller.

import { getDb } from "@/features/notes/db/client";

export type PushQueueState = "pending" | "parked_max_attempts" | "remote_ahead";

export const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 3_600_000]; // 5s, 30s, 2m, 10m, 1h cap

export function computeBackoffMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i];
}

export interface ExistingQueueRow {
  state: PushQueueState;
  attempts: number;
}

export interface NextQueueState {
  state: "pending" | "parked_max_attempts";
  attempts: number;
  nextRetryAt: number | null;
}

// Pure decision logic for a failed push (unit-tested).
//  - an existing remote_ahead row is sticky: a transient failure must not
//    downgrade it into a retryable row (returns null = leave it alone)
//  - a retry-drain failure counts as another attempt
//  - a fresh failure (e.g. a new save of the note) restarts the count, which
//    also un-parks a parked note
export function nextStateAfterFailure(
  existing: ExistingQueueRow | null,
  isRetry: boolean,
  now: number
): NextQueueState | null {
  if (existing?.state === "remote_ahead") return null;
  const attempts = isRetry && existing ? existing.attempts + 1 : 1;
  if (attempts >= MAX_ATTEMPTS) {
    return { state: "parked_max_attempts", attempts, nextRetryAt: null };
  }
  return { state: "pending", attempts, nextRetryAt: now + computeBackoffMs(attempts) };
}

export async function enqueueFailedPush(
  noteId: string,
  reason: string,
  opts: { isRetry?: boolean } = {}
): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    const rows = await db.select<ExistingQueueRow[]>(
      `SELECT state, attempts FROM sync_push_queue WHERE note_id = $1`,
      [noteId]
    );
    const next = nextStateAfterFailure(rows[0] ?? null, opts.isRetry === true, now);
    if (!next) return;

    await db.execute(
      `INSERT INTO sync_push_queue
         (note_id, state, reason, attempts, next_retry_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(note_id) DO UPDATE SET
         state           = excluded.state,
         reason          = excluded.reason,
         attempts        = excluded.attempts,
         next_retry_at   = excluded.next_retry_at,
         local_revision  = NULL,
         remote_revision = NULL,
         updated_at      = excluded.updated_at`,
      [noteId, next.state, reason, next.attempts, next.nextRetryAt, now, now]
    );
    console.warn(
      `[sync] push failed for ${noteId} (attempt ${next.attempts}, ${next.state}): ${reason}`
    );
  } catch (err) {
    console.warn("[sync] could not record failed push:", noteId, err);
  }
}

// Hosted revision is newer than local — skipped, and handed to Stage 4d.
export async function markRemoteAhead(
  noteId: string,
  remoteRevision: number,
  localRevision: number
): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    await db.execute(
      `INSERT INTO sync_push_queue
         (note_id, state, reason, attempts, next_retry_at,
          local_revision, remote_revision, created_at, updated_at)
       VALUES ($1, 'remote_ahead', $2, 0, NULL, $3, $4, $5, $6)
       ON CONFLICT(note_id) DO UPDATE SET
         state           = 'remote_ahead',
         reason          = excluded.reason,
         attempts        = 0,
         next_retry_at   = NULL,
         local_revision  = excluded.local_revision,
         remote_revision = excluded.remote_revision,
         updated_at      = excluded.updated_at`,
      [
        noteId,
        `remote r${remoteRevision} is ahead of local r${localRevision}`,
        localRevision,
        remoteRevision,
        now,
        now,
      ]
    );
  } catch (err) {
    console.warn("[sync] could not record remote-ahead note:", noteId, err);
  }
}

// A push succeeded (or the note no longer needs one): drop any queue row.
export async function clearQueued(noteId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(`DELETE FROM sync_push_queue WHERE note_id = $1`, [noteId]);
  } catch (err) {
    console.warn("[sync] could not clear queue row:", noteId, err);
  }
}

export async function getDueRetries(now: number, limit = 200): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ note_id: string }[]>(
    `SELECT note_id FROM sync_push_queue
     WHERE state = 'pending' AND next_retry_at <= $1
     ORDER BY next_retry_at
     LIMIT $2`,
    [now, limit]
  );
  return rows.map((r) => r.note_id);
}

export interface PushQueueCounts {
  pending: number;
  parked: number;
  remoteAhead: number;
}

export async function getQueueCounts(): Promise<PushQueueCounts> {
  const db = await getDb();
  const rows = await db.select<{ state: PushQueueState; n: number }[]>(
    `SELECT state, COUNT(*) AS n FROM sync_push_queue GROUP BY state`
  );
  const counts: PushQueueCounts = { pending: 0, parked: 0, remoteAhead: 0 };
  for (const r of rows) {
    if (r.state === "pending") counts.pending = r.n;
    else if (r.state === "parked_max_attempts") counts.parked = r.n;
    else if (r.state === "remote_ahead") counts.remoteAhead = r.n;
  }
  return counts;
}

export interface RemoteAheadEntry {
  noteId: string;
  localRevision: number | null;
  remoteRevision: number | null;
}

// Stage 4d's to-reconcile list.
export async function listRemoteAhead(): Promise<RemoteAheadEntry[]> {
  const db = await getDb();
  const rows = await db.select<
    { note_id: string; local_revision: number | null; remote_revision: number | null }[]
  >(
    `SELECT note_id, local_revision, remote_revision
     FROM sync_push_queue WHERE state = 'remote_ahead' ORDER BY updated_at`
  );
  return rows.map((r) => ({
    noteId: r.note_id,
    localRevision: r.local_revision,
    remoteRevision: r.remote_revision,
  }));
}

// Manual "retry" for parked rows: back to pending, due now, attempts reset.
export async function requeueParked(): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.execute(
    `UPDATE sync_push_queue
     SET state = 'pending', attempts = 0, next_retry_at = $1, updated_at = $2
     WHERE state = 'parked_max_attempts'`,
    [now, now]
  );
  return result.rowsAffected;
}
