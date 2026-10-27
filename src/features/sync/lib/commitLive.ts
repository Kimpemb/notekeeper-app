// src/features/sync/lib/commitLive.ts
//
// Stage 4d.3, batch 3b — the live wiring for commitReview.ts. Everything that
// touches the real world (hosted Supabase, local SQLite, stores, indexer) lives
// here; commitReview.ts and commitPlan.ts stay pure and unit-tested.
//
// Mirrors the pull's proven techniques: local compare-and-swap on
// (revision, meta_rev, updated_at), then read back and verify what the triggers
// must have produced; title / trash side effects as the pull does them.
//
// Never import this file from a test: it reaches supabaseClient.

import { getDb } from "@/features/notes/db/client";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import {
  updateNote as dbUpdateNote,
  syncNoteBlocks,
  syncBacklinks,
  extractNoteLinkIdsFromJson,
  getAllNotes,
  getTrashedNotes,
} from "@/features/notes/db/queries";
import { writeBlockRevisionSnapshot } from "@/features/notes/lib/blockRevisioning";
import { tryLockNote } from "@/features/sync/lib/noteLock";
import { loadLocalNote, finishPush } from "@/features/sync/lib/pushToHostedSync";
import { isNoteOpen } from "@/features/sync/lib/pullFromHostedSync";
import { buildSyncReview } from "@/features/sync/lib/syncReview";
import { writeBackup, deleteChoices } from "@/features/sync/lib/reconcileStore";
import { generatePlaintextLive } from "@/features/sync/lib/reconcileDryRun";
import { commitReview } from "@/features/sync/lib/commitReview";
import type {
  CommitDeps,
  CommitOutcome,
  CommitRequest,
  HostedSnapshot,
  LocalWriteResult,
  PlanContext,
  PushOutcome,
  RecordArgs,
  Stamp,
} from "@/features/sync/lib/commitReview";
import type { LocalFields, ServerFields } from "@/features/sync/lib/commitPlan";
import { buildLocalUpdate } from "@/features/sync/lib/localWriteSql";

const HOSTED_COLUMNS =
  "revision, title, content, plaintext, tags, parent_id, sort_order, frontmatter, deleted_at, purged_at";

interface HostedFull {
  revision: number;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number | null;
  frontmatter: string | null;
  deleted_at: string | null;
  purged_at: string | null;
}

// ─── Collaborators ────────────────────────────────────────────────────────

async function planContext(review: Parameters<CommitDeps["planContext"]>[0]): Promise<PlanContext> {
  let parentExistsLocally = true;
  const hostedParent = review.remote.parentId;
  if (hostedParent) {
    const db = await getDb();
    const rows = await db.select<{ id: string }[]>(`SELECT id FROM notes WHERE id = $1`, [hostedParent]);
    parentExistsLocally = rows.length > 0;
  }
  const generated = generatePlaintextLive(review.mineContent);
  return {
    parentExistsLocally,
    storedMatchedGeneratedBefore: generated !== null && generated === review.mine.plaintext,
    generatePlaintext: generatePlaintextLive,
  };
}

async function pushMerged(noteId: string, fields: ServerFields, expectedRevision: number): Promise<PushOutcome> {
  const { data, error } = await supabase
    .from("notes")
    .update({ ...fields, revision: expectedRevision + 1 })
    .eq("id", noteId)
    .eq("revision", expectedRevision)
    .is("purged_at", null)
    .select("id");
  if (error) throw new Error(`merged push failed (${error.code ?? "?"}): ${error.message}`);
  return (data?.length ?? 0) > 0 ? { kind: "won" } : { kind: "zero_rows" };
}

async function fetchHosted(noteId: string): Promise<HostedSnapshot> {
  const { data, error } = await supabase.from("notes").select(HOSTED_COLUMNS).eq("id", noteId).maybeSingle();
  if (error) throw new Error(`hosted fetch failed (${error.code ?? "?"}): ${error.message}`);
  const row = data as HostedFull | null;
  if (!row) return { kind: "missing" };
  if (row.purged_at != null) return { kind: "purged" };
  return {
    kind: "row",
    revision: row.revision,
    title: row.title,
    content: row.content,
    plaintext: row.plaintext,
    tags: row.tags,
    parent_id: row.parent_id,
    sort_order: row.sort_order,
    frontmatter: row.frontmatter,
    deleted_at: row.deleted_at,
  };
}

async function writeLocal(
  noteId: string,
  fields: LocalFields,
  expected: Stamp,
  expectedAfter: Stamp
): Promise<LocalWriteResult> {
  const db = await getDb();

  const update = buildLocalUpdate(noteId, fields, expected);
  if (!update) return { kind: "ok" };
  const res = await db.execute(update.sql, update.params);
  if (res.rowsAffected === 0) return { kind: "raced" };

  // Same side effects the pull runs. Writing the same title again changes no
  // revision or meta_rev; it only runs dbUpdateNote's side effects.
  if (fields.title !== undefined) {
    try {
      await dbUpdateNote(noteId, { title: fields.title });
    } catch (err) {
      console.warn("[sync] commit: title side effects failed:", noteId, err);
    }
  }
  // A trashed note has no title chunk.
  if (fields.deleted_at !== undefined && fields.deleted_at !== null) {
    try {
      await db.execute(`DELETE FROM note_title_chunks WHERE note_id = $1`, [noteId]);
    } catch (err) {
      console.warn("[sync] commit: title chunk cleanup failed:", noteId, err);
    }
  }

  const after = await loadLocalNote(noteId);
  const verified =
    after !== null &&
    after.revision === expectedAfter.revision &&
    after.meta_rev === expectedAfter.metaRev &&
    after.updated_at === expectedAfter.updatedAt;
  return verified ? { kind: "ok" } : { kind: "unverified" };
}

/**
 * Throws ONLY when the sync state could not be recorded (the part that makes the
 * next check correct). Everything after that is best-effort.
 */
async function record({ noteId, plan, newServerRevision }: RecordArgs): Promise<void> {
  const row = await loadLocalNote(noteId);
  if (!row) throw new Error("local note missing after commit");

  // Local base snapshot first, so finishPush can upload it with the sync state.
  try {
    await writeBlockRevisionSnapshot(noteId, row.content);
  } catch (err) {
    console.warn("[sync] commit: block snapshot failed:", noteId, err);
  }

  // Records sync state, clears the queue row, uploads snapshots best-effort.
  await finishPush(row, newServerRevision);

  // From here on nothing may throw: both writes and the sync state are done.
  const session = useSyncStore.getState().session;
  if (session) {
    try {
      await deleteChoices(await getDb(), session.user.id, noteId);
    } catch (err) {
      console.warn("[sync] commit: could not delete saved choices:", noteId, err);
    }
  }

  try {
    await useNoteStore.getState().refreshNote(noteId);
    if (plan.trashChange) {
      const [notes, trashedNotes] = await Promise.all([getAllNotes(), getTrashedNotes()]);
      useNoteStore.setState({ notes, trashedNotes });
    }
  } catch (err) {
    console.warn("[sync] commit: store refresh failed:", noteId, err);
  }

  if (plan.reindex) {
    try {
      await syncBacklinks(noteId, extractNoteLinkIdsFromJson(row.content));
    } catch (err) {
      console.warn("[sync] commit: backlinks failed:", noteId, err);
    }
  }

  if ((plan.reindex || plan.trashChange === "restored") && useAIStore.getState().enabled) {
    try {
      await syncNoteBlocks(noteId, row.content, "note", plan.trashChange === "restored" ? row.title : undefined);
      nudgeIndexer();
    } catch (err) {
      console.warn("[sync] commit: embedding enqueue failed:", noteId, err);
    }
  }
}

// ─── Public entry points ──────────────────────────────────────────────────

export function liveCommitDeps(): CommitDeps {
  return {
    noteIsOpen: isNoteOpen,
    lock: (noteId) => tryLockNote(noteId, "reconcile"),
    rebuild: async (noteId) => {
      const built = await buildSyncReview(noteId);
      return built.ok ? { ok: true, review: built.review } : { ok: false, reason: built.reason };
    },
    planContext,
    writeBackup: async (input) => {
      await writeBackup(await getDb(), input);
    },
    pushMerged,
    fetchHosted,
    writeLocal,
    record,
    now: () => Date.now(),
  };
}

/** The one call the UI makes. Never throws for the failure cases commitReview models. */
export function commitNoteReview(req: CommitRequest): Promise<CommitOutcome> {
  return commitReview(liveCommitDeps(), req);
}
