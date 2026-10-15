// src/features/sync/lib/backfillVault.ts
//
// Upload of the local vault to hosted Supabase (re-runnable). Reuses
// pushToHostedSync() per note, so row mapping, ancestor ordering and the
// compare-and-swap rules are the same path autosave uses. Classification uses
// the same pure decideSyncAction() as the push path, against the recorded
// sync state and the hosted revision/updated_at map.

import { getDb } from "@/features/notes/db/client";
import { isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { pushToHostedSync } from "@/features/sync/lib/pushToHostedSync";
import { fetchRemoteNoteMap } from "@/features/sync/lib/remoteNotes";
import { loadAllSyncStates } from "@/features/sync/lib/noteSyncState";
import { decideSyncAction } from "@/features/sync/lib/syncDecision";

interface LocalRow {
  id: string;
  parent_id: string | null;
  revision: number;
  meta_rev: number;
  updated_at: number;
}

export interface BackfillSummary {
  total: number;       // live, non-canvas local notes considered
  uploaded: number;    // pushed (or recorded) this run
  upToDate: number;    // already in sync, nothing to do
  remoteAhead: number; // server has changes this device hasn't merged — left for pull/reconcile
  failed: number;      // pushes that errored (queued for retry by the 4c queue)
  stopped: null | "cancelled" | "too_many_failures";
}

export interface BackfillOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_DEPTH = 50;

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
    `SELECT id, parent_id, revision, meta_rev, updated_at
     FROM notes
     WHERE deleted_at IS NULL AND is_canvas = 0`
  );
  const remote = await fetchRemoteNoteMap(session.user.id);
  const states = await loadAllSyncStates();

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
    const decision = decideSyncAction(
      { revision: row.revision, updatedAt: row.updated_at, metaRev: row.meta_rev },
      states.get(row.id) ?? null,
      remote.get(row.id) ?? null
    );
    switch (decision.action) {
      case "in_sync":
        summary.upToDate++;
        break;
      case "behind":
      case "diverged":
        summary.remoteAhead++;
        break;
      default: // insert | push | adopt
        work.push(row);
    }
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
      // Server moved on after the remote map was fetched — left for pull/reconcile.
      summary.remoteAhead++;
      consecutiveFailures = 0;
    } else if (result === "in_sync") {
      summary.upToDate++;
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
