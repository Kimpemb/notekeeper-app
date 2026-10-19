// src/features/sync/lib/downloadRow.ts
//
// Stage 4d.5 — pure mapping from a hosted notes row to the local INSERT. The
// triggers bump revision / meta_rev only on UPDATE, so an INSERT stores exactly
// what is passed: downloaded notes start at local revision 1, meta_rev 0 (D4).
// sync_id is dormant (nothing reads it) but NOT NULL UNIQUE, so it is generated.

export const DOWNLOAD_LOCAL_REVISION = 1;
export const DOWNLOAD_LOCAL_META_REV = 0;

/** Hosted columns a download reads (timestamps are ISO strings from Postgres). */
export const REMOTE_DOWNLOAD_COLUMNS =
  "id, title, content, plaintext, tags, parent_id, sort_order, frontmatter, " +
  "created_at, updated_at, deleted_at, revision, is_published, publish_visibility, " +
  "publish_token, forked_from_note_id, forked_from_owner_id, fork_base_revision";

export interface RemoteDownloadRow {
  id: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sort_order: number;
  frontmatter: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  is_published: boolean;
  publish_visibility: "team" | "public" | null;
  publish_token: string | null;
  forked_from_note_id: string | null;
  forked_from_owner_id: string | null;
  fork_base_revision: number | null;
}

export const INSERT_DOWNLOADED_NOTE_SQL = `INSERT OR IGNORE INTO notes (
  id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
  created_at, updated_at, deleted_at, sort_order,
  is_canvas, canvas_state, rag_excluded, source_type, source_file, source_meta,
  revision, meta_rev,
  is_published, publish_visibility, publish_token,
  forked_from_note_id, forked_from_owner_id, fork_base_revision
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,NULL,0,'note',NULL,NULL,$13,$14,$15,$16,$17,$18,$19,$20)`;

/**
 * Parameters for INSERT_DOWNLOADED_NOTE_SQL. `parentId` is the planned parent
 * (planDownload may have dropped the hosted one); `syncId` is a fresh uuid.
 */
export function remoteRowToInsertParams(
  r: RemoteDownloadRow,
  parentId: string | null,
  syncId: string
): unknown[] {
  return [
    r.id,
    r.title,
    r.content,
    r.plaintext,
    r.tags,
    r.frontmatter,
    parentId,
    syncId,
    Date.parse(r.created_at),
    Date.parse(r.updated_at),
    null, // deleted_at: hosted-deleted rows are never downloaded (D5)
    r.sort_order,
    DOWNLOAD_LOCAL_REVISION,
    DOWNLOAD_LOCAL_META_REV,
    r.is_published ? 1 : 0,
    r.publish_visibility,
    r.publish_token,
    r.forked_from_note_id,
    r.forked_from_owner_id,
    r.fork_base_revision,
  ];
}
