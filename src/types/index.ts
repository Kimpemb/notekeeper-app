// src/types/index.ts

export interface Note {
  id: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  frontmatter: string | null;  // JSON string of key-value pairs
  parent_id: string | null;
  sync_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;  // null = live, timestamp = in trash
  sort_order: number;
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