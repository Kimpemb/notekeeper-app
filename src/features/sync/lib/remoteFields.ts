// src/features/sync/lib/remoteFields.ts
//
// PURE: no DB, no network, no supabaseClient import, so it runs in the node test
// environment.
//
// The fields a push writes to the hosted `notes` row (everything except id / owner_id).
// `revision` here is the SERVER revision.
//
// SHARE STATE IS DELIBERATELY ABSENT: is_published, publish_visibility and
// publish_token are owned by the server (set only by the share functions). If a
// push wrote them from the local row (always 0 / null), an ordinary sync would
// silently unshare notes. See note-sharing-tier1-plan.md, decision 160 / finding F1.
// The fork columns are still pushed.

export interface RemoteFieldsSource {
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
  forked_from_note_id: string | null;
  forked_from_owner_id: string | null;
  fork_base_revision: number | null;
}

const toIso = (ms: number): string => new Date(ms).toISOString();

export function toRemoteFields(row: RemoteFieldsSource, serverRevision: number) {
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
    forked_from_note_id: row.forked_from_note_id,
    forked_from_owner_id: row.forked_from_owner_id,
    fork_base_revision: row.fork_base_revision,
  };
}