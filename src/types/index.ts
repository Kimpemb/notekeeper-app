// src/types/index.ts
// Add deleted_at to the Note interface

export interface Note {
  id: string;
  title: string;
  content: string;
  plaintext: string;
  tags: string | null;
  parent_id: string | null;
  sync_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;  // null = live, timestamp = in trash
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