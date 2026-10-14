// src/features/sync/lib/pushToHostedSync.ts
//
// Stage 4b — push-up write path. Pushes one note's current local state
// (row + block snapshots at its current revision) to hosted Supabase.
//
// Local SQLite is the sole revision authority: the hosted bump trigger was
// dropped in 4a, so revision and updated_at are sent exactly as stored locally.
// Never throws to callers — failures go to the durable retry queue (4c), and
// remote-ahead skips go to its remote_ahead state for Stage 4d. Returns a
// PushResult so callers (backfill, queue drain) can tell outcomes apart.

import { getDb } from "@/features/notes/db/client";
import { supabase, isSyncConfigured } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { enqueueFailedPush, markRemoteAhead, clearQueued } from "@/features/sync/lib/pushQueue";

export type PushResult = "pushed" | "skipped" | "remote_ahead" | "failed" | "busy";

export interface PushOptions {
  // true when called by the queue drain: a failure then counts as another attempt
  isRetry?: boolean;
}

interface LocalNoteRow {
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
  is_canvas: number;
  is_published: number;
  publish_visibility: "team" | "public" | null;
  publish_token: string | null;
  forked_from_note_id: string | null;
  forked_from_owner_id: string | null;
  fork_base_revision: number | null;
}

const NOTE_COLUMNS = `id, title, content, plaintext, tags, parent_id, sort_order,
  frontmatter, created_at, updated_at, deleted_at, revision, is_canvas,
  is_published, publish_visibility, publish_token, forked_from_note_id,
  forked_from_owner_id, fork_base_revision`;

const MAX_ANCESTOR_DEPTH = 20;
const SNAPSHOT_CHUNK = 200;

const toIso = (ms: number): string => new Date(ms).toISOString();

async function loadLocalNote(id: string): Promise<LocalNoteRow | null> {
  const db = await getDb();
  const rows = await db.select<LocalNoteRow[]>(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

function toRemoteRow(row: LocalNoteRow, ownerId: string) {
  return {
    id: row.id,
    owner_id: ownerId,
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
    revision: row.revision,
    is_published: row.is_published === 1,
    publish_visibility: row.publish_visibility,
    publish_token: row.publish_token,
    forked_from_note_id: row.forked_from_note_id,
    forked_from_owner_id: row.forked_from_owner_id,
    fork_base_revision: row.fork_base_revision,
  };
}

async function upsertNoteRow(row: LocalNoteRow, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from("notes")
    .upsert(toRemoteRow(row, ownerId), { onConflict: "id" });
  if (error) {
    throw new Error(`notes upsert failed (${error.code ?? "?"}): ${error.message}`);
  }
}

// hosted notes.parent_id is a real FK — a child can't land before its parent.
async function ensureAncestors(row: LocalNoteRow, ownerId: string): Promise<void> {
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
    if (!present.has(ancestor.id)) await upsertNoteRow(ancestor, ownerId);
  }
}

async function pushSnapshots(noteId: string, revision: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<
    { block_id: string; content: string; content_hash: string | null; created_at: number }[]
  >(
    `SELECT block_id, content, content_hash, created_at
     FROM block_revision_snapshots
     WHERE note_id = $1 AND revision = $2`,
    [noteId, revision]
  );
  if (rows.length === 0) return; // no blockId'd blocks, or snapshot not written yet

  const payload = rows.map((r) => ({
    note_id: noteId,
    revision,
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

async function pushOnce(noteId: string): Promise<"pushed" | "skipped" | "remote_ahead"> {
  const session = useSyncStore.getState().session;
  if (!session) return "skipped";
  const ownerId = session.user.id;

  const row = await loadLocalNote(noteId);
  if (!row || row.is_canvas) {
    await clearQueued(noteId); // nothing to push, so nothing to retry
    return "skipped";
  }

  // Remote-ahead guard: never overwrite a newer remote revision from a stale
  // local copy. Recorded in the queue's remote_ahead state (not retried);
  // Stage 4d's reconnect conflict resolution consumes it.
  const { data: remote, error: remoteErr } = await supabase
    .from("notes")
    .select("revision")
    .eq("id", noteId)
    .maybeSingle();
  if (remoteErr) {
    throw new Error(`remote revision check failed (${remoteErr.code ?? "?"}): ${remoteErr.message}`);
  }
  if (remote && remote.revision > row.revision) {
    console.warn(
      `[sync] remote is ahead for ${noteId} (remote r${remote.revision} > local r${row.revision}) — skipping push, needs 4d reconcile`
    );
    await markRemoteAhead(noteId, remote.revision, row.revision);
    return "remote_ahead";
  }

  await ensureAncestors(row, ownerId);
  await upsertNoteRow(row, ownerId);
  await pushSnapshots(row.id, row.revision);
  await clearQueued(noteId);
  return "pushed";
}

// Coalesce overlapping saves of the same note: one push at a time per note,
// and one re-run if another save landed while it was in flight.
const inFlight = new Set<string>();
const rerun = new Set<string>();

export async function pushToHostedSync(
  noteId: string,
  opts: PushOptions = {}
): Promise<PushResult> {
  if (!isSyncConfigured) return "skipped";
  if (!useSyncStore.getState().session) return "skipped";

  if (inFlight.has(noteId)) {
    rerun.add(noteId);
    return "busy"; // the in-flight push will run once more for this save
  }

  let result: PushResult = "skipped";
  inFlight.add(noteId);
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
    inFlight.delete(noteId);
  }
  return result;
}