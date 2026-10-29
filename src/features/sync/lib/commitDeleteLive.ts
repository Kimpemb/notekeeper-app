// src/features/sync/lib/commitDeleteLive.ts
//
// Stage 4d.3, step 10 — the live wiring for commitDelete.ts. Everything that
// touches the real world (hosted Supabase, local SQLite, stores, indexer) lives
// here; deleteReviewPlan.ts and commitDelete.ts stay pure and unit-tested.
//
// Decisions made here (not in the pure files):
//   * D2 "let go" deletes with a plain compare-and-swap DELETE, NOT deleteNoteOnly:
//     that also deletes the note's image files, which would break "Recover from
//     backup" later. Orphaned image files are a disk leak, not data loss.
//   * D1 "keep it" restores the note unpublished and without fork fields: a purge
//     already destroyed publish state, and nothing in the app writes it today.
//
// Never import this file from a test: it reaches supabaseClient.

import { getDb } from "@/features/notes/db/client";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import {
  syncNoteBlocks,
  syncBacklinks,
  extractNoteLinkIdsFromJson,
  getAllNotes,
  getTrashedNotes,
} from "@/features/notes/db/queries";
import { writeBlockRevisionSnapshot } from "@/features/notes/lib/blockRevisioning";
import { tryLockNote } from "@/features/sync/lib/noteLock";
import { loadLocalNote, finishPush, ensureAncestors } from "@/features/sync/lib/pushToHostedSync";
import { isNoteOpen } from "@/features/sync/lib/pullFromHostedSync";
import { writeBackup } from "@/features/sync/lib/reconcileStore";
import { recordSynced } from "@/features/sync/lib/noteSyncState";
import {
  DOWNLOAD_LOCAL_META_REV,
  DOWNLOAD_LOCAL_REVISION,
  INSERT_DOWNLOADED_NOTE_SQL,
  remoteRowToInsertParams,
} from "@/features/sync/lib/downloadRow";
import { commitDelete } from "@/features/sync/lib/commitDelete";
import type { DeleteDeps, DeleteOutcome, DeleteRequest, LocalStamp } from "@/features/sync/lib/commitDelete";
import type { D1Hosted, D1Insert, D1Plan, D2Hosted, D2Plan, D2ServerFields } from "@/features/sync/lib/deleteReviewPlan";

const HOSTED_COLUMNS =
  "revision, title, content, plaintext, tags, parent_id, sort_order, frontmatter, created_at, updated_at, deleted_at, purged_at";

interface HostedFullRow {
  revision: number;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number | null;
  frontmatter: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  purged_at: string | null;
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ─── Hosted reads ─────────────────────────────────────────────────────────

async function fetchHostedFull(noteId: string): Promise<HostedFullRow | null> {
  const { data, error } = await supabase.from("notes").select(HOSTED_COLUMNS).eq("id", noteId).maybeSingle();
  if (error) throw new Error(`hosted fetch failed (${error.code ?? "?"}): ${error.message}`);
  return (data as HostedFullRow | null) ?? null;
}

async function fetchD1Hosted(noteId: string): Promise<D1Hosted> {
  const row = await fetchHostedFull(noteId);
  if (!row) return { kind: "missing" };
  if (row.purged_at != null) return { kind: "purged", revision: row.revision };
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };
}

async function fetchD2Hosted(noteId: string): Promise<D2Hosted> {
  const row = await fetchHostedFull(noteId);
  if (!row) return { kind: "missing" };
  return row.purged_at != null ? { kind: "purged", revision: row.revision } : { kind: "row", revision: row.revision };
}

// ─── Reads for the two cases ──────────────────────────────────────────────

const readD1: DeleteDeps["readD1"] = async (noteId) => {
  try {
    const db = await getDb();
    const tomb = await db.select<Array<{ synced_server_revision: number; state: string }>>(
      `SELECT synced_server_revision, state FROM note_tombstones WHERE note_id = $1`,
      [noteId]
    );
    if (tomb.length === 0) return { ok: false, reason: "no tombstone for this note" };
    const local = await db.select<Array<{ id: string }>>(`SELECT id FROM notes WHERE id = $1`, [noteId]);
    const hosted = await fetchD1Hosted(noteId);
    let parentExistsLocally = true;
    if (hosted.kind === "row" && hosted.parent_id) {
      const p = await db.select<Array<{ id: string }>>(`SELECT id FROM notes WHERE id = $1`, [hosted.parent_id]);
      parentExistsLocally = p.length > 0;
    }
    return {
      ok: true,
      input: {
        tombstone: {
          state: tomb[0].state === "conflict" ? "conflict" : "pending",
          serverRevision: tomb[0].synced_server_revision,
        },
        localPresent: local.length > 0,
        hosted,
        parentExistsLocally,
      },
    };
  } catch (err) {
    return { ok: false, reason: msg(err) };
  }
};

const readD2: DeleteDeps["readD2"] = async (noteId) => {
  try {
    const row = await loadLocalNote(noteId);
    if (!row) return { ok: false, reason: "local note missing" };
    const hosted = await fetchD2Hosted(noteId);
    return {
      ok: true,
      input: {
        local: {
          title: row.title,
          content: row.content,
          plaintext: row.plaintext,
          tags: row.tags,
          parent_id: row.parent_id,
          sort_order: row.sort_order,
          frontmatter: row.frontmatter,
          deleted_at: row.deleted_at,
          updated_at: row.updated_at,
          revision: row.revision,
          meta_rev: row.meta_rev,
        },
        hosted,
      },
    };
  } catch (err) {
    return { ok: false, reason: msg(err) };
  }
};

// ─── D1 collaborators ─────────────────────────────────────────────────────

/** Same insert the pull uses; verified by reading it back. Throws on any failure. */
async function insertLocal(ins: D1Insert): Promise<void> {
  const db = await getDb();
  const iso = (ms: number): string => new Date(ms).toISOString();
  const params = remoteRowToInsertParams(
    {
      id: ins.noteId,
      title: ins.title,
      content: ins.content,
      plaintext: ins.plaintext,
      tags: ins.tags,
      parent_id: ins.parentId,
      sort_order: ins.sortOrder,
      frontmatter: ins.frontmatter,
      created_at: iso(ins.createdAt),
      updated_at: iso(ins.updatedAt),
      deleted_at: ins.deletedAt === null ? null : iso(ins.deletedAt),
      revision: DOWNLOAD_LOCAL_REVISION, // not used: the insert stores the local constants
      is_published: false,
      publish_visibility: null,
      publish_token: null,
      forked_from_note_id: null,
      forked_from_owner_id: null,
      fork_base_revision: null,
    },
    ins.parentId,
    crypto.randomUUID()
  );
  const res = await db.execute(INSERT_DOWNLOADED_NOTE_SQL, params);
  if (res.rowsAffected === 0) throw new Error("note was not inserted (id clash)");
  const after = await db.select<Array<{ revision: number; meta_rev: number; updated_at: number }>>(
    `SELECT revision, meta_rev, updated_at FROM notes WHERE id = $1`,
    [ins.noteId]
  );
  const a = after[0];
  if (
    !a ||
    a.revision !== DOWNLOAD_LOCAL_REVISION ||
    a.meta_rev !== DOWNLOAD_LOCAL_META_REV ||
    a.updated_at !== ins.updatedAt
  ) {
    throw new Error("restored note read-back mismatch");
  }
}

/** Only used before any sync state exists, so the delete trigger records nothing. */
async function removeInserted(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM notes WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM note_sync_state WHERE note_id = $1)`,
    [noteId]
  );
}

async function finishRestored(noteId: string, ins: D1Insert): Promise<void> {
  try {
    await writeBlockRevisionSnapshot(noteId, ins.content);
  } catch (err) {
    console.warn("[sync] delete review: block snapshot failed:", noteId, err);
  }
  try {
    await syncBacklinks(noteId, extractNoteLinkIdsFromJson(ins.content));
  } catch (err) {
    console.warn("[sync] delete review: backlinks failed:", noteId, err);
  }
  if (useAIStore.getState().enabled && ins.deletedAt === null) {
    try {
      await syncNoteBlocks(noteId, ins.content, "note", ins.title);
      nudgeIndexer();
    } catch (err) {
      console.warn("[sync] delete review: embedding enqueue failed:", noteId, err);
    }
  }
  await refreshLists(noteId);
}

async function refreshLists(noteId: string): Promise<void> {
  try {
    const [notes, trashedNotes] = await Promise.all([getAllNotes(), getTrashedNotes()]);
    useNoteStore.setState({ notes, trashedNotes });
  } catch (err) {
    console.warn("[sync] delete review: list refresh failed:", noteId, err);
  }
}

/** Throws ONLY if the sync state could not be recorded; the follow-up is best-effort. */
async function recordD1(noteId: string, plan: D1Plan): Promise<void> {
  const s = plan.syncedAfter;
  if (!s || !plan.insert) throw new Error("keep_it plan has no sync state");
  await recordSynced(noteId, {
    localRevision: s.localRevision,
    localUpdatedAt: s.localUpdatedAt,
    serverRevision: s.serverRevision,
    metaRev: s.metaRev,
  });
  await finishRestored(noteId, plan.insert);
}

async function clearTombstone(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM note_tombstones WHERE note_id = $1`, [noteId]);
}

async function purgeHosted(noteId: string, expectedRevision: number): Promise<"won" | "zero_rows"> {
  const { data, error } = await supabase.rpc("purge_note", { p_id: noteId, p_expected_revision: expectedRevision });
  if (error) throw new Error(`purge_note failed (${error.code ?? "?"}): ${error.message}`);
  return data == null ? "zero_rows" : "won";
}

// ─── D2 collaborators ─────────────────────────────────────────────────────

async function ensureAncestorsLive(noteId: string, _parentId: string): Promise<void> {
  const session = useSyncStore.getState().session;
  if (!session) throw new Error("not signed in");
  const row = await loadLocalNote(noteId);
  if (!row) throw new Error("local note missing");
  await ensureAncestors(row, session.user.id);
}

/** Compare-and-swap on the PURGED row: revision as read AND purged_at still set. */
async function unpurgeHosted(
  noteId: string,
  fields: D2ServerFields,
  expectedPurgedRevision: number
): Promise<"won" | "zero_rows"> {
  const { data, error } = await supabase
    .from("notes")
    .update({ ...fields, revision: expectedPurgedRevision + 1 })
    .eq("id", noteId)
    .eq("revision", expectedPurgedRevision)
    .not("purged_at", "is", null)
    .select("id");
  if (error) throw new Error(`un-purge failed (${error.code ?? "?"}): ${error.message}`);
  return (data?.length ?? 0) > 0 ? "won" : "zero_rows";
}

/** Throws ONLY if the sync state could not be recorded (finishPush at the new hosted revision). */
async function recordD2KeepMine(noteId: string, plan: D2Plan): Promise<void> {
  if (plan.serverRevisionAfter === null) throw new Error("keep_mine plan has no hosted revision");
  const row = await loadLocalNote(noteId);
  if (!row) throw new Error("local note missing after un-purge");
  try {
    await writeBlockRevisionSnapshot(noteId, row.content);
  } catch (err) {
    console.warn("[sync] delete review: block snapshot failed:", noteId, err);
  }
  await finishPush(row, plan.serverRevisionAfter);
}

/** Compare-and-swap DELETE: the row must still carry the stamp the user reviewed. */
async function deleteLocal(noteId: string, s: LocalStamp): Promise<"deleted" | "raced"> {
  const db = await getDb();
  const res = await db.execute(
    `DELETE FROM notes WHERE id = $1 AND revision = $2 AND meta_rev = $3 AND updated_at = $4`,
    [noteId, s.revision, s.metaRev, s.updatedAt]
  );
  if (res.rowsAffected === 0) return "raced";
  await refreshLists(noteId);
  return "deleted";
}

// ─── Public entry points ──────────────────────────────────────────────────

export function liveDeleteDeps(): DeleteDeps {
  return {
    signedIn: () => useSyncStore.getState().session != null,
    noteIsOpen: isNoteOpen,
    lock: (noteId) => tryLockNote(noteId, "reconcile"),
    readD1,
    readD2,
    writeBackup: async (input) => {
      await writeBackup(await getDb(), input);
    },
    insertLocal,
    removeInserted,
    recordD1,
    clearTombstone,
    purgeHosted,
    ensureAncestors: ensureAncestorsLive,
    unpurgeHosted,
    fetchHostedState: fetchD2Hosted,
    recordD2KeepMine,
    deleteLocal,
    now: () => Date.now(),
  };
}

/** The one call the UI makes. Never throws for the failure cases commitDelete models. */
export function commitNoteDelete(req: DeleteRequest): Promise<DeleteOutcome> {
  return commitDelete(liveDeleteDeps(), req);
}
