// src/features/sync/lib/dirtyScan.ts
//
// Finds notes whose local state differs from the last recorded sync point (or that
// have none) and that aren't already queued. Covers edits made while signed out,
// while the session couldn't be restored offline, and metadata-only edits.

import { getDb } from "@/features/notes/db/client";

export async function findDirtyNoteIds(limit = 50): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    `SELECT n.id
     FROM notes n
     LEFT JOIN note_sync_state s ON s.note_id = n.id
     LEFT JOIN sync_push_queue q ON q.note_id = n.id
     WHERE n.is_canvas = 0
       AND q.note_id IS NULL
       AND (s.note_id IS NULL
            OR n.revision   != s.synced_local_revision
            OR n.updated_at != s.synced_local_updated_at)
     ORDER BY n.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => r.id);
}