// src/features/sync/lib/recoverView.ts
//
// Stage 4d.3, step 14.2c (part 1) — PURE view model for the Backups screen: how a
// backup row is described, which versions can be restored, and the plain-language
// text for what a recovery did. No DB, no network, no React, and no import that
// reaches supabaseClient (type-only imports and wholeNoteView are pure).

import { contentToLines } from "@/features/sync/lib/wholeNoteView";
import { availableSides, countMediaNodes, sideOf, type RecoverSide } from "@/features/sync/lib/recoverPlan";
import type { BackupKind, BackupRow } from "@/features/sync/lib/reconcileStore";
import type { OutcomeText } from "@/features/sync/lib/outcomeText";

export const PREVIEW_MAX_CHARS = 160;

export const KIND_LABEL: Record<BackupKind, string> = {
  merge: "Before a merge",
  whole_note: "Before a whole-note choice",
  purge: "Before a deletion",
  recover: "Before a restore",
};

export function backupKindLabel(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? "Backup";
}

export const SIDE_LABEL: Record<RecoverSide, string> = {
  mine: "This device's version",
  theirs: "The other device's version",
};

/** First text lines of a document, joined and cut to a short single-line preview. */
export function previewText(content: string, max = PREVIEW_MAX_CHARS): string {
  const joined = contentToLines(content)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");
  if (joined === "") return "(empty)";
  return joined.length <= max ? joined : joined.slice(0, max - 1).trimEnd() + "…";
}

export interface SideView {
  side: RecoverSide;
  label: string;
  title: string;
  preview: string;
  /** false for an older backup: a restore then uses defaults for folder, order and tags. */
  keptMetadata: boolean;
  mediaCount: number;
}

export interface BackupView {
  id: string;
  noteId: string;
  createdAt: number;
  kindLabel: string;
  sides: SideView[];
}

export function describeBackup(row: BackupRow): BackupView {
  const sides: SideView[] = availableSides(row).map((side) => {
    const data = sideOf(row, side);
    // availableSides only returns sides sideOf accepts, so data is set.
    const content = data?.content ?? "";
    return {
      side,
      label: SIDE_LABEL[side],
      title: (data?.title ?? "").trim() === "" ? "Untitled" : (data?.title ?? ""),
      preview: previewText(content),
      keptMetadata: data?.meta != null,
      mediaCount: countMediaNodes(content),
    };
  });
  return { id: row.id, noteId: row.note_id, createdAt: row.created_at, kindLabel: backupKindLabel(row.kind), sides };
}

export interface NoteBackups {
  noteId: string;
  /** Newest backup first, as listed. Backups with no restorable side are dropped. */
  backups: BackupView[];
  /** Newest backup time, for sorting the notes. */
  latest: number;
}

/** Groups rows by note, drops rows with nothing to restore, notes sorted newest first. */
export function groupBackups(rows: BackupRow[]): NoteBackups[] {
  const byNote = new Map<string, BackupView[]>();
  for (const row of rows) {
    const view = describeBackup(row);
    if (view.sides.length === 0) continue;
    const list = byNote.get(row.note_id) ?? [];
    list.push(view);
    byNote.set(row.note_id, list);
  }
  const out: NoteBackups[] = [];
  for (const [noteId, backups] of byNote) {
    backups.sort((a, b) => b.createdAt - a.createdAt);
    out.push({ noteId, backups, latest: backups[0].createdAt });
  }
  return out.sort((a, b) => b.latest - a.latest);
}

// ─── What a recovery did, in plain words ──────────────────────────────────

/** Loose structural type, so this file does not import commitRecover. */
export interface RecoverOutcomeLike {
  status: string;
  choice?: string;
  reason?: string;
  notes?: string[];
}

export interface RecoverOutcomeText extends OutcomeText {
  /** Extra lines to show under the sentence (warnings the plan raised). */
  notes: string[];
}

const PLAN_FAILED_TEXT: Record<string, string> = {
  side_empty: "That version has no text to restore, so nothing was changed.",
  bad_content: "The saved text could not be read, so nothing was changed.",
  note_missing: "This note no longer exists on this device, so it can only be restored as a new note.",
  nothing_to_change: "The note already matches this backup, so nothing was changed.",
};

const REFUSED_TEXT: Record<string, string> = {
  note_open: "This note is open in a tab. Close it, then try again. Nothing was changed.",
  busy: "This note is being synced right now. Try again in a moment. Nothing was changed.",
  read_failed: "The note could not be read, so nothing was changed. Try again.",
  backup_failed: "A backup of the current version could not be saved, so nothing was changed.",
};

export function describeRecoverOutcome(o: RecoverOutcomeLike): RecoverOutcomeText {
  const notes = o.notes ?? [];
  switch (o.status) {
    case "committed":
      return o.choice === "replace"
        ? {
            text: "Done. The note's title and text were replaced from the backup. A backup of the previous version was saved first, and the change will upload at the next sync.",
            tone: "success",
            changed: true,
            notes,
          }
        : {
            text: "Done. A new note was created from the backup, named with \"(restored)\" at the end. It will upload at the next sync.",
            tone: "success",
            changed: true,
            notes,
          };
    case "stale":
      return {
        text: "The note changed since you opened this screen, so nothing was changed. Check the note and try again.",
        tone: "warning",
        changed: false,
        notes,
      };
    case "refused":
      return {
        text: REFUSED_TEXT[o.reason ?? ""] ?? "Nothing was changed.",
        tone: "info",
        changed: false,
        notes,
        ...(o.reason === "note_open" ? { closeNote: true } : {}),
      };
    case "plan_failed":
      return {
        text: PLAN_FAILED_TEXT[o.reason ?? ""] ?? "Nothing was changed.",
        tone: "info",
        changed: false,
        notes,
      };
    case "local_failed":
      return {
        text: "Something went wrong while saving. Check the note before trying again.",
        tone: "error",
        changed: true,
        notes,
      };
    default:
      return { text: "Something unexpected happened. Check the note before trying again.", tone: "error", changed: true, notes };
  }
}
