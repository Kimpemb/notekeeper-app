// src/types/index.ts

export interface Note {
  id: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  frontmatter: string | null;
  parent_id: string | null;
  sync_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  sort_order: number;
  is_canvas: boolean;       // ← NEW
  canvas_state: string | null; // ← NEW
  vault_watched_folder?: string | null;
}

export interface NoteVersion {
  id: string;
  note_id: string;
  content: string;
  plaintext: string;
  created_at: number;
}

export interface Backlink {
  source_id: string;
  target_id: string;
}

export interface NoteBookmark {
  kind: "note";
  id: string;
  noteId: string;
  label: string | null;
  groupId: string | null;
  sort_order: number;
}

export interface BookmarkGroup {
  kind: "group";
  id: string;
  name: string;
  collapsed: boolean;
  sort_order: number;
}

export type BookmarkItem = NoteBookmark | BookmarkGroup;