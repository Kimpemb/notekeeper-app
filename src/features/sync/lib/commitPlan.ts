// src/features/sync/lib/commitPlan.ts
//
// Stage 4d.3, batch 3b — the PURE half of the commit step (design rev 3,
// sections 3 to 5). Given a review the user has resolved, decide exactly what
// to write on the server and on this device. No DB, no network, no store, and
// no import of anything that reaches supabaseClient (type imports below are
// erased at runtime and come from pure files), so it is unit-tested in node.
//
// What it decides:
//   - the merged content (block merge), or mine's or theirs' content as it is
//     (whole-note variants), or no content change (identical)
//   - metadata (title, parent, sort order, tags, frontmatter, trash state)
//   - the search text (plaintext), by the rule in design rev 3, section 5
//   - the server write: ONLY the fields that differ from hosted (never
//     created_at, publish or fork fields), or null when the server needs nothing
//   - the local write: ONLY the fields that differ from this device, or null
//   - what the local revision and meta_rev must be afterwards (the triggers
//     bump revision on a content change and meta_rev on a metadata change; the
//     committer verifies by reading back, as the pull does)
//
// Not here: taking the lock, the backup, the compare-and-swap, recording sync
// state. Those are commitReview.ts, with injected collaborators.

import { applyReconcileJson, type ApplyFailure, type ApplyItem } from "@/features/notes/lib/applyReconcile";
import type { ReviewMode } from "@/features/sync/lib/reviewAssemble";
import { conflictCopyTitle, remapBlockIds } from "@/features/sync/lib/conflictCopy";

// ─── Types ────────────────────────────────────────────────────────────────

export type CommitVariant =
  | "identical" // same blocks on both sides: record the agreement (plus any metadata decision)
  | "block_merge" // the gate passed: merged content
  | "whole_keep_mine" // the gate tripped: this device's version goes to the server
  | "whole_take_theirs" // the gate tripped: the server's version comes here
  | "whole_keep_both"; // keep mine, save theirs as a new note

export type MetaField = "title" | "parentId" | "sortOrder" | "tags" | "frontmatter" | "deletedAt";
export type MetaValue = string | number | null;

export interface MetaSide {
  title: string;
  parentId: string | null;
  sortOrder: number | null;
  tags: string | null;
  frontmatter: string | null;
  deletedAt: number | null; // ms; null = not in the Trash
  plaintext: string | null;
}

export type FinalMeta = Omit<MetaSide, "plaintext">;

/** The part of a SyncReview the commit needs (a SyncReview satisfies it). */
export interface CommitReviewInput {
  mode: ReviewMode;
  mineContent: string;
  theirsContent: string;
  theirsServerRevision: number;
  mineStamp: { revision: number; metaRev: number; updatedAt: number };
  /** meta_rev recorded at the last agreement; null when there is no sync state. */
  syncedMetaRev: number | null;
  mine: MetaSide;
  remote: MetaSide;
}

export interface MetaRow {
  field: MetaField;
  mine: MetaValue;
  theirs: MetaValue;
  choice: "mine" | "theirs";
  default: "mine";
  /** false when taking theirs is not allowed (a hosted parent this device does not have). */
  canTakeTheirs: boolean;
}

/** Hosted column names. Only fields that differ from the hosted row appear. */
export interface ServerFields {
  title?: string;
  content?: string;
  plaintext?: string;
  tags?: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
  frontmatter?: string | null;
  updated_at?: string; // ISO
  deleted_at?: string | null; // ISO
}

/** Local column names. Only fields that differ from this device appear. */
export interface LocalFields {
  title?: string;
  content?: string;
  plaintext?: string;
  tags?: string | null;
  parent_id?: string | null;
  sort_order?: number | null;
  frontmatter?: string | null;
  updated_at?: number; // ms
  deleted_at?: number | null; // ms
}

export interface CommitPlan {
  variant: CommitVariant;
  /** Which backup to write before the first write; null when nothing will be written. */
  backupKind: "merge" | "whole_note" | null;
  mergedContent: string;
  /** null = the server needs no write. */
  serverFields: ServerFields | null;
  /** null = this device needs no write. */
  localFields: LocalFields | null;
  newUpdatedAt: number;
  /** The hosted revision the review was built on; the push must find exactly this. */
  expectedServerRevision: number;
  /** The hosted revision after the commit (expected + 1 when the server is written). */
  serverRevisionAfter: number;
  /** The local stamp the local write must find unchanged. */
  expectedLocalStamp: { revision: number; metaRev: number; updatedAt: number };
  /** What the local row must read back as after the local write. */
  expectedLocalAfter: { revision: number; metaRev: number; updatedAt: number };
  /** Metadata fields that need a visible choice (default: keep mine). */
  metaRows: MetaRow[];
  /** Metadata fields taken from the server without a row (this device had not changed any). */
  autoTaken: MetaField[];
  /** Run the title side effects (breadcrumbs, calendar titles). */
  titleChanged: boolean;
  /** Local trash state changes: needs the title-chunk cleanup or rewrite the pull does. */
  trashChange: "trashed" | "restored" | null;
  /** The local content changes: queue re-indexing (blocks, embeddings, backlinks). */
  reindex: boolean;
  /** whole_keep_both only: theirs' version as a new local note (pushed later by the drain). */
  copy: ConflictCopyPlan | null;
  notes: string[];
}

/** A new note built from theirs. Never trashed, block ids are fresh, no sync state. */
export interface ConflictCopyPlan {
  noteId: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  frontmatter: string | null;
  parentId: string | null;
  sortOrder: number;
  createdAt: number; // ms
  updatedAt: number; // ms
}

export type PlanFailure = ApplyFailure | "variant_not_allowed" | "copy_failed";

export interface PlanInput {
  review: CommitReviewInput;
  variant: CommitVariant;
  items: ApplyItem[];
  metaChoices: Partial<Record<MetaField, "mine" | "theirs">>;
  /** true when the hosted parent is null or exists on this device. */
  parentExistsLocally: boolean;
  /** generateText with the live schema, supplied by the caller; null/absent = unavailable. */
  generatePlaintext?: (content: string) => string | null;
  /** true when this note's stored plaintext already equalled generateText of its content before the merge. */
  storedMatchedGeneratedBefore: boolean;
  now: number;
  /** Fresh ids for the conflict copy (note id first, then block ids). Required for whole_keep_both. */
  newId?: () => string;
}

export type PlanResult =
  | { ok: true; plan: CommitPlan }
  | { ok: false; reason: PlanFailure; detail: string[] };

const META_FIELDS: readonly MetaField[] = ["title", "parentId", "sortOrder", "tags", "frontmatter", "deletedAt"];

// ─── Metadata ─────────────────────────────────────────────────────────────

const same = (a: MetaValue | undefined, b: MetaValue | undefined): boolean => (a ?? null) === (b ?? null);

/** Trash state is compared by whether it is set, not by when. */
const sameField = (f: MetaField, a: MetaValue, b: MetaValue): boolean =>
  f === "deletedAt" ? (a === null) === (b === null) : same(a, b);

export interface MetaResolution {
  final: FinalMeta;
  rows: MetaRow[];
  autoTaken: MetaField[];
  notes: string[];
}

/**
 * Per-field metadata rules (design rev 3, section 4). The sync state keeps
 * counters, not values, so there is no base for individual fields:
 *   - same on both sides: nothing
 *   - differs, and this device has not changed metadata since the last
 *     agreement: take theirs, silently
 *   - differs, and this device has changed metadata: a visible row, default mine
 *   - trash state is always a visible row when it differs (Q7), default mine
 *   - a hosted parent this device does not have is never taken
 */
export function resolveMetadata(p: {
  mine: MetaSide;
  remote: MetaSide;
  mineMetaRev: number;
  syncedMetaRev: number | null;
  choices: Partial<Record<MetaField, "mine" | "theirs">>;
  parentExistsLocally: boolean;
}): MetaResolution {
  const final: FinalMeta = {
    title: p.mine.title,
    parentId: p.mine.parentId,
    sortOrder: p.mine.sortOrder,
    tags: p.mine.tags,
    frontmatter: p.mine.frontmatter,
    deletedAt: p.mine.deletedAt,
  };
  const out: Record<MetaField, MetaValue> = final;
  const rows: MetaRow[] = [];
  const autoTaken: MetaField[] = [];
  const notes: string[] = [];

  const unchangedHere = p.syncedMetaRev !== null && p.mineMetaRev === p.syncedMetaRev;

  for (const f of META_FIELDS) {
    const m: MetaValue = p.mine[f];
    const t: MetaValue = p.remote[f];
    if (sameField(f, m, t)) continue; // identical: keep mine's value, nothing to write

    const parentBlocked = f === "parentId" && t !== null && !p.parentExistsLocally;

    if (unchangedHere && f !== "deletedAt" && !parentBlocked) {
      out[f] = t;
      autoTaken.push(f);
      continue;
    }
    const choice: "mine" | "theirs" = parentBlocked ? "mine" : (p.choices[f] ?? "mine");
    rows.push({ field: f, mine: m, theirs: t, choice, default: "mine", canTakeTheirs: !parentBlocked });
    out[f] = choice === "mine" ? m : t;
    if (parentBlocked) {
      notes.push("The server has this note under a parent this device does not have, so this device's parent was kept.");
    }
  }

  return { final, rows, autoTaken, notes };
}

// ─── Search text ──────────────────────────────────────────────────────────

/**
 * Rule (design rev 3, section 5): plaintext has more than one writer, so a
 * regenerated value is only trusted for a note whose stored text already
 * matched generateText before the merge. Exact cases first: when the result
 * equals one side's content, that side's stored text is exactly right.
 */
function choosePlaintext(p: {
  merged: string;
  mineContent: string;
  theirsContent: string;
  mine: MetaSide;
  remote: MetaSide;
  generate?: (content: string) => string | null;
  storedMatched: boolean;
}): { plaintext: string; note?: string } {
  if (p.merged === p.mineContent) return { plaintext: p.mine.plaintext ?? "" };
  if (p.merged === p.theirsContent) return { plaintext: p.remote.plaintext ?? "" };
  if (p.storedMatched && p.generate) {
    const g = p.generate(p.merged);
    if (g !== null) return { plaintext: g };
  }
  return {
    plaintext: p.mine.plaintext ?? "",
    note: "Search text for this note may lag behind its content until it is next edited.",
  };
}

// ─── Field sets ───────────────────────────────────────────────────────────

const isoOrNull = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

function addLocalMeta(final: FinalMeta, mine: MetaSide, out: LocalFields): void {
  if (!same(final.title, mine.title)) out.title = final.title;
  if (!same(final.parentId, mine.parentId)) out.parent_id = final.parentId;
  if (!same(final.sortOrder, mine.sortOrder)) out.sort_order = final.sortOrder;
  if (!same(final.tags, mine.tags)) out.tags = final.tags;
  if (!same(final.frontmatter, mine.frontmatter)) out.frontmatter = final.frontmatter;
  if (!sameField("deletedAt", final.deletedAt, mine.deletedAt)) out.deleted_at = final.deletedAt;
}

function addServerMeta(final: FinalMeta, remote: MetaSide, out: ServerFields): void {
  if (!same(final.title, remote.title)) out.title = final.title;
  if (!same(final.parentId, remote.parentId)) out.parent_id = final.parentId;
  if (!same(final.sortOrder, remote.sortOrder)) out.sort_order = final.sortOrder;
  if (!same(final.tags, remote.tags)) out.tags = final.tags;
  if (!same(final.frontmatter, remote.frontmatter)) out.frontmatter = final.frontmatter;
  if (!sameField("deletedAt", final.deletedAt, remote.deletedAt)) out.deleted_at = isoOrNull(final.deletedAt);
}

// ─── planCommit ───────────────────────────────────────────────────────────

const REQUIRED_MODE: Record<CommitVariant, ReviewMode | null> = {
  identical: "identical",
  block_merge: "block",
  whole_keep_mine: "whole_note",
  whole_take_theirs: "whole_note",
  whole_keep_both: "whole_note",
};

const fail = (reason: PlanFailure, detail: string[]): PlanResult => ({ ok: false, reason, detail });

export function planCommit(input: PlanInput): PlanResult {
  const { review, variant } = input;
  const notes: string[] = [];

  const need = REQUIRED_MODE[variant];
  if (need === null) return fail("variant_not_allowed", [`${variant} is not built yet`]);
  if (review.mode !== need) {
    return fail("variant_not_allowed", [`${variant} needs a ${need} review, this one is ${review.mode}`]);
  }

  // 1. Content.
  let content: string;
  if (variant === "block_merge") {
    const applied = applyReconcileJson(review.mineContent, review.theirsContent, input.items);
    if (!applied.ok) return fail(applied.reason, applied.detail);
    content = applied.content as string;
    notes.push(...applied.notes);
  } else if (variant === "whole_take_theirs") {
    content = review.theirsContent;
  } else {
    content = review.mineContent; // identical, whole_keep_mine, whole_keep_both
  }

  // 2. Metadata.
  const meta = resolveMetadata({
    mine: review.mine,
    remote: review.remote,
    mineMetaRev: review.mineStamp.metaRev,
    syncedMetaRev: review.syncedMetaRev,
    choices: input.metaChoices,
    parentExistsLocally: input.parentExistsLocally,
  });
  notes.push(...meta.notes);

  // 3. Search text.
  const pt = choosePlaintext({
    merged: content,
    mineContent: review.mineContent,
    theirsContent: review.theirsContent,
    mine: review.mine,
    remote: review.remote,
    generate: input.generatePlaintext,
    storedMatched: input.storedMatchedGeneratedBefore,
  });
  if (pt.note) notes.push(pt.note);

  // 3b. Keep both: theirs' version becomes a new note beside this one.
  let copy: ConflictCopyPlan | null = null;
  if (variant === "whole_keep_both") {
    if (!input.newId) return fail("copy_failed", ["no id generator supplied"]);
    try {
      const noteId = input.newId();
      const remapped = remapBlockIds(review.theirsContent, input.newId);
      copy = {
        noteId,
        title: conflictCopyTitle(meta.final.title),
        content: remapped.content,
        plaintext: review.remote.plaintext ?? "",
        tags: review.remote.tags,
        frontmatter: review.remote.frontmatter,
        parentId: meta.final.parentId,
        sortOrder: meta.final.sortOrder ?? 0,
        createdAt: input.now,
        updatedAt: input.now,
      };
    } catch (err) {
      return fail("copy_failed", [err instanceof Error ? err.message : String(err)]);
    }
  }

  // 4. Local write: only what differs from this device. "identical" never
  //    touches content (the blocks already agree).
  const contentChangedLocal = variant !== "identical" && content !== review.mineContent;
  const contentChangedServer = variant !== "identical" && content !== review.theirsContent;

  const local: LocalFields = {};
  if (contentChangedLocal) {
    local.content = content;
    local.plaintext = pt.plaintext;
  }
  addLocalMeta(meta.final, review.mine, local);
  const hasLocal = Object.keys(local).length > 0;

  const newUpdatedAt = Math.max(input.now, review.mineStamp.updatedAt + 1);
  if (hasLocal) local.updated_at = newUpdatedAt;

  // 5. Server write: only what differs from hosted. The server always gets the
  //    new time: the pull copies hosted updated_at onto other devices, so it
  //    must never go backwards. This device gets it only when it is written.
  const server: ServerFields = {};
  if (contentChangedServer) {
    server.content = content;
    server.plaintext = pt.plaintext;
  }
  addServerMeta(meta.final, review.remote, server);
  const hasServer = Object.keys(server).length > 0;
  if (hasServer) server.updated_at = new Date(newUpdatedAt).toISOString();

  // 6. What the local row must read back as (same formula the pull verifies).
  const metaChangedLocal = META_FIELDS.some((f) => !sameField(f, meta.final[f], review.mine[f]));
  const expectedLocalAfter = {
    revision: review.mineStamp.revision + (contentChangedLocal ? 1 : 0),
    metaRev: review.mineStamp.metaRev + (metaChangedLocal ? 1 : 0),
    updatedAt: hasLocal ? newUpdatedAt : review.mineStamp.updatedAt,
  };

  const trashChange: CommitPlan["trashChange"] = sameField("deletedAt", meta.final.deletedAt, review.mine.deletedAt)
    ? null
    : meta.final.deletedAt !== null
      ? "trashed"
      : "restored";

  const backupKind: CommitPlan["backupKind"] =
    hasLocal || hasServer ? (variant.startsWith("whole") ? "whole_note" : "merge") : null;

  return {
    ok: true,
    plan: {
      variant,
      backupKind,
      mergedContent: content,
      serverFields: hasServer ? server : null,
      localFields: hasLocal ? local : null,
      newUpdatedAt,
      expectedServerRevision: review.theirsServerRevision,
      serverRevisionAfter: review.theirsServerRevision + (hasServer ? 1 : 0),
      expectedLocalStamp: { ...review.mineStamp },
      expectedLocalAfter,
      metaRows: meta.rows,
      autoTaken: meta.autoTaken,
      titleChanged: !same(meta.final.title, review.mine.title),
      trashChange,
      reindex: contentChangedLocal,
      copy,
      notes,
    },
  };
}
