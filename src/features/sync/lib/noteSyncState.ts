// src/features/sync/lib/noteSyncState.ts
//
// Stage 4d.1 — local note_sync_state table access. One row per note: the local
// revision / updated_at / meta_rev and the hosted revision at which both sides
// were last known to be identical. This is the "base" pointer for three-way diffs.
// All functions throw on DB errors; callers decide how to handle them.

import { getDb } from "@/features/notes/db/client";

export interface NoteSyncState {
  noteId: string;
  localRevision: number;
  localUpdatedAt: number;
  serverRevision: number;
  metaRev: number;
}

export interface SyncedPoint {
  localRevision: number;
  localUpdatedAt: number;
  serverRevision: number;
  metaRev: number;
}

interface StateRow {
  note_id: string;
  synced_local_revision: number;
  synced_local_updated_at: number;
  synced_server_revision: number;
  synced_meta_rev: number;
}

const COLS = `note_id, synced_local_revision, synced_local_updated_at,
  synced_server_revision, synced_meta_rev`;

const toState = (r: StateRow): NoteSyncState => ({
  noteId: r.note_id,
  localRevision: r.synced_local_revision,
  localUpdatedAt: r.synced_local_updated_at,
  serverRevision: r.synced_server_revision,
  metaRev: r.synced_meta_rev,
});

export async function getSyncState(noteId: string): Promise<NoteSyncState | null> {
  const db = await getDb();
  const rows = await db.select<StateRow[]>(
    `SELECT ${COLS} FROM note_sync_state WHERE note_id = $1`,
    [noteId]
  );
  return rows[0] ? toState(rows[0]) : null;
}

export async function loadAllSyncStates(): Promise<Map<string, NoteSyncState>> {
  const db = await getDb();
  const rows = await db.select<StateRow[]>(`SELECT ${COLS} FROM note_sync_state`);
  return new Map(rows.map((r) => [r.note_id, toState(r)]));
}

export async function recordSynced(noteId: string, p: SyncedPoint): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO note_sync_state
       (note_id, synced_local_revision, synced_local_updated_at,
        synced_server_revision, synced_meta_rev, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(note_id) DO UPDATE SET
       synced_local_revision   = excluded.synced_local_revision,
       synced_local_updated_at = excluded.synced_local_updated_at,
       synced_server_revision  = excluded.synced_server_revision,
       synced_meta_rev         = excluded.synced_meta_rev,
       synced_at               = excluded.synced_at`,
    [noteId, p.localRevision, p.localUpdatedAt, p.serverRevision, p.metaRev, Date.now()]
  );
}

// Bulk insert-if-absent, used by seeding. Never overwrites an existing row.
export async function recordSyncedBulkIfAbsent(
  entries: Array<{ noteId: string } & SyncedPoint>
): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  const CHUNK = 100;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const params: Array<string | number> = [];
    const tuples = slice.map((e, j) => {
      const b = j * 6;
      params.push(e.noteId, e.localRevision, e.localUpdatedAt, e.serverRevision, e.metaRev, now);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
    });
    await db.execute(
      `INSERT OR IGNORE INTO note_sync_state
         (note_id, synced_local_revision, synced_local_updated_at,
          synced_server_revision, synced_meta_rev, synced_at)
       VALUES ${tuples.join(", ")}`,
      params
    );
  }
}