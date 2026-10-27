// src/features/sync/lib/commitReview.ts
//
// Stage 4d.3, batch 3b — the commit step (design rev 3, section 3). The world
// outside (lock, backup, hosted push, local write, recording sync state) is
// passed in as `deps`, so each failure row can be provoked in a unit test and
// this file imports nothing that reaches supabaseClient. The live wiring is
// commitLive.ts (not written yet).
//
// Order of effects, and why:
//   1. refuse if the note is open in a tab; take the note lock
//   2. rebuild the review fresh and compare it with the one the user decided on
//      (hosted revision and local stamp must be unchanged) — otherwise write nothing
//   3. planCommit (pure) — refuse on an unresolved item or a failed completeness check
//   4. backup, BEFORE any write; if the backup fails, nothing is written
//   5. server first, compare-and-swap on the hosted revision the review was built on
//   6. local write, compare-and-swap on the local stamp, verified by reading back
//   7. record the agreement (sync state, snapshots, queue, store, re-index, choices)
//
// A push whose result we cannot know (an error, or zero rows updated) is
// resolved by LOOKING at the hosted row, never by guessing:
//   - already holds exactly the planned write at expected+1  -> it won; carry on
//   - purged / missing / moved on                            -> push_lost
//   - unchanged after an error                               -> the request never arrived
// The lock is released on every path.

import type {
  CommitPlan,
  CommitReviewInput,
  CommitVariant,
  ConflictCopyPlan,
  LocalFields,
  MetaField,
  ServerFields,
} from "@/features/sync/lib/commitPlan";
import { planCommit } from "@/features/sync/lib/commitPlan";
import type { ApplyItem } from "@/features/notes/lib/applyReconcile";
import type { BackupInput } from "@/features/sync/lib/reconcileStore";

// ─── Types ────────────────────────────────────────────────────────────────

export interface Stamp {
  revision: number;
  metaRev: number;
  updatedAt: number;
}

export interface PlanContext {
  /** true when the hosted parent is null or exists on this device. */
  parentExistsLocally: boolean;
  storedMatchedGeneratedBefore: boolean;
  generatePlaintext?: (content: string) => string | null;
}

export type HostedSnapshot =
  | {
      kind: "row";
      revision: number;
      title: string;
      content: string;
      plaintext: string;
      tags: string | null;
      parent_id: string | null;
      sort_order: number | null;
      frontmatter: string | null;
      deleted_at: string | null;
    }
  | { kind: "purged" }
  | { kind: "missing" };

export type HostedRow = Extract<HostedSnapshot, { kind: "row" }>;

export type PushOutcome = { kind: "won" } | { kind: "zero_rows" };
export type LocalWriteResult = { kind: "ok" } | { kind: "raced" } | { kind: "unverified" };

export interface RecordArgs {
  noteId: string;
  plan: CommitPlan;
  newServerRevision: number;
}

export interface CommitDeps {
  noteIsOpen(noteId: string): boolean;
  /** Returns a release function, or null when the note is busy. */
  lock(noteId: string): (() => void) | null;
  rebuild(noteId: string): Promise<{ ok: true; review: CommitReviewInput } | { ok: false; reason: string }>;
  planContext(review: CommitReviewInput): Promise<PlanContext>;
  writeBackup(input: BackupInput): Promise<void>;
  /** Compare-and-swap on the hosted revision. Throws on a network or server error. */
  pushMerged(noteId: string, fields: ServerFields, expectedRevision: number): Promise<PushOutcome>;
  fetchHosted(noteId: string): Promise<HostedSnapshot>;
  /** Compare-and-swap on the local stamp, then read back and verify. */
  writeLocal(noteId: string, fields: LocalFields, expectedStamp: Stamp, expectedAfter: Stamp): Promise<LocalWriteResult>;
  /** Must throw ONLY if the sync state could not be recorded; best-effort steps swallow their own errors. */
  record(args: RecordArgs): Promise<void>;
  now(): number;
  /** Fresh ids for a conflict copy (whole_keep_both). */
  newId?(): string;
  /** whole_keep_both: insert theirs' version as a new local note with no sync state. Throws on failure. */
  createCopy?(copy: ConflictCopyPlan): Promise<void>;
  /** Undo createCopy when the server was not written. Best-effort. */
  removeCopy?(copy: ConflictCopyPlan): Promise<void>;
}

export interface CommitRequest {
  noteId: string;
  variant: CommitVariant;
  /** The review the user decided on. */
  review: CommitReviewInput;
  items: ApplyItem[];
  metaChoices: Partial<Record<MetaField, "mine" | "theirs">>;
}

export type CommitOutcome =
  | {
      status: "committed";
      variant: CommitVariant;
      newServerRevision: number;
      serverWritten: boolean;
      localWritten: boolean;
      notes: string[];
      copyNoteId?: string;
    }
  | { status: "stale"; reason: "hosted_moved" | "local_changed" }
  | {
      status: "refused";
      reason: "note_open" | "busy" | "rebuild_failed" | "plan_failed" | "backup_failed" | "copy_failed";
      detail: string[];
    }
  | { status: "push_lost"; hosted: "moved" | "purged" | "missing" | "unchanged" }
  | { status: "network_error"; maybeApplied: boolean }
  | { status: "local_failed"; detail: string }
  | { status: "server_won_local_failed"; newServerRevision: number; detail: string }
  | { status: "committed_unrecorded"; newServerRevision: number };

// ─── Helpers ──────────────────────────────────────────────────────────────

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function removeCopyQuietly(deps: CommitDeps, copy: ConflictCopyPlan): Promise<void> {
  if (!deps.removeCopy) return;
  try {
    await deps.removeCopy(copy);
  } catch {
    // best-effort: a stray copy is harmless, a failed cleanup must not mask the real outcome
  }
}

const sameStamp = (a: Stamp, b: Stamp): boolean =>
  a.revision === b.revision && a.metaRev === b.metaRev && a.updatedAt === b.updatedAt;

const sameNull = <T,>(a: T | null | undefined, b: T | null | undefined): boolean => (a ?? null) === (b ?? null);

/** Does the hosted row already hold exactly what this plan would have written? */
export function hostedMatchesPlan(h: HostedRow, f: ServerFields): boolean {
  if (f.title !== undefined && h.title !== f.title) return false;
  if (f.content !== undefined && h.content !== f.content) return false;
  if (f.plaintext !== undefined && h.plaintext !== f.plaintext) return false;
  if ("tags" in f && !sameNull(h.tags, f.tags)) return false;
  if ("parent_id" in f && !sameNull(h.parent_id, f.parent_id)) return false;
  if ("sort_order" in f && !sameNull(h.sort_order, f.sort_order)) return false;
  if ("frontmatter" in f && !sameNull(h.frontmatter, f.frontmatter)) return false;
  if ("deleted_at" in f && (h.deleted_at === null) !== ((f.deleted_at ?? null) === null)) return false;
  return true;
}

type PushVerdict = { kind: "won" } | { kind: "stop"; outcome: CommitOutcome };

async function pushWithVerification(deps: CommitDeps, noteId: string, plan: CommitPlan): Promise<PushVerdict> {
  const fields = plan.serverFields as ServerFields;
  let threw = false;

  try {
    const pushed = await deps.pushMerged(noteId, fields, plan.expectedServerRevision);
    if (pushed.kind === "won") return { kind: "won" };
  } catch {
    threw = true;
  }

  // Zero rows, or an error whose result we cannot know: look at the hosted row.
  let hosted: HostedSnapshot;
  try {
    hosted = await deps.fetchHosted(noteId);
  } catch {
    return { kind: "stop", outcome: { status: "network_error", maybeApplied: true } };
  }

  if (hosted.kind === "purged") return { kind: "stop", outcome: { status: "push_lost", hosted: "purged" } };
  if (hosted.kind === "missing") return { kind: "stop", outcome: { status: "push_lost", hosted: "missing" } };

  if (hosted.revision === plan.expectedServerRevision + 1 && hostedMatchesPlan(hosted, fields)) {
    return { kind: "won" }; // an earlier attempt already landed
  }
  if (hosted.revision === plan.expectedServerRevision) {
    return {
      kind: "stop",
      outcome: threw ? { status: "network_error", maybeApplied: false } : { status: "push_lost", hosted: "unchanged" },
    };
  }
  return { kind: "stop", outcome: { status: "push_lost", hosted: "moved" } };
}

// ─── commitReview ─────────────────────────────────────────────────────────

export async function commitReview(deps: CommitDeps, req: CommitRequest): Promise<CommitOutcome> {
  if (deps.noteIsOpen(req.noteId)) return { status: "refused", reason: "note_open", detail: [] };

  const release = deps.lock(req.noteId);
  if (!release) return { status: "refused", reason: "busy", detail: [] };

  const held: Array<() => void> = [];
  try {
    return await run(deps, req, held);
  } finally {
    for (const r of held) r();
    release();
  }
}

async function run(deps: CommitDeps, req: CommitRequest, held: Array<() => void>): Promise<CommitOutcome> {
  // 1. Rebuild fresh and compare with what the user decided on.
  let fresh: CommitReviewInput;
  try {
    const rebuilt = await deps.rebuild(req.noteId);
    if (!rebuilt.ok) return { status: "refused", reason: "rebuild_failed", detail: [rebuilt.reason] };
    fresh = rebuilt.review;
  } catch (err) {
    return { status: "refused", reason: "rebuild_failed", detail: [msg(err)] };
  }
  if (fresh.theirsServerRevision !== req.review.theirsServerRevision) {
    return { status: "stale", reason: "hosted_moved" };
  }
  if (!sameStamp(fresh.mineStamp, req.review.mineStamp)) {
    return { status: "stale", reason: "local_changed" };
  }

  // 2. Plan (pure).
  let ctx: PlanContext;
  try {
    ctx = await deps.planContext(fresh);
  } catch (err) {
    return { status: "refused", reason: "plan_failed", detail: ["context_failed", msg(err)] };
  }
  const planned = planCommit({
    review: fresh,
    variant: req.variant,
    items: req.items,
    metaChoices: req.metaChoices,
    parentExistsLocally: ctx.parentExistsLocally,
    storedMatchedGeneratedBefore: ctx.storedMatchedGeneratedBefore,
    now: deps.now(),
    ...(deps.newId ? { newId: deps.newId } : {}),
    ...(ctx.generatePlaintext ? { generatePlaintext: ctx.generatePlaintext } : {}),
  });
  if (!planned.ok) {
    return { status: "refused", reason: "plan_failed", detail: [planned.reason, ...planned.detail] };
  }
  const plan = planned.plan;
  const copy = plan.copy;
  if (copy !== null && !deps.createCopy) {
    return { status: "refused", reason: "plan_failed", detail: ["copy_unavailable"] };
  }

  // 3. Backup before any write; a failed backup means no write.
  if (plan.backupKind !== null) {
    try {
      await deps.writeBackup({
        noteId: req.noteId,
        kind: plan.backupKind,
        hostedRevision: plan.expectedServerRevision,
        mineTitle: fresh.mine.title,
        mineContent: fresh.mineContent,
        theirsTitle: fresh.remote.title,
        theirsContent: fresh.theirsContent,
      });
    } catch (err) {
      return { status: "refused", reason: "backup_failed", detail: [msg(err)] };
    }
  }

  // 3b. Keep both: make the copy BEFORE the server is written, so a crash leaves
  //     an extra note rather than lost content. Its own lock stops the drain
  //     pushing it half-way through the commit.
  if (copy !== null && deps.createCopy) {
    const copyRelease = deps.lock(copy.noteId);
    if (!copyRelease) return { status: "refused", reason: "busy", detail: [] };
    held.push(copyRelease);
    try {
      await deps.createCopy(copy);
    } catch (err) {
      await removeCopyQuietly(deps, copy);
      return { status: "refused", reason: "copy_failed", detail: [msg(err)] };
    }
  }

  // 4. Server first.
  let serverWritten = false;
  if (plan.serverFields !== null) {
    const verdict = await pushWithVerification(deps, req.noteId, plan);
    if (verdict.kind === "stop") {
      // Keep the copy only when we cannot tell whether the server applied our write:
      // theirs' text must not be lost.
      const unknown = verdict.outcome.status === "network_error" && verdict.outcome.maybeApplied;
      if (copy !== null && !unknown) await removeCopyQuietly(deps, copy);
      return verdict.outcome;
    }
    serverWritten = true;
  }
  const newServerRevision = plan.serverRevisionAfter;

  // 5. Local write.
  let localWritten = false;
  if (plan.localFields !== null) {
    let written: LocalWriteResult | { kind: "threw"; detail: string };
    try {
      written = await deps.writeLocal(req.noteId, plan.localFields, plan.expectedLocalStamp, plan.expectedLocalAfter);
    } catch (err) {
      written = { kind: "threw", detail: msg(err) };
    }
    if (written.kind !== "ok") {
      const detail = written.kind === "threw" ? written.detail : written.kind;
      return serverWritten
        ? { status: "server_won_local_failed", newServerRevision, detail }
        : { status: "local_failed", detail };
    }
    localWritten = true;
  }

  // 6. Record the agreement.
  try {
    await deps.record({ noteId: req.noteId, plan, newServerRevision });
  } catch {
    return { status: "committed_unrecorded", newServerRevision };
  }

  return {
    status: "committed",
    variant: plan.variant,
    newServerRevision,
    serverWritten,
    localWritten,
    notes: plan.notes,
    ...(copy !== null ? { copyNoteId: copy.noteId } : {}),
  };
}
