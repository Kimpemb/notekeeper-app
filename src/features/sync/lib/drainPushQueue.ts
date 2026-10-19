// src/features/sync/lib/drainPushQueue.ts
//
// Stage 4c/4d — one sequential pass per drain: (1) retry queued pushes and push
// dirty notes the queue never saw, then (2) pull notes the server has moved on
// (4d.2). Skips the pull phase when the push phase looks offline.
//
// Drain triggers: app start (after initDb), sign-in / session restore, the
// window "online" event, and a 60s timer.

import { isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { pushToHostedSync } from "@/features/sync/lib/pushToHostedSync";
import { getDueRetries } from "@/features/sync/lib/pushQueue";
import { seedSyncStateFromRemote } from "@/features/sync/lib/seedSyncState";
import { findDirtyNoteIds } from "@/features/sync/lib/dirtyScan";
import { pullBehindNotes } from "@/features/sync/lib/pullFromHostedSync";
import { isDownloadInProgress, isVaultGateOpen } from "@/features/sync/lib/vaultGate";

const DRAIN_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export interface DrainSummary {
  attempted: number;
  pushed: number;
  failed: number;
  pulled: number;
}

let draining = false;
let started = false;
let seeded = false;
let gateLogged = false;

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
  const summary: DrainSummary = { attempted: 0, pushed: 0, failed: 0, pulled: 0 };
  if (!isSyncConfigured || draining) return summary;
  if (!useSyncStore.getState().session) return summary;
  if (isDownloadInProgress()) return summary; // 4d.5: the download owns the vault

  draining = true;
  try {
    // 4d.5: a fresh device must not push while hosted already holds a vault.
    if (!(await isVaultGateOpen())) {
      if (!gateLogged) {
        gateLogged = true;
        console.info("[sync] drain paused: hosted already has notes; download the vault or start fresh");
      }
      return summary;
    }
    await ensureSeeded();

    // Phase 1: queued retries, then notes that are dirty but were never queued.
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
    let looksOffline = false;
    for (const { id, isRetry } of work) {
      if (!useSyncStore.getState().session) break; // signed out mid-drain
      const result = await pushToHostedSync(id, { isRetry });
      summary.attempted++;
      if (result === "failed") {
        summary.failed++;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          looksOffline = true;
          break;
        }
      } else {
        summary.pushed++;
        consecutiveFailures = 0;
      }
    }

    // Phase 2: pull-down, unless the pushes just failed repeatedly.
    if (!looksOffline && useSyncStore.getState().session) {
      try {
        const pull = await pullBehindNotes();
        summary.pulled = pull.pulled;
      } catch (err) {
        console.warn("[sync] pull phase failed:", err);
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