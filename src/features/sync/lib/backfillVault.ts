// src/features/sync/lib/backfillVault.ts
//
// One-time (re-runnable) upload of the existing local vault to hosted
// Supabase. Reuses pushToHostedSync() per note, so row mapping, ancestor
// ordering, the remote-ahead guard and snapshot upload are the same path
// autosave already uses. Idempotent: re-running only does work for notes that
// are missing remotely, behind, or have local snapshots to (re)confirm.

import { getDb } from "@/features/notes/db/client";
import { supabase, isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { pushToHostedSync } from "@/features/sync/lib/pushToHostedSync";

interface LocalRow {
  id: string;
  parent_id: string | null;
  revision: number;
  has_snapshots: number; // 0 | 1 from SQLite EXISTS
}

export interface BackfillSummary {
  total: number;       // live, non-canvas local notes considered
  uploaded: number;    // pushed this run
  upToDate: number;    // already on hosted at the same revision, nothing to confirm
  remoteAhead: number; // hosted has a newer revision — left alone (4d reconcile)
  failed: number;      // pushes that errored (queued for retry by the 4c queue)
  stopped: null | "cancelled" | "too_many_failures";
}

export interface BackfillOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const REMOTE_PAGE = 1000;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_DEPTH = 50;

async function fetchRemoteRevisions(ownerId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("notes")
      .select("id, revision")
      .eq("owner_id", ownerId)
      .order("id")
      .range(from, from + REMOTE_PAGE - 1);
    if (error) {
      throw new Error(`remote revision fetch failed (${error.code ?? "?"}): ${error.message}`);
    }
    for (const r of (data ?? []) as Array<{ id: string; revision: number }>) {
      map.set(r.id, r.revision);
    }
    if (!data || data.length < REMOTE_PAGE) break;
    from += REMOTE_PAGE;
  }
  return map;
}

// Shallowest notes first, so parents land before children.
function depthOf(id: string, byId: Map<string, LocalRow>): number {
  let depth = 0;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id) && depth < MAX_DEPTH) {
    seen.add(cur.id);
    cur = byId.get(cur.parent_id);
    depth++;
  }
  return depth;
}

export async function backfillVault(opts: BackfillOptions = {}): Promise<BackfillSummary> {
  if (!isSyncConfigured) throw new Error("Sync isn't configured in this build.");
  const session = useSyncStore.getState().session;
  if (!session) throw new Error("Sign in first.");

  const db = await getDb();
  const local = await db.select<LocalRow[]>(
    `SELECT n.id, n.parent_id, n.revision,
            EXISTS (
              SELECT 1 FROM block_revision_snapshots s
              WHERE s.note_id = n.id AND s.revision = n.revision
            ) AS has_snapshots
     FROM notes n
     WHERE n.deleted_at IS NULL AND n.is_canvas = 0`
  );
  const remote = await fetchRemoteRevisions(session.user.id);

  const summary: BackfillSummary = {
    total: local.length,
    uploaded: 0,
    upToDate: 0,
    remoteAhead: 0,
    failed: 0,
    stopped: null,
  };

  const byId = new Map(local.map((r) => [r.id, r]));
  const work: LocalRow[] = [];
  for (const row of local) {
    const remoteRev = remote.get(row.id);
    if (remoteRev !== undefined && remoteRev > row.revision) summary.remoteAhead++;
    else if (remoteRev !== undefined && remoteRev === row.revision && !row.has_snapshots) summary.upToDate++;
    else work.push(row);
  }
  work.sort((a, b) => depthOf(a.id, byId) - depthOf(b.id, byId));

  let done = 0;
  let consecutiveFailures = 0;
  for (const row of work) {
    if (opts.signal?.aborted) {
      summary.stopped = "cancelled";
      break;
    }

    const result = await pushToHostedSync(row.id);

    if (result === "failed") {
      summary.failed++;
      consecutiveFailures++;
    } else if (result === "remote_ahead") {
      // Server moved on after we fetched the remote map — left for 4d.
      summary.remoteAhead++;
      consecutiveFailures = 0;
    } else {
      summary.uploaded++;
      consecutiveFailures = 0;
    }

    done++;
    opts.onProgress?.(done, work.length);

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      summary.stopped = "too_many_failures";
      break;
    }
  }

  return summary;
}