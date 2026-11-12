// src/features/sync/lib/reviewCandidatesLive.ts
//
// Stage 4d.3, step 11 — the live half of the "N need review" list: reads the
// local queue and tombstones, asks the server about those notes in batches, and
// hands everything to the pure classifier (reviewCandidates.ts).
//
// Never throws. When the server cannot be asked (signed out, offline, a failed
// query), hostedChecked is false and the classifier labels the rows 'unchecked'.
//
// Never import this file from a test: it reaches supabaseClient.

import { getDb } from "@/features/notes/db/client";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { checkReachable } from "@/features/sync/lib/reachabilityLive";
import {
  classifyCandidates,
  type HostedStatus,
  type QueueRowInput,
  type ReviewCandidate,
  type TombstoneInput,
} from "@/features/sync/lib/reviewCandidates";

const CHUNK = 100;

export interface ReviewCandidateList {
  candidates: ReviewCandidate[];
  /** false when the server could not be asked; rows then appear as 'unchecked'. */
  hostedChecked: boolean;
}

async function fetchHostedStatuses(ids: string[]): Promise<Map<string, HostedStatus> | null> {
  const out = new Map<string, HostedStatus>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("notes").select("id, revision, purged_at, title").in("id", slice);
    if (error) {
      console.warn("[sync] review list: hosted lookup failed:", error.message);
      return null;
    }
    for (const r of (data ?? []) as Array<{ id: string; revision: number; purged_at: string | null; title: string }>) {
      out.set(r.id, { revision: r.revision, purged: r.purged_at != null, title: r.title });
    }
  }
  return out;
}

export async function listReviewCandidates(): Promise<ReviewCandidateList> {
  const db = await getDb();

  const queueRows = await db.select<
    Array<{
      note_id: string;
      state: QueueRowInput["state"];
      reason: string | null;
      local_revision: number | null;
      remote_revision: number | null;
      updated_at: number;
      title: string | null;
    }>
  >(
    `SELECT q.note_id, q.state, q.reason, q.local_revision, q.remote_revision, q.updated_at, n.title
     FROM sync_push_queue q LEFT JOIN notes n ON n.id = q.note_id
     WHERE q.state = 'remote_ahead'`
  );
  const tombRows = await db.select<
    Array<{ note_id: string; state: TombstoneInput["state"]; synced_server_revision: number; deleted_at: number }>
  >(`SELECT note_id, state, synced_server_revision, deleted_at FROM note_tombstones WHERE state = 'conflict'`);

  const queue: QueueRowInput[] = queueRows.map((r) => ({
    noteId: r.note_id,
    state: r.state,
    reason: r.reason,
    localRevision: r.local_revision,
    remoteRevision: r.remote_revision,
    updatedAt: r.updated_at,
    localTitle: r.title,
  }));
  const tombstones: TombstoneInput[] = tombRows.map((r) => ({
    noteId: r.note_id,
    state: r.state,
    syncedServerRevision: r.synced_server_revision,
    deletedAt: r.deleted_at,
  }));

  const ids = [...new Set([...queue.map((q) => q.noteId), ...tombstones.map((t) => t.noteId)])];
  if (ids.length === 0) return { candidates: [], hostedChecked: true };

  let hosted: Map<string, HostedStatus> | null = null;
  if (useSyncStore.getState().session) {
    try {
      const probe = await checkReachable();
      if (probe.state === "online") {
        hosted = await fetchHostedStatuses(ids);
      } else {
        console.warn(`[sync] review list: server not reachable (${probe.reason}); rows shown unchecked`);
      }
    } catch (err) {
      console.warn("[sync] review list: hosted lookup threw:", err);
    }
  }

  const hostedChecked = hosted !== null;
  return {
    candidates: classifyCandidates({ queue, tombstones, hosted: hosted ?? new Map(), hostedChecked }),
    hostedChecked,
  };
}

/** The number the Sync panel shows. */
export async function countNeedReview(): Promise<number> {
  return (await listReviewCandidates()).candidates.length;
}
