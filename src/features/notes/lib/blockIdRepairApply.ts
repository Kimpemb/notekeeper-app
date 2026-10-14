// src/features/notes/lib/blockIdRepairApply.ts
//
// Applies the fix. For every note flagged by blockIdRepairScan.ts, walks
// its content in document order and reassigns a fresh UUID to every
// occurrence of a blockId AFTER the first one seen — same algorithm as
// the corrected appendTransaction in BlockIdExtension.ts, applied once,
// retroactively, to already-corrupted documents.
//
// Content-safe: no text, node, or ordering is touched. Only blockId
// attributes change. The first-seen occurrence of each duplicated ID
// keeps it; every later occurrence gets a new one — this is a documented
// simplification (see design note below), not a semantic judgement about
// which occurrence is "the real one".
//
// Writes go through a real UPDATE on notes.content, which fires the
// existing notes_revision_bump and notes_version_on_update triggers
// exactly as a normal editor save would. writeBlockRevisionSnapshot is
// then called explicitly afterward, since that call normally happens
// from the app's save path (useAutoSave.ts), not from a DB trigger, and
// this script writes directly to the DB.

import { getDb } from "@/features/notes/db/client";
import { writeBlockRevisionSnapshot } from "@/features/notes/lib/blockRevisioning";
import { scanForDuplicateBlockIds } from "@/features/notes/lib/blockIdRepairScan";

interface DocNode {
  type?: string;
  attrs?: { blockId?: string | null; [k: string]: unknown };
  content?: DocNode[];
  [k: string]: unknown;
}

interface RepairResult {
  noteId: string;
  title: string;
  reassignedCount: number;
}

/**
 * Walks a document tree and reassigns a fresh UUID to every node whose
 * blockId has already been seen earlier in the same walk. Mirrors
 * BlockIdExtension.ts's appendTransaction fix exactly, applied to a
 * plain JSON tree instead of a live ProseMirror doc.
 */
function reassignDuplicates(node: DocNode | undefined, seen: Set<string>): number {
  if (!node) return 0;
  let reassigned = 0;

  if (node.attrs?.blockId) {
    const id = node.attrs.blockId;
    if (seen.has(id)) {
      node.attrs.blockId = crypto.randomUUID();
      seen.add(node.attrs.blockId);
      reassigned++;
    } else {
      seen.add(id);
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      reassigned += reassignDuplicates(child, seen);
    }
  }

  return reassigned;
}

/**
 * Repairs a single note by id. Returns null if the note had no
 * duplicates (nothing to do) or doesn't exist / fails to parse.
 */
export async function repairNote(noteId: string, dryRun: boolean): Promise<RepairResult | null> {
  const db = await getDb();
  const rows = await db.select<{ id: string; title: string; content: string }[]>(
    `SELECT id, title, content FROM notes WHERE id = $1`,
    [noteId]
  );
  const note = rows[0];
  if (!note) return null;

  let doc: DocNode;
  try {
    doc = JSON.parse(note.content);
  } catch {
    return null;
  }

  const seen = new Set<string>();
  const reassignedCount = reassignDuplicates(doc, seen);

  if (reassignedCount === 0) return null;

  if (!dryRun) {
    const newContent = JSON.stringify(doc);
    // Real UPDATE — fires notes_revision_bump and notes_version_on_update
    // exactly as a normal save would.
    await db.execute(`UPDATE notes SET content = $1 WHERE id = $2`, [newContent, noteId]);
    // The app's own save path calls this after content changes; a direct
    // DB write here doesn't go through that path, so call it explicitly
    // to make sure a correct, deduplicated snapshot gets recorded at the
    // note's new revision.
    await writeBlockRevisionSnapshot(noteId, newContent);
  }

  return { noteId, title: note.title, reassignedCount };
}

/**
 * Repairs every note flagged by the scan. dryRun (default true) computes
 * and reports what WOULD change without writing anything — always run
 * this first and review the output before calling with dryRun: false.
 */
export async function runBlockIdRepair(options: { dryRun?: boolean } = {}): Promise<void> {
  const dryRun = options.dryRun ?? true;

  const flagged = await scanForDuplicateBlockIds();
  if (flagged.length === 0) {
    console.log("✅ Nothing to repair — no duplicate blockIds found.");
    return;
  }

  console.log(
    dryRun
      ? `🔍 DRY RUN — would repair ${flagged.length} note(s). Nothing will be written.`
      : `✍️  APPLYING — repairing ${flagged.length} note(s). This will write to the database.`
  );

  const results: RepairResult[] = [];
  for (const { noteId } of flagged) {
    const result = await repairNote(noteId, dryRun);
    if (result) results.push(result);
  }

  console.table(results);
  console.log(
    dryRun
      ? `Dry run complete. ${results.length} note(s) would be repaired. Re-run with { dryRun: false } to apply.`
      : `✅ Repair complete. ${results.length} note(s) updated, revisions bumped, fresh snapshots written.`
  );

  if (!dryRun) {
    const remaining = await scanForDuplicateBlockIds();
    if (remaining.length === 0) {
      console.log("✅ Verification: no duplicate blockIds remain anywhere in the vault.");
    } else {
      console.warn(`⚠️  Verification found ${remaining.length} note(s) STILL flagged after repair — investigate before trusting the result.`, remaining);
    }
  }
}