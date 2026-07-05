// src/features/backup/lib/backup.ts
//
// Orchestrates the full export and restore flows.
// Export: assemble → compress → encrypt → save as .nkbackup
// Restore: open file → decrypt → decompress → validate → restore to DB

export interface ExportResult {
  success:   boolean;
  noteCount: number;
  fileName:  string;
}

import type { Note } from "@/types";

export interface RestoreResult {
  success:   boolean;
  noteCount: number;
  notes:     Note[];
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportBackup(password: string): Promise<ExportResult> {
  if (!password.trim()) throw new Error("Password is required to create a backup.");

  const { encrypt }        = await import("@/features/backup/lib/crypto");
  const { assembleBundle } = await import("@/features/backup/lib/bundler");
  const { compress }       = await import("@/features/backup/lib/compression");
  const { saveBackupFile } = await import("@/lib/tauri/fs");

  const bundle     = await assembleBundle();
  const json       = JSON.stringify(bundle);
  const compressed = await compress(json);
  const encrypted  = await encrypt(compressed, password);

  const date     = new Date().toISOString().slice(0, 10);
  const fileName = `idemora-backup-${date}.nkbackup`;
  const saved    = await saveBackupFile(encrypted, fileName);

  if (!saved) throw new Error("Export cancelled.");

  return { success: true, noteCount: bundle.noteCount, fileName };
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export async function restoreBackup(password: string): Promise<RestoreResult> {
  if (!password.trim()) throw new Error("Password is required to restore a backup.");

  const { decrypt }                       = await import("@/features/backup/lib/crypto");
  const { validateBundle, restoreBundle } = await import("@/features/backup/lib/bundler");
  const { decompress }                    = await import("@/features/backup/lib/compression");
  const { openBackupFile }                = await import("@/lib/tauri/fs");

  const encrypted = await openBackupFile();
  if (!encrypted) throw new Error("No file selected.");

  let compressed: Uint8Array<ArrayBuffer>;
  try {
    compressed = await decrypt(encrypted, password);
  } catch {
    throw new Error("Incorrect password or corrupted backup file.");
  }

  let json: string;
  try {
    json = await decompress(compressed);
  } catch {
    throw new Error("Backup file is corrupted and could not be decompressed.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Backup file is corrupted and could not be read.");
  }

  const bundle = validateBundle(raw);
  const restoredNotes = await restoreBundle(bundle);

  return { success: true, noteCount: bundle.noteCount, notes: restoredNotes };
}