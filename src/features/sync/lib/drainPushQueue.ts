// src/features/sync/lib/drainPushQueue.ts
//
// Stage 4c — retries queued pushes. Kept separate from pushQueue.ts so the
// queue (DB only) and pushToHostedSync (network) don't import each other.
//
// Drain triggers: app start (after initDb), sign-in / session restore, the
// window "online" event, and a 60s timer. Each drain is one sequential pass
// over rows whose next_retry_at has passed; it bails out after a few
// consecutive failures (likely offline) rather than grinding through the queue.

import { isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { pushToHostedSync } from "@/features/sync/lib/pushToHostedSync";
import { getDueRetries } from "@/features/sync/lib/pushQueue";

const DRAIN_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface DrainSummary {
  attempted: number;
  pushed: number;
  failed: number;
}

let draining = false;
let started = false;

export async function drainPushQueue(): Promise<DrainSummary> {
  const summary: DrainSummary = { attempted: 0, pushed: 0, failed: 0 };
  if (!isSyncConfigured || draining) return summary;
  if (!useSyncStore.getState().session) return summary;

  draining = true;
  try {
    const due = await getDueRetries(Date.now());
    let consecutiveFailures = 0;
    for (const noteId of due) {
      if (!useSyncStore.getState().session) break; // signed out mid-drain
      const result = await pushToHostedSync(noteId, { isRetry: true });
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

// Idempotent. Call once, after the local DB is initialised (the queue table
// is created by initDb's migrations).
export function startPushQueueDrain(): void {
  if (started || !isSyncConfigured) return;
  started = true;

  const run = () => {
    drainPushQueue().catch((err) => console.warn("[sync] queue drain failed:", err));
  };

  window.addEventListener("online", run);
  window.setInterval(run, DRAIN_INTERVAL_MS);
  // Session restore isn't awaited at boot, so also drain when a session appears.
  useSyncStore.subscribe((state, prev) => {
    if (state.session && !prev.session) run();
  });
  run();
}
