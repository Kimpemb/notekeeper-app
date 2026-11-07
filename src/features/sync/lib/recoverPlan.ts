// src/features/sync/lib/recoverPlan.ts
//
// Stage 4d.3, step 14.2 — the PURE half of "Recover from a backup". No DB, no
// network, no store, and no import of anything that reaches supabaseClient
// (the imports below are type-only or pure), so it is unit-tested in node.
//
// Two actions, both starting from one SIDE of one backup row (mine or theirs):
//
//   as_new   Restore as a new note (the safe default). A brand-new note id and
//            fresh block ids, no sync state, never trashed; the drain pushes
//            it as an ordinary new note. Parent, sort order, tags and
//            frontmatter come back only when the backup kept them
//            (has_meta = 1); an older backup gives a root note with defaults.
//   replace  Replace this note's content. Only title and content are written,
//            through the normal save path; metadata is never touched (a
//            silent rename or move would surprise people). The note's current
//            state is backed up first, as kind "recover".
//
// Not here: the lock, the open-note check, the backup write, the insert or the
// update. The live committer does those and calls these plans.

import { remapBlockIds } from "@/features/sync/lib/conflictCopy";
import type { ConflictCopyPlan } from "@/features/sync/lib/commitPlan";
import type { BackupInput, BackupMeta, BackupRow } from "@/features/sync/lib/reconcileStore";


export type RecoverSide = "mine" | "theirs";
export type RecoverChoice = "as_new" | "replace";

export const RESTORED_SUFFIX = " (restored)";

export function restoredTitle(title: string): string {
  const base = title.trim() === "" ? "Untitled" : title;
  return base + RESTORED_SUFFIX;
}

export type RecoverFailure =
  | "side_empty" // that side holds no content (for example mine on a purge backup)
  | "bad_content" // the stored content is not a valid document
  | "note_missing" // replace needs a live local note
  | "nothing_to_change"; // replace would write exactly what the note already holds

export type RecoverResult<P> = { ok: true; plan: P } | { ok: false; reason: RecoverFailure; detail: string[] };

const fail = (reason: RecoverFailure, detail: string[] = []) => ({ ok: false as const, reason, detail });

// ─── One side of a backup row ─────────────────────────────────────────────

export interface RecoverSideData {
  side: RecoverSide;
  title: string;
  content: string;
  /** null when the backup did not keep metadata for this side (has_meta = 0). */
  meta: BackupMeta | null;
}

/** The side's data, or null when that side holds no usable content. */
export function sideOf(row: BackupRow, side: RecoverSide): RecoverSideData | null {
  const content = side === "mine" ? row.mine_content : row.theirs_content;
  if (content === null || content === undefined || content === "") return null;
  const title = (side === "mine" ? row.mine_title : row.theirs_title) ?? "";
  const hasMeta = (side === "mine" ? row.mine_has_meta : row.theirs_has_meta) === 1;
  const meta: BackupMeta | null = hasMeta
    ? side === "mine"
      ? {
          parentId: row.mine_parent_id,
          sortOrder: row.mine_sort_order,
          tags: row.mine_tags,
          frontmatter: row.mine_frontmatter,
        }
      : {
          parentId: row.theirs_parent_id,
          sortOrder: row.theirs_sort_order,
          tags: row.theirs_tags,
          frontmatter: row.theirs_frontmatter,
        }
    : null;
  return { side, title, content, meta };
}

/** Sides a person can restore from, in display order (mine first). */
export function availableSides(row: BackupRow): RecoverSide[] {
  const out: RecoverSide[] = [];
  if (sideOf(row, "mine")) out.push("mine");
  if (sideOf(row, "theirs")) out.push("theirs");
  return out;
}

/** A parsed document root, or null when the string is not a ProseMirror-style doc. */
function parseDoc(content: string): { type?: unknown; content?: unknown } | null {
  try {
    const v: unknown = JSON.parse(content);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    return v as { type?: unknown; content?: unknown };
  } catch {
    return null;
  }
}

/** Number of image and attachment nodes. Their files live on one machine (handoff finding 11). */
export function countMediaNodes(content: string): number {
  const doc = parseDoc(content);
  if (!doc) return 0;
  let n = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const o = node as { type?: unknown; content?: unknown };
    if (o.type === "image" || o.type === "attachment") n++;
    if (o.content !== undefined) walk(o.content);
  };
  walk(doc);
  return n;
}

function mediaNote(side: RecoverSide, count: number): string | null {
  if (count === 0) return null;
  const where = side === "theirs" ? "the other device's" : "this device's";
  return `The text contains ${count} image or attachment ${count === 1 ? "node" : "nodes"}. Those files are not part of a backup, and the paths point at ${where} files, so they may show as broken.`;
}

// ─── Restore as a new note ────────────────────────────────────────────────

export interface RecoverAsNewInput {
  row: BackupRow;
  side: RecoverSide;
  now: number;
  /** Fresh ids: the note id first, then one per block. */
  newId: () => string;
  /** generateText with the live schema; null result or absent = unavailable. */
  generatePlaintext?: (content: string) => string | null;
  /** true when the saved parent exists on this device. Ignored when there is no saved metadata. */
  parentExistsLocally: boolean;
}

export interface RecoverAsNewPlan {
  copy: ConflictCopyPlan;
  notes: string[];
}

export function planRecoverAsNew(input: RecoverAsNewInput): RecoverResult<RecoverAsNewPlan> {
  const data = sideOf(input.row, input.side);
  if (!data) return fail("side_empty");
  if (!parseDoc(data.content)) return fail("bad_content");

  const notes: string[] = [];
  let content: string;
  try {
    const noteIdReserved = input.newId(); // first id is the note's
    content = remapBlockIds(data.content, input.newId).content;
    const plaintext = input.generatePlaintext?.(content) ?? null;
    if (plaintext === null) notes.push("Search text could not be generated; the note is re-indexed from its content.");

    const meta = data.meta;
    let parentId: string | null = null;
    if (meta?.parentId) {
      if (input.parentExistsLocally) parentId = meta.parentId;
      else notes.push("The note's old parent is no longer on this device, so the restored note is at the top level.");
    }
    if (!meta) notes.push("This backup did not keep the note's folder, order or tags, so the restored note uses defaults.");

    const media = mediaNote(input.side, countMediaNodes(content));
    if (media) notes.push(media);

    return {
      ok: true,
      plan: {
        copy: {
          noteId: noteIdReserved,
          title: restoredTitle(data.title),
          content,
          plaintext: plaintext ?? "",
          tags: meta?.tags ?? null,
          frontmatter: meta?.frontmatter ?? null,
          parentId,
          sortOrder: meta?.sortOrder ?? 0,
          createdAt: input.now,
          updatedAt: input.now,
        },
        notes,
      },
    };
  } catch (err) {
    return fail("bad_content", [err instanceof Error ? err.message : String(err)]);
  }
}

// ─── Replace this note's content ──────────────────────────────────────────

export interface RecoverLocalNote {
  title: string;
  content: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  revision: number;
  meta_rev: number;
  updated_at: number;
}

export interface RecoverReplaceInput {
  row: BackupRow;
  side: RecoverSide;
  /** The live local note, or null when it no longer exists (only "as new" is possible then). */
  local: RecoverLocalNote | null;
  now: number;
  generatePlaintext?: (content: string) => string | null;
}

export interface RecoverReplacePlan {
  noteId: string;
  /** Written before any change, so the replace can itself be undone. */
  backup: BackupInput;
  title: string;
  content: string;
  plaintext: string;
  /** true when plaintext came from generateText; false means "left empty, re-index from content". */
  plaintextGenerated: boolean;
  /** The local stamp the committer must find unchanged. */
  expectedLocalStamp: { revision: number; metaRev: number; updatedAt: number };
  notes: string[];
}

export function planRecoverReplace(input: RecoverReplaceInput): RecoverResult<RecoverReplacePlan> {
  const { row, side, local } = input;
  if (!local) return fail("note_missing");
  const data = sideOf(row, side);
  if (!data) return fail("side_empty");
  if (!parseDoc(data.content)) return fail("bad_content");

  const title = data.title.trim() === "" ? "Untitled" : data.title;
  if (title === local.title && data.content === local.content) return fail("nothing_to_change");

  const generated = input.generatePlaintext?.(data.content) ?? null;
  const notes: string[] = [
    "Only the title and text are replaced. The note keeps its current folder, order and tags.",
    "A backup of the current version is saved first.",
  ];
  if (generated === null) notes.push("Search text could not be generated; the note is re-indexed from its content.");
  const media = mediaNote(side, countMediaNodes(data.content));
  if (media) notes.push(media);

  return {
    ok: true,
    plan: {
      noteId: row.note_id,
      backup: {
        noteId: row.note_id,
        kind: "recover",
        hostedRevision: null,
        mineTitle: local.title,
        mineContent: local.content,
        theirsTitle: null,
        theirsContent: null,
        mineMeta: {
          parentId: local.parent_id,
          sortOrder: local.sort_order,
          tags: local.tags,
          frontmatter: local.frontmatter,
        },
      },
      title,
      content: data.content,
      plaintext: generated ?? "",
      plaintextGenerated: generated !== null,
      expectedLocalStamp: { revision: local.revision, metaRev: local.meta_rev, updatedAt: local.updated_at },
      notes,
    },
  };
}
