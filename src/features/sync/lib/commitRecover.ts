// src/features/sync/lib/commitRecover.ts
//
// Stage 4d.3, step 14.2b (part 1) — the commit sequence for "Recover from a
// backup". Same pattern as commitReview.ts and commitDelete.ts: the outside
// world is injected, so every failure row is unit-tested. NO import of
// supabaseClient, the DB or any store. The live collaborators come next, in
// commitRecoverLive.ts.
//
// Sequences (the plans come from recoverPlan.ts):
//   as_new   lock the source note -> read parent -> plan -> insert the new note
//            (no sync state; the drain pushes it) -> finish (best effort)
//   replace  note not open -> lock -> read the note fresh -> stale check ->
//            plan -> backup (kind "recover") -> compare-and-swap local write,
//            read back and verify -> finish (best effort)
//
// Rules this file keeps:
//   * Nothing is overwritten before its backup is written.
//   * Replace writes locally only. The note then looks "changed here" to the
//     next drain, which pushes it like any edit (or parks it for review if the
//     server moved too). No server call is made here.
//   * Replace writes title and content only, never parent, order or tags.
//   * The finish step never throws; the write itself is already done.

import type { BackupInput, BackupRow } from "@/features/sync/lib/reconcileStore";
import {
  planRecoverAsNew,
  planRecoverReplace,
  type RecoverAsNewPlan,
  type RecoverChoice,
  type RecoverFailure,
  type RecoverLocalNote,
  type RecoverReplacePlan,
  type RecoverSide,
} from "@/features/sync/lib/recoverPlan";
import type { ConflictCopyPlan, LocalFields } from "@/features/sync/lib/commitPlan";

export interface RecoverStamp {
  revision: number;
  metaRev: number;
  updatedAt: number;
}

export interface RecoverRequest {
  /** The backup row the person picked (the list screen already loaded it). */
  row: BackupRow;
  side: RecoverSide;
  choice: RecoverChoice;
  /** replace only: the stamp of the note as the screen last showed it. */
  reviewedLocalStamp?: RecoverStamp;
}

export type RecoverOutcome =
  | { status: "committed"; choice: "as_new"; newNoteId: string; notes: string[] }
  | { status: "committed"; choice: "replace"; noteId: string; notes: string[] }
  | { status: "stale"; reason: "local_changed" }
  | { status: "refused"; reason: "note_open" | "busy" | "read_failed" | "backup_failed"; detail: string[] }
  | { status: "plan_failed"; reason: RecoverFailure; detail: string[] }
  | { status: "local_failed"; detail: string };

export type RecoverWriteResult = "ok" | "raced" | "unverified";

export interface RecoverDeps {
  noteIsOpen(noteId: string): boolean;
  /** Returns a release function, or null when the note is busy. */
  lock(noteId: string): (() => void) | null;

  /** The live local note, or null when it no longer exists. Throws on a database error. */
  readLocal(noteId: string): Promise<RecoverLocalNote | null>;
  parentExists(parentId: string): Promise<boolean>;

  writeBackup(input: BackupInput): Promise<void>;

  /** Compare-and-swap UPDATE on `expected`, then read back and compare with `expectedAfter`. */
  writeLocal(
    noteId: string,
    fields: LocalFields,
    expected: RecoverStamp,
    expectedAfter: RecoverStamp
  ): Promise<RecoverWriteResult>;

  /** Insert the new note (INSERT OR IGNORE, verified). Throws on any failure. */
  insertNew(copy: ConflictCopyPlan): Promise<void>;

  /** Best-effort follow-ups (snapshot, backlinks, store refresh, re-index). Must never throw. */
  finishReplace(noteId: string, plan: RecoverReplacePlan): Promise<void>;
  finishNew(copy: ConflictCopyPlan): Promise<void>;

  generatePlaintext(content: string): string | null;
  now(): number;
  newId(): string;
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function quietly(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // best-effort
  }
}

export async function commitRecover(deps: RecoverDeps, req: RecoverRequest): Promise<RecoverOutcome> {
  return req.choice === "as_new" ? runAsNew(deps, req) : runReplace(deps, req);
}

// ─── Restore as a new note ────────────────────────────────────────────────

async function runAsNew(deps: RecoverDeps, req: RecoverRequest): Promise<RecoverOutcome> {
  // The saved parent id, if the backup kept one. Checked here so the plan stays pure.
  const savedParent = req.side === "mine" ? req.row.mine_parent_id : req.row.theirs_parent_id;
  const hasMeta = (req.side === "mine" ? req.row.mine_has_meta : req.row.theirs_has_meta) === 1;
  let parentExistsLocally = false;
  if (hasMeta && savedParent) {
    try {
      parentExistsLocally = await deps.parentExists(savedParent);
    } catch (err) {
      return { status: "refused", reason: "read_failed", detail: [msg(err)] };
    }
  }

  const planned = planRecoverAsNew({
    row: req.row,
    side: req.side,
    now: deps.now(),
    newId: deps.newId,
    generatePlaintext: deps.generatePlaintext,
    parentExistsLocally,
  });
  if (!planned.ok) return { status: "plan_failed", reason: planned.reason, detail: planned.detail };
  const plan: RecoverAsNewPlan = planned.plan;

  try {
    await deps.insertNew(plan.copy);
  } catch (err) {
    return { status: "local_failed", detail: msg(err) };
  }

  await quietly(() => deps.finishNew(plan.copy));
  return { status: "committed", choice: "as_new", newNoteId: plan.copy.noteId, notes: plan.notes };
}

// ─── Replace this note's content ──────────────────────────────────────────

const sameStamp = (a: RecoverStamp, b: RecoverStamp): boolean =>
  a.revision === b.revision && a.metaRev === b.metaRev && a.updatedAt === b.updatedAt;

async function runReplace(deps: RecoverDeps, req: RecoverRequest): Promise<RecoverOutcome> {
  const noteId = req.row.note_id;
  if (deps.noteIsOpen(noteId)) return { status: "refused", reason: "note_open", detail: [] };

  const release = deps.lock(noteId);
  if (!release) return { status: "refused", reason: "busy", detail: [] };
  try {
    let local: RecoverLocalNote | null;
    try {
      local = await deps.readLocal(noteId);
    } catch (err) {
      return { status: "refused", reason: "read_failed", detail: [msg(err)] };
    }

    // Stale check: the note moved since the screen last showed it.
    if (local && req.reviewedLocalStamp) {
      const nowStamp: RecoverStamp = { revision: local.revision, metaRev: local.meta_rev, updatedAt: local.updated_at };
      if (!sameStamp(nowStamp, req.reviewedLocalStamp)) return { status: "stale", reason: "local_changed" };
    }

    const planned = planRecoverReplace({
      row: req.row,
      side: req.side,
      local,
      now: deps.now(),
      generatePlaintext: deps.generatePlaintext,
    });
    if (!planned.ok) return { status: "plan_failed", reason: planned.reason, detail: planned.detail };
    const plan = planned.plan;
    const current = local as RecoverLocalNote; // plan ok implies the note exists

    // Backup first. Nothing is overwritten if this fails.
    try {
      await deps.writeBackup(plan.backup);
    } catch (err) {
      return { status: "refused", reason: "backup_failed", detail: [msg(err)] };
    }

    // Only title and content (and search text and the edit time). Never metadata.
    const titleChanged = plan.title !== current.title;
    const contentChanged = plan.content !== current.content;
    const newUpdatedAt = deps.now();
    const fields: LocalFields = { updated_at: newUpdatedAt };
    if (titleChanged) fields.title = plan.title;
    if (contentChanged) {
      fields.content = plan.content;
      // Only write search text we actually generated; otherwise the stored text is kept
      // and the note is re-indexed from its content in the finish step.
      if (plan.plaintextGenerated) fields.plaintext = plan.plaintext;
    }

    // Same formula the other commits verify: a content change bumps revision,
    // a title change bumps meta_rev.
    const expectedAfter: RecoverStamp = {
      revision: plan.expectedLocalStamp.revision + (contentChanged ? 1 : 0),
      metaRev: plan.expectedLocalStamp.metaRev + (titleChanged ? 1 : 0),
      updatedAt: newUpdatedAt,
    };

    let written: RecoverWriteResult;
    try {
      written = await deps.writeLocal(noteId, fields, plan.expectedLocalStamp, expectedAfter);
    } catch (err) {
      return { status: "local_failed", detail: msg(err) };
    }
    if (written === "raced") return { status: "stale", reason: "local_changed" };
    // "unverified": the write went through but the read-back differed. The data is
    // written and backed up, so carry on and say so in the notes.
    const notes = written === "unverified"
      ? [...plan.notes, "The note was written, but the saved version numbers were not what was expected. It will be checked on the next sync."]
      : plan.notes;

    await quietly(() => deps.finishReplace(noteId, plan));
    return { status: "committed", choice: "replace", noteId, notes };
  } finally {
    release();
  }
}
