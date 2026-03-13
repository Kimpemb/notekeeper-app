// src/db/queries.ts
import { getDb } from "@/db/client";
import { ALL_MIGRATIONS } from "@/db/schema";
import type { Note, NoteVersion, Backlink } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Run all migrations at startup.
 * Each entry in ALL_MIGRATIONS is a single complete SQL statement — no splitting needed.
 */
export async function initDb(): Promise<void> {
  const db = await getDb();
  for (const sql of ALL_MIGRATIONS) {
    await db.execute(sql);
  }
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function getAllNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(`SELECT * FROM notes ORDER BY updated_at DESC`);
}

export async function getNoteById(id: string): Promise<Note | null> {
  const db = await getDb();
  const rows = await db.select<Note[]>(`SELECT * FROM notes WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getNotesByParent(parentId: string | null): Promise<Note[]> {
  const db = await getDb();
  if (parentId === null) {
    return db.select<Note[]>(
      `SELECT * FROM notes WHERE parent_id IS NULL ORDER BY updated_at DESC`
    );
  }
  return db.select<Note[]>(
    `SELECT * FROM notes WHERE parent_id = $1 ORDER BY updated_at DESC`,
    [parentId]
  );
}

export interface CreateNoteInput {
  title?: string;
  content?: string;
  plaintext?: string;
  tags?: string | null;
  parent_id?: string | null;
}

export async function createNote(input: CreateNoteInput = {}): Promise<Note> {
  const db = await getDb();
  const note: Note = {
    id: uuid(),
    title: input.title ?? "Untitled",
    content: input.content ?? JSON.stringify({ type: "doc", content: [] }),
    plaintext: input.plaintext ?? "",
    tags: input.tags ?? null,
    parent_id: input.parent_id ?? null,
    sync_id: uuid(),
    created_at: now(),
    updated_at: now(),
  };

  await db.execute(
    `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [note.id, note.title, note.content, note.plaintext, note.tags,
     note.parent_id, note.sync_id, note.created_at, note.updated_at]
  );

  return note;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  plaintext?: string;
  tags?: string | null;
  parent_id?: string | null;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.title     !== undefined) { fields.push(`title = $${idx++}`);     values.push(input.title); }
  if (input.content   !== undefined) { fields.push(`content = $${idx++}`);   values.push(input.content); }
  if (input.plaintext !== undefined) { fields.push(`plaintext = $${idx++}`); values.push(input.plaintext); }
  if (input.tags      !== undefined) { fields.push(`tags = $${idx++}`);      values.push(input.tags); }
  if (input.parent_id !== undefined) { fields.push(`parent_id = $${idx++}`); values.push(input.parent_id); }

  if (fields.length === 0) return;

  fields.push(`updated_at = $${idx++}`);
  values.push(now());
  values.push(id);

  await db.execute(
    `UPDATE notes SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

export async function deleteNote(id: string): Promise<void> {
  const descendants = await getAllDescendants(id);
  const allIds = [...descendants.reverse(), id];
  const db = await getDb();
  for (const noteId of allIds) {
    await db.execute(`DELETE FROM notes WHERE id = $1`, [noteId]);
  }
}

async function getAllDescendants(id: string): Promise<string[]> {
  const db = await getDb();
  const children = await db.select<{ id: string }[]>(
    `SELECT id FROM notes WHERE parent_id = $1`, [id]
  );
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    ids.push(...await getAllDescendants(child.id));
  }
  return ids;
}

export async function moveNote(id: string, newParentId: string | null): Promise<void> {
  if (newParentId !== null) {
    const descendants = await getAllDescendants(id);
    if (descendants.includes(newParentId) || newParentId === id) {
      throw new Error("Cannot move a note into one of its own descendants.");
    }
  }
  await updateNote(id, { parent_id: newParentId });
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

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  title: string;
  plaintext: string;
  updated_at: number;
  parent_id: string | null;
}

export async function searchNotes(query: string, limit = 20): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const db = await getDb();
  const sanitized = query.replace(/['"*^()]/g, " ").trim() + "*";
  return db.select<SearchResult[]>(
    `SELECT n.id, n.title, n.plaintext, n.updated_at, n.parent_id
     FROM notes_fts f
     JOIN notes n ON n.id = f.id
     WHERE notes_fts MATCH $1
     ORDER BY rank
     LIMIT $2`,
    [sanitized, limit]
  );
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

export async function syncBacklinks(sourceId: string, targetIds: string[]): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM backlinks WHERE source_id = $1`, [sourceId]);
  for (const targetId of targetIds) {
    if (targetId === sourceId) continue;
    await db.execute(
      `INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES ($1, $2)`,
      [sourceId, targetId]
    );
  }
}

export async function getBacklinksForNote(targetId: string): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    `SELECT n.* FROM notes n
     JOIN backlinks b ON b.source_id = n.id
     WHERE b.target_id = $1
     ORDER BY n.updated_at DESC`,
    [targetId]
  );
}

export async function getAllBacklinks(): Promise<Backlink[]> {
  const db = await getDb();
  return db.select<Backlink[]>(`SELECT * FROM backlinks`);
}

// ─── Export / Import ──────────────────────────────────────────────────────────

export async function exportAllNotes(): Promise<string> {
  return JSON.stringify(await getAllNotes(), null, 2);
}

/**
 * Validate and sanitize a raw parsed object into a Note.
 * Fills in missing required fields with safe defaults.
 */
function sanitizeNote(raw: Record<string, unknown>): Note {
  const now_ = Date.now();
  const title = typeof raw.title === "string" && raw.title.trim()
    ? raw.title.trim()
    : "Imported Note";
  const content = typeof raw.content === "string" && raw.content.trim()
    ? raw.content
    : JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
  const plaintext = typeof raw.plaintext === "string" ? raw.plaintext : "";
  const tags = typeof raw.tags === "string" ? raw.tags : null;
  const parent_id = typeof raw.parent_id === "string" ? raw.parent_id : null;
  const id = typeof raw.id === "string" && raw.id.trim()
    ? raw.id.trim()
    : crypto.randomUUID();
  const sync_id = typeof raw.sync_id === "string" && raw.sync_id.trim()
    ? raw.sync_id.trim()
    : crypto.randomUUID();
  const created_at = typeof raw.created_at === "number" ? raw.created_at : now_;
  const updated_at = typeof raw.updated_at === "number" ? raw.updated_at : now_;
  return { id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at };
}

/**
 * Sort notes so parents always come before their children.
 * Prevents FOREIGN KEY constraint failures during import.
 */
function topoSort(notes: Note[]): Note[] {
  const map = new Map(notes.map((n) => [n.id, n]));
  const result: Note[] = [];
  const visited = new Set<string>();

  function visit(note: Note) {
    if (visited.has(note.id)) return;
    // Visit parent first if it exists in the import set
    if (note.parent_id && map.has(note.parent_id)) {
      visit(map.get(note.parent_id)!);
    }
    visited.add(note.id);
    result.push(note);
  }

  for (const note of notes) visit(note);
  return result;
}

export async function importNotes(json: string): Promise<number> {
  const db = await getDb();
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of notes.");
  const notes: Note[] = topoSort(raw.map((r) => sanitizeNote(r as Record<string, unknown>)));
  let imported = 0;
  for (const note of notes) {
    if (await getNoteById(note.id)) continue;
    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [note.id, note.title, note.content, note.plaintext, note.tags,
       note.parent_id, note.sync_id ?? uuid(), note.created_at, note.updated_at]
    );
    imported++;
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
      `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, content=excluded.content, plaintext=excluded.plaintext,
         tags=excluded.tags, updated_at=excluded.updated_at`,
      [note.id, note.title, note.content, note.plaintext, note.tags,
       note.parent_id, note.sync_id ?? uuid(), note.created_at, note.updated_at]
    );
    count++;
  }
  return count;
}

export async function importNotesAsCopies(json: string): Promise<number> {
  const db = await getDb();
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of notes.");
  const notes: Note[] = topoSort(raw.map((r) => sanitizeNote(r as Record<string, unknown>)));
  // Build old→new ID map so parent_id references stay valid
  const idMap = new Map<string, string>();
  for (const note of notes) idMap.set(note.id, uuid());
  let count = 0;
  for (const note of notes) {
    const newId       = idMap.get(note.id)!;
    const newParentId = note.parent_id ? (idMap.get(note.parent_id) ?? null) : null;
    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [newId, note.title, note.content, note.plaintext, note.tags,
       newParentId, uuid(), now(), now()]
    );
    count++;
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
  const [noteCount]    = await db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM notes`);
  const [versionCount] = await db.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM note_versions`);
  return { totalNotes: noteCount.count, totalVersions: versionCount.count, tags: await getAllTags() };
}