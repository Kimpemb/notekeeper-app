// src/features/sync/lib/reviewPicksLive.ts
//
// Stage 4d.3, step 14 (decision Q5) — saves a block pick the moment the user makes
// it, so closing the review and reopening it keeps the pick. The loading side
// already exists: syncReview.ts reads reconcile_choices through loadChoices and
// only returns a pick whose block hash is unchanged on BOTH sides, so a block
// whose text changed since is asked again. A commit deletes the note's saved
// picks, and pruneReconcileData (called at startup) removes old ones.
//
// Never throws: a failed save must never get in the way of making the pick. The
// worst case is that the pick is not remembered after the dialog closes.
//
// Never import this file from a test: it reaches supabaseClient.

import { getDb } from "@/features/notes/db/client";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { saveChoice } from "@/features/sync/lib/reconcileStore";
import type { ApplyItem } from "@/features/notes/lib/applyReconcile";
import type { ReconcileAction } from "@/features/notes/lib/reconcileSession";

export async function saveBlockPick(noteId: string, item: ApplyItem, action: ReconcileAction): Promise<void> {
  try {
    const session = useSyncStore.getState().session;
    if (!session) return; // signed out: nothing to key the pick on
    await saveChoice(
      await getDb(),
      session.user.id,
      noteId,
      { blockId: item.blockId, mine: item.mine, theirs: item.theirs },
      action
    );
  } catch (err) {
    console.warn("[sync] review: could not save the pick:", noteId, item.blockId, err);
  }
}
