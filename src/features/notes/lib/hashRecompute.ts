// src/features/notes/lib/hashRecompute.ts
import { getDb } from "@/features/notes/db/client";
import { hashBlockContent } from "./blockRevisioning";

export async function recomputeAllHashes(dryRun = true) {
  const db = await getDb();
  const rows = await db.select<{ note_id: string; revision: number; block_id: string; content: string; content_hash: string | null }[]>(
    "SELECT note_id, revision, block_id, content, content_hash FROM block_revision_snapshots"
  );

  let changed = 0;
  for (const row of rows) {
    const newHash = await hashBlockContent(row.content);
    if (newHash !== row.content_hash) {
      changed++;
      if (!dryRun) {
        await db.execute(
          "UPDATE block_revision_snapshots SET content_hash = $1 WHERE note_id = $2 AND revision = $3 AND block_id = $4",
          [newHash, row.note_id, row.revision, row.block_id]
        );
      }
    }
  }
  console.log(`${changed} of ${rows.length} rows would change${dryRun ? " (dry run)" : " — updated"}`);
  return { total: rows.length, changed };
}