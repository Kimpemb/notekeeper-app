// src/types/index.ts

export interface Note {
  id: string;
  title: string;
  content: string;      // TipTap JSON stringified
  plaintext: string;    // Stripped plain text for search + AI
  tags: string | null;  // JSON array string e.g. '["draft","important"]'
  parent_id: string | null;  // For sidebar nesting
  sync_id: string;      // UUID — required for PowerSync Phase 6
  created_at: number;   // Unix timestamp
  updated_at: number;   // Unix timestamp
}

export interface NoteVersion {
  id: string;
  note_id: string;
  content: string;      // TipTap JSON snapshot
  plaintext: string;
  created_at: number;
}

export interface Backlink {
  source_id: string;
  target_id: string;
}