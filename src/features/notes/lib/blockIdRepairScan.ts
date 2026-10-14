// src/features/notes/lib/blockIdRepairScan.ts
//
// Dry-run scan for duplicate blockIds across the whole vault, caused by
// the pre-fix BlockIdExtension.ts bug (stock ProseMirror commands like
// splitListItem cloning a node's full attrs, blockId included, when the
// old appendTransaction only checked for MISSING blockIds, not DUPLICATE
// ones). Fixed going forward; this finds what's already corrupted.
//
// Read-only. Prints a report. Does not write anything. Run the companion
// apply script (blockIdRepairApply.ts) only after reviewing this output.

import { getDb } from "@/features/notes/db/client";

interface DocNode {
  type?: string;
  attrs?: { blockId?: string | null; [k: string]: unknown };
  content?: DocNode[];
  [k: string]: unknown;
}

interface DuplicateReport {
  noteId: string;
  title: string;
  duplicateBlockIds: string[]; // blockIds that appear 2+ times in this note
  occurrenceCounts: Record<string, number>;
}

function collectBlockIds(node: DocNode | undefined, out: string[]): void {
  if (!node) return;
  if (node.attrs?.blockId) out.push(node.attrs.blockId);
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectBlockIds(child, out);
  }
}

export async function scanForDuplicateBlockIds(): Promise<DuplicateReport[]> {
  const db = await getDb();
  const notes = await db.select<{ id: string; title: string; content: string }[]>(
    `SELECT id, title, content FROM notes WHERE deleted_at IS NULL`
  );

  const reports: DuplicateReport[] = [];

  for (const note of notes) {
    let doc: DocNode;
    try {
      doc = JSON.parse(note.content);
    } catch {
      continue; // unparseable content — skip, not this scan's concern
    }

    const ids: string[] = [];
    collectBlockIds(doc, ids);

    const counts: Record<string, number> = {};
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;

    const duplicates = Object.entries(counts)
      .filter(([, count]) => count > 1)
      .map(([id]) => id);

    if (duplicates.length > 0) {
      reports.push({
        noteId: note.id,
        title: note.title,
        duplicateBlockIds: duplicates,
        occurrenceCounts: Object.fromEntries(duplicates.map((id) => [id, counts[id]])),
      });
    }
  }

  return reports;
}

// ─── Console-friendly runner ────────────────────────────────────────────────
// Usage from DevTools:
//   const { runBlockIdScan } = await import('/src/features/notes/lib/blockIdRepairScan.ts');
//   await runBlockIdScan();
export async function runBlockIdScan(): Promise<void> {
  const reports = await scanForDuplicateBlockIds();

  if (reports.length === 0) {
    console.log("✅ No duplicate blockIds found across the vault.");
    return;
  }

  console.warn(`⚠️  Found ${reports.length} note(s) with duplicate blockIds:`);
  console.table(
    reports.map((r) => ({
      noteId: r.noteId,
      title: r.title,
      duplicateCount: r.duplicateBlockIds.length,
      totalExtraOccurrences: r.duplicateBlockIds.reduce(
        (sum, id) => sum + (r.occurrenceCounts[id] - 1),
        0
      ),
    }))
  );
  console.log("Full detail (per-note duplicate blockIds and counts):");
  console.log(reports);
}