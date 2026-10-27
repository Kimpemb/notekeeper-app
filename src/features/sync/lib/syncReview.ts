// src/features/sync/lib/syncReview.ts
//
// Stage 4d.3, batch 3 — turns a note that changed on both sides into a review.
// READ-ONLY: builds the three maps, runs the diff and the gate, and returns
// what the review screen needs. It writes nothing (no local writes, no hosted
// writes, no store changes).
//
//   assembleReview   pure; lives in reviewAssemble.ts (unit-tested there)
//   buildSyncReview  loads the local row, the sync state and the hosted row,
//                    builds the maps, then calls assembleReview

import { getDb } from "@/features/notes/db/client";
import { getSyncState } from "@/features/sync/lib/noteSyncState";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { loadBlockMapAtRevision, loadLiveBlockMap } from "@/features/notes/lib/blockRevisioning";
import { loadChoices } from "@/features/sync/lib/reconcileStore";
import { assembleReview, type ReviewCore } from "@/features/sync/lib/reviewAssemble";

export { assembleReview };
export type { AssembleInput, ReviewCore, ReviewMode } from "@/features/sync/lib/reviewAssemble";

// ─── Impure wrapper ───────────────────────────────────────────────────────

export interface SyncReview extends ReviewCore {
  noteId: string;
  title: string;
  builtAt: number;
  /** Hosted revision this review was built against; the commit must find it unchanged. */
  theirsServerRevision: number;
  /** Local state this review was built against; the commit must find it unchanged. */
  mineStamp: { revision: number; metaRev: number; updatedAt: number };
  /** meta_rev recorded at the last agreement; null when there is no sync state. */
  syncedMetaRev: number | null;
  mineContent: string;
  theirsContent: string;
  remote: {
    title: string;
    plaintext: string | null;
    parentId: string | null;
    sortOrder: number | null;
    tags: string | null;
    frontmatter: string | null;
    trashed: boolean;
    deletedAt: number | null;
  };
  mine: {
    title: string;
    plaintext: string | null;
    parentId: string | null;
    sortOrder: number | null;
    tags: string | null;
    frontmatter: string | null;
    trashed: boolean;
    deletedAt: number | null;
  };
}

export type BuildFailure =
  | "signed_out"
  | "local_missing"
  | "canvas"
  | "remote_missing"
  | "remote_purged" // a delete review, not a block review (design D2)
  | "unparseable";

interface LocalRow {
  id: string;
  title: string;
  content: string | null;
  plaintext: string | null;
  parent_id: string | null;
  sort_order: number | null;
  tags: string | null;
  frontmatter: string | null;
  deleted_at: number | null;
  revision: number;
  meta_rev: number;
  updated_at: number;
  is_canvas: number | null;
}

interface RemoteRow {
  title: string;
  content: string;
  plaintext: string | null;
  parent_id: string | null;
  sort_order: number | null;
  tags: string | null;
  frontmatter: string | null;
  deleted_at: string | null;
  purged_at: string | null;
  revision: number;
}

export async function buildSyncReview(
  noteId: string
): Promise<{ ok: true; review: SyncReview } | { ok: false; reason: BuildFailure }> {
  const session = useSyncStore.getState().session;
  if (!session) return { ok: false, reason: "signed_out" };

  const db = await getDb();
  const rows = await db.select<LocalRow[]>(
    `SELECT id, title, content, plaintext, parent_id, sort_order, tags, frontmatter,
            deleted_at, revision, meta_rev, updated_at, is_canvas
     FROM notes WHERE id = $1`,
    [noteId]
  );
  const local = rows[0];
  if (!local) return { ok: false, reason: "local_missing" };
  if (local.is_canvas) return { ok: false, reason: "canvas" };

  const { data, error } = await supabase
    .from("notes")
    .select("title, content, plaintext, parent_id, sort_order, tags, frontmatter, deleted_at, purged_at, revision")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw new Error(`review fetch failed (${error.code ?? "?"}): ${error.message}`);
  const remote = data as RemoteRow | null;
  if (!remote) return { ok: false, reason: "remote_missing" };
  if (remote.purged_at != null) return { ok: false, reason: "remote_purged" };

  const state = await getSyncState(noteId);
  const base = state ? await loadBlockMapAtRevision(noteId, state.localRevision) : null;
  const theirsMap = await loadLiveBlockMap(remote.content);
  const mineContent = local.content ?? "";
  const mineMap = await loadLiveBlockMap(mineContent);

  // Saved choices apply only where both hashes still match (reconcileStore).
  const probe = assembleReview({ theirsContent: remote.content, mineContent, base, theirsMap, mineMap });
  if ("error" in probe) return { ok: false, reason: "unparseable" };
  const choices = await loadChoices(
    db,
    session.user.id,
    noteId,
    probe.items.map((i) => ({ blockId: i.blockId, mine: i.mine, theirs: i.theirs }))
  );
  const core = Object.keys(choices).length
    ? assembleReview({ theirsContent: remote.content, mineContent, base, theirsMap, mineMap, choices })
    : probe;
  if ("error" in core) return { ok: false, reason: "unparseable" };

  return {
    ok: true,
    review: {
      ...core,
      noteId,
      title: local.title,
      builtAt: Date.now(),
      theirsServerRevision: remote.revision,
      mineStamp: { revision: local.revision, metaRev: local.meta_rev, updatedAt: local.updated_at },
      syncedMetaRev: state ? state.metaRev : null,
      mineContent,
      theirsContent: remote.content,
      remote: {
        title: remote.title,
        plaintext: remote.plaintext,
        parentId: remote.parent_id,
        sortOrder: remote.sort_order,
        tags: remote.tags,
        frontmatter: remote.frontmatter,
        trashed: remote.deleted_at != null,
        deletedAt: remote.deleted_at == null ? null : Date.parse(remote.deleted_at),
      },
      mine: {
        title: local.title,
        plaintext: local.plaintext,
        parentId: local.parent_id,
        sortOrder: local.sort_order,
        tags: local.tags,
        frontmatter: local.frontmatter,
        trashed: local.deleted_at != null,
        deletedAt: local.deleted_at,
      },
    },
  };
}
