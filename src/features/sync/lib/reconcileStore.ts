// src/features/sync/lib/reconcileStore.ts
//
// Stage 4d.3, batch 3 — local-only storage for reviews (design rev 2, sections
// 6.1 and 6.3). Two tables, both created by ALL_MIGRATIONS in schema.ts:
//
//   reconcile_backups  a copy of both versions, written before anything is
//                      committed or purged. Never synced. Survives the note
//                      being deleted (there is deliberately no foreign key).
//                      Retention: the last 5 per note and at most 30 days.
//   reconcile_choices  the user's decision per block, kept across restarts and
//                      reused only while the block still hashes the same on
//                      both sides. Keyed by user id so another account's
//                      choices are never applied.
//
// Functions take a minimal SqlDb so the same code runs against
// tauri-plugin-sql in the app (pass `await getDb()`) and better-sqlite3 in tests.

import type { ReconcileAction } from "@/features/notes/lib/reconcileSession";

export interface SqlDb {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

export const BACKUPS_PER_NOTE = 5;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type BackupKind = "merge" | "whole_note" | "purge";

export interface BackupInput {
  noteId: string;
  kind: BackupKind;
  hostedRevision: number | null;
  mineTitle: string | null;
  mineContent: string | null;
  theirsTitle: string | null;
  theirsContent: string | null;
}

export interface BackupRow {
  id: string;
  note_id: string;
  kind: BackupKind;
  created_at: number;
  hosted_revision: number | null;
  mine_title: string | null;
  mine_content: string | null;
  theirs_title: string | null;
  theirs_content: string | null;
}

/** Writes a backup, then trims that note's backups to the newest BACKUPS_PER_NOTE. Returns the backup id. */
export async function writeBackup(db: SqlDb, input: BackupInput, now = Date.now()): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO reconcile_backups
       (id, note_id, kind, created_at, hosted_revision, mine_title, mine_content, theirs_title, theirs_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.noteId,
      input.kind,
      now,
      input.hostedRevision,
      input.mineTitle,
      input.mineContent,
      input.theirsTitle,
      input.theirsContent,
    ]
  );
  await db.execute(
    `DELETE FROM reconcile_backups
     WHERE note_id = $1
       AND id NOT IN (
         SELECT id FROM reconcile_backups WHERE note_id = $1
         ORDER BY created_at DESC, rowid DESC LIMIT $2
       )`,
    [input.noteId, BACKUPS_PER_NOTE]
  );
  return id;
}

export async function listBackups(db: SqlDb, noteId: string): Promise<BackupRow[]> {
  return db.select<BackupRow[]>(
    `SELECT id, note_id, kind, created_at, hosted_revision, mine_title, mine_content, theirs_title, theirs_content
     FROM reconcile_backups WHERE note_id = $1 ORDER BY created_at DESC, rowid DESC`,
    [noteId]
  );
}

export interface ChoiceItem {
  blockId: string;
  mine?: { hash: string };
  theirs?: { hash: string };
}

export async function saveChoice(
  db: SqlDb,
  userId: string,
  noteId: string,
  item: ChoiceItem,
  action: ReconcileAction,
  now = Date.now()
): Promise<void> {
  await db.execute(
    `INSERT INTO reconcile_choices (user_id, note_id, block_id, mine_hash, theirs_hash, action, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(user_id, note_id, block_id) DO UPDATE SET
       mine_hash = excluded.mine_hash,
       theirs_hash = excluded.theirs_hash,
       action = excluded.action,
       created_at = excluded.created_at`,
    [userId, noteId, item.blockId, item.mine?.hash ?? "", item.theirs?.hash ?? "", action, now]
  );
}

/**
 * Saved choices that still apply: a choice is returned only when the block's
 * hash on BOTH sides is unchanged since it was made. Anything else is ignored
 * (and stays in the table until pruned or the review is committed).
 */
export async function loadChoices(
  db: SqlDb,
  userId: string,
  noteId: string,
  items: ChoiceItem[]
): Promise<Record<string, ReconcileAction>> {
  const rows = await db.select<
    Array<{ block_id: string; mine_hash: string; theirs_hash: string; action: ReconcileAction }>
  >(`SELECT block_id, mine_hash, theirs_hash, action FROM reconcile_choices WHERE user_id = $1 AND note_id = $2`, [
    userId,
    noteId,
  ]);
  const byId = new Map(items.map((i) => [i.blockId, i]));
  const out: Record<string, ReconcileAction> = {};
  for (const r of rows) {
    const item = byId.get(r.block_id);
    if (!item) continue;
    if ((item.mine?.hash ?? "") === r.mine_hash && (item.theirs?.hash ?? "") === r.theirs_hash) {
      out[r.block_id] = r.action;
    }
  }
  return out;
}

export async function deleteChoices(db: SqlDb, userId: string, noteId: string): Promise<void> {
  await db.execute(`DELETE FROM reconcile_choices WHERE user_id = $1 AND note_id = $2`, [userId, noteId]);
}

/** Startup housekeeping: backups and choices older than the retention window. */
export async function pruneReconcileData(db: SqlDb, now = Date.now()): Promise<void> {
  const cutoff = now - RETENTION_MS;
  await db.execute(`DELETE FROM reconcile_backups WHERE created_at < $1`, [cutoff]);
  await db.execute(`DELETE FROM reconcile_choices WHERE created_at < $1`, [cutoff]);
}
