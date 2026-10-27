// src/features/sync/lib/pullFromHostedSync.ts
//
// Stage 4d.2 — pull-down (fast-forward only). When the hosted copy of a note has
// moved and this device hasn't touched it since the last agreement ("behind"),
// write the hosted state locally and record the new agreement point.
//
// Safety rules:
//   - skip notes open in any tab (the editor has no external-update path for
//     dirty content; retried on the next drain once closed)
//   - one lock per note, shared with push (noteLock.ts)
//   - the local write is compare-and-swap on (revision, meta_rev, updated_at), so
//     a save that lands mid-pull makes the pull abort instead of overwriting it
//   - notes whose deleted state differs, or whose parent doesn't exist locally,
//     are left alone (tombstone design / 4d.5)
//   - "diverged" notes are never touched here (4d.3)
// Never throws to callers.

import { getDb } from "@/features/notes/db/client";
import { supabase, isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import {
  updateNote as dbUpdateNote,
  syncNoteBlocks,
  deleteNoteOnly,
  getAllNotes,
  getTrashedNotes,
} from "@/features/notes/db/queries";import { decideDeleteAction } from "@/features/sync/lib/deleteDecision";
import { writeBlockRevisionSnapshot } from "@/features/notes/lib/blockRevisioning";
import { getSyncState, loadAllSyncStates, recordSynced } from "@/features/sync/lib/noteSyncState";
import { clearQueued } from "@/features/sync/lib/pushQueue";
import { tryLockNote } from "@/features/sync/lib/noteLock";
import { decideSyncAction } from "@/features/sync/lib/syncDecision";
import { fetchRemoteNoteMap } from "@/features/sync/lib/remoteNotes";

export type PullResult =
  | "pulled"
  | "pulled_unrecorded" // written locally, but local changed again before the state was recorded
  | "skipped_open"
  | "skipped_busy"
  | "skipped_deleted"   // deleted state differs between local and hosted
  | "skipped_parent"    // hosted parent doesn't exist locally yet
  | "purged_local"      // server purged it and it was unchanged here: deleted locally
  | "skipped_purge_parked" // server purged it but it changed here: kept, left to 4d.3
  | "not_behind"        // no state, no remote row, or the decision isn't "behind"
  | "raced"             // local note changed during the pull; nothing was written
  | "skipped"           // sync off / signed out
  | "failed";

export interface PullSummary {
  listed: number;
  candidates: number;
  pulled: number;
  skipped: number;
  failed: number;
  remoteIds?: string[]; // every hosted note id seen in this listing (for the new-note pull)
}

interface LocalRow {
  id: string;
  title: string;
  content: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  updated_at: number;
  deleted_at: number | null;
  revision: number;
  meta_rev: number;
  is_canvas: number;
}

interface RemoteFullRow {
  id: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  updated_at: string;
  deleted_at: string | null;
  purged_at: string | null;
  revision: number;
}

const MAX_CONSECUTIVE_FAILURES = 3;

// Set when a pull deleted or trashed/restored a note; the store lists are
// refreshed once at the end of the pass.
let listsDirty = false;

// Pure: notes with a recorded sync state whose hosted revision has moved past it.
export function selectPullCandidates(
  states: Iterable<{ noteId: string; serverRevision: number }>,
  remote: Map<string, { revision: number }>
): string[] {
  const out: string[] = [];
  for (const s of states) {
    const r = remote.get(s.noteId);
    if (r && r.revision > s.serverRevision) out.push(s.noteId);
  }
  return out;
}

export function isNoteOpen(noteId: string): boolean {
  const ui = useUIStore.getState();
  const inTabs = [...ui.tabs, ...ui.pane2Tabs].some((t) => t.noteId === noteId);
  return inTabs || useNoteStore.getState().activeNoteId === noteId;
}

async function loadLocal(noteId: string): Promise<LocalRow | null> {
  const db = await getDb();
  const rows = await db.select<LocalRow[]>(
    `SELECT id, title, content, tags, parent_id, sort_order, frontmatter,
            updated_at, deleted_at, revision, meta_rev, is_canvas
     FROM notes WHERE id = $1`,
    [noteId]
  );
  return rows[0] ?? null;
}

async function fetchRemoteFull(noteId: string): Promise<RemoteFullRow | null> {
  const { data, error } = await supabase
    .from("notes")
    .select(
      "id, title, content, plaintext, tags, parent_id, sort_order, frontmatter, updated_at, deleted_at, purged_at, revision"
    )
    .eq("id", noteId)
    .maybeSingle();
  if (error) {
    throw new Error(`remote note fetch failed (${error.code ?? "?"}): ${error.message}`);
  }
  return (data as RemoteFullRow | null) ?? null;
}

const same = <T>(a: T | null | undefined, b: T | null | undefined) => (a ?? null) === (b ?? null);

async function pullLocked(noteId: string): Promise<PullResult> {
  const local = await loadLocal(noteId);
  if (!local || local.is_canvas) return "not_behind";

  const state = await getSyncState(noteId);
  if (!state) return "not_behind"; // unseeded: seeding / 4d.5 decides

  const remote = await fetchRemoteFull(noteId);
  if (!remote) return "not_behind";

  const newUpdatedAt = Date.parse(remote.updated_at);
  const decision = decideSyncAction(
    { revision: local.revision, updatedAt: local.updated_at, metaRev: local.meta_rev },
    state,
    { revision: remote.revision, updatedAt: newUpdatedAt }
  );
  // 4d tombstones (rows F and G): the server purged this note. Never write the
  // blanked hosted content over it.
  if (remote.purged_at != null) {
    if (decision.action !== "behind" && decision.action !== "diverged") return "not_behind";
    const del = decideDeleteAction({
      localPresent: true,
      tombstone: null,
      hasSyncState: true,
      localChanged: decision.action === "diverged",
      hosted: { state: "purged", revision: remote.revision },
    });
    if (del.action !== "apply_purge_local") return "skipped_purge_parked";
    await deleteNoteOnly(noteId);
    listsDirty = true;
    return "purged_local";
  }

  if (decision.action !== "behind") return "not_behind";

  // T5: trash and restore are metadata. A behind note takes the hosted deleted_at.
  const remoteDeletedAt = remote.deleted_at == null ? null : Date.parse(remote.deleted_at);
  const trashChanged = (local.deleted_at ?? null) !== remoteDeletedAt;

  const db = await getDb();
  if (remote.parent_id && remote.parent_id !== local.parent_id) {
    const parent = await db.select<{ id: string }[]>(`SELECT id FROM notes WHERE id = $1`, [
      remote.parent_id,
    ]);
    if (parent.length === 0) return "skipped_parent";
  }

  // Compare-and-swap on the local note: only write if it is exactly as we read it.
  const res = await db.execute(
    `UPDATE notes
     SET title = $1, content = $2, plaintext = $3, tags = $4, parent_id = $5,
         sort_order = $6, frontmatter = $7, updated_at = $8, deleted_at = $13
     WHERE id = $9 AND revision = $10 AND meta_rev = $11 AND updated_at = $12`,
    [
      remote.title,
      remote.content,
      remote.plaintext,
      remote.tags,
      remote.parent_id,
      remote.sort_order,
      remote.frontmatter,
      newUpdatedAt,
      noteId,
      local.revision,
      local.meta_rev,
      local.updated_at,
      remoteDeletedAt,
    ]
  );
  if (res.rowsAffected === 0) return "raced";
  if (trashChanged) listsDirty = true;

  // The triggers bump revision on a content change and meta_rev on a metadata
  // change; compute what they must have produced, then verify by reading back.
  const titleChanged = !same(local.title, remote.title);
  const metaChanged =
    titleChanged ||
    !same(local.parent_id, remote.parent_id) ||
    local.sort_order !== remote.sort_order ||
    !same(local.tags, remote.tags) ||
    !same(local.frontmatter, remote.frontmatter) ||
    trashChanged;
  const expectedRevision = local.revision + (local.content !== remote.content ? 1 : 0);
  const expectedMeta = local.meta_rev + (metaChanged ? 1 : 0);

  // Title side effects (breadcrumbs, calendar titles). Writing the same title
  // again changes no revision or meta_rev; it only runs dbUpdateNote's side effects.
  if (titleChanged) {
    try {
      await dbUpdateNote(noteId, { title: remote.title });
    } catch (err) {
      console.warn("[sync] pull: title side effects failed:", noteId, err);
    }
  }

  // Same side effect as trashNote: a trashed note has no title chunk.
  if (trashChanged && remote.deleted_at != null) {
    try {
      await db.execute(`DELETE FROM note_title_chunks WHERE note_id = $1`, [noteId]);
    } catch (err) {
      console.warn("[sync] pull: title chunk cleanup failed:", noteId, err);
    }
  }

  const after = await loadLocal(noteId);
  const recorded =
    after &&
    after.revision === expectedRevision &&
    after.meta_rev === expectedMeta &&
    after.updated_at === newUpdatedAt;

  if (recorded) {
    await recordSynced(noteId, {
      localRevision: after.revision,
      localUpdatedAt: after.updated_at,
      serverRevision: remote.revision,
      metaRev: after.meta_rev,
    });
  } else {
    console.warn(`[sync] pull: ${noteId} changed locally during the pull; sync state not recorded`);
  }

  // Local base snapshot at the new local revision (reads the revision from the DB).
  try {
    await writeBlockRevisionSnapshot(noteId, remote.content);
  } catch (err) {
    console.warn("[sync] pull: block snapshot failed:", noteId, err);
  }

  await clearQueued(noteId);

  // The note is closed, so refreshing it in the store can't blank an editor.
  try {
    await useNoteStore.getState().refreshNote(noteId);
  } catch (err) {
    console.warn("[sync] pull: store refresh failed:", noteId, err);
  }

  if (useAIStore.getState().enabled) {
    try {
      await syncNoteBlocks(
        noteId,
        remote.content,
        "note",
        trashChanged && remote.deleted_at == null ? remote.title : undefined // restored: rewrite title chunk
      );
      nudgeIndexer();
    } catch (err) {
      console.warn("[sync] pull: embedding enqueue failed:", noteId, err);
    }
  }

  return recorded ? "pulled" : "pulled_unrecorded";
}

export async function pullNoteFromHosted(noteId: string): Promise<PullResult> {
  if (!isSyncConfigured || !useSyncStore.getState().session) return "skipped";
  if (isNoteOpen(noteId)) return "skipped_open";

  const release = tryLockNote(noteId, "pull");
  if (!release) return "skipped_busy";
  try {
    return await pullLocked(noteId);
  } catch (err) {
    console.warn("[sync] pull failed:", noteId, err);
    return "failed";
  } finally {
    release();
  }
}

// One pass: list hosted revisions, pull every note that is behind.
export async function pullBehindNotes(limit = 25): Promise<PullSummary> {
  const summary: PullSummary = { listed: 0, candidates: 0, pulled: 0, skipped: 0, failed: 0 };
  const session = useSyncStore.getState().session;
  if (!isSyncConfigured || !session) return summary;

  const t0 = performance.now();
  const remote = await fetchRemoteNoteMap(session.user.id);
  const states = await loadAllSyncStates();
  summary.listed = remote.size;
  summary.remoteIds = [...remote.keys()];
  console.info(`[sync] listed ${remote.size} notes in ${Math.round(performance.now() - t0)} ms`);

  const ids = selectPullCandidates(states.values(), remote).slice(0, limit);
  summary.candidates = ids.length;

  let consecutiveFailures = 0;
  for (const id of ids) {
    if (!useSyncStore.getState().session) break;
    const result = await pullNoteFromHosted(id);
    if (result === "pulled" || result === "pulled_unrecorded" || result === "purged_local") {
      summary.pulled++;
      consecutiveFailures = 0;
    } else if (result === "failed") {
      summary.failed++;
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
    } else {
      summary.skipped++;
    }
  }
  if (listsDirty) {
    listsDirty = false;
    try {
      // Includes content, so open editors are not blanked (restoreNote does the same).
      const [notes, trashedNotes] = await Promise.all([getAllNotes(), getTrashedNotes()]);
      useNoteStore.setState({ notes, trashedNotes });
    } catch (err) {
      console.warn("[sync] pull: list refresh failed:", err);
    }
  }
  if (ids.length > 0) {
    console.info(
      `[sync] pull: ${summary.pulled} pulled, ${summary.skipped} skipped, ${summary.failed} failed`
    );
  }
  return summary;
}