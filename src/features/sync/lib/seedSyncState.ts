// src/features/sync/lib/seedSyncState.ts
//
// Stage 4d.1 — one-time (re-runnable) seeding of note_sync_state for notes that
// were uploaded before sync state existed. A note is seeded only when its hosted
// revision AND updated_at equal the local ones: before 4d.1 only this device
// pushed (verbatim stamps), so equality means identical content. Anything else
// is left unseeded and handled by decideSyncAction's no-base rules.
// Never overwrites an existing row.

import { getDb } from "@/features/notes/db/client";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { fetchRemoteNoteMap } from "@/features/sync/lib/remoteNotes";
import { recordSyncedBulkIfAbsent } from "@/features/sync/lib/noteSyncState";

export interface SeedSummary {
  checked: number; // unseeded local notes considered
  seeded: number;
}

export async function seedSyncStateFromRemote(): Promise<SeedSummary> {
  const session = useSyncStore.getState().session;
  if (!session) return { checked: 0, seeded: 0 };

  const db = await getDb();
  const unseeded = await db.select<
    { id: string; revision: number; meta_rev: number; updated_at: number }[]
  >(
    `SELECT n.id, n.revision, n.meta_rev, n.updated_at
     FROM notes n
     LEFT JOIN note_sync_state s ON s.note_id = n.id
     WHERE s.note_id IS NULL AND n.is_canvas = 0`
  );
  if (unseeded.length === 0) return { checked: 0, seeded: 0 };

  const remote = await fetchRemoteNoteMap(session.user.id);
  const entries = [];
  for (const row of unseeded) {
    const r = remote.get(row.id);
    if (r && r.revision === row.revision && r.updatedAt === row.updated_at) {
      entries.push({
        noteId: row.id,
        localRevision: row.revision,
        localUpdatedAt: row.updated_at,
        serverRevision: r.revision,
        metaRev: row.meta_rev,
      });
    }
  }
  await recordSyncedBulkIfAbsent(entries);
  return { checked: unseeded.length, seeded: entries.length };
}
