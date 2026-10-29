// src/features/sync/lib/pushToHostedSync.ts
//
// Push-up write path. Pushes one note's current local state to hosted Supabase.
//
// Stage 4d.1: the push is compare-and-swap against the note's recorded sync
// state (see syncDecision.ts / noteSyncState.ts). The hosted `revision` is
// SERVER-ASSIGNED: each accepted push sets it to (expected + 1), so it forms one
// linear history across devices. Local `revision` stays a per-device counter.
//
//   - not on the server yet      → INSERT at server revision 1
//   - only local changed         → UPDATE ... WHERE revision = <synced server revision>
//   - only the server changed    → recorded as remote_ahead (pull is Stage 4d.2)
//   - both changed / no base     → recorded as remote_ahead (reconcile is Stage 4d.3)
//
// Row first, then snapshots: winning the compare-and-swap reserves the server
// revision; block snapshots (best-effort, nothing reads them yet) follow.
// Never throws to callers — failures go to the durable retry queue (4c).

import { getDb } from "@/features/notes/db/client";
import { supabase, isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { enqueueFailedPush, markRemoteAhead, clearQueued } from "@/features/sync/lib/pushQueue";
import { getSyncState, recordSynced } from "@/features/sync/lib/noteSyncState";
import { tryLockNote, noteLockHolder } from "@/features/sync/lib/noteLock";
import {
  decideSyncAction,
  describeDecision,
  type RemoteNoteInfo,
} from "@/features/sync/lib/syncDecision";

export type PushResult = "pushed" | "in_sync" | "skipped" | "remote_ahead" | "failed" | "busy";

export interface PushOptions {
  // true when called by the queue drain: a failure then counts as another attempt
  isRetry?: boolean;
}

export interface LocalNoteRow {
  id: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  revision: number;
  meta_rev: number;
  is_canvas: number;
  is_published: number;
  publish_visibility: "team" | "public" | null;
  publish_token: string | null;
  forked_from_note_id: string | null;
  forked_from_owner_id: string | null;
  fork_base_revision: number | null;
}

const NOTE_COLUMNS = `id, title, content, plaintext, tags, parent_id, sort_order,
  frontmatter, created_at, updated_at, deleted_at, revision, meta_rev, is_canvas,
  is_published, publish_visibility, publish_token, forked_from_note_id,
  forked_from_owner_id, fork_base_revision`;

const MAX_ANCESTOR_DEPTH = 20;
const SNAPSHOT_CHUNK = 200;

const toIso = (ms: number): string => new Date(ms).toISOString();

export async function loadLocalNote(id: string): Promise<LocalNoteRow | null> {
  const db = await getDb();
  const rows = await db.select<LocalNoteRow[]>(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

// Everything except id / owner_id; `revision` here is the SERVER revision.
function toRemoteFields(row: LocalNoteRow, serverRevision: number) {
  return {
    title: row.title,
    content: row.content,
    plaintext: row.plaintext,
    tags: row.tags,
    parent_id: row.parent_id,
    sort_order: row.sort_order,
    frontmatter: row.frontmatter,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    deleted_at: row.deleted_at == null ? null : toIso(row.deleted_at),
    revision: serverRevision,
    is_published: row.is_published === 1,
    publish_visibility: row.publish_visibility,
    publish_token: row.publish_token,
    forked_from_note_id: row.forked_from_note_id,
    forked_from_owner_id: row.forked_from_owner_id,
    fork_base_revision: row.fork_base_revision,
  };
}

function toRemoteRow(row: LocalNoteRow, ownerId: string, serverRevision: number) {
  return { id: row.id, owner_id: ownerId, ...toRemoteFields(row, serverRevision) };
}

async function fetchRemote(noteId: string): Promise<RemoteNoteInfo | null> {
  const { data, error } = await supabase
    .from("notes")
    .select("revision, updated_at")
    .eq("id", noteId)
    .maybeSingle();
  if (error) {
    throw new Error(`remote revision check failed (${error.code ?? "?"}): ${error.message}`);
  }
  if (!data) return null;
  return { revision: data.revision, updatedAt: Date.parse(data.updated_at) };
}

// hosted notes.parent_id is a real FK — a child can't land before its parent.
// Missing ancestors are inserted insert-only (never overwriting a copy that
// appeared meanwhile) at server revision 1, and recorded as synced.
export async function ensureAncestors(row: LocalNoteRow, ownerId: string): Promise<void> {
  const chain: LocalNoteRow[] = [];
  const seen = new Set<string>([row.id]);
  let parentId = row.parent_id;

  while (parentId && chain.length < MAX_ANCESTOR_DEPTH) {
    if (seen.has(parentId)) break; // cycle guard
    seen.add(parentId);
    const parent = await loadLocalNote(parentId);
    if (!parent) break;
    chain.push(parent);
    parentId = parent.parent_id;
  }
  if (chain.length === 0) return;

  const { data, error } = await supabase
    .from("notes")
    .select("id")
    .in("id", chain.map((n) => n.id));
  if (error) {
    throw new Error(`ancestor lookup failed (${error.code ?? "?"}): ${error.message}`);
  }
  const present = new Set((data ?? []).map((r: { id: string }) => r.id));

  for (const ancestor of chain.reverse()) {
    if (present.has(ancestor.id)) continue;
    const { data: inserted, error: insErr } = await supabase
      .from("notes")
      .upsert(toRemoteRow(ancestor, ownerId, 1), { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (insErr) {
      throw new Error(`ancestor insert failed (${insErr.code ?? "?"}): ${insErr.message}`);
    }
    if (inserted && inserted.length > 0) {
      await recordSynced(ancestor.id, {
        localRevision: ancestor.revision,
        localUpdatedAt: ancestor.updated_at,
        serverRevision: 1,
        metaRev: ancestor.meta_rev,
      });
    }
  }
}

// true = inserted; false = a row with this id already exists (lost a race).
async function insertNote(row: LocalNoteRow, ownerId: string): Promise<boolean> {
  const { error } = await supabase.from("notes").insert(toRemoteRow(row, ownerId, 1));
  if (!error) return true;
  if (error.code === "23505") return false; // unique_violation
  throw new Error(`notes insert failed (${error.code ?? "?"}): ${error.message}`);
}

// Compare-and-swap: only updates if the hosted revision is still `expected`.
// true = won (hosted revision is now expected + 1); false = someone else pushed.
async function casUpdateNote(row: LocalNoteRow, expected: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("notes")
    .update(toRemoteFields(row, expected + 1))
    .eq("id", row.id)
    .eq("revision", expected)
    .select("id");
  if (error) {
    throw new Error(`notes update failed (${error.code ?? "?"}): ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

// Local snapshots at the pushed LOCAL revision, stored under the SERVER revision.
async function pushSnapshots(
  noteId: string,
  localRevision: number,
  serverRevision: number
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<
    { block_id: string; content: string; content_hash: string | null; created_at: number }[]
  >(
    `SELECT block_id, content, content_hash, created_at
     FROM block_revision_snapshots
     WHERE note_id = $1 AND revision = $2`,
    [noteId, localRevision]
  );
  if (rows.length === 0) return; // no blockId'd blocks, or snapshot not written yet

  const payload = rows.map((r) => ({
    note_id: noteId,
    revision: serverRevision,
    block_id: r.block_id,
    content: r.content,
    content_hash: r.content_hash,
    created_at: toIso(r.created_at),
  }));

  for (let i = 0; i < payload.length; i += SNAPSHOT_CHUNK) {
    const { error } = await supabase
      .from("block_revision_snapshots")
      .upsert(payload.slice(i, i + SNAPSHOT_CHUNK), {
        onConflict: "note_id,revision,block_id",
        ignoreDuplicates: true,
      });
    if (error) {
      throw new Error(`snapshot upsert failed (${error.code ?? "?"}): ${error.message}`);
    }
  }
}

// After a won push: record the agreement point FIRST (this is what makes the
// next check correct), then upload snapshots best-effort.
export async function finishPush(row: LocalNoteRow, serverRevision: number): Promise<void> {
  await recordSynced(row.id, {
    localRevision: row.revision,
    localUpdatedAt: row.updated_at,
    serverRevision,
    metaRev: row.meta_rev,
  });
  await clearQueued(row.id);
  try {
    await pushSnapshots(row.id, row.revision, serverRevision);
  } catch (err) {
    console.warn("[sync] snapshot upload failed (best-effort, not retried):", row.id, err);
  }
}

type PushOnceResult = "pushed" | "in_sync" | "skipped" | "remote_ahead";

async function pushOnce(noteId: string): Promise<PushOnceResult> {
  const session = useSyncStore.getState().session;
  if (!session) return "skipped";
  const ownerId = session.user.id;

  const row = await loadLocalNote(noteId);
  if (!row || row.is_canvas) {
    await clearQueued(noteId); // nothing to push, so nothing to retry
    return "skipped";
  }

  let lastRemote: RemoteNoteInfo | null = null;

  // Two passes: a lost compare-and-swap (or insert race) re-reads state once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [state, remote] = await Promise.all([getSyncState(noteId), fetchRemote(noteId)]);
    lastRemote = remote;
    const decision = decideSyncAction(
      { revision: row.revision, updatedAt: row.updated_at, metaRev: row.meta_rev },
      state,
      remote
    );

    switch (decision.action) {
      case "in_sync":
        await clearQueued(noteId);
        return "in_sync";

      case "adopt":
        if (!remote) throw new Error("adopt decision without a remote row");
        await recordSynced(noteId, {
          localRevision: row.revision,
          localUpdatedAt: row.updated_at,
          serverRevision: remote.revision,
          metaRev: row.meta_rev,
        });
        await clearQueued(noteId);
        return "in_sync";

      case "behind":
      case "diverged": {
        const reason = describeDecision(decision);
        console.warn(`[sync] ${noteId}: ${reason} — not pushing`);
        await markRemoteAhead(noteId, remote?.revision ?? 0, row.revision, reason);
        return "remote_ahead";
      }

      case "insert": {
        await ensureAncestors(row, ownerId);
        if (!(await insertNote(row, ownerId))) continue;
        await finishPush(row, 1);
        return "pushed";
      }

      case "push": {
        await ensureAncestors(row, ownerId);
        const expected = decision.expectedServerRevision;
        if (!(await casUpdateNote(row, expected))) continue;
        await finishPush(row, expected + 1);
        return "pushed";
      }
    }
  }

  await markRemoteAhead(
    noteId,
    lastRemote?.revision ?? 0,
    row.revision,
    "server changed during push (compare-and-swap lost twice)"
  );
  return "remote_ahead";
}

// Coalesce overlapping saves of the same note: one push at a time per note
// (the lock is shared with pull, see noteLock.ts), and one re-run if another
// save landed while a push was in flight.
const rerun = new Set<string>();

export async function pushToHostedSync(
  noteId: string,
  opts: PushOptions = {}
): Promise<PushResult> {
  if (!isSyncConfigured) return "skipped";
  if (!useSyncStore.getState().session) return "skipped";

  const release = tryLockNote(noteId, "push");
  if (!release) {
    // Another push is running: it will go round once more for this save.
    // A pull is running: this save is already in the local DB, and the dirty
    // scan will push it afterwards, so no rerun is scheduled.
    if (noteLockHolder(noteId) === "push") rerun.add(noteId);
    return "busy";
  }

  let result: PushResult = "skipped";
  try {
    do {
      rerun.delete(noteId);
      try {
        result = await pushOnce(noteId);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await enqueueFailedPush(noteId, reason, { isRetry: opts.isRetry });
        result = "failed";
      }
    } while (rerun.has(noteId));
  } finally {
    release();
  }
  return result;
}
