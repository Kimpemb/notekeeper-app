// src/features/sync/lib/deleteReviewLive.ts
//
// Stage 4d.3, step 13 (stage 2) — the live half of the delete-review screens: reads
// what each screen needs and runs the user's choice through commitNoteDelete (the same
// engine every earlier live run used, so each choice still takes its own backup,
// lock and compare-and-swap). Nothing here writes on its own.
//
// Never import this file from a test: it reaches supabaseClient.

import { commitNoteDelete, liveDeleteDeps } from "@/features/sync/lib/commitDeleteLive";
import type { LocalStamp } from "@/features/sync/lib/commitDelete";
import {
  buildD1View,
  buildD2View,
  type DeleteReviewChoiceId,
  type DeleteReviewView,
} from "@/features/sync/lib/deleteReviewView";
import type { OutcomeLike } from "@/features/sync/lib/outcomeText";
import { classifyError } from "@/features/sync/lib/classifyError";
import { checkReachable } from "@/features/sync/lib/reachabilityLive";
import { OFFLINE_TEXT } from "@/features/sync/lib/reachability";

export type LoadedDeleteReview =
  | { ok: true; case: "d1"; view: DeleteReviewView; hostedRevision: number }
  | { ok: true; case: "d2"; view: DeleteReviewView; hostedRevision: number; localStamp: LocalStamp }
  | { ok: false; message: string; details?: string; retryable?: boolean };

 

export async function loadDeleteReview(
  noteId: string,
  kind: "deleted_here" | "purged_elsewhere"
): Promise<LoadedDeleteReview> {
  try {
    const probe = await checkReachable();
    if (probe.state === "offline") {
      return { ok: false, message: OFFLINE_TEXT, details: `reachability check: ${probe.reason}`, retryable: true };
    }
    const deps = liveDeleteDeps();

    if (kind === "deleted_here") {
      const r = await deps.readD1(noteId);
      if (!r.ok) return { ok: false, message: `This review could not be loaded (${r.reason}).` };
      const { hosted, tombstone, localPresent } = r.input;
      if (localPresent) return { ok: false, message: "This note exists on this device again, so there is nothing to review." };
      if (tombstone.state !== "conflict") return { ok: false, message: "This deletion is not waiting for a decision." };
      if (hosted.kind === "missing") return { ok: false, message: "This note is no longer on the server. The next sync finishes the deletion." };
      if (hosted.kind === "purged") return { ok: false, message: "This note was already deleted on the server. The next sync finishes the deletion." };
      if (hosted.revision <= tombstone.serverRevision) {
        return { ok: false, message: "The other device has not changed this note since you deleted it. The next sync finishes the deletion." };
      }
      return {
        ok: true,
        case: "d1",
        hostedRevision: hosted.revision,
        view: buildD1View({ title: hosted.title, hostedContent: hosted.content, hostedInTrash: hosted.deleted_at !== null }),
      };
    }

    const r = await deps.readD2(noteId);
    if (!r.ok) return { ok: false, message: `This review could not be loaded (${r.reason}).` };
    const { hosted, local } = r.input;
    if (hosted.kind === "missing") return { ok: false, message: "This note is no longer on the server." };
    if (hosted.kind === "row") return { ok: false, message: "This note is on the server again, so there is nothing to review. The next sync handles it." };
    return {
      ok: true,
      case: "d2",
      hostedRevision: hosted.revision,
      localStamp: { revision: local.revision, metaRev: local.meta_rev, updatedAt: local.updated_at },
      view: buildD2View({ title: local.title, localContent: local.content }),
    };
  } catch (err) {
    const f = classifyError(err, "load");
    return { ok: false, message: f.text, details: f.details, retryable: f.retryable };
  }
}

/** Runs the user's choice on the review they saw. The commit re-checks that nothing moved. */
export async function commitDeleteChoice(
  noteId: string,
  loaded: Extract<LoadedDeleteReview, { ok: true }>,
  choice: DeleteReviewChoiceId
): Promise<OutcomeLike> {
  if (loaded.case === "d1" && (choice === "keep_it" || choice === "delete_anyway")) {
    return commitNoteDelete({ case: "d1", noteId, choice, reviewedHostedRevision: loaded.hostedRevision });
  }
  if (loaded.case === "d2" && (choice === "keep_mine" || choice === "let_go")) {
    return commitNoteDelete({
      case: "d2",
      noteId,
      choice,
      reviewedHostedRevision: loaded.hostedRevision,
      reviewedLocalStamp: loaded.localStamp,
    });
  }
  return { status: "refused", reason: "plan_failed" };
}
