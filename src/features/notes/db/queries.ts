// src/features/notes/db/queries.ts
import { getDb } from "@/features/notes/db/client";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";
import { deleteImage } from "@/lib/tauri/fs";
import type { Note, NoteVersion, Backlink, BookmarkItem, NoteBookmark, BookmarkGroup, NoteSourceType } from "@/types";
import { blobToVector, vectorToBlob } from "@/features/ai/lib/provider"
import { backfillPdfBlocks } from "@/features/importer/lib/extractPDFText"
import {
  getSimilarityResults,
  type FeedbackEntry,
} from "@/features/notes/similarity/similarityUtils";
import { chunkDocument, type SourceType } from "@/features/ai/lib/search/chunker";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

// ─── Asset path extractor (images + attachments) ─────────────────────────────

function extractAssetPaths(content: string): string[] {
  if (!content) return [];
  try {
    const doc = JSON.parse(content);
    const paths: string[] = [];
    function walk(node: Record<string, unknown>) {
      if ((node.type === "image" || node.type === "attachment") &&
          typeof node.attrs === "object" && node.attrs !== null) {
        const src = (node.attrs as Record<string, unknown>).src;
        if (typeof src === "string" && src) paths.push(src);
      }
      if (Array.isArray(node.content)) {
        (node.content as Record<string, unknown>[]).forEach(walk);
      }
    }
    if (Array.isArray(doc.content)) {
      (doc.content as Record<string, unknown>[]).forEach(walk);
    }
    return paths;
  } catch {
    return [];
  }
}

async function deleteNoteAssets(content: string): Promise<void> {
  const paths = extractAssetPaths(content);
  await Promise.allSettled(paths.map((p) => deleteImage(p)));
}

// ─── Breadcrumb computation (M11) ────────────────────────────────────────────
//
// Walks the parent_id chain up to the root and returns a /-separated string
// of note titles. MAX_DEPTH guards against infinite loops on corrupted chains.
//
// Example: "Idemora / Documentation / Design Spec / Context Vault Spec v4.0"

const BREADCRUMB_MAX_DEPTH = 20;
const BREADCRUMB_SEP       = " / ";

export async function computeBreadcrumb(noteId: string): Promise<string> {
  const db    = await getDb();
  const parts: string[] = [];
  let   current         = noteId;

  for (let depth = 0; depth < BREADCRUMB_MAX_DEPTH; depth++) {
    const rows = await db.select<{ id: string; title: string; parent_id: string | null }[]>(
      `SELECT id, title, parent_id FROM notes WHERE id = $1`,
      [current]
    );
    if (rows.length === 0) break;

    const row = rows[0];
    parts.unshift(row.title);

    if (row.parent_id === null) break;
    current = row.parent_id;
  }

  return parts.join(BREADCRUMB_SEP);
}

// Recomputes breadcrumbs for a note and all its descendants.
// Called on note move and note rename.
// If descendant count exceeds BREADCRUMB_RECOMPUTE_WARN, logs a warning
// (progress indicator wiring is a UI concern — flag at implementation time).

const BREADCRUMB_RECOMPUTE_WARN = 50;

async function recomputeBreadcrumbsForSubtree(noteId: string): Promise<void> {
  const descendants = await getAllDescendants(noteId);
  const allIds      = [noteId, ...descendants.map(d => d.id)];

  if (allIds.length > BREADCRUMB_RECOMPUTE_WARN) {
    console.warn(
      `[breadcrumb] Recomputing for ${allIds.length} notes — consider adding a progress indicator.`
    );
  }

  for (const id of allIds) {
    const breadcrumb = await computeBreadcrumb(id);

    // Update note_title_chunks breadcrumb
    await upsertBreadcrumbOnTitleChunk(id, breadcrumb);

    // Update embeddings breadcrumb
    await upsertBreadcrumbOnEmbeddings(id, breadcrumb);
  }
}


async function upsertBreadcrumbOnTitleChunk(noteId: string, breadcrumb: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE note_title_chunks SET breadcrumb = $1 WHERE note_id = $2`,
    [breadcrumb, noteId]
  );
}

async function upsertBreadcrumbOnEmbeddings(noteId: string, breadcrumb: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE embeddings SET breadcrumb = $1 WHERE note_id = $2`,
    [breadcrumb, noteId]
  );
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// ─── FTS index rebuild ────────────────────────────────────────────────────────
// The notes_fts table started with only title + plaintext indexed.
// We need to expand it to include tags and frontmatter so search covers all
// fields. FTS5 content tables cannot be ALTER TABLE'd — full rebuild required.
//
// This is done entirely in code after initDb() finishes all migrations, never
// inside ALL_MIGRATIONS. Putting DROP TABLE or INSERT...SELECT inside the
// migration array crashes on fresh installs because SQLite's tauri-plugin-sql
// driver processes migration statements in a context where the content table's
// backing table (notes) is not yet visible to FTS5 DDL operations.
//
// Strategy:
//   1. Check if already done via a settings flag — skip if so.
//   2. Detect whether the current FTS table has the old 3-column schema by
//      trying a query against the tags column. If it fails, schema is old.
//   3. If old: drop triggers, drop table, recreate with 5 columns, recreate
//      triggers, bulk INSERT from notes.
//   4. If new but empty (fresh install): bulk INSERT from notes (no-op if
//      notes is empty, which it will be on first launch).
//   5. Set the flag so this never runs again.

async function rebuildFtsIndexIfNeeded(): Promise<void> {
  console.log("[FTS] rebuildFtsIndexIfNeeded: started");
  const db = await getDb();

  const alreadyDone = await getSetting("fts_rebuild_v2_done");
  console.log("[FTS] fts_rebuild_v2_done flag:", alreadyDone);
  if (alreadyDone === "1") {
    console.log("[FTS] already done, skipping");
    return;
  }

  console.log("[FTS] flag not set — proceeding with rebuild check");

  let needsRebuild = false;
  try {
    await db.select(`SELECT tags FROM notes_fts LIMIT 1`);
    console.log("[FTS] tags column exists — no schema rebuild needed");
  } catch (e) {
    console.log("[FTS] tags column missing — full rebuild required", e);
    needsRebuild = true;
  }

  if (needsRebuild) {
    console.log("[FTS] dropping old triggers");
    await db.execute(`DROP TRIGGER IF EXISTS notes_fts_insert`);
    await db.execute(`DROP TRIGGER IF EXISTS notes_fts_update`);
    await db.execute(`DROP TRIGGER IF EXISTS notes_fts_delete`);

    console.log("[FTS] dropping old notes_fts table");
    await db.execute(`DROP TABLE IF EXISTS notes_fts`);

    console.log("[FTS] creating new notes_fts table with 5 columns");
    await db.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      id          UNINDEXED,
      title,
      plaintext,
      tags,
      frontmatter,
      content='notes',
      content_rowid='rowid'
    )`);

    console.log("[FTS] recreating triggers");
    await db.execute(`CREATE TRIGGER IF NOT EXISTS notes_fts_insert
      AFTER INSERT ON notes
      BEGIN
        INSERT INTO notes_fts(rowid, id, title, plaintext, tags, frontmatter)
        VALUES (
          new.rowid, new.id, new.title, new.plaintext,
          COALESCE(new.tags, ''),
          COALESCE(new.frontmatter, '')
        );
      END`);

    await db.execute(`CREATE TRIGGER IF NOT EXISTS notes_fts_update
      AFTER UPDATE ON notes
      BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, id, title, plaintext, tags, frontmatter)
        VALUES ('delete', old.rowid, old.id, old.title, old.plaintext,
          COALESCE(old.tags, ''), COALESCE(old.frontmatter, ''));
        INSERT INTO notes_fts(rowid, id, title, plaintext, tags, frontmatter)
        VALUES (
          new.rowid, new.id, new.title, new.plaintext,
          COALESCE(new.tags, ''),
          COALESCE(new.frontmatter, '')
        );
      END`);

    await db.execute(`CREATE TRIGGER IF NOT EXISTS notes_fts_delete
      AFTER DELETE ON notes
      BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, id, title, plaintext, tags, frontmatter)
        VALUES ('delete', old.rowid, old.id, old.title, old.plaintext,
          COALESCE(old.tags, ''), COALESCE(old.frontmatter, ''));
      END`);
  }

  console.log("[FTS] bulk inserting from notes table");
  try {
    await db.execute(
      `INSERT INTO notes_fts(rowid, id, title, plaintext, tags, frontmatter)
       SELECT rowid, id, title, plaintext,
         COALESCE(tags, ''),
         COALESCE(frontmatter, '')
       FROM notes
       WHERE deleted_at IS NULL`
    );
    console.log("[FTS] bulk insert complete");
  } catch (err) {
    console.warn("[FTS] bulk insert skipped (already populated):", err);
  }

  await setSetting("fts_rebuild_v2_done", "1");
  console.log("[FTS] complete, flag set");
}

async function migrateNoteBlocksV3(): Promise<void> {
  console.log("[RAG v3] migrateNoteBlocksV3: started");
  const db = await getDb();

  const alreadyDone = await getSetting("rag_v3_blocks_migrated");
  if (alreadyDone === "1") {
    console.log("[RAG v3] note_blocks already migrated, skipping");
    return;
  }

  console.log("[RAG v3] migrating note_blocks to v3 schema");

  // Step 1 — drop blocks_fts triggers
  await db.execute(`DROP TRIGGER IF EXISTS blocks_fts_insert`);
  await db.execute(`DROP TRIGGER IF EXISTS blocks_fts_update`);
  await db.execute(`DROP TRIGGER IF EXISTS blocks_fts_delete`);

  // Step 2 — drop blocks_fts virtual table
  await db.execute(`DROP TABLE IF EXISTS blocks_fts`);

  // Step 3 — drop note_blocks (cascades to embedding_jobs and embeddings via FK)
  await db.execute(`DROP TABLE IF EXISTS note_blocks`);

  // Step 4 — recreate note_blocks with v3 schema
  await db.execute(`
    CREATE TABLE IF NOT EXISTS note_blocks (
      block_id         TEXT    NOT NULL PRIMARY KEY,
      note_id          TEXT    NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      block_type       TEXT    NOT NULL DEFAULT 'paragraph',
      plaintext        TEXT    NOT NULL DEFAULT '',
      chunk_heading    TEXT,
      chunk_index      INTEGER NOT NULL DEFAULT 0,
      source_type      TEXT    NOT NULL DEFAULT 'note',
      block_created_at INTEGER NOT NULL,
      block_updated_at INTEGER NOT NULL,
      content_hash     TEXT
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_blocks_note_id ON note_blocks(note_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_blocks_updated_at
      ON note_blocks(block_updated_at DESC)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_blocks_source_type
      ON note_blocks(source_type)`
  );

  // Step 5 — recreate blocks_fts with chunk_heading included
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
      block_id      UNINDEXED,
      note_id       UNINDEXED,
      plaintext,
      chunk_heading,
      content='note_blocks',
      content_rowid='rowid'
    )
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS blocks_fts_insert
      AFTER INSERT ON note_blocks
      BEGIN
        INSERT INTO blocks_fts(rowid, block_id, note_id, plaintext, chunk_heading)
        VALUES (
          new.rowid, new.block_id, new.note_id, new.plaintext,
          COALESCE(new.chunk_heading, '')
        );
      END
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS blocks_fts_update
      AFTER UPDATE ON note_blocks
      BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid, block_id, note_id, plaintext, chunk_heading)
        VALUES (
          'delete', old.rowid, old.block_id, old.note_id, old.plaintext,
          COALESCE(old.chunk_heading, '')
        );
        INSERT INTO blocks_fts(rowid, block_id, note_id, plaintext, chunk_heading)
        VALUES (
          new.rowid, new.block_id, new.note_id, new.plaintext,
          COALESCE(new.chunk_heading, '')
        );
      END
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS blocks_fts_delete
      AFTER DELETE ON note_blocks
      BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid, block_id, note_id, plaintext, chunk_heading)
        VALUES (
          'delete', old.rowid, old.block_id, old.note_id, old.plaintext,
          COALESCE(old.chunk_heading, '')
        );
      END
  `);

  // Step 6 — recreate embeddings cascade delete trigger
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS embeddings_delete_on_block_delete
      AFTER DELETE ON note_blocks
      BEGIN
        DELETE FROM embeddings WHERE block_id = OLD.block_id;
      END
  `);

  // Step 7 — clear all embedding_jobs rows (old block_ids are now gone)
  await db.execute(`DELETE FROM embedding_jobs`);

  // Step 8 — clear embeddings table (old flat chunks are invalid)
  await db.execute(`DELETE FROM embeddings`);

  await setSetting("rag_v3_blocks_migrated", "1");
  console.log("[RAG v3] note_blocks migration complete");
}

async function fixBlocksFtsUpdateTrigger(): Promise<void> {
  const db = await getDb();
  try {
    await db.execute(`DROP TRIGGER IF EXISTS blocks_fts_update`);
    await db.execute(`CREATE TRIGGER IF NOT EXISTS blocks_fts_update
      AFTER UPDATE ON note_blocks
      BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid, block_id, note_id, plaintext, chunk_heading)
        VALUES ('delete', old.rowid, old.block_id, old.note_id, old.plaintext,
          COALESCE(old.chunk_heading, ''));
        INSERT INTO blocks_fts(rowid, block_id, note_id, plaintext, chunk_heading)
        VALUES (new.rowid, new.block_id, new.note_id, new.plaintext,
          COALESCE(new.chunk_heading, ''));
      END`);
  } catch (err) {
    console.warn("[initDb] blocks_fts_update trigger fix skipped:", err);
  }
}

async function fixNullTitles(): Promise<void> {
  const db = await getDb();
  const nullTitleNotes = await db.select<{ id: string; title: string | null }[]>(
    `SELECT id, title FROM notes WHERE title IS NULL OR title = ''`
  );
  
  for (const note of nullTitleNotes) {
    const newTitle = `Untitled-${Date.now()}`;
    await db.execute(
      `UPDATE notes SET title = $1 WHERE id = $2`,
      [newTitle, note.id]
    );
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  
  if (nullTitleNotes.length > 0) {
    console.log(`[initDb] Fixed ${nullTitleNotes.length} notes with null/empty titles`);
  }
}

let _dbInitialized = false;

let _dbReady: Promise<void> | null = null;
let _dbReadyResolve: (() => void) | null = null;

export function waitForDb(): Promise<void> {
  if (!_dbReady) {
    _dbReady = new Promise((res) => { _dbReadyResolve = res; });
  }
  return _dbReady;
}

async function resetFailedEmbeddingJobs(): Promise<void> {
  const db = await getDb()
  const result = await db.execute(
    `UPDATE embedding_jobs
     SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = 0
     WHERE status = 'failed'`
  )
  if (result.rowsAffected > 0) {
    console.log(`[initDb] reset ${result.rowsAffected} failed embedding jobs`)
  }
}

export async function initDb(): Promise<void> {
  if (_dbInitialized) return;
  _dbInitialized = true;

  const db = await getDb();

  for (const sql of ALL_MIGRATIONS) {
    try {
      await db.execute(sql);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("duplicate column name") || msg.includes("already exists")) continue;
      throw err;
    }
  }

  // These must run before app starts
  await fixNullTitles();

  // Defer everything else — run after first render
  setTimeout(async () => {
    await purgeTrashedNotes();
    await clearStaleExhaustionEntries();
    await migrateNoteBlocksV3();
    await fixBlocksFtsUpdateTrigger();
    await backfillNoteBlocks()
    await backfillUnblockedNotes()
    await backfillPdfBlocks()
    await backfillBacklinks()
    await backfillBreadcrumbs();
    await backfillExcludedTitleChunks();
    await backfillMissingTitleChunks();
    await resetFailedEmbeddingJobs();
    await rebuildFtsIndexIfNeeded();
    await archiveOldExhaustionLogs();
    await addMemoryBlockColumns();
    const { ageWarmToCold } = await import('@/features/ai/lib/memory/blockFormation')
    await ageWarmToCold()
    console.log("[initDb] Background maintenance complete");
    _dbReadyResolve?.();
  }, 5000);

  console.log("[initDb] Database initialized successfully");
}


// ─── Notes ────────────────────────────────────────────────────────────────────

export async function getAllNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order,
            is_canvas, canvas_state, COALESCE(rag_excluded, 0) AS rag_excluded,
            source_type, source_file, source_meta
     FROM notes WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
  );
}

export async function getAllNotesMeta(): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    `SELECT id, title, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order, is_canvas,
            COALESCE(rag_excluded, 0) AS rag_excluded,
            source_type, source_file, source_meta
     FROM notes WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
  );
}

export async function getNoteContent(id: string): Promise<{ content: string | null; canvas_state: string | null }> {
  const db = await getDb();
  const rows = await db.select<{ content: string | null; canvas_state: string | null }[]>(
    `SELECT content, canvas_state FROM notes WHERE id = ?`, [id]
  );
  return rows[0] ?? { content: null, canvas_state: null };
}

export async function getNoteById(id: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<Note[]>(
    `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order,
            COALESCE(rag_excluded, 0) AS rag_excluded,
            source_type, source_file, source_meta
     FROM notes WHERE id = $1`, 
    [id]
  );
  return rows[0] ?? null;
}

export async function getNotesByParent(parentId: string | null): Promise<Note[]> {
  const db = await getDb();
  if (parentId === null) {
    return db.select<Note[]>(
      `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
              created_at, updated_at, deleted_at, sort_order,
              COALESCE(rag_excluded, 0) AS rag_excluded,
              source_type, source_file, source_meta
       FROM notes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
    );
  }
  return db.select<Note[]>(
    `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order,
            COALESCE(rag_excluded, 0) AS rag_excluded,
            source_type, source_file, source_meta
     FROM notes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
    [parentId]
  );
}

export interface CreateNoteInput {
  title?:        string
  content?:      string
  plaintext?:    string
  tags?:         string | null
  frontmatter?:  string | null
  parent_id?:    string | null
  sort_order?:   number
  is_canvas?:    boolean
  canvas_state?: string | null
  source_type?:  NoteSourceType
  source_file?:  string
  source_meta?:  string
}

export async function createNote(input: CreateNoteInput = {}): Promise<Note> {
  const db = await getDb();

  let sort_order = input.sort_order ?? 0;
  if (input.sort_order === undefined) {
    const rows = await db.select<{ max_order: number | null }[]>(
      `SELECT MAX(sort_order) as max_order FROM notes WHERE deleted_at IS NULL AND parent_id IS $1`,
      [input.parent_id ?? null]
    );
    sort_order = (rows[0]?.max_order ?? -1) + 1;
  }

const note: Note = {
    id: uuid(),
    title: input.title ?? "Untitled",
    content: input.content ?? JSON.stringify({ type: "doc", content: [] }),
    plaintext: input.plaintext ?? "",
    tags: input.tags ?? null,
    frontmatter: input.frontmatter ?? null,
    parent_id: input.parent_id ?? null,
    sync_id: uuid(),
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
    sort_order,
    is_canvas: input.is_canvas ?? false,
    canvas_state: input.canvas_state ?? null,
    rag_excluded: 0,
    source_type: input.source_type ?? 'note',
    source_file: input.source_file,
    source_meta: input.source_meta,
  };   


await db.execute(
    `INSERT INTO notes (id, title, content, plaintext, tags, frontmatter, parent_id,
                        sync_id, created_at, updated_at, deleted_at, sort_order,
                        is_canvas, canvas_state, rag_excluded,
                        source_type, source_file, source_meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [note.id, note.title, note.content, note.plaintext, note.tags, note.frontmatter,
     note.parent_id, note.sync_id, note.created_at, note.updated_at, null, note.sort_order,
     note.is_canvas ? 1 : 0, note.canvas_state, 0,
     note.source_type, note.source_file ?? null, note.source_meta ?? null]
  );

  // M11 — write initial breadcrumb for the new note
  const breadcrumb = await computeBreadcrumb(note.id);
  await upsertNoteTitleChunkWithBreadcrumb(note.id, note.title, "note", breadcrumb);

  return note;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  plaintext?: string;
  tags?: string | null;
  frontmatter?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  is_canvas?: boolean;
  canvas_state?: string | null;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.title !== undefined)      { fields.push(`title = $${idx++}`);      values.push(input.title); }
  if (input.content !== undefined)    { fields.push(`content = $${idx++}`);    values.push(input.content); }
  if (input.plaintext !== undefined)  { fields.push(`plaintext = $${idx++}`);  values.push(input.plaintext); }
  if (input.tags !== undefined)       { fields.push(`tags = $${idx++}`);       values.push(input.tags); }
  if (input.frontmatter !== undefined) { fields.push(`frontmatter = $${idx++}`); values.push(input.frontmatter); }
  if (input.parent_id !== undefined)  { fields.push(`parent_id = $${idx++}`);  values.push(input.parent_id); }
  if (input.sort_order !== undefined) { fields.push(`sort_order = $${idx++}`); values.push(input.sort_order); }
  if (input.canvas_state !== undefined) { fields.push(`canvas_state = $${idx++}`); values.push(input.canvas_state); }

  if (fields.length === 0) return;

  const isContentEdit = input.content !== undefined || input.plaintext !== undefined;
  if (isContentEdit) {
    fields.push(`updated_at = $${idx++}`);
    values.push(now());
  }

  values.push(id);

  await db.execute(
    `UPDATE notes SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );

  // M11 — if the title changed, recompute breadcrumbs for this note and all
  // descendants (their breadcrumbs embed the ancestor title in the path).
  if (input.title !== undefined) {
    // Update this note's title chunk breadcrumb
    const breadcrumb = await computeBreadcrumb(id);
    await upsertBreadcrumbOnTitleChunk(id, breadcrumb);
    await upsertBreadcrumbOnEmbeddings(id, breadcrumb);

    // Recompute descendants — their paths include this note's title
    await recomputeBreadcrumbsForSubtree(id);

    // Sync title to any calendar events sourced from this note (@date chips)
    await db.execute(
      `UPDATE calendar_events SET title = $1, updated_at = $2
       WHERE source_id = $3 AND source_type = 'note'`,
      [input.title, now(), id]
    );
  }
}

export async function bulkUpdateSortOrder(updates: { id: string; sort_order: number }[]): Promise<void> {
  const db = await getDb();
  for (const { id, sort_order } of updates) {
    await db.execute(
      `UPDATE notes SET sort_order = $1 WHERE id = $2`,
      [sort_order, id]
    );
  }
}

export async function deleteNote(id: string): Promise<void> {
  const descendants = await getAllDescendants(id);
  const allIds = [...descendants.map(d => d.id).reverse(), id];
  const db = await getDb();
  for (const noteId of allIds) {
    const note = await getNoteById(noteId);
    if (note) await deleteNoteAssets(note.content ?? "");
    await db.execute(`DELETE FROM notes WHERE id = $1`, [noteId]);
    await deleteChatSession(noteId);
  }
  await db.execute(`PRAGMA wal_checkpoint(TRUNCATE)`);
}

export async function trashNote(id: string): Promise<void> {
  const descendants = await getAllDescendants(id);
  const allIds = [id, ...descendants.map(d => d.id)];
  const db = await getDb();
  const trashedAt = now();
  for (const noteId of allIds) {
    await db.execute(
      `UPDATE notes SET deleted_at = $1 WHERE id = $2`,
      [trashedAt, noteId]
    );
    await db.execute(
      `DELETE FROM note_title_chunks WHERE note_id = $1`,
      [noteId]
    );
  }
}

export async function restoreNote(id: string): Promise<void> {
  const db = await getDb();
  const descendants = await getAllDescendants(id);
  const allIds = [id, ...descendants.map(d => d.id)];
  for (const noteId of allIds) {
    await db.execute(
      `UPDATE notes SET deleted_at = NULL WHERE id = $1`,
      [noteId]
    );
  }
}

export async function permanentlyDeleteNote(id: string): Promise<void> {
  await deleteNote(id);
}

export async function getTrashedNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order,
            COALESCE(rag_excluded, 0) AS rag_excluded,
            source_type, source_file, source_meta
     FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
}

export async function emptyTrash(): Promise<void> {
  const db = await getDb();
  const trashed = await getTrashedNotes();
  await Promise.allSettled(
    trashed.map((note) => deleteNoteAssets(note.content ?? ""))
  );
  await db.execute(`DELETE FROM notes WHERE deleted_at IS NOT NULL`);
  await db.execute(`PRAGMA wal_checkpoint(TRUNCATE)`);
}

export async function purgeTrashedNotes(): Promise<void> {
  const db = await getDb();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = await db.select<Note[]>(
    `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order,
            COALESCE(rag_excluded, 0) AS rag_excluded,
            source_type, source_file, source_meta
     FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [thirtyDaysAgo]
  );
  await Promise.allSettled(
    expired.map((note) => deleteNoteAssets(note.content ?? ""))
  );
  await db.execute(
    `DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [thirtyDaysAgo]
  );
}

export async function getAllDescendants(id: string): Promise<{ id: string }[]> {
  const db = await getDb();
  const children = await db.select<{ id: string }[]>(
    `SELECT id FROM notes WHERE parent_id = $1`, [id]
  );
  const rows: { id: string }[] = [];
  for (const child of children) {
    rows.push(child);
    rows.push(...await getAllDescendants(child.id));
  }
  return rows;
}

export async function moveNote(id: string, newParentId: string | null): Promise<void> {
  if (newParentId !== null) {
    const descendants = await getAllDescendants(id);
    if (descendants.map(d => d.id).includes(newParentId) || newParentId === id) {
      throw new Error("Cannot move a note into one of its own descendants.");
    }
  }
  await updateNote(id, { parent_id: newParentId });

  // M11 — recompute breadcrumbs for the moved note and all its descendants.
  // parent_id change means the full path has changed for the entire subtree.
  await recomputeBreadcrumbsForSubtree(id);
}

// ─── RAG Exclusion (M13) ─────────────────────────────────────────────────────
//
// Sets rag_excluded on a note. When excluding (value = 1):
//   - Clears all existing embeddings for the note (they will not be re-created)
//   - Removes pending embedding jobs for the note's blocks
// When re-including (value = 0):
//   - Embeddings will be recreated on the next syncNoteBlocks call
//   - Enqueues blocks for embedding immediately

export async function setRagExcluded(
  noteId:   string,
  excluded: boolean,
  cascade:  boolean = false
): Promise<void> {
  const db = await getDb();

  const descendants = cascade ? await getAllDescendants(noteId) : [];
  const targets     = [noteId, ...descendants.map((d) => d.id)];

  for (const id of targets) {
    await db.execute(
      `UPDATE notes SET rag_excluded = $1 WHERE id = $2`,
      [excluded ? 1 : 0, id]
    );

    if (excluded) {
      await db.execute(`DELETE FROM embeddings WHERE note_id = $1`, [id]);
      await db.execute(`DELETE FROM embedding_jobs WHERE note_id = $1`, [id]);
    } else {
      const blocks = await db.select<{ block_id: string }[]>(
        `SELECT block_id FROM note_blocks WHERE note_id = $1`,
        [id]
      );
      if (blocks.length > 0) {
        await enqueueEmbeddingJobs(blocks.map((b) => ({ blockId: b.block_id, noteId: id })));
      }
    }
  }
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export async function getAllTags(): Promise<string[]> {
  const notes = await getAllNotes();
  const tagSet = new Set<string>();
  for (const note of notes) {
    if (!note.tags) continue;
    try {
      const parsed: string[] = JSON.parse(note.tags);
      parsed.forEach((t) => tagSet.add(t));
    } catch { /* skip malformed */ }
  }
  return Array.from(tagSet).sort();
}

export async function getNotesByTag(tag: string): Promise<Note[]> {
  const notes = await getAllNotes();
  return notes.filter((note) => {
    if (!note.tags) return false;
    try {
      return (JSON.parse(note.tags) as string[]).includes(tag);
    } catch { return false; }
  });
}

export async function renameTag(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim().toLowerCase().replace(/\s+/g, "-");
  if (!trimmed || trimmed === oldName) return;
  const notes = await getAllNotes();
  for (const note of notes) {
    if (!note.tags) continue;
    try {
      const tags: string[] = JSON.parse(note.tags);
      if (!tags.includes(oldName)) continue;
      const next = tags.map((t) => (t === oldName ? trimmed : t));
      await updateNote(note.id, { tags: JSON.stringify(next) });
    } catch { /* skip malformed */ }
  }
}

export async function deleteTag(name: string): Promise<void> {
  const notes = await getAllNotes();
  for (const note of notes) {
    if (!note.tags) continue;
    try {
      const tags: string[] = JSON.parse(note.tags);
      if (!tags.includes(name)) continue;
      const next = tags.filter((t) => t !== name);
      await updateNote(note.id, { tags: next.length ? JSON.stringify(next) : null });
    } catch { /* skip malformed */ }
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  offset: number;
  updated_at: number;
  parent_id: string | null;
}

export async function searchNotes(query: string, limit = 20): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const db = await getDb();

  const raw = query.trim();
  const isTagQuery = raw.startsWith("#");
  const bare = isTagQuery ? raw.slice(1) : raw;

  if (!bare) return [];

  const ftsQuery = bare
    .replace(/['"^():]/g, " ")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const ftsMatch = ftsQuery.length > 0
    ? ftsQuery.split(" ").filter(Boolean).map(t => `${t}*`).join(" ")
    : null;

  const likePattern = `%${bare}%`;

  const seen    = new Set<string>();
  const results: SearchResult[] = [];

  async function runFts() {
    if (!ftsMatch || results.length >= limit) return;
    try {
      const ftsRows = await db.select<(SearchResult & { _titleSnip: string; _bodySnip: string })[]>(
        `SELECT
          n.id,
          n.title,
          snippet(notes_fts, 1, '**', '**', '…', 12) AS _titleSnip,
          snippet(notes_fts, 2, '**', '**', '…', 12) AS _bodySnip,
          n.updated_at,
          n.parent_id,
          instr(n.plaintext, $2) AS offset
        FROM notes_fts f
        JOIN notes n ON n.id = f.id
        WHERE notes_fts MATCH $1
          AND n.deleted_at IS NULL
        ORDER BY rank
        LIMIT $3`,
        [ftsMatch, bare, limit]
      );
      for (const row of ftsRows) {
        if (seen.has(row.id)) continue;
        const snippet = row._titleSnip?.trim() || row._bodySnip?.trim() || "";
        if (!snippet) continue;
        seen.add(row.id);
        results.push({ ...row, snippet });
      }
    } catch { /* fall through */ }
  }

  async function runTagLike() {
    if (results.length >= limit) return;
    const tagRows = await db.select<{
      id: string; title: string; updated_at: number; parent_id: string | null; tags: string | null;
    }[]>(
      `SELECT id, title, updated_at, parent_id, tags
       FROM notes
       WHERE tags LIKE $1
         AND deleted_at IS NULL
       LIMIT $2`,
      [likePattern, limit - results.length]
    );
    for (const row of tagRows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      let snippet = "";
      if (row.tags) {
        try {
          const tagArr: string[] = JSON.parse(row.tags);
          const matched = tagArr.filter(t => t.toLowerCase().includes(bare.toLowerCase()));
          if (matched.length > 0) snippet = `Tag: ${matched.join(", ")}`;
        } catch { snippet = ""; }
      }
      results.push({ id: row.id, title: row.title, snippet, offset: 0, updated_at: row.updated_at, parent_id: row.parent_id });
    }
  }

  async function runFrontmatterLike() {
    if (results.length >= limit) return;
    const fmRows = await db.select<{
      id: string; title: string; updated_at: number; parent_id: string | null; frontmatter: string | null;
    }[]>(
      `SELECT id, title, updated_at, parent_id, frontmatter
       FROM notes
       WHERE frontmatter LIKE $1
         AND deleted_at IS NULL
       LIMIT $2`,
      [likePattern, limit - results.length]
    );
    for (const row of fmRows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      let snippet = "";
      if (row.frontmatter) {
        try {
          const fm = JSON.parse(row.frontmatter) as Record<string, unknown>;
          const matchedPairs = Object.entries(fm)
            .filter(([k, v]) =>
              k.toLowerCase().includes(bare.toLowerCase()) ||
              String(v).toLowerCase().includes(bare.toLowerCase())
            )
            .map(([k, v]) => `${k}: ${v}`)
            .slice(0, 2);
          if (matchedPairs.length > 0) snippet = matchedPairs.join(" · ");
        } catch { snippet = ""; }
      }
      results.push({ id: row.id, title: row.title, snippet, offset: 0, updated_at: row.updated_at, parent_id: row.parent_id });
    }
  }

  async function runBodyLike() {
    if (results.length >= limit) return;
    const likeRows = await db.select<{
      id: string; title: string; updated_at: number; parent_id: string | null; plaintext: string | null;
    }[]>(
      `SELECT id, title, updated_at, parent_id, plaintext
       FROM notes
       WHERE (title LIKE $1 OR plaintext LIKE $1)
         AND deleted_at IS NULL
       LIMIT $2`,
      [likePattern, limit - results.length]
    );
    for (const row of likeRows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      let snippet = "";
      if (row.plaintext) {
        const lower = row.plaintext.toLowerCase();
        const idx = lower.indexOf(bare.toLowerCase());
        if (idx !== -1) {
          const start = Math.max(0, idx - 40);
          const end   = Math.min(row.plaintext.length, idx + bare.length + 40);
          snippet = (start > 0 ? "…" : "") + row.plaintext.slice(start, end).trim() + (end < row.plaintext.length ? "…" : "");
        }
      }
      results.push({ id: row.id, title: row.title, snippet, offset: 0, updated_at: row.updated_at, parent_id: row.parent_id });
    }
  }

  if (isTagQuery) {
    await runTagLike();
    await runFts();
    await runFrontmatterLike();
    await runBodyLike();
  } else {
    await runFts();
    await runTagLike();
    await runFrontmatterLike();
    await runBodyLike();
  }

  // Boost title matches to the top — exact first, then startsWith, then contains
  const needle = bare.toLowerCase();
  results.sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    const score = (t: string) =>
      t === needle ? 3 : t.startsWith(needle) ? 2 : t.includes(needle) ? 1 : 0;
    return score(bTitle) - score(aTitle);
  });

  return results.slice(0, limit);
}

// ─── Version History ──────────────────────────────────────────────────────────

export async function getNoteVersions(noteId: string): Promise<NoteVersion[]> {
  const db = await getDb();
  return db.select<NoteVersion[]>(
    `SELECT * FROM note_versions WHERE note_id = $1 ORDER BY created_at DESC`,
    [noteId]
  );
}

export async function restoreNoteVersion(noteId: string, versionId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<NoteVersion[]>(
    `SELECT * FROM note_versions WHERE id = $1`, [versionId]
  );
  const version = rows[0];
  if (!version) throw new Error(`Version ${versionId} not found.`);
  await updateNote(noteId, { content: version.content, plaintext: version.plaintext });
}

export async function saveManualVersion(noteId: string): Promise<void> {
  const db = await getDb();
  const note = await getNoteById(noteId);
  if (!note) throw new Error(`Note ${noteId} not found.`);
  await db.execute(
    `INSERT INTO note_versions (id, note_id, content, plaintext, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [uuid(), noteId, note.content, note.plaintext, now()]
  );
}

// ─── Backlinks ────────────────────────────────────────────────────────────────

export async function syncBacklinks(sourceId: string, targetIds: string[], source?: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM backlinks WHERE source_id = $1`, [sourceId]);
  for (const targetId of targetIds) {
    if (targetId === sourceId) continue;
    const exists = await db.select<{ id: string }[]>(
      `SELECT id FROM notes WHERE id = $1 AND deleted_at IS NULL`, [targetId]
    );
    if (exists.length === 0) continue;
    await db.execute(
      `INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES ($1, $2)`,
      [sourceId, targetId]
    );
  }
  window.dispatchEvent(new CustomEvent("idemora:backlinks-updated", {
    detail: { source },
  }));
}

export async function getBacklinksForNote(targetId: string): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    `SELECT n.id, n.title, n.content, n.plaintext, n.tags, n.frontmatter, n.parent_id, n.sync_id,
            n.created_at, n.updated_at, n.deleted_at, n.sort_order,
            COALESCE(n.rag_excluded, 0) AS rag_excluded
    FROM notes n
    JOIN backlinks b ON b.source_id = n.id
    WHERE b.target_id = $1
      AND n.deleted_at IS NULL
    ORDER BY n.updated_at DESC`,
    [targetId]
  );
}

export async function getAllBacklinks(): Promise<Backlink[]> {
  const db = await getDb();
  return db.select<Backlink[]>(`SELECT * FROM backlinks`);
}

// ─── Stale notes ──────────────────────────────────────────────────────────────

export interface StaleNote extends Note {
  last_visit: number | null;
}

export async function getStaleNotes(dayThreshold: number, limit = 5): Promise<StaleNote[]> {
  const db = await getDb();
  const cutoff = Date.now() - dayThreshold * 24 * 60 * 60 * 1000;

  return db.select<StaleNote[]>(
    `SELECT n.id, n.title, n.content, n.plaintext, n.tags, n.frontmatter, n.parent_id, n.sync_id,
            n.created_at, n.updated_at, n.deleted_at, n.sort_order,
            COALESCE(n.rag_excluded, 0) AS rag_excluded,
            v.last_visit
    FROM notes n
    LEFT JOIN (
      SELECT note_id, MAX(visited_at) AS last_visit
      FROM note_visits
      GROUP BY note_id
    ) v ON v.note_id = n.id
    WHERE n.deleted_at IS NULL
      AND (v.last_visit IS NULL OR v.last_visit < $1)
    ORDER BY RANDOM()
    LIMIT $2`,
    [cutoff, limit]
  );
}

// ─── Unlinked Mentions ────────────────────────────────────────────────────────

export interface UnlinkedMention {
  note: Note;
  snippet: string;
  occurrences: number;
}

const UNTITLED_RE = /^Untitled-\d+$/;

export async function getUnlinkedMentions(
  targetId: string,
  targetTitle: string
): Promise<UnlinkedMention[]> {
  if (!targetTitle.trim() || UNTITLED_RE.test(targetTitle)) return []

  const db = await getDb();

  const linked = await db.select<{ source_id: string }[]>(
    `SELECT source_id FROM backlinks WHERE target_id = $1`,
    [targetId]
  );
  const linkedIds = new Set(linked.map((r) => r.source_id));

  const allNotes = await db.select<Note[]>(
    `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order,
            COALESCE(rag_excluded, 0) AS rag_excluded
     FROM notes WHERE deleted_at IS NULL AND id != $1`,
    [targetId]
  );

  const otherTitles = allNotes
    .filter((n) => n.id !== targetId)
    .map((n) => n.title.toLowerCase());

  const escapedTitle = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<![\\w])${escapedTitle}(?![\\w])`, "gi");

  const mentions: UnlinkedMention[] = [];

  for (const note of allNotes) {
    if (linkedIds.has(note.id)) continue;
    const plaintext = note.plaintext ?? "";

    const rawMatches = [...plaintext.matchAll(regex)];
    const validMatches = rawMatches.filter((match) => {
      const matchIndex = match.index ?? 0;
      return !otherTitles.some((otherTitle) => {
        if (!otherTitle.includes(targetTitle.toLowerCase())) return false;
        const chunk = plaintext.slice(matchIndex, matchIndex + otherTitle.length).toLowerCase();
        return chunk === otherTitle;
      });
    });

    if (validMatches.length === 0) continue;

    const idx = validMatches[0].index ?? 0;
    const start = Math.max(0, idx - 60);
    const end   = Math.min(plaintext.length, idx + targetTitle.length + 60);
    let snippet = plaintext.slice(start, end).trim();
    if (start > 0) snippet = "…" + snippet;
    if (end < plaintext.length) snippet = snippet + "…";

    mentions.push({ note, snippet, occurrences: validMatches.length });
  }

  return mentions.sort((a, b) => b.note.updated_at - a.note.updated_at);
}

// ─── Link first unlinked mention ─────────────────────────────────────────────

export async function linkFirstMention(
  sourceNoteId: string,
  targetId: string,
  targetTitle: string
): Promise<void> {
  const note = await getNoteById(sourceNoteId);
  if (!note || !note.content) return;

  let doc: any;
  try { doc = JSON.parse(note.content); } catch { return; }

  const escapedTitle = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<![\\w])${escapedTitle}(?![\\w])`, "i");

  let linked = false;

  function walkAndLink(nodes: any[]): any[] {
    if (linked) return nodes;
    const result: any[] = [];
    for (const node of nodes) {
      if (linked) { result.push(node); continue; }
      if (node.content && Array.isArray(node.content)) {
        result.push({ ...node, content: walkAndLink(node.content) }); continue;
      }
      if (node.type !== "text" || typeof node.text !== "string") { result.push(node); continue; }
      const match = regex.exec(node.text);
      if (!match) { result.push(node); continue; }
      linked = true;
      const before = node.text.slice(0, match.index);
      const after  = node.text.slice(match.index + match[0].length);
      if (before) result.push({ ...node, text: before });
      result.push({ type: "noteLink", attrs: { id: targetId, label: match[0] } });
      if (after) result.push({ ...node, text: after });
    }
    return result;
  }

  if (doc.content) doc.content = walkAndLink(doc.content);
  if (!linked) return;

  function extractText(nodes: any[]): string {
    return nodes.map((n) => {
      if (n.type === "text") return n.text ?? "";
      if (n.type === "noteLink") return n.attrs?.label ?? "";
      if (n.content && Array.isArray(n.content)) return extractText(n.content);
      return "";
    }).join("");
  }

  const newContent   = JSON.stringify(doc);
  const newPlaintext = extractText(doc.content ?? []);
  await updateNote(sourceNoteId, { content: newContent, plaintext: newPlaintext });
}

// ─── Export / Import ──────────────────────────────────────────────────────────

export async function exportAllNotes(): Promise<string> {
  return JSON.stringify(await getAllNotes(), null, 2);
}

function sanitizeNote(raw: Record<string, unknown>): Note {
  const now_ = Date.now();
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Imported Note";
  const content = typeof raw.content === "string" && raw.content.trim()
    ? raw.content
    : JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
  const plaintext   = typeof raw.plaintext   === "string" ? raw.plaintext   : "";
  const tags        = typeof raw.tags        === "string" ? raw.tags        : null;
  const frontmatter = typeof raw.frontmatter === "string" ? raw.frontmatter : null;
  const parent_id   = typeof raw.parent_id   === "string" ? raw.parent_id   : null;
  const sort_order  = typeof raw.sort_order  === "number" ? raw.sort_order  : 0;
  const id          = typeof raw.id          === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();
  const sync_id     = typeof raw.sync_id     === "string" && raw.sync_id.trim() ? raw.sync_id.trim() : crypto.randomUUID();
  const created_at  = typeof raw.created_at  === "number" ? raw.created_at  : now_;
  const updated_at  = typeof raw.updated_at  === "number" ? raw.updated_at  : now_;
  return {
    id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
    created_at, updated_at, deleted_at: null, sort_order,
    is_canvas: false,
    canvas_state: null,
    rag_excluded: 0,
    source_type: typeof raw.source_type === 'string' ? raw.source_type as NoteSourceType : 'note',
    source_file:  typeof raw.source_file === 'string' ? raw.source_file : undefined,
    source_meta:  typeof raw.source_meta === 'string' ? raw.source_meta : undefined,
  };
}

function topoSort(notes: Note[]): Note[] {
  const map     = new Map(notes.map((n) => [n.id, n]));
  const result  : Note[] = [];
  const visited = new Set<string>();
  function visit(note: Note) {
    if (visited.has(note.id)) return;
    if (note.parent_id && map.has(note.parent_id)) visit(map.get(note.parent_id)!);
    visited.add(note.id);
    result.push(note);
  }
  for (const note of notes) visit(note);
  return result;
}

function extractNoteLinkIdsFromJson(contentJson: string): string[] {
  const ids: string[] = [];
  try {
    const doc = JSON.parse(contentJson);
    function walk(node: any) {
      if (node.type === "noteLink" && node.attrs?.id) {
        ids.push(node.attrs.id);
      }
      if (Array.isArray(node.content)) {
        node.content.forEach(walk);
      }
    }
    walk(doc);
  } catch { /* malformed content — return empty */ }
  return ids;
}

export async function importNotes(json: string): Promise<number> {
  const db = await getDb();
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of notes.");
  const notes: Note[] = topoSort(raw.map((r) => sanitizeNote(r as Record<string, unknown>)));
  let imported = 0;

  for (const note of notes) {
    const rows = await db.select<{ id: string; deleted_at: number | null }[]>(
      `SELECT id, deleted_at FROM notes WHERE id = $1`, [note.id]
    );
    if (rows.length > 0 && rows[0].deleted_at === null) continue;
    if (rows.length > 0) {
      await db.execute(
        `UPDATE notes SET deleted_at = NULL, title = $1, content = $2, plaintext = $3,
         tags = $4, frontmatter = $5, updated_at = $6 WHERE id = $7`,
        [note.title, note.content, note.plaintext, note.tags, note.frontmatter, now(), note.id]
      );
      imported++;
      continue;
    }
    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [note.id, note.title, note.content, note.plaintext, note.tags, note.frontmatter,
      note.parent_id, note.sync_id ?? uuid(), note.created_at, note.updated_at, null, note.sort_order]
    );
    imported++;
  }

  for (const note of notes) {
    await syncBacklinks(note.id, extractNoteLinkIdsFromJson(note.content ?? ""));
  }

  return imported;
}

export async function importNotesOverwrite(json: string): Promise<number> {
  const db = await getDb();
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of notes.");
  const notes: Note[] = topoSort(raw.map((r) => sanitizeNote(r as Record<string, unknown>)));
  let count = 0;

  for (const note of notes) {
    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, content=excluded.content, plaintext=excluded.plaintext,
        tags=excluded.tags, frontmatter=excluded.frontmatter, updated_at=excluded.updated_at,
        sort_order=excluded.sort_order, deleted_at=NULL`,
      [note.id, note.title, note.content, note.plaintext, note.tags, note.frontmatter,
      note.parent_id, note.sync_id ?? uuid(), note.created_at, note.updated_at, null, note.sort_order]
    );
    count++;
  }

  for (const note of notes) {
    await syncBacklinks(note.id, extractNoteLinkIdsFromJson(note.content ?? ""));
  }

  return count;
}

export async function importNotesAsCopies(json: string): Promise<number> {
  const db = await getDb();
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of notes.");
  const notes: Note[] = topoSort(raw.map((r) => sanitizeNote(r as Record<string, unknown>)));

  const idMap = new Map<string, string>();
  for (const note of notes) idMap.set(note.id, uuid());

  let count = 0;
  const remappedContents = new Map<string, string>();

  for (const note of notes) {
    const newId = idMap.get(note.id)!;
    const newParentId = note.parent_id ? (idMap.get(note.parent_id) ?? null) : null;

    let remappedContent = note.content;
    for (const [oldId, newId_] of idMap.entries()) {
      remappedContent = remappedContent.replace(new RegExp(oldId, 'g'), newId_);
    }
    remappedContents.set(newId, remappedContent);

    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [newId, note.title, remappedContent, note.plaintext, note.tags, note.frontmatter,
      newParentId, uuid(), now(), now(), null, note.sort_order]
    );
    count++;
  }

  for (const [newId, remappedContent] of remappedContents.entries()) {
    await syncBacklinks(newId, extractNoteLinkIdsFromJson(remappedContent ?? ""));
  }

  return count;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface DbStats {
  totalNotes: number;
  totalVersions: number;
  tags: string[];
}

export async function getDbStats(): Promise<DbStats> {
  const db = await getDb();
  const [noteCount]    = await db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM notes WHERE deleted_at IS NULL`);
  const [versionCount] = await db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM note_versions`);
  return { totalNotes: noteCount.count, totalVersions: versionCount.count, tags: await getAllTags() };
}

// ─── Visits ───────────────────────────────────────────────────────────────────

export async function recordVisit(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO note_visits (note_id, visited_at) VALUES ($1, $2)`,
    [noteId, Date.now()]
  );
}

export async function getRecentVisits(limit = 50): Promise<{ note_id: string; visited_at: number }[]> {
  const db = await getDb();
  return db.select(
    `SELECT note_id, MAX(visited_at) as visited_at
    FROM note_visits
    GROUP BY note_id
    ORDER BY visited_at DESC
    LIMIT $1`,
    [limit]
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM app_settings WHERE key = $1`, [key]
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export interface SimilarNote extends Note {
  score: number;
  confidence: "Strong" | "Possible";
  sharedTags: string[];
  sharedKeywords: string[];
}

export async function getSimilarNotes(
  noteId: string,
  allNotes: Note[],
  limit = 5
): Promise<SimilarNote[]> {
  const sourceNote = allNotes.find((n) => n.id === noteId);
  if (!sourceNote) return [];

  const db = await getDb();

  const feedback = await db.select<FeedbackEntry[]>(
    `SELECT source_id, target_id, action FROM suggestion_feedback`
  );

  const backlinkRows = await db.select<{ source_id: string; target_id: string }[]>(
    `SELECT source_id, target_id FROM backlinks
    WHERE source_id = $1 OR target_id = $1`,
    [noteId]
  );
  const backlinkIds = new Set(
    backlinkRows.flatMap(({ source_id, target_id }) => [source_id, target_id])
  );
  backlinkIds.delete(noteId);

  const results = getSimilarityResults(
    sourceNote,
    allNotes,
    feedback,
    backlinkIds,
    limit
  );

  const noteMap = new Map(allNotes.map((n) => [n.id, n]));
  return results.map((r) => ({
    ...noteMap.get(r.noteId)!,
    score: r.score,
    confidence: r.confidence,
    sharedTags: r.sharedTags,
    sharedKeywords: r.sharedKeywords,
  }));
}

export async function recordSuggestionFeedback(
  sourceId: string,
  targetId: string,
  action: "accepted" | "ignored"
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO suggestion_feedback (source_id, target_id, action, created_at)
    VALUES ($1, $2, $3, $4)`,
    [sourceId, targetId, action, Date.now()]
  );
}

export async function getSuggestionFeedback(): Promise<FeedbackEntry[]> {
  const db = await getDb();
  return db.select<FeedbackEntry[]>(
    `SELECT source_id, target_id, action FROM suggestion_feedback`
  );
}

// ─── Cluster gap suggestion persistence ───────────────────────────────────────

const CLUSTER_META_KEY      = "cluster_suggestion_meta";
const CLUSTER_DISMISSED_KEY = "cluster_dismissed_pairs";

export interface ClusterSuggestionMeta {
  lastShownAt: number;
  lastClusterNoteIds: string[];
}

export async function getClusterSuggestionMeta(): Promise<ClusterSuggestionMeta | null> {
  const raw = await getSetting(CLUSTER_META_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as ClusterSuggestionMeta; }
  catch { return null; }
}

export async function saveClusterSuggestionMeta(meta: ClusterSuggestionMeta): Promise<void> {
  await setSetting(CLUSTER_META_KEY, JSON.stringify(meta));
}

export async function getClusterDismissedPairs(): Promise<Set<string>> {
  const raw = await getSetting(CLUSTER_DISMISSED_KEY);
  if (!raw) return new Set();
  try { return new Set(JSON.parse(raw) as string[]); }
  catch { return new Set(); }
}

export async function dismissClusterPair(sourceId: string, targetId: string): Promise<void> {
  const existing = await getClusterDismissedPairs();
  existing.add(`${sourceId}:${targetId}`);
  existing.add(`${targetId}:${sourceId}`);
  await setSetting(CLUSTER_DISMISSED_KEY, JSON.stringify([...existing]));
}

export async function getAllBacklinkRows(): Promise<{ source_id: string; target_id: string }[]> {
  const db = await getDb();
  return db.select<{ source_id: string; target_id: string }[]>(
    `SELECT source_id, target_id FROM backlinks`
  );
}

// ─── Block Registry ───────────────────────────────────────────────────────────

export interface BlockSearchResult {
  noteId:    string;
  noteTitle: string;
  blockId:   string;
  blockType: string;
  plaintext: string;
}


// ─── Note title chunks ────────────────────────────────────────────────────────

export async function upsertNoteTitleChunk(
  noteId: string,
  title: string,
  sourceType: SourceType
): Promise<void> {
  if (!title.trim()) return;
  const db = await getDb();
  await db.execute(
    `INSERT INTO note_title_chunks (note_id, title, source_type, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(note_id) DO UPDATE SET
       title      = excluded.title,
       source_type = excluded.source_type,
       updated_at = excluded.updated_at`,
    [noteId, title, sourceType, Date.now()]
  );
}

// M11 variant — writes breadcrumb alongside title chunk
async function upsertNoteTitleChunkWithBreadcrumb(
  noteId: string,
  title: string,
  sourceType: SourceType,
  breadcrumb: string
): Promise<void> {
  if (!title.trim()) return;
  const db = await getDb();
  await db.execute(
    `INSERT INTO note_title_chunks (note_id, title, source_type, updated_at, breadcrumb)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(note_id) DO UPDATE SET
       title       = excluded.title,
       source_type = excluded.source_type,
       updated_at  = excluded.updated_at,
       breadcrumb  = excluded.breadcrumb`,
    [noteId, title, sourceType, Date.now(), breadcrumb]
  );
}

// ─── Quota log helper ─────────────────────────────────────────────────────────

export async function incrementEmbeddingQuota(
  providerId: string,
  modelId: string,
  keyId: string,
  count: number = 1
): Promise<void> {
  const db = await getDb();
  const date = new Date().toISOString().slice(0, 10); // UTC always
  await db.execute(
    `INSERT INTO embedding_quota_log (provider_id, model_id, key_id, requests, date)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(provider_id, model_id, key_id, date) DO UPDATE SET
       requests = embedding_quota_log.requests + excluded.requests`,
    [providerId, modelId, keyId, count, date]
  );
}

export async function getEmbeddingQuotaToday(
  providerId: string,
  modelId: string,
  keyId: string
): Promise<number> {
  const db = await getDb();
  const date = new Date().toISOString().slice(0, 10);
  const rows = await db.select<{ requests: number }[]>(
    `SELECT requests FROM embedding_quota_log
     WHERE provider_id = $1 AND model_id = $2 AND key_id = $3 AND date = $4`,
    [providerId, modelId, keyId, date]
  );
  return rows[0]?.requests ?? 0;
}

// ─── syncNoteBlocks — v3 rewrite ──────────────────────────────────────────────
//
// Replaces the old walkIndexableBlocks approach entirely.
// Uses the heading-aware chunker, computes content_hash per chunk,
// skips unchanged blocks (hash match), and enqueues only changed/new blocks.
// A note with 40 blocks where 1 changed produces exactly 1 embedding job.
//
// M12 — skips notes with rag_excluded = 1.
// Excluded notes: no blocks written, no jobs enqueued, no title chunk written.
// Existing blocks and embeddings for excluded notes are removed by setRagExcluded.

export async function syncNoteBlocks(
  noteId: string,
  contentJson: string,
  sourceType: SourceType = "note",
  noteTitle?: string
): Promise<void> {
  const db = await getDb();

  const excludedRows = await db.select<{ rag_excluded: number }[]>(
    `SELECT COALESCE(rag_excluded, 0) AS rag_excluded FROM notes WHERE id = $1`,
    [noteId]
  );
  const isExcluded = excludedRows[0]?.rag_excluded === 1;

  // Always write the title chunk — excluded notes still need title discovery
  if (noteTitle?.trim()) {
    const breadcrumb = await computeBreadcrumb(noteId);
    await upsertNoteTitleChunkWithBreadcrumb(noteId, noteTitle, sourceType, breadcrumb);
  }

  if (isExcluded) {
    console.log(`[syncNoteBlocks] skipping blocks for excluded note ${noteId}`);
    return;
  }

  const freshChunks = await chunkDocument(contentJson, sourceType);
  const freshIds    = new Set(freshChunks.map((c) => c.blockId));

  const existing = await db.select<{ block_id: string; content_hash: string | null }[]>(
    `SELECT block_id, content_hash FROM note_blocks WHERE note_id = $1`,
    [noteId]
  );
  const existingHashMap = new Map(existing.map((r) => [r.block_id, r.content_hash]));

  for (let i = 0; i < freshChunks.length; i += NOTES_BATCH_SIZE) {
    const batch = freshChunks.slice(i, i + NOTES_BATCH_SIZE);

    const placeholders = batch.map((_, j) => {
      const b = j * 10;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`;
    }).join(", ");

    const values = batch.flatMap((chunk) => [
      chunk.blockId,
      noteId,
      chunk.blockType,
      chunk.plaintext,
      chunk.chunkHeading,
      chunk.chunkIndex,
      chunk.sourceType,
      chunk.blockCreatedAt,
      chunk.blockUpdatedAt,
      chunk.contentHash,
    ]);

    await db.execute(
      `INSERT INTO note_blocks
         (block_id, note_id, block_type, plaintext, chunk_heading, chunk_index,
          source_type, block_created_at, block_updated_at, content_hash)
       VALUES ${placeholders}
       ON CONFLICT(block_id) DO UPDATE SET
         block_type       = excluded.block_type,
         plaintext        = excluded.plaintext,
         chunk_heading    = excluded.chunk_heading,
         chunk_index      = excluded.chunk_index,
         source_type      = excluded.source_type,
         block_updated_at = CASE
           WHEN note_blocks.content_hash != excluded.content_hash
           THEN excluded.block_updated_at
           ELSE note_blocks.block_updated_at
         END,
         content_hash     = excluded.content_hash`,
      values
    );
  }

  const deletedIds = existing
    .map((r) => r.block_id)
    .filter((id) => !freshIds.has(id));

  if (deletedIds.length > 0) {
    const placeholders = deletedIds.map((_, i) => `$${i + 1}`).join(", ");
    await db.execute(
      `DELETE FROM note_blocks WHERE block_id IN (${placeholders})`,
      deletedIds
    );
  }

  const blocksToEmbed = freshChunks
    .filter((chunk) => existingHashMap.get(chunk.blockId) !== chunk.contentHash)
    .map((chunk) => ({ blockId: chunk.blockId, noteId }));

  if (blocksToEmbed.length > 0) {
    await enqueueEmbeddingJobs(blocksToEmbed);
  }
}

export async function searchBlocks(
  query: string,
  excludeNoteId: string,
  limit = 20
): Promise<BlockSearchResult[]> {
  const sanitized = query.trim().replace(/['"*^()]/g, " ").trim() + "*";
  const q = query.trim().toLowerCase();
  const db = await getDb();

  const rows = await db.select<{ id: string; title: string; plaintext: string }[]>(
    `SELECT n.id, n.title, n.plaintext
    FROM notes_fts f
    JOIN notes n ON n.id = f.id
    WHERE notes_fts MATCH $1
      AND n.id != $2
      AND n.deleted_at IS NULL
    ORDER BY rank
    LIMIT $3`,
    [sanitized, excludeNoteId, limit]
  );

  return rows.flatMap((r) => {
    const lines = r.plaintext.split("\n").map((l) => l.trim()).filter(Boolean);
    const matchedLines = lines.filter((l) => l.toLowerCase().includes(q));
    const candidates = matchedLines.length > 0 ? matchedLines : [lines[0]].filter(Boolean);

    return candidates.slice(0, 3).map((line, i) => ({
      noteId:    r.id,
      noteTitle: r.title,
      blockId:   `${r.id}-fts-${i}`,
      blockType: "paragraph",
      plaintext: line,
    }));
  }).slice(0, limit);
}

export async function backfillNoteBlocks(): Promise<void> {
  const alreadyDone = await getSetting("v3_block_backfill_done");
  if (alreadyDone === "1") return;

  const db = await getDb();
  const notes = await db.select<{ id: string; content: string; title: string }[]>(
    `SELECT n.id, n.content, n.title FROM notes n
     WHERE n.content IS NOT NULL
       AND n.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM note_blocks nb WHERE nb.note_id = n.id
       )`
  );

  console.log(`[backfill] ${notes.length} notes to chunk...`);

  for (const note of notes) {
    await syncNoteBlocks(note.id, note.content, "note", note.title);
  }

  await setSetting("v3_block_backfill_done", "1");
  console.log("[backfill] complete");
}

async function backfillUnblockedNotes(): Promise<void> {
  const db = await getDb()
  const notes = await db.select<{ id: string; content: string; title: string }[]>(
    `SELECT n.id, n.content, n.title
     FROM notes n
     WHERE n.deleted_at IS NULL
       AND COALESCE(n.rag_excluded, 0) = 0
       AND TRIM(n.plaintext) != ''
       AND n.content IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM note_blocks nb WHERE nb.note_id = n.id
       )`
  )

  if (notes.length === 0) return
  console.log(`[backfill] chunking ${notes.length} notes with plaintext but no blocks`)

  for (const note of notes) {
    await syncNoteBlocks(note.id, note.content, "note", note.title)
  }

  console.log("[backfill] unblocked notes complete")
}

export async function backfillBacklinks(): Promise<void> {
  const alreadyDone = await getSetting("v3_backlinks_backfill_done");
  if (alreadyDone === "1") return;

  const db = await getDb();
  const notes = await db.select<{ id: string; content: string }[]>(
    `SELECT n.id, n.content FROM notes n
     WHERE n.content IS NOT NULL
       AND n.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM backlinks b WHERE b.source_id = n.id
       )`
  );
  for (const note of notes) {
    await syncBacklinks(note.id, extractNoteLinkIdsFromJson(note.content));
  }
  await setSetting("v3_backlinks_backfill_done", "1");
}

export async function backfillBreadcrumbs(): Promise<void> {
  const alreadyDone = await getSetting("breadcrumb_backfill_done");
  if (alreadyDone === "1") return;

  const db = await getDb();
  const notes = await db.select<{ id: string }[]>(
    `SELECT id FROM notes WHERE deleted_at IS NULL`
  );

  console.log(`[breadcrumb backfill] computing for ${notes.length} notes...`);

  for (const note of notes) {
    const breadcrumb = await computeBreadcrumb(note.id);
    await upsertBreadcrumbOnTitleChunk(note.id, breadcrumb);
    await upsertBreadcrumbOnEmbeddings(note.id, breadcrumb);
  }

  await setSetting("breadcrumb_backfill_done", "1");
  console.log("[breadcrumb backfill] complete");
}

async function backfillExcludedTitleChunks(): Promise<void> {
  const alreadyDone = await getSetting("excluded_title_chunk_backfill_done");
  if (alreadyDone === "1") return;

  const db = await getDb();
  const missing = await db.select<{ id: string; title: string }[]>(
    `SELECT n.id, n.title
     FROM notes n
     WHERE n.rag_excluded = 1
       AND n.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM note_title_chunks ntc WHERE ntc.note_id = n.id
       )`
  );

  console.log(`[backfill] writing title chunks for ${missing.length} excluded notes`);

  for (const note of missing) {
    const breadcrumb = await computeBreadcrumb(note.id);
    await upsertNoteTitleChunkWithBreadcrumb(note.id, note.title, "note", breadcrumb);
  }

  await setSetting("excluded_title_chunk_backfill_done", "1");
  console.log("[backfill] excluded title chunks complete");
}

async function backfillMissingTitleChunks(): Promise<void> {
  const alreadyDone = await getSetting("missing_title_chunk_backfill_done")
  if (alreadyDone === "1") return

  const db = await getDb()
  const missing = await db.select<{ id: string; title: string }[]>(
    `SELECT n.id, n.title
     FROM notes n
     WHERE n.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM note_title_chunks ntc WHERE ntc.note_id = n.id
       )`
  )

  console.log(`[backfill] writing title chunks for ${missing.length} notes`)

  for (const note of missing) {
    if (!note.title.trim()) continue
    const breadcrumb = await computeBreadcrumb(note.id)
    await upsertNoteTitleChunkWithBreadcrumb(note.id, note.title, "note", breadcrumb)
  }

  await setSetting("missing_title_chunk_backfill_done", "1")
  console.log("[backfill] missing title chunks complete")
}

export interface AISummaryRow {
  note_id: string;
  summary: string;
  note_hash: number;
  created_at: number;
  updated_at: number;
}

export async function getAISummary(noteId: string, noteUpdatedAt: number): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<AISummaryRow[]>(
    `SELECT * FROM ai_summaries WHERE note_id = $1`,
    [noteId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.note_hash !== noteUpdatedAt) return null;
  return row.summary;
}

export async function upsertAISummary(
  noteId: string,
  summary: string,
  noteUpdatedAt: number
): Promise<void> {
  const db = await getDb();
  const ts = Date.now();
  await db.execute(
    `INSERT INTO ai_summaries (note_id, summary, note_hash, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT(note_id) DO UPDATE SET
      summary    = excluded.summary,
      note_hash  = excluded.note_hash,
      updated_at = excluded.updated_at`,
    [noteId, summary, noteUpdatedAt, ts, ts]
  );
}

export interface AITagCacheRow {
  note_id: string;
  tags: string;
  note_hash: number;
  created_at: number;
}

export async function getAITagCache(noteId: string, noteUpdatedAt: number): Promise<string[] | null> {
  const db = await getDb();
  const rows = await db.select<AITagCacheRow[]>(
    `SELECT * FROM ai_tag_cache WHERE note_id = $1`,
    [noteId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.note_hash !== noteUpdatedAt) return null;
  try {
    return JSON.parse(row.tags) as string[];
  } catch {
    return null;
  }
}

export async function upsertAITagCache(
  noteId: string,
  tags: string[],
  noteUpdatedAt: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ai_tag_cache (note_id, tags, note_hash, created_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT(note_id) DO UPDATE SET
      tags      = excluded.tags,
      note_hash = excluded.note_hash`,
    [noteId, JSON.stringify(tags), noteUpdatedAt, Date.now()]
  );
}

export interface AIHistoryRow {
  id: string;
  note_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

const AI_HISTORY_LIMIT = 200;

export async function getAIHistory(
  noteId: string,
  limit: number = 40
): Promise<AIHistoryRow[]> {
  const db = await getDb();
  const rows = await db.select<AIHistoryRow[]>(
    `SELECT * FROM ai_history
    WHERE note_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [noteId, limit]
  );
  return rows.reverse();
}

export async function appendAIHistory(
  noteId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO ai_history (id, note_id, role, content, created_at)
    VALUES ($1, $2, $3, $4, $5)`,
    [crypto.randomUUID(), noteId, role, content, Date.now()]
  );
  await db.execute(
    `DELETE FROM ai_history
    WHERE note_id = $1
      AND id NOT IN (
        SELECT id FROM ai_history
        WHERE note_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      )`,
    [noteId, AI_HISTORY_LIMIT]
  );
}

export async function clearAIHistory(noteId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ai_history WHERE note_id = $1`, [noteId]);
}

export async function getAllAISummaries(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select<{ note_id: string; summary: string }[]>(
    `SELECT note_id, summary FROM ai_summaries`
  );
  return new Map(rows.map((r) => [r.note_id, r.summary]));
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

export interface EmbeddingRow {
  block_id:   string
  note_id:    string
  model_id:   string
  vector:     string
  updated_at: number
}

export interface EmbeddingWithVector {
  block_id:  string
  note_id:   string
  model_id:  string
  vector:    Float32Array
  updated_at: number
}

export async function upsertEmbedding(
  blockId:    string,
  noteId:     string,
  modelId:    string,
  vector:     Float32Array,
  breadcrumb?: string
): Promise<void> {
  const db   = await getDb()
  const blob = vectorToBlob(vector)
  await db.execute(
    `INSERT INTO embeddings (block_id, note_id, model_id, vector, updated_at, breadcrumb)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(block_id, model_id) DO UPDATE SET
       vector     = excluded.vector,
       updated_at = excluded.updated_at,
       breadcrumb = excluded.breadcrumb`,
    [blockId, noteId, modelId, blob, Date.now(), breadcrumb ?? null]
  )
}

// AFTER
export async function getAllEmbeddings(
  modelId: string,
  limit = 10_000
): Promise<EmbeddingWithVector[]> {
  const db   = await getDb()
  const rows = await db.select<EmbeddingRow[]>(
    `SELECT block_id, note_id, model_id, vector, updated_at
     FROM embeddings
     WHERE model_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [modelId, limit]
  )
  return rows.map((r) => ({
    ...r,
    vector: blobToVector(r.vector),
  }))
}

export async function deleteNoteEmbeddings(noteId: string): Promise<void> {
  const db = await getDb()
  await db.execute(`DELETE FROM embeddings WHERE note_id = $1`, [noteId])
}

export async function hasStaleEmbeddings(
  noteId:          string,
  activeModelId:   string
): Promise<boolean> {
  const db   = await getDb()
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM embeddings
     WHERE note_id  = $1
       AND model_id != $2`,
    [noteId, activeModelId]
  )
  return (rows[0]?.count ?? 0) > 0
}

// ─── Embedding jobs ───────────────────────────────────────────────────────────

export interface EmbeddingJobRow {
  block_id:        string
  note_id:         string
  status:          "pending" | "processing" | "done" | "failed"
  attempts:        number
  last_error:      string | null
  next_attempt_at: number
  updated_at:      number
}

const NOTES_BATCH_SIZE = 99  // 99 × 10 params = 990, under SQLite 999 limit
const JOBS_BATCH_SIZE  = 333 // 333 × 3 params = 999, at SQLite limit

export async function enqueueEmbeddingJobs(
  blocks: { blockId: string; noteId: string }[]
): Promise<void> {
  if (blocks.length === 0) return
  const db = await getDb()
  const ts = Date.now()

  for (let i = 0; i < blocks.length; i += JOBS_BATCH_SIZE) {
    const batch = blocks.slice(i, i + JOBS_BATCH_SIZE)

    const placeholders = batch.map((_, j) => {
      const b = j * 3;
      return `($${b+1}, $${b+2}, 'pending', 0, NULL, 0, $${b+3})`;
    }).join(", ")

    const values = batch.flatMap(({ blockId, noteId }) => [blockId, noteId, ts])

    await db.execute(
      `INSERT INTO embedding_jobs
         (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
       VALUES ${placeholders}
       ON CONFLICT(block_id) DO UPDATE SET
         status          = CASE
                             WHEN excluded.status = 'pending'
                               AND embedding_jobs.status IN ('pending', 'processing')
                             THEN embedding_jobs.status
                             ELSE 'pending'
                           END,
         attempts        = 0,
         last_error      = NULL,
         next_attempt_at = 0,
         updated_at      = $${batch.length * 3}`,
      values
    )
  }
}

export async function claimPendingJobs(limit = 3): Promise<EmbeddingJobRow[]> {
  const db  = await getDb()
  const now = Date.now()

  const rows = await db.select<EmbeddingJobRow[]>(
    `SELECT block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at
     FROM embedding_jobs
     WHERE status          = 'pending'
       AND next_attempt_at <= $1
     ORDER BY updated_at ASC
     LIMIT $2`,
    [now, limit]
  )

  if (rows.length === 0) return []

  const placeholders = rows.map((_, i) => `$${i + 2}`).join(", ")
  await db.execute(
    `UPDATE embedding_jobs
     SET status = 'processing', updated_at = $1
     WHERE block_id IN (${placeholders}) AND status = 'pending'`,
    [now, ...rows.map((r) => r.block_id)]
  )

  return rows
}

export async function markJobDone(blockId: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    `UPDATE embedding_jobs
     SET status = 'done', last_error = NULL, updated_at = $1
     WHERE block_id = $2`,
    [Date.now(), blockId]
  )
}

export async function markJobFailed(
  blockId:     string,
  error:       string,
  attempts:    number,
  retryable:   boolean,
  maxAttempts: number = 3
): Promise<void> {
  const db  = await getDb()
  const ts  = Date.now()

  const exhausted = !retryable || attempts >= maxAttempts
  const backoffMs = retryable
    ? [30_000, 300_000, 1_800_000][Math.min(attempts, 2)]
    : 0

  await db.execute(
    `UPDATE embedding_jobs
     SET status          = $1,
         attempts        = $2,
         last_error      = $3,
         next_attempt_at = $4,
         updated_at      = $5
     WHERE block_id = $6`,
    [
      exhausted ? "failed" : "pending",
      attempts + 1,
      error,
      exhausted ? 0 : ts + backoffMs,
      ts,
      blockId,
    ]
  )
}

export async function resetStuckJobs(): Promise<void> {
  const db = await getDb()
  await db.execute(
    `UPDATE embedding_jobs
     SET status = 'pending', updated_at = $1
     WHERE status = 'processing'`,
    [Date.now()]
  )
}

export async function getPendingJobCount(): Promise<number> {
  const db   = await getDb()
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM embedding_jobs
     WHERE status IN ('pending', 'processing')`
  )
  return rows[0]?.count ?? 0
}

export async function enqueueUnindexedBlocks(activeModelId: string): Promise<number> {
  const db = await getDb()
  const ts = Date.now()

  const unindexed = await db.select<{ block_id: string; note_id: string }[]>(
    `SELECT nb.block_id, nb.note_id
     FROM note_blocks nb
     LEFT JOIN embeddings e
       ON e.block_id = nb.block_id
      AND e.model_id = $1
     WHERE e.block_id IS NULL`,
    [activeModelId]
  )

  if (unindexed.length === 0) return 0

  for (const { block_id, note_id } of unindexed) {
    await db.execute(
      `INSERT INTO embedding_jobs
         (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
       VALUES ($1, $2, 'pending', 0, NULL, 0, $3)
       ON CONFLICT(block_id) DO NOTHING`,
      [block_id, note_id, ts]
    )
  }

  return unindexed.length
}

export async function getSurroundingBlocks(
  blockId:    string,
  noteId:     string,
  windowSize: number = 2
): Promise<string[]> {
  const db = await getDb()

  const allBlocks = await db.select<{ block_id: string; plaintext: string; chunk_heading: string | null }[]>(
    `SELECT block_id, plaintext, chunk_heading
     FROM note_blocks
     WHERE note_id = $1
       AND plaintext != ''
     ORDER BY chunk_index ASC, rowid ASC`,
    [noteId]
  )

  if (allBlocks.length === 0) return []

  const idx = allBlocks.findIndex((b) => b.block_id === blockId)
  if (idx === -1) return []

  const matchedHeading = allBlocks[idx].chunk_heading

  // Expand backwards — stop when heading changes
  let start = idx
  for (let i = idx - 1; i >= Math.max(0, idx - windowSize); i--) {
    if (allBlocks[i].chunk_heading !== matchedHeading) break
    start = i
  }

  // Expand forwards — stop when heading changes
  let end = idx
  for (let i = idx + 1; i <= Math.min(allBlocks.length - 1, idx + windowSize); i++) {
    if (allBlocks[i].chunk_heading !== matchedHeading) break
    end = i
  }

  console.log('[surrounding] blockId:', blockId, 'matchedHeading:', matchedHeading, 'start:', start, 'end:', end, 'headings:', allBlocks.slice(start, end + 1).map(b => b.chunk_heading))

  return allBlocks.slice(start, end + 1).map((b) => b.plaintext).filter(Boolean)
}

// ─── Rolling conversation summary ────────────────────────────────────────────

export interface ConversationSummaryRow {
  note_id:       string
  summary:       string
  message_count: number
  updated_at:    number
}

export async function getConversationSummary(
  noteId: string
): Promise<ConversationSummaryRow | null> {
  const db   = await getDb()
  const rows = await db.select<ConversationSummaryRow[]>(
    `SELECT * FROM ai_conversation_summary WHERE note_id = $1`,
    [noteId]
  )
  return rows[0] ?? null
}

export async function saveConversationSummary(
  noteId:       string,
  summary:      string,
  messageCount: number
): Promise<void> {
  const db = await getDb()
  await db.execute(
    `INSERT INTO ai_conversation_summary (note_id, summary, message_count, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(note_id) DO UPDATE SET
       summary       = excluded.summary,
       message_count = excluded.message_count,
       updated_at    = excluded.updated_at`,
    [noteId, summary, messageCount, Date.now()]
  )
}

export async function clearConversationSummary(noteId: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    `DELETE FROM ai_conversation_summary WHERE note_id = $1`,
    [noteId]
  )
}

async function addMemoryBlockColumns(): Promise<void> {
  const db = await getDb()
  const cols = [
    `ALTER TABLE note_blocks ADD COLUMN episode_id TEXT`,
    `ALTER TABLE note_blocks ADD COLUMN memory_metadata TEXT`,
    `ALTER TABLE note_blocks ADD COLUMN query_embedding BLOB`,
    `ALTER TABLE note_blocks ADD COLUMN episode_embedding BLOB`,
  ]
  for (const sql of cols) {
    try { await db.execute(sql) } catch { /* already exists — safe to ignore */ }
  }
}

// ─── Canvas migration ─────────────────────────────────────────────────────────

export async function migrateCanvasesToNotes(): Promise<void> {
  const db = await getDb();

  const tableCheck = await db.select<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='canvases'`
  );
  if (tableCheck.length === 0) return;

  const canvases = await db.select<{
    id: string; name: string; data: string; created_at: number; updated_at: number;
  }[]>(`SELECT * FROM canvases`);

  for (const canvas of canvases) {
    const existing = await db.select<{ id: string }[]>(
      `SELECT id FROM notes WHERE id = $1`, [canvas.id]
    );
    if (existing.length > 0) continue;

    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id,
                          created_at, updated_at, is_canvas, canvas_state)
       VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, 1, $8)`,
      [
        canvas.id,
        canvas.name,
        JSON.stringify({ type: "doc", content: [] }),
        "",
        canvas.id,
        canvas.created_at,
        canvas.updated_at,
        canvas.data,
      ]
    );
  }
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

const BOOKMARKS_SETTING_KEY = "bookmarks";

export async function loadBookmarks(): Promise<BookmarkItem[]> {
  try {
    const raw = await getSetting(BOOKMARKS_SETTING_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BookmarkItem[];
  } catch {
    return [];
  }
}

export async function saveBookmarks(items: BookmarkItem[]): Promise<void> {
  await setSetting(BOOKMARKS_SETTING_KEY, JSON.stringify(items));
}

export async function addNoteBookmark(
  noteId: string,
  groupId: string | null = null
): Promise<NoteBookmark> {
  const items = await loadBookmarks();
  const existing = items.find(
    (b): b is NoteBookmark => b.kind === "note" && b.noteId === noteId
  );
  if (existing) return existing;
  const maxOrder = items.reduce((m, b) => Math.max(m, b.sort_order), -1);
  const bookmark: NoteBookmark = {
    kind: "note",
    id: crypto.randomUUID(),
    noteId,
    label: null,
    groupId,
    sort_order: maxOrder + 1,
  };
  await saveBookmarks([...items, bookmark]);
  return bookmark;
}

export async function removeBookmark(bookmarkId: string): Promise<void> {
  const items = await loadBookmarks();
  await saveBookmarks(items.filter((b) => b.id !== bookmarkId));
}

export async function addBookmarkGroup(name: string): Promise<BookmarkGroup> {
  const items = await loadBookmarks();
  const maxOrder = items.reduce((m, b) => Math.max(m, b.sort_order), -1);
  const group: BookmarkGroup = {
    kind: "group",
    id: crypto.randomUUID(),
    name,
    collapsed: false,
    sort_order: maxOrder + 1,
  };
  await saveBookmarks([...items, group]);
  return group;
}

export async function atomicQuotaIncrement(
  providerId: string,
  modelId: string,
  keyId: string,
  ceiling: number
): Promise<'ok' | 'exhausted'> {
  const db = await getDb();
  const date = new Date().toISOString().slice(0, 10);

  await db.execute(
    `INSERT INTO embedding_quota_log (provider_id, model_id, key_id, requests, date)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT(provider_id, model_id, key_id, date) DO UPDATE
       SET requests = CASE
         WHEN embedding_quota_log.requests < $5
         THEN embedding_quota_log.requests + 1
         ELSE embedding_quota_log.requests
       END`,
    [providerId, modelId, keyId, date, ceiling]
  );

  const rows = await db.select<{ requests: number }[]>(
    `SELECT requests FROM embedding_quota_log
     WHERE provider_id = $1 AND model_id = $2 AND key_id = $3 AND date = $4`,
    [providerId, modelId, keyId, date]
  );
  const count = rows[0]?.requests ?? 0;
  return count < ceiling ? 'ok' : 'exhausted';
}

export async function logExhaustion(
  providerId:  string,
  modelId:     string,
  keyId:       string,
  slot:        string,
  reason:      string,
  projectTag?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO exhaustion_log
       (provider_id, model_id, key_id, slot, reason, exhausted_at, project_tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [providerId, modelId, keyId, slot, reason, Date.now(), projectTag ?? null]
  );
}

export async function markRecovered(
  providerId: string,
  modelId: string,
  keyId: string,
  slot: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE exhaustion_log
     SET recovered_at = $1
     WHERE provider_id = $2
       AND model_id = $3
       AND key_id = $4
       AND slot = $5
       AND recovered_at IS NULL`,
    [Date.now(), providerId, modelId, keyId, slot]
  );
}

export async function archiveOldExhaustionLogs(): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const archivedAt = Date.now();

  await db.execute(
    `INSERT INTO exhaustion_log_archive
       (provider_id, model_id, key_id, slot, reason,
        exhausted_at, last_checked_at, recovered_at, archived_at)
     SELECT provider_id, model_id, key_id, slot, reason,
            exhausted_at, last_checked_at, recovered_at, $1
     FROM exhaustion_log
     WHERE exhausted_at < $2`,
    [archivedAt, cutoff]
  );

  await db.execute(
    `DELETE FROM exhaustion_log WHERE exhausted_at < $1`,
    [cutoff]
  );
}

// ─── Startup exhaustion cleanup ───────────────────────────────────────────────
//
// Clears RPD exhaustion entries from previous UTC dates on startup.
// Quota resets at midnight Pacific — any entry from a previous UTC date is
// guaranteed stale. Don't rely on the background checker for day-old entries.

export async function clearStaleExhaustionEntries(): Promise<void> {
  const db = await getDb();
  const todayUtc = new Date().toISOString().slice(0, 10);
  // exhausted_at is Unix ms — convert to UTC date string for comparison
  await db.execute(
    `UPDATE exhaustion_log
     SET recovered_at = $1
     WHERE recovered_at IS NULL
       AND date(exhausted_at / 1000, 'unixepoch') < $2`,
    [Date.now(), todayUtc]
  );
}

// ─── RAG-excluded notes (for .env view) ──────────────────────────────────────
//
// Returns all non-deleted notes that have rag_excluded = 1.
// Used by the .env sidebar panel (Phase 4).

export async function getRagExcludedNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id,
            created_at, updated_at, deleted_at, sort_order,
            COALESCE(rag_excluded, 0) AS rag_excluded
     FROM notes
     WHERE rag_excluded = 1
       AND deleted_at IS NULL`
  );
}

// ─── Chat Sessions ────────────────────────────────────────────────────────────

export interface PersistedMeta {
  messageId:       string
  confidence?:     "high" | "medium" | "low"
  citations?:      { noteId: string; title: string; isTitleMatch?: boolean }[]
  usedWeb?:        boolean
  usedEmbeddings?: boolean
}

export interface PersistedChatSession {
  messages:         import("@/features/ai/lib/chat").ChatMessage[]
  persistedMeta:    PersistedMeta[]
  linkedNoteId:     string | null
  linkedNoteTitle:  string | null
  lastSavedAt:      number | null
  ragScope:         "all" | "note"
  webSearchEnabled: boolean
  updatedAt:        number
}

function trimToMessageCap(
  messages: import("@/features/ai/lib/chat").ChatMessage[],
  cap = 80
): import("@/features/ai/lib/chat").ChatMessage[] {
  if (messages.length <= cap) return messages
  return messages.slice(messages.length - cap)
}

export async function getChatSession(
  noteId: string
): Promise<PersistedChatSession | null> {
  const db = await getDb()
  const rows = await db.select<{
    note_id:            string
    messages:           string
    persisted_meta:     string
    linked_note_id:     string | null
    linked_note_title:  string | null
    last_saved_at:      number | null
    rag_scope:          string
    web_search_enabled: number
    updated_at:         number
  }[]>(
    `SELECT note_id, messages, persisted_meta, linked_note_id, linked_note_title,
            last_saved_at, rag_scope, web_search_enabled, updated_at
     FROM chat_sessions WHERE note_id = $1`,
    [noteId]
  )
  if (rows.length === 0) return null
  const row = rows[0]
  try {
    return {
      messages:         JSON.parse(row.messages)         ?? [],
      persistedMeta:    JSON.parse(row.persisted_meta)   ?? [],
      linkedNoteId:     row.linked_note_id,
      linkedNoteTitle:  row.linked_note_title,
      lastSavedAt:      row.last_saved_at,
      ragScope:         (row.rag_scope as "all" | "note") ?? "all",
      webSearchEnabled: row.web_search_enabled === 1,
      updatedAt:        row.updated_at,
    }
  } catch {
    return null
  }
}

export async function saveChatSession(
  noteId: string,
  data: PersistedChatSession
): Promise<void> {
  const db = await getDb()
  const trimmedMessages = trimToMessageCap(data.messages, 80)
  await db.execute(
    `INSERT INTO chat_sessions
       (note_id, messages, persisted_meta, linked_note_id, linked_note_title,
        last_saved_at, rag_scope, web_search_enabled, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(note_id) DO UPDATE SET
       messages           = excluded.messages,
       persisted_meta     = excluded.persisted_meta,
       linked_note_id     = excluded.linked_note_id,
       linked_note_title  = excluded.linked_note_title,
       last_saved_at      = excluded.last_saved_at,
       rag_scope          = excluded.rag_scope,
       web_search_enabled = excluded.web_search_enabled,
       updated_at         = excluded.updated_at`,
    [
      noteId,
      JSON.stringify(trimmedMessages),
      JSON.stringify(data.persistedMeta),
      data.linkedNoteId,
      data.linkedNoteTitle,
      data.lastSavedAt,
      data.ragScope,
      data.webSearchEnabled ? 1 : 0,
      data.updatedAt,
    ]
  )
}

export async function deleteChatSession(noteId: string): Promise<void> {
  const db = await getDb()
  await db.execute(`DELETE FROM chat_sessions WHERE note_id = $1`, [noteId])
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

export interface EpisodeRow {
  id:                string
  note_id:           string | null
  opened_at:         number
  closed_at:         number | null
  message_count:     number
  topic_summary:     string | null
  intent_tags:       string | null
  boundary_score:    number
  created_at:        number
}

export interface EpisodeMessageRow {
  id:              string
  episode_id:      string
  role:            'user' | 'assistant'
  content:         string
  created_at:      number
}

export async function createEpisode(noteId: string | null): Promise<EpisodeRow> {
  const db  = await getDb()
  const now = Date.now()
  const id  = crypto.randomUUID()
  await db.execute(
    `INSERT INTO episodes (id, note_id, opened_at, message_count, boundary_score, created_at)
     VALUES ($1, $2, $3, 0, 0, $4)`,
    [id, noteId, now, now]
  )
  return {
    id, note_id: noteId, opened_at: now, closed_at: null,
    message_count: 0, topic_summary: null, intent_tags: null,
    boundary_score: 0, created_at: now,
  }
}

export async function getOpenEpisode(noteId: string): Promise<EpisodeRow | null> {
  const db   = await getDb()
  const rows = await db.select<EpisodeRow[]>(
    `SELECT * FROM episodes
     WHERE note_id = $1 AND closed_at IS NULL
     ORDER BY opened_at DESC LIMIT 1`,
    [noteId]
  )
  return rows[0] ?? null
}

export async function closeEpisode(
  episodeId:    string,
  topicSummary: string,
  intentTags:   string[],
  embedding?:   Float32Array,
): Promise<void> {
  const db  = await getDb()
  const now = Date.now()
  await db.execute(
    `UPDATE episodes
     SET closed_at        = $1,
         topic_summary    = $2,
         intent_tags      = $3,
         episode_embedding = $4
     WHERE id = $5`,
    [
      now,
      topicSummary,
      JSON.stringify(intentTags),
      embedding ? vectorToBlob(embedding) : null,
      episodeId,
    ]
  )
}

export async function incrementEpisodeMessageCount(episodeId: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    `UPDATE episodes SET message_count = message_count + 1 WHERE id = $1`,
    [episodeId]
  )
}

export async function appendEpisodeMessage(
  episodeId:      string,
  role:           'user' | 'assistant',
  content:        string,
  queryEmbedding?: Float32Array,
): Promise<void> {
  const db  = await getDb()
  const now = Date.now()
  await db.execute(
    `INSERT INTO episode_messages (id, episode_id, role, content, created_at, query_embedding)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      crypto.randomUUID(),
      episodeId,
      role,
      content,
      now,
      queryEmbedding ? vectorToBlob(queryEmbedding) : null,
    ]
  )
  await incrementEpisodeMessageCount(episodeId)
}

export async function getEpisodeMessages(episodeId: string): Promise<EpisodeMessageRow[]> {
  const db = await getDb()
  return db.select<EpisodeMessageRow[]>(
    `SELECT id, episode_id, role, content, created_at
     FROM episode_messages
     WHERE episode_id = $1
     ORDER BY created_at ASC`,
    [episodeId]
  )
}

export async function getRecentClosedEpisodes(
  limit: number = 10
): Promise<EpisodeRow[]> {
  const db = await getDb()
  return db.select<EpisodeRow[]>(
    `SELECT * FROM episodes
     WHERE closed_at IS NOT NULL
     ORDER BY closed_at DESC
     LIMIT $1`,
    [limit]
  )
}

export async function deleteEpisode(episodeId: string): Promise<void> {
  const db = await getDb()
  await db.execute(`DELETE FROM episodes WHERE id = $1`, [episodeId])
}