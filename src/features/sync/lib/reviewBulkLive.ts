// src/features/sync/lib/reviewBulkLive.ts
//
// Stage 4d.3, step 12 — the live half of bulk actions: finds each content
// conflict's review mode, and builds the commitOne() that reviewBulkRun.ts runs.
// Everything it commits goes through the same commit engines the per-note paths
// use (commitNoteReview, commitNoteDelete), so every note still gets its own
// backup, compare-and-swap and lock. Nothing here writes on its own.
//
// Never import this file from a test: it reaches supabaseClient.

import { buildSyncReview } from "@/features/sync/lib/syncReview";
import { checkReachable } from "@/features/sync/lib/reachabilityLive";
import { commitNoteReview } from "@/features/sync/lib/commitLive";
import { commitNoteDelete, liveDeleteDeps } from "@/features/sync/lib/commitDeleteLive";
import { isNoteOpen } from "@/features/sync/lib/pullFromHostedSync";
import { getDb } from "@/features/notes/db/client";
import { countMedia } from "@/features/sync/lib/wholeNoteView";
import type { ReviewCandidate } from "@/features/sync/lib/reviewCandidates";
import type { BulkOption, BulkOutcomeLike, ReviewMode } from "@/features/sync/lib/reviewList";

export { isNoteOpen };

/** One review build per note (each asks the server). null = could not be determined. */
export async function loadReviewModes(rows: readonly ReviewCandidate[]): Promise<Map<string, ReviewMode | null>> {
  // One quick check first: offline, each build below would hang for several seconds.
  const probe = await checkReachable();
  if (probe.state === "offline") throw new Error(`No internet connection (reachability check: ${probe.reason})`);
  const modes = new Map<string, ReviewMode | null>();
  for (const r of rows) {
    try {
      const b = await buildSyncReview(r.noteId);
      modes.set(r.noteId, b.ok ? b.review.mode : null);
    } catch {
      modes.set(r.noteId, null);
    }
  }
  return modes;
}

/** Notes whose own (local) content has images or attachments. A local read only. */
export async function loadMediaIds(rows: readonly ReviewCandidate[]): Promise<Set<string>> {
  const db = await getDb();
  const ids = new Set<string>();
  for (const r of rows) {
    const found = await db.select<Array<{ content: string }>>(`SELECT content FROM notes WHERE id = $1`, [r.noteId]);
    if (found[0] && countMedia(found[0].content).total > 0) ids.add(r.noteId);
  }
  return ids;
}

/** Every note's commit is preceded by a reachability check, so an offline run stops after
 *  two quick network_error outcomes instead of waiting on a hanging request per note. */
export function commitOneFor(option: BulkOption): (row: ReviewCandidate) => Promise<BulkOutcomeLike> {
  const inner = commitOneInner(option);
  return async (row) => {
    if ((await checkReachable()).state === "offline") return { status: "network_error" };
    const outcome = await inner(row);
    // A refused read right after a cached "online" answer usually means the connection
    // just dropped. Nothing was written, so a fresh probe can safely say so.
    if (
      outcome.status === "refused" &&
      outcome.reason === "read_failed" &&
      (await checkReachable({ force: true })).state === "offline"
    ) {
      return { status: "network_error" };
    }
    return outcome;
  };
}

function commitOneInner(option: BulkOption): (row: ReviewCandidate) => Promise<BulkOutcomeLike> {
  switch (option.id) {
    case "d1_keep_it":
      return async (row) => {
        if (row.hostedRevision === null) return { status: "refused", reason: "plan_failed" };
        return commitNoteDelete({
          case: "d1",
          noteId: row.noteId,
          choice: "keep_it",
          reviewedHostedRevision: row.hostedRevision,
        });
      };

    case "d2_keep_mine":
      return async (row) => {
        if (row.hostedRevision === null) return { status: "refused", reason: "plan_failed" };
        // The note is closed (the run skips open ones), so its local stamp cannot move
        // between this read and the commit's own fresh compare.
        const read = await liveDeleteDeps().readD2(row.noteId);
        if (!read.ok) return { status: "refused", reason: "read_failed" };
        const l = read.input.local;
        return commitNoteDelete({
          case: "d2",
          noteId: row.noteId,
          choice: "keep_mine",
          reviewedHostedRevision: row.hostedRevision,
          reviewedLocalStamp: { revision: l.revision, metaRev: l.meta_rev, updatedAt: l.updated_at },
        });
      };

    case "whole_keep_mine":
    case "whole_take_theirs": {
      const variant = option.id;
      return async (row) => {
        const b = await buildSyncReview(row.noteId);
        if (!b.ok) return { status: "refused", reason: b.reason };
        // The mode was checked when the run was planned; it can change before this note's turn.
        if (b.review.mode !== "whole_note") return { status: "refused", reason: "needs_item_review" };
        // metaChoices left empty: metadata follows the commit's own defaults (keep mine per
        // field, or take theirs when this device's metadata has not changed since the last sync).
        return commitNoteReview({ noteId: row.noteId, variant, review: b.review, items: [], metaChoices: {} });
      };
    }
  }
}
