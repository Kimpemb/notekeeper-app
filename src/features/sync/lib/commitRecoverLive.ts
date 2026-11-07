// src/features/sync/lib/commitRecoverLive.ts
//
// Stage 4d.3, step 14.2b (part 2) — the live collaborators for commitRecover.ts.
// Everything that touches the real world (local SQLite, stores, indexer) lives
// here. commitRecover.ts and recoverPlan.ts stay pure and unit-tested.
//
// Reuses what the review commit already proved live: the local compare-and-swap
// UPDATE (buildLocalUpdate), the title side effects, the new-note insert
// (createCopy) and its follow-ups (finishCopy). No server call is made: the
// drain pushes a recovered note like any other edit or new note.
//
// Never import this file from a test: it reaches supabaseClient.

import { getDb } from "@/features/notes/db/client";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import {
  updateNote as dbUpdateNote,
  syncNoteBlocks,
  syncBacklinks,
  extractNoteLinkIdsFromJson,
} from "@/features/notes/db/queries";
import { writeBlockRevisionSnapshot } from "@/features/notes/lib/blockRevisioning";
import { tryLockNote } from "@/features/sync/lib/noteLock";
import { loadLocalNote } from "@/features/sync/lib/pushToHostedSync";
import { isNoteOpen } from "@/features/sync/lib/pullFromHostedSync";
import { writeBackup } from "@/features/sync/lib/reconcileStore";
import { generatePlaintextLive } from "@/features/sync/lib/reconcileDryRun";
import { buildLocalUpdate } from "@/features/sync/lib/localWriteSql";
import { createCopy, finishCopy } from "@/features/sync/lib/commitLive";
import { commitRecover } from "@/features/sync/lib/commitRecover";
import type { RecoverDeps, RecoverOutcome, RecoverRequest } from "@/features/sync/lib/commitRecover";
import type { RecoverLocalNote, RecoverReplacePlan } from "@/features/sync/lib/recoverPlan";

async function readLocal(noteId: string): Promise<RecoverLocalNote | null> {
  const row = await loadLocalNote(noteId);
  if (!row) return null;
  return {
    title: row.title,
    content: row.content,
    tags: row.tags,
    parent_id: row.parent_id,
    sort_order: row.sort_order,
    frontmatter: row.frontmatter,
    revision: row.revision,
    meta_rev: row.meta_rev,
    updated_at: row.updated_at,
  };
}

async function parentExists(parentId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(`SELECT id FROM notes WHERE id = $1`, [parentId]);
  return rows.length > 0;
}

async function writeLocal(
  noteId: string,
  fields: Parameters<RecoverDeps["writeLocal"]>[1],
  expected: Parameters<RecoverDeps["writeLocal"]>[2],
  expectedAfter: Parameters<RecoverDeps["writeLocal"]>[3]
): ReturnType<RecoverDeps["writeLocal"]> {
  const db = await getDb();
  const update = buildLocalUpdate(noteId, fields, expected);
  if (!update) return "ok";
  const res = await db.execute(update.sql, update.params);
  if (res.rowsAffected === 0) return "raced";

  // Same title side effects the pull and the review commit run. Writing the same
  // title again changes no revision or meta_rev.
  if (fields.title !== undefined) {
    try {
      await dbUpdateNote(noteId, { title: fields.title });
    } catch (err) {
      console.warn("[sync] recover: title side effects failed:", noteId, err);
    }
  }

  const after = await loadLocalNote(noteId);
  const verified =
    after !== null &&
    after.revision === expectedAfter.revision &&
    after.meta_rev === expectedAfter.metaRev &&
    after.updated_at === expectedAfter.updatedAt;
  return verified ? "ok" : "unverified";
}

/** Best-effort follow-ups after a replace. Never throws. */
async function finishReplace(noteId: string, plan: RecoverReplacePlan): Promise<void> {
  try {
    await writeBlockRevisionSnapshot(noteId, plan.content);
  } catch (err) {
    console.warn("[sync] recover: block snapshot failed:", noteId, err);
  }
  try {
    await syncBacklinks(noteId, extractNoteLinkIdsFromJson(plan.content));
  } catch (err) {
    console.warn("[sync] recover: backlinks failed:", noteId, err);
  }
  try {
    await useNoteStore.getState().refreshNote(noteId);
  } catch (err) {
    console.warn("[sync] recover: store refresh failed:", noteId, err);
  }
  if (useAIStore.getState().enabled) {
    try {
      await syncNoteBlocks(noteId, plan.content, "note", plan.title);
      nudgeIndexer();
    } catch (err) {
      console.warn("[sync] recover: embedding enqueue failed:", noteId, err);
    }
  }
}

export function liveRecoverDeps(): RecoverDeps {
  return {
    noteIsOpen: isNoteOpen,
    lock: (noteId) => tryLockNote(noteId, "reconcile"),
    readLocal,
    parentExists,
    writeBackup: async (input) => {
      await writeBackup(await getDb(), input);
    },
    writeLocal,
    insertNew: createCopy,
    finishReplace,
    finishNew: finishCopy,
    generatePlaintext: generatePlaintextLive,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
  };
}

/** The one call the Backups screen makes. Never throws for the failure cases commitRecover models. */
export function commitNoteRecover(req: RecoverRequest): Promise<RecoverOutcome> {
  return commitRecover(liveRecoverDeps(), req);
}
