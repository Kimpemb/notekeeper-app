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
import { commitNoteReview } from "@/features/sync/lib/commitLive";
import { commitNoteDelete, liveDeleteDeps } from "@/features/sync/lib/commitDeleteLive";
import { isNoteOpen } from "@/features/sync/lib/pullFromHostedSync";
import type { ReviewCandidate } from "@/features/sync/lib/reviewCandidates";
import type { BulkOption, BulkOutcomeLike, ReviewMode } from "@/features/sync/lib/reviewList";

export { isNoteOpen };

/** One review build per note (each asks the server). null = could not be determined. */
export async function loadReviewModes(rows: readonly ReviewCandidate[]): Promise<Map<string, ReviewMode | null>> {
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

export function commitOneFor(option: BulkOption): (row: ReviewCandidate) => Promise<BulkOutcomeLike> {
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
