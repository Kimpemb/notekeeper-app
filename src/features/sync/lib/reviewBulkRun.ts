// src/features/sync/lib/reviewBulkRun.ts
//
// Stage 4d.3, step 12 — the PURE sequencer for a bulk run. It commits the rows one
// at a time through an injected commitOne(), so the stop rules, cancel, progress and
// "a throw never kills the run" are unit-tested without a database or a network.
// (reviewList.ts decides WHICH rows run and when to stop; this file runs them.)
//
// Rules:
//   * strictly one note at a time (every commit writes its own backup and takes its own lock)
//   * commitOne never needs to be trusted not to throw: a throw becomes a failed outcome
//   * the run stops for a lost session or two network errors in a row (nextBulkStep),
//     and between notes when cancelled; the note in flight is always allowed to finish

import { nextBulkStep, type BulkOutcomeLike } from "@/features/sync/lib/reviewList";
import type { ReviewCandidate } from "@/features/sync/lib/reviewCandidates";

export interface BulkRunOptions {
  onProgress?: (done: number, total: number) => void;
  /** Checked before each note; the commit in flight is never interrupted. */
  isCancelled?: () => boolean;
}

export type BulkStopReason = "signed_out" | "network" | "cancelled" | null;

export interface BulkRunResult {
  outcomes: Array<{ noteId: string; outcome: BulkOutcomeLike }>;
  stoppedBy: BulkStopReason;
}

export async function runBulk(
  rows: readonly ReviewCandidate[],
  commitOne: (row: ReviewCandidate) => Promise<BulkOutcomeLike>,
  options: BulkRunOptions = {}
): Promise<BulkRunResult> {
  const outcomes: BulkRunResult["outcomes"] = [];
  let stoppedBy: BulkStopReason = null;

  for (const row of rows) {
    if (options.isCancelled?.()) {
      stoppedBy = "cancelled";
      break;
    }

    let outcome: BulkOutcomeLike;
    try {
      outcome = await commitOne(row);
    } catch (err) {
      outcome = { status: "local_failed", reason: err instanceof Error ? err.message : String(err) };
    }
    outcomes.push({ noteId: row.noteId, outcome });
    options.onProgress?.(outcomes.length, rows.length);

    const step = nextBulkStep(outcomes.map((o) => o.outcome));
    if (step === "stop_signed_out") {
      stoppedBy = "signed_out";
      break;
    }
    if (step === "stop_network") {
      stoppedBy = "network";
      break;
    }
  }

  return { outcomes, stoppedBy };
}
