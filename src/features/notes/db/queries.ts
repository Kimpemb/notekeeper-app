// src/features/notes/db/queries.ts
import { getDb } from "@/features/notes/db/client";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";
import { deleteImage } from "@/lib/tauri/fs";
import type { Note, NoteVersion, Backlink } from "@/types";
import {
  getSimilarityResults,
  type FeedbackEntry,
} from "@/features/notes/similarity/similarityUtils";

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

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
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
  await purgeTrashedNotes();
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function getAllNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.select<Note[]>(
    `SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
  );
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
      `SELECT * FROM notes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
    );
  }
  return db.select<Note[]>(
    `SELECT * FROM notes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
    [parentId]
  );
}

export interface CreateNoteInput {
  title?: string;
  content?: string;
  plaintext?: string;
  tags?: string | null;
  parent_id?: string | null;
  sort_order?: number;
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
    parent_id: input.parent_id ?? null,
    sync_id: uuid(),
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
    sort_order,
  };

  await db.execute(
    `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [note.id, note.title, note.content, note.plaintext, note.tags,
     note.parent_id, note.sync_id, note.created_at, note.updated_at, null, note.sort_order]
  );

  return note;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  plaintext?: string;
  tags?: string | null;
  parent_id?: string | null;
  sort_order?: number;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.title      !== undefined) { fields.push(`title = $${idx++}`);      values.push(input.title); }
  if (input.content    !== undefined) { fields.push(`content = $${idx++}`);    values.push(input.content); }
  if (input.plaintext  !== undefined) { fields.push(`plaintext = $${idx++}`);  values.push(input.plaintext); }
  if (input.tags       !== undefined) { fields.push(`tags = $${idx++}`);       values.push(input.tags); }
  if (input.parent_id  !== undefined) { fields.push(`parent_id = $${idx++}`);  values.push(input.parent_id); }
  if (input.sort_order !== undefined) { fields.push(`sort_order = $${idx++}`); values.push(input.sort_order); }

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
  const allIds = [...descendants.reverse(), id];
  const db = await getDb();
  for (const noteId of allIds) {
    const note = await getNoteById(noteId);
    if (note) await deleteNoteAssets(note.content ?? "");
    await db.execute(`DELETE FROM notes WHERE id = $1`, [noteId]);
  }
}

export async function trashNote(id: string): Promise<void> {
  const descendants = await getAllDescendants(id);
  const allIds = [id, ...descendants];
  const db = await getDb();
  const trashedAt = now();
  for (const noteId of allIds) {
    await db.execute(
      `UPDATE notes SET deleted_at = $1 WHERE id = $2`,
      [trashedAt, noteId]
    );
  }
}

export async function restoreNote(id: string): Promise<void> {
  const db = await getDb();
  const descendants = await getAllDescendants(id);
  const allIds = [id, ...descendants];
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
    `SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
}

export async function emptyTrash(): Promise<void> {
  const db = await getDb();
  const trashed = await getTrashedNotes();
  await Promise.allSettled(
    trashed.map((note) => deleteNoteAssets(note.content ?? ""))
  );
  await db.execute(`DELETE FROM notes WHERE deleted_at IS NOT NULL`);
}

export async function purgeTrashedNotes(): Promise<void> {
  const db = await getDb();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = await db.select<Note[]>(
    `SELECT * FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
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

  const sanitized = query.trim().replace(/['"*^()]/g, " ").trim() + "*";
  const bare      = query.trim();

  return db.select<SearchResult[]>(
    `SELECT
       n.id,
       n.title,
       snippet(notes_fts, 2, '**', '**', '…', 12) AS snippet,
       n.updated_at,
       n.parent_id,
       instr(n.plaintext, $2) AS offset
     FROM notes_fts f
     JOIN notes n ON n.id = f.id
     WHERE notes_fts MATCH $1
       AND n.deleted_at IS NULL
     ORDER BY rank
     LIMIT $3`,
    [sanitized, bare, limit]
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
       AND n.deleted_at IS NULL
     ORDER BY n.updated_at DESC`,
    [targetId]
  );
}

export async function getAllBacklinks(): Promise<Backlink[]> {
  const db = await getDb();
  return db.select<Backlink[]>(`SELECT * FROM backlinks`);
}

// ─── Stale notes (not visited in N days) ─────────────────────────────────────

export interface StaleNote extends Note {
  last_visit: number | null; // unix ms of most recent visit, null if never visited
}

export async function getStaleNotes(dayThreshold: number, limit = 5): Promise<StaleNote[]> {
  const db = await getDb();
  const cutoff = Date.now() - dayThreshold * 24 * 60 * 60 * 1000;

  return db.select<StaleNote[]>(
    `SELECT n.*, v.last_visit
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

export async function getUnlinkedMentions(
  targetId: string,
  targetTitle: string
): Promise<UnlinkedMention[]> {
  if (!targetTitle.trim() || /^Untitled-\d+$/.test(targetTitle)) return [];

  const db = await getDb();

  const linked = await db.select<{ source_id: string }[]>(
    `SELECT source_id FROM backlinks WHERE target_id = $1`,
    [targetId]
  );
  const linkedIds = new Set(linked.map((r) => r.source_id));

  const allNotes = await db.select<Note[]>(
    `SELECT * FROM notes WHERE deleted_at IS NULL AND id != $1`,
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

    const rawMatches = [...plaintext.matchAll(new RegExp(regex.source, "gi"))];
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
  const plaintext  = typeof raw.plaintext  === "string" ? raw.plaintext  : "";
  const tags       = typeof raw.tags       === "string" ? raw.tags       : null;
  const parent_id  = typeof raw.parent_id  === "string" ? raw.parent_id  : null;
  const sort_order = typeof raw.sort_order === "number" ? raw.sort_order : 0;
  const id         = typeof raw.id         === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();
  const sync_id    = typeof raw.sync_id    === "string" && raw.sync_id.trim() ? raw.sync_id.trim() : crypto.randomUUID();
  const created_at = typeof raw.created_at === "number" ? raw.created_at : now_;
  const updated_at = typeof raw.updated_at === "number" ? raw.updated_at : now_;
  return { id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at, deleted_at: null, sort_order };
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

export async function importNotes(json: string): Promise<number> {
  const db = await getDb();
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of notes.");
  const notes: Note[] = topoSort(raw.map((r) => sanitizeNote(r as Record<string, unknown>)));
  let imported = 0;
  for (const note of notes) {
    if (await getNoteById(note.id)) continue;
    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [note.id, note.title, note.content, note.plaintext, note.tags,
       note.parent_id, note.sync_id ?? uuid(), note.created_at, note.updated_at, null, note.sort_order]
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
      `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, content=excluded.content, plaintext=excluded.plaintext,
         tags=excluded.tags, updated_at=excluded.updated_at, sort_order=excluded.sort_order`,
      [note.id, note.title, note.content, note.plaintext, note.tags,
       note.parent_id, note.sync_id ?? uuid(), note.created_at, note.updated_at, null, note.sort_order]
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
  const idMap = new Map<string, string>();
  for (const note of notes) idMap.set(note.id, uuid());
  let count = 0;
  for (const note of notes) {
    const newId       = idMap.get(note.id)!;
    const newParentId = note.parent_id ? (idMap.get(note.parent_id) ?? null) : null;
    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [newId, note.title, note.content, note.plaintext, note.tags,
       newParentId, uuid(), now(), now(), null, note.sort_order]
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

/**
 * Returns the top `limit` similar notes for `noteId`.
 *
 * - Takes `allNotes` from the store to avoid a duplicate DB fetch.
 * - Fetches feedback + backlinks from the DB, then scores in JS.
 */
export async function getSimilarNotes(
  noteId: string,
  allNotes: Note[],
  limit = 5
): Promise<SimilarNote[]> {
  const sourceNote = allNotes.find((n) => n.id === noteId);
  if (!sourceNote) return [];
 
  const db = await getDb();
 
  // Fetch all feedback rows in one query
  const feedback = await db.select<FeedbackEntry[]>(
    `SELECT source_id, target_id, action FROM suggestion_feedback`
  );
 
  // Collect all note IDs already linked to/from this note (bidirectional)
  const backlinkRows = await db.select<{ source_id: string; target_id: string }[]>(
    `SELECT source_id, target_id FROM backlinks
     WHERE source_id = $1 OR target_id = $1`,
    [noteId]
  );
  const backlinkIds = new Set(
    backlinkRows.flatMap(({ source_id, target_id }) => [source_id, target_id])
  );
  backlinkIds.delete(noteId); // don't exclude self via this set — scoreCandidate handles that
 
  const results = getSimilarityResults(
    sourceNote,
    allNotes,
    feedback,
    backlinkIds,
    limit
  );
 
  // Hydrate each result with the full Note fields
  const noteMap = new Map(allNotes.map((n) => [n.id, n]));
  return results.map((r) => ({
    ...noteMap.get(r.noteId)!,
    score: r.score,
    confidence: r.confidence,
    sharedTags: r.sharedTags,
    sharedKeywords: r.sharedKeywords,
  }));
}
 
/**
 * Records a user's accept/ignore decision for a suggested note pair.
 *
 * Uses INSERT OR REPLACE so a later decision overwrites an earlier one
 * (e.g. user ignored then later accepts).
 */
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
 
/**
 * Returns all feedback rows — used by the similarity engine to apply
 * boosts (accepted ×1.5) and exclusions (ignored ×0.0).
 */
export async function getSuggestionFeedback(): Promise<FeedbackEntry[]> {
  const db = await getDb();
  return db.select<FeedbackEntry[]>(
    `SELECT source_id, target_id, action FROM suggestion_feedback`
  );
}

// ─── Cluster gap suggestion persistence ───────────────────────────────────────
// Append these functions to the bottom of src/features/notes/db/queries.ts
 
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