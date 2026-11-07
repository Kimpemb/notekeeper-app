// src/features/sync/lib/backupsLive.ts
//
// Stage 4d.3, step 14.2c (part 2) — the live half of the Backups screen: reads
// every backup with its note's current title and stamp, and runs one recovery.
// The rules live in recoverView.ts (pure) and commitRecover.ts (pure); the real
// collaborators are in commitRecoverLive.ts.
//
// Never import this file from a test: it reaches supabaseClient.

import { getDb } from "@/features/notes/db/client";
import { listAllBackups, type BackupRow } from "@/features/sync/lib/reconcileStore";
import { groupBackups, describeRecoverOutcome, type NoteBackups, type RecoverOutcomeText } from "@/features/sync/lib/recoverView";
import { commitNoteRecover } from "@/features/sync/lib/commitRecoverLive";
import type { RecoverChoice, RecoverSide } from "@/features/sync/lib/recoverPlan";
import type { RecoverStamp } from "@/features/sync/lib/commitRecover";

export interface BackupNote {
  noteId: string;
  /** The note's current title, or the newest backup's title when the note is gone. */
  title: string;
  /** false when the note no longer exists on this device: only "restore as a new note" works. */
  exists: boolean;
  /** The note as it is now; passed back on Replace so a change in between is caught. */
  stamp: RecoverStamp | null;
  group: NoteBackups;
}

export type BackupsOverview =
  | { ok: true; notes: BackupNote[]; rows: Map<string, BackupRow> }
  | { ok: false; message: string };

interface NoteHead {
  id: string;
  title: string;
  revision: number;
  meta_rev: number;
  updated_at: number;
}

export async function loadBackupsOverview(): Promise<BackupsOverview> {
  try {
    const db = await getDb();
    const rows = await listAllBackups(db);
    const groups = groupBackups(rows);
    if (groups.length === 0) return { ok: true, notes: [], rows: new Map() };

    // One query for every note that has a backup. No content is loaded.
    const heads = await db.select<NoteHead[]>(
      `SELECT id, title, revision, meta_rev, updated_at FROM notes
       WHERE id IN (SELECT DISTINCT note_id FROM reconcile_backups)`
    );
    const byId = new Map(heads.map((h) => [h.id, h]));

    const notes: BackupNote[] = groups.map((group) => {
      const head = byId.get(group.noteId);
      const firstTitle = group.backups[0]?.sides[0]?.title ?? "Untitled";
      return {
        noteId: group.noteId,
        title: head ? (head.title.trim() === "" ? "Untitled" : head.title) : firstTitle,
        exists: !!head,
        stamp: head ? { revision: head.revision, metaRev: head.meta_rev, updatedAt: head.updated_at } : null,
        group,
      };
    });
    return { ok: true, notes, rows: new Map(rows.map((r) => [r.id, r])) };
  } catch (err) {
    return { ok: false, message: `Backups could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** One recovery. Never throws: an unexpected error becomes an error text that says to check the note. */
export async function runRecover(
  overview: Extract<BackupsOverview, { ok: true }>,
  note: BackupNote,
  backupId: string,
  side: RecoverSide,
  choice: RecoverChoice
): Promise<RecoverOutcomeText> {
  const row = overview.rows.get(backupId);
  if (!row) {
    return { text: "That backup is no longer there, so nothing was changed. Reopen the list.", tone: "info", changed: false, notes: [] };
  }
  try {
    const outcome = await commitNoteRecover({
      row,
      side,
      choice,
      reviewedLocalStamp: choice === "replace" && note.stamp ? note.stamp : undefined,
    });
    return describeRecoverOutcome(outcome);
  } catch (err) {
    return {
      text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}. Check the note before trying again.`,
      tone: "error",
      changed: true,
      notes: [],
    };
  }
}
