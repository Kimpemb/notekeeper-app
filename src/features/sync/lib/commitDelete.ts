// src/features/sync/lib/commitDelete.ts
//
// Stage 4d.3, step 10 — the commit sequence for the two delete reviews (D1, D2).
// Same pattern as commitReview.ts: the outside world is injected, so every
// failure row is unit-tested. NO import of supabaseClient, the DB or any store.
// The live collaborators are built in commitDeleteLive.ts (next step).
//
// Sequences (the plan comes from deleteReviewPlan.ts):
//   D1 keep it       signed in -> lock -> read fresh -> stale check -> plan ->
//                    insert locally (verified) -> record sync state -> clear tombstone
//   D1 delete anyway signed in -> lock -> read fresh -> stale check -> plan ->
//                    backup -> purge_note (compare-and-swap) -> clear tombstone
//   D2 keep mine     signed in -> note not open -> lock -> read fresh -> stale check ->
//                    plan -> backup -> ensure ancestors -> un-purge (compare-and-swap
//                    on the PURGED row) -> record sync state
//   D2 let go        same preconditions -> plan -> backup -> delete locally (compare-and-swap
//                    on the local stamp); the tombstone trigger records it
//
// Rules this file keeps:
//   * Nothing destructive happens before the backup is written.
//   * A lost network answer after a hosted write is reported as "maybeApplied", never as a failure.
//   * Clearing a tombstone is best-effort: a leftover one heals itself on the next drain.

import type { BackupInput } from "@/features/sync/lib/reconcileStore";
import {
  planD1,
  planD2,
  type D1Choice,
  type D1Input,
  type D1Insert,
  type D1Plan,
  type D2Choice,
  type D2Hosted,
  type D2Input,
  type D2Plan,
  type D2ServerFields,
} from "@/features/sync/lib/deleteReviewPlan";

export interface LocalStamp {
  revision: number;
  metaRev: number;
  updatedAt: number;
}

export type DeleteRequest =
  | { case: "d1"; noteId: string; choice: D1Choice; reviewedHostedRevision: number }
  | {
      case: "d2";
      noteId: string;
      choice: D2Choice;
      reviewedHostedRevision: number; // the purged row's revision the user saw
      reviewedLocalStamp: LocalStamp;
    };

export type DeleteOutcome =
  | { status: "committed"; case: "d1" | "d2"; choice: D1Choice | D2Choice; notes: string[] }
  | { status: "committed_unrecorded"; case: "d1" | "d2"; choice: D1Choice | D2Choice; detail: string }
  | { status: "stale"; reason: "hosted_moved" | "local_changed" }
  | {
      status: "refused";
      reason: "signed_out" | "note_open" | "busy" | "read_failed" | "plan_failed" | "backup_failed" | "ancestors_failed";
      detail: string[];
    }
  | { status: "network_error"; maybeApplied: boolean }
  | { status: "local_failed"; detail: string };

export type HostedWriteResult = "won" | "zero_rows";

export interface DeleteDeps {
  signedIn(): boolean;
  noteIsOpen(noteId: string): boolean;
  /** Returns a release function, or null when the note is busy. */
  lock(noteId: string): (() => void) | null;

  readD1(noteId: string): Promise<{ ok: true; input: Omit<D1Input, "choice"> } | { ok: false; reason: string }>;
  readD2(noteId: string): Promise<{ ok: true; input: Omit<D2Input, "choice" | "now"> } | { ok: false; reason: string }>;

  writeBackup(input: BackupInput): Promise<void>;

  /** D1 keep it: insert the note (INSERT OR IGNORE) and read it back. Throws on any failure. */
  insertLocal(insert: D1Insert): Promise<void>;
  /** Undo insertLocal. Only used before any sync state exists. Best-effort. */
  removeInserted(noteId: string): Promise<void>;
  /** Must throw ONLY if the sync state could not be recorded. */
  recordD1(noteId: string, plan: D1Plan): Promise<void>;
  /** Best-effort: a leftover tombstone heals on the next drain. */
  clearTombstone(noteId: string): Promise<void>;

  /** D1 delete anyway: purge_note compare-and-swap. "zero_rows" = the revision moved. Throws on a network or server error. */
  purgeHosted(noteId: string, expectedRevision: number): Promise<HostedWriteResult>;

  /** D2 keep mine: make sure the parent chain exists hosted. Throws on failure. */
  ensureAncestors(noteId: string, parentId: string): Promise<void>;
  /** Un-purge: update where revision = expected AND purged_at IS NOT NULL. Throws on a network or server error. */
  unpurgeHosted(noteId: string, fields: D2ServerFields, expectedPurgedRevision: number): Promise<HostedWriteResult>;
  /** Used to classify a lost network answer. */
  fetchHostedState(noteId: string): Promise<D2Hosted>;
  /** Must throw ONLY if the sync state could not be recorded (finishPush at serverRevisionAfter). */
  recordD2KeepMine(noteId: string, plan: D2Plan): Promise<void>;

  /** D2 let go: delete locally with a compare-and-swap on the stamp. */
  deleteLocal(noteId: string, expectedStamp: LocalStamp): Promise<"deleted" | "raced">;

  now(): number;
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function quietly(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // best-effort
  }
}

export async function commitDelete(deps: DeleteDeps, req: DeleteRequest): Promise<DeleteOutcome> {
  if (!deps.signedIn()) return { status: "refused", reason: "signed_out", detail: [] };
  if (req.case === "d2" && deps.noteIsOpen(req.noteId)) return { status: "refused", reason: "note_open", detail: [] };

  const release = deps.lock(req.noteId);
  if (!release) return { status: "refused", reason: "busy", detail: [] };
  try {
    return req.case === "d1" ? await runD1(deps, req) : await runD2(deps, req);
  } finally {
    release();
  }
}

// ─── D1 ───────────────────────────────────────────────────────────────────

async function runD1(deps: DeleteDeps, req: Extract<DeleteRequest, { case: "d1" }>): Promise<DeleteOutcome> {
  const read = await deps.readD1(req.noteId);
  if (!read.ok) return { status: "refused", reason: "read_failed", detail: [read.reason] };

  const hosted = read.input.hosted;
  if (hosted.kind === "row" && hosted.revision !== req.reviewedHostedRevision) {
    return { status: "stale", reason: "hosted_moved" };
  }

  const planned = planD1(req.noteId, { ...read.input, choice: req.choice });
  if (!planned.ok) return { status: "refused", reason: "plan_failed", detail: [planned.reason, ...planned.detail] };
  const plan = planned.plan;

  if (plan.choice === "keep_it") {
    if (!plan.insert) return { status: "refused", reason: "plan_failed", detail: ["keep_it plan has no insert"] };
    try {
      await deps.insertLocal(plan.insert);
    } catch (err) {
      await quietly(() => deps.removeInserted(req.noteId));
      return { status: "local_failed", detail: msg(err) };
    }
    try {
      await deps.recordD1(req.noteId, plan);
    } catch (err) {
      return { status: "committed_unrecorded", case: "d1", choice: plan.choice, detail: msg(err) };
    }
    await quietly(() => deps.clearTombstone(req.noteId));
    return { status: "committed", case: "d1", choice: plan.choice, notes: plan.notes };
  }

  // delete_anyway
  if (!plan.backup || plan.purgeExpectedRevision === null) {
    return { status: "refused", reason: "plan_failed", detail: ["delete_anyway plan is incomplete"] };
  }
  try {
    await deps.writeBackup(plan.backup);
  } catch (err) {
    return { status: "refused", reason: "backup_failed", detail: [msg(err)] };
  }
  let result: HostedWriteResult;
  try {
    result = await deps.purgeHosted(req.noteId, plan.purgeExpectedRevision);
  } catch {
    // The purge may have gone through. If it did, the tombstone is cleared by the
    // next drain (hosted purged); if not, the review is still parked. Either is safe.
    return { status: "network_error", maybeApplied: true };
  }
  if (result === "zero_rows") return { status: "stale", reason: "hosted_moved" };
  await quietly(() => deps.clearTombstone(req.noteId));
  return { status: "committed", case: "d1", choice: plan.choice, notes: plan.notes };
}

// ─── D2 ───────────────────────────────────────────────────────────────────

async function runD2(deps: DeleteDeps, req: Extract<DeleteRequest, { case: "d2" }>): Promise<DeleteOutcome> {
  const read = await deps.readD2(req.noteId);
  if (!read.ok) return { status: "refused", reason: "read_failed", detail: [read.reason] };

  const { hosted, local } = read.input;
  if (hosted.kind !== "missing" && hosted.revision !== req.reviewedHostedRevision) {
    return { status: "stale", reason: "hosted_moved" };
  }
  const s = req.reviewedLocalStamp;
  if (local.revision !== s.revision || local.meta_rev !== s.metaRev || local.updated_at !== s.updatedAt) {
    return { status: "stale", reason: "local_changed" };
  }

  const planned = planD2(req.noteId, { ...read.input, choice: req.choice, now: deps.now() });
  if (!planned.ok) return { status: "refused", reason: "plan_failed", detail: [planned.reason, ...planned.detail] };
  const plan = planned.plan;

  // Mine is the only copy left once hosted is purged: the backup comes first, always.
  try {
    await deps.writeBackup(plan.backup);
  } catch (err) {
    return { status: "refused", reason: "backup_failed", detail: [msg(err)] };
  }

  if (plan.choice === "let_go") {
    let r: "deleted" | "raced";
    try {
      r = await deps.deleteLocal(req.noteId, plan.expectedLocalStamp);
    } catch (err) {
      return { status: "local_failed", detail: msg(err) };
    }
    if (r === "raced") return { status: "stale", reason: "local_changed" };
    return { status: "committed", case: "d2", choice: plan.choice, notes: plan.notes };
  }

  // keep_mine
  if (!plan.serverFields || plan.serverRevisionAfter === null) {
    return { status: "refused", reason: "plan_failed", detail: ["keep_mine plan is incomplete"] };
  }
  if (plan.ensureAncestorsOf !== null) {
    try {
      await deps.ensureAncestors(req.noteId, plan.ensureAncestorsOf);
    } catch (err) {
      return { status: "refused", reason: "ancestors_failed", detail: [msg(err)] };
    }
  }

  let won = false;
  try {
    won = (await deps.unpurgeHosted(req.noteId, plan.serverFields, plan.expectedPurgedRevision)) === "won";
    if (!won) return { status: "stale", reason: "hosted_moved" };
  } catch {
    // The answer was lost. Look at the hosted row to find out what happened.
    try {
      const h = await deps.fetchHostedState(req.noteId);
      if (h.kind === "row" && h.revision === plan.serverRevisionAfter) {
        won = true; // it did apply
      } else if (h.kind === "purged" && h.revision === plan.expectedPurgedRevision) {
        return { status: "network_error", maybeApplied: false }; // it did not
      } else {
        return { status: "stale", reason: "hosted_moved" }; // someone else moved it
      }
    } catch {
      return { status: "network_error", maybeApplied: true };
    }
  }

  try {
    await deps.recordD2KeepMine(req.noteId, plan);
  } catch (err) {
    return { status: "committed_unrecorded", case: "d2", choice: plan.choice, detail: msg(err) };
  }
  return { status: "committed", case: "d2", choice: plan.choice, notes: plan.notes };
}
