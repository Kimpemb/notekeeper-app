// src/features/backup/lib/bundler.ts
//
// Assembles the full backup bundle from the DB and validates it on restore.
// The app signature ensures the bundle is only restorable in Idemora.
//
// All DB imports are lazy (inside functions) to avoid circular dependencies
// with queries.ts at module load time.
console.log("bundler.ts loading");
import type { Note, Backlink } from "@/types";

// ─── Bundle shape ─────────────────────────────────────────────────────────────

export interface BackupBundle {
  app:       "idemora";
  version:   string;
  createdAt: number;
  noteCount: number;
  notes:     Note[];
  backlinks: Backlink[];
  settings:  Record<string, string>;
}

// ─── Settings keys to include in backup ───────────────────────────────────────
// Excludes AI key for security — user should re-enter their own key after restore.

const BACKUP_SETTING_KEYS = [
  "app_settings_v1",
  "pinned_ids",
];

// ─── Assembler ────────────────────────────────────────────────────────────────

/**
 * Reads all vault data from the DB and assembles a BackupBundle.
 * Called before encryption during export.
 */
export async function assembleBundle(): Promise<BackupBundle> {
  const { getAllNotes, getAllBacklinks, getSetting } = await import("@/features/notes/db/queries");

  const [notes, backlinks] = await Promise.all([
    getAllNotes(),
    getAllBacklinks(),
  ]);

  const settings: Record<string, string> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const value = await getSetting(key);
    if (value !== null) settings[key] = value;
  }

  return {
    app:       "idemora",
    version:   "1.0",
    createdAt: Date.now(),
    noteCount: notes.length,
    notes,
    backlinks,
    settings,
  };
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validates a parsed bundle before restore.
 * Throws a descriptive error if anything is wrong.
 */
export function validateBundle(raw: unknown): BackupBundle {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid backup file — not a valid bundle.");
  }

  const bundle = raw as Record<string, unknown>;

  if (bundle.app !== "idemora") {
    throw new Error("This backup was not created by Idemora and cannot be restored.");
  }

  if (typeof bundle.version !== "string") {
    throw new Error("Invalid backup file — missing version.");
  }

  if (!Array.isArray(bundle.notes)) {
    throw new Error("Invalid backup file — notes data is missing or corrupt.");
  }

  if (!Array.isArray(bundle.backlinks)) {
    throw new Error("Invalid backup file — backlinks data is missing or corrupt.");
  }

  return bundle as unknown as BackupBundle;
}

// ─── Restorer ─────────────────────────────────────────────────────────────────

/**
 * Writes a validated bundle back to the DB.
 * Notes are restored with overwrite (ON CONFLICT → UPDATE).
 * Settings are restored selectively — AI key is never overwritten.
 */
export async function restoreBundle(bundle: BackupBundle): Promise<Note[]> {
  const { importNotesOverwrite, setSetting } = await import("@/features/notes/db/queries");
  const { getDb } = await import("@/features/notes/db/client");

  // ── Restore notes ─────────────────────────────────────────────────────────
  const restoredNotes = await importNotesOverwrite(JSON.stringify(bundle.notes));

  // ── Restore backlinks ─────────────────────────────────────────────────────
  const db = await getDb();
  await db.execute(`DELETE FROM backlinks`);
  for (const bl of bundle.backlinks) {
    await db.execute(
      `INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES ($1, $2)`,
      [bl.source_id, bl.target_id]
    );
  }

  // ── Restore settings (selective) ──────────────────────────────────────────
  for (const [key, value] of Object.entries(bundle.settings)) {
    if (BACKUP_SETTING_KEYS.includes(key)) {
      await setSetting(key, value);
    }
  }

  return restoredNotes;
}