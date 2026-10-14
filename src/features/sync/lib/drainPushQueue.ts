// src/features/sync/lib/drainPushQueue.ts
//
// Stage 4c — retries queued pushes, plus (4d) a dirty scan so edits made while
// offline/signed out are never lost just because they never reached the queue.
//
// Drain triggers: app start (after initDb), sign-in / session restore, the
// window "online" event, and a 60s timer. Each drain is one sequential pass;
// it bails out after a few consecutive failures (likely offline).

import { isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { pushToHostedSync } from "@/features/sync/lib/pushToHostedSync";
import { getDueRetries } from "@/features/sync/lib/pushQueue";
import { seedSyncStateFromRemote } from "@/features/sync/lib/seedSyncState";
import { findDirtyNoteIds } from "@/features/sync/lib/dirtyScan";

const DRAIN_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface DrainSummary {
  attempted: number;
  pushed: number;
  failed: number;
}

let draining = false;
let started = false;
let seeded = false;

async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  try {
    const r = await seedSyncStateFromRemote();
    seeded = true;
    if (r.seeded > 0) console.info(`[sync] seeded sync state for ${r.seeded}/${r.checked} notes`);
  } catch (err) {
    console.warn("[sync] sync-state seeding failed, will retry:", err);
  }
}

export async function drainPushQueue(): Promise<DrainSummary> {
  const summary: DrainSummary = { attempted: 0, pushed: 0, failed: 0 };
  if (!isSyncConfigured || draining) return summary;
  if (!useSyncStore.getState().session) return summary;

  draining = true;
  try {
    await ensureSeeded();

    // Queued retries first, then notes that are dirty but were never queued.
    const due = await getDueRetries(Date.now());
    const dirty = await findDirtyNoteIds();
    const work: Array<{ id: string; isRetry: boolean }> = [
      ...due.map((id) => ({ id, isRetry: true })),
      ...dirty.map((id) => ({ id, isRetry: false })),
    ];
    if (work.length > 0) {
      console.info(`[sync] drain: ${due.length} queued, ${dirty.length} dirty`);
    }

    let consecutiveFailures = 0;
    for (const { id, isRetry } of work) {
      if (!useSyncStore.getState().session) break; // signed out mid-drain
      const result = await pushToHostedSync(id, { isRetry });
      summary.attempted++;
      if (result === "failed") {
        summary.failed++;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
      } else {
        summary.pushed++;
        consecutiveFailures = 0;
      }
    }
  } finally {
    draining = false;
  }
  return summary;
}

// Idempotent. Call once, after the local DB is initialised.
export function startPushQueueDrain(): void {
  if (started || !isSyncConfigured) return;
  started = true;

  const run = () => {
    drainPushQueue().catch((err) => console.warn("[sync] queue drain failed:", err));
  };

  window.addEventListener("online", run);
  window.setInterval(run, DRAIN_INTERVAL_MS);
  useSyncStore.subscribe((state, prev) => {
    if (state.session && !prev.session) run();
  });
  run();
}