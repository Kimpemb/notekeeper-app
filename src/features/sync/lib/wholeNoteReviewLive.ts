// src/features/sync/lib/wholeNoteReviewLive.ts
//
// Stage 4d.3, step 13 (stage 1) — the live half of the whole-note review screen:
// builds the review the user will see, and runs the commit for their choice. The
// view itself is wholeNoteView.ts (pure); the commit is the same commitNoteReview
// every earlier live run used, so it still takes its own backup, lock and
// compare-and-swap. Nothing here writes on its own.
//
// Never import this file from a test: it reaches supabaseClient.

import { getDb } from "@/features/notes/db/client";
import { buildSyncReview } from "@/features/sync/lib/syncReview";
import { commitNoteReview } from "@/features/sync/lib/commitLive";
import { planCommit } from "@/features/sync/lib/commitPlan";
import { buildWholeNoteView, type MetaRowInput, type WholeNoteView } from "@/features/sync/lib/wholeNoteView";
import type { ApplyItem } from "@/features/notes/lib/applyReconcile";
import type { OutcomeLike } from "@/features/sync/lib/outcomeText";

type BuildResult = Awaited<ReturnType<typeof buildSyncReview>>;
export type SyncReviewData = Extract<BuildResult, { ok: true }>["review"];

export type LoadedReview =
  | { ok: true; kind: "whole_note"; review: SyncReviewData; view: WholeNoteView }
  | {
      ok: true;
      kind: "block_merge";
      review: SyncReviewData;
      metaRows: MetaRowInput[];
      parentTitles: ReadonlyMap<string, string>;
    }
  | { ok: false; message: string };

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function reasonText(reason: string): string {
  switch (reason) {
    case "local_missing":
      return "This note is no longer on this device.";
    case "remote_purged":
      return "This note was deleted on another device.";
    default:
      return `The review could not be built (${reason}).`;
  }
}

export async function loadWholeNoteReview(noteId: string): Promise<LoadedReview> {
  try {
    const b = await buildSyncReview(noteId);
    if (!b.ok) return { ok: false, message: reasonText(b.reason) };
    const review = b.review;
    const isWhole = review.mode === "whole_note";

    // Parent names for the metadata rows, from this device only (no network).
    const db = await getDb();
    const parentIds = [review.mine.parentId, review.remote.parentId].filter(
      (p): p is string => typeof p === "string" && p !== ""
    );
    const parentTitles = new Map<string, string>();
    for (const id of new Set(parentIds)) {
      const rows = await db.select<Array<{ title: string }>>(`SELECT title FROM notes WHERE id = $1`, [id]);
      if (rows[0]) parentTitles.set(id, rows[0].title);
    }
    const hostedParent = review.remote.parentId;
    const parentExistsLocally = !hostedParent || parentTitles.has(hostedParent);

    // A block merge cannot be planned with a conflict undecided. This plan only reads the
    // metadata rows, so undecided conflicts get a placeholder choice here. Nothing is written.
    const dryItems: ApplyItem[] =
      review.mode === "block"
        ? review.items.map(
            (i): ApplyItem =>
              i.classification === "conflict" && i.status !== "resolved"
                ? { ...i, status: "resolved", chosenAction: "keep_mine" }
                : i
          )
        : [];

    // A dry plan, only to read the metadata rows. Nothing is written.
    const planned = planCommit({
      review,
      variant: isWhole ? "whole_keep_mine" : review.mode === "identical" ? "identical" : "block_merge",
      items: isWhole ? [] : dryItems,
      metaChoices: {},
      parentExistsLocally,
      storedMatchedGeneratedBefore: false,
      now: Date.now(),
    });
    if (!planned.ok) return { ok: false, message: `This note cannot be reviewed yet (${planned.reason}).` };

    if (!isWhole) {
      return { ok: true, kind: "block_merge", review, metaRows: planned.plan.metaRows, parentTitles };
    }

    const view = buildWholeNoteView({
      mineContent: review.mineContent,
      theirsContent: review.theirsContent,
      mineTitle: review.mine.title,
      metaRows: planned.plan.metaRows,
      parentTitles,
    });
    return { ok: true, kind: "whole_note", review, view };
  } catch (err) {
    return { ok: false, message: msg(err) };
  }
}

/** Runs the user's choice on the review they saw. The commit re-checks that nothing moved. */
export function commitWholeNoteReview(
  noteId: string,
  review: SyncReviewData,
  variant: "whole_keep_mine" | "whole_take_theirs" | "whole_keep_both",
  metaChoices: Record<string, "mine" | "theirs">
): Promise<OutcomeLike> {
  return commitNoteReview({ noteId, variant, review, items: [], metaChoices });
}

/** Runs the user's decisions on a block-mode or identical review. The commit re-checks that nothing moved. */
export function commitBlockMergeReview(
  noteId: string,
  review: SyncReviewData,
  items: ApplyItem[],
  metaChoices: Record<string, "mine" | "theirs">
): Promise<OutcomeLike> {
  const variant = review.mode === "identical" ? "identical" : "block_merge";
  return commitNoteReview({ noteId, variant, review, items: variant === "identical" ? [] : items, metaChoices });
}