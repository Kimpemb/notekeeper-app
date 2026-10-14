// src/features/notes/lib/blockRevisioning.ts
//
// Writes a full block-level snapshot of a note at its current revision.
// One row per blockId-bearing node (per BlockIdExtension.ts), keyed by
// (note_id, revision, block_id). content_hash is computed now, unused for
// now — it's what makes a later move to content-addressable storage
// (dedup via block_content_store) a pure addition, not a rework: the
// hashes already exist on every row by the time that migration happens.

import { getDb } from "@/features/notes/db/client";
import type { BlockMap, BlockSnapshot } from "@/features/notes/lib/threeWayDiff";

interface DocNode {
  type?: string;
  attrs?: { blockId?: string | null; [k: string]: unknown };
  content?: DocNode[];
  [k: string]: unknown;
}

export function computeBlockSnapshots(
  contentJson: string
): Array<{ blockId: string; content: string }> {
  let doc: DocNode;
  try { doc = JSON.parse(contentJson); } catch { return []; }

  const blocks: Array<{ blockId: string; content: string }> = [];

  function walk(node: DocNode | undefined): void {
    if (!node) return;
    if (node.attrs?.blockId) {
      blocks.push({ blockId: node.attrs.blockId, content: JSON.stringify(node) });
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  }

  walk(doc);
  return blocks;
}

/**
 * Same walk as computeBlockSnapshots, but resolves each block's hash too —
 * used to build a BlockMap for "mine" (live editor state) without a DB
 * round trip, per threeWayDiff.ts's loader boundary (Core Design doc §4).
 */
export async function computeBlockSnapshotsWithHash(
  contentJson: string
): Promise<Array<{ blockId: string; content: string; hash: string }>> {
  const blocks = computeBlockSnapshots(contentJson);
  return Promise.all(
    blocks.map(async (b) => ({ ...b, hash: await hashBlockContent(b.content) }))
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export async function hashBlockContent(content: string): Promise<string> {
  let canonicalStr: string;
  try {
    canonicalStr = JSON.stringify(canonicalize(JSON.parse(content)));
  } catch {
    // content always comes from JSON.stringify(node) upstream, so this
    // shouldn't happen — fall back to raw string rather than throw.
    canonicalStr = content;
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalStr));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function writeBlockRevisionSnapshot(
  noteId: string,
  contentJson: string
): Promise<void> {
  const db = await getDb();

  const revRows = await db.select<{ revision: number }[]>(
    `SELECT revision FROM notes WHERE id = $1`,
    [noteId]
  );
  const revision = revRows[0]?.revision;
  if (revision == null) return; // note gone mid-flight — nothing to snapshot

  const blocks = computeBlockSnapshots(contentJson);
  if (blocks.length === 0) return;

  const now = Date.now();
  for (const block of blocks) {
    const hash = await hashBlockContent(block.content);
    // OR IGNORE: defensive against a re-entrant save landing on the same
    // (note_id, revision, block_id) — should not happen, but a silent
    // no-op here is far safer than a thrown constraint violation.
    await db.execute(
      `INSERT OR IGNORE INTO block_revision_snapshots
         (note_id, revision, block_id, content, content_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [noteId, revision, block.blockId, block.content, hash, now]
    );
  }
}

// ─── Loaders for threeWayDiff.ts (design doc §6) ─────────────────────────────
//
// DB-touching boundary around the pure diff function — Stage 4 (live sync)
// and Stage 6 (fork reconcile) each build BlockMaps differently (a network
// payload vs. a local snapshot read), so this stays a thin, swappable
// adapter rather than something diffNoteRevisions itself knows about.

/**
 * Loads a BlockMap for a note at a specific revision, for use as `base`,
 * `theirs`, or a saved `mine` in diffNoteRevisions.
 *
 * Returns null when no rows exist at that exact (note_id, revision) pair.
 * Per design doc §4.3, a pruned revision and a genuinely-never-had-blocks
 * note are handled identically downstream — diffNoteRevisions's own
 * pruned-base fallback treats both cases the same way — so there's no
 * need to distinguish them here with an extra query.
 */
export async function loadBlockMapAtRevision(
  noteId: string,
  revision: number
): Promise<BlockMap | null> {
  const db = await getDb();
  const rows = await db.select<{ block_id: string; content: string; content_hash: string | null }[]>(
    `SELECT block_id, content, content_hash
     FROM block_revision_snapshots
     WHERE note_id = $1 AND revision = $2`,
    [noteId, revision]
  );

  if (rows.length === 0) return null;

  const map: BlockMap = new Map();
  for (const row of rows) {
    // content_hash is nullable at the schema level (added via a later
    // migration than the column it backfills alongside) — fall back to
    // hashing on read for any row written before that column existed.
    const hash = row.content_hash ?? (await hashBlockContent(row.content));
    map.set(row.block_id, { blockId: row.block_id, content: row.content, hash } satisfies BlockSnapshot);
  }
  return map;
}

/**
 * Builds a BlockMap directly from live/current document JSON — content
 * that hasn't necessarily been written to block_revision_snapshots yet
 * (e.g. the actively-open editor's in-memory state). Used for `mine` when
 * diffing against an unsaved or just-about-to-save state, without waiting
 * on the debounced snapshot write in useAutoSave.ts.
 */
export async function loadLiveBlockMap(contentJson: string): Promise<BlockMap> {
  const blocks = await computeBlockSnapshotsWithHash(contentJson);
  const map: BlockMap = new Map();
  for (const block of blocks) {
    map.set(block.blockId, block satisfies BlockSnapshot);
  }
  return map;
}