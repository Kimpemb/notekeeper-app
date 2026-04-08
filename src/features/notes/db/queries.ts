  // src/features/notes/db/queries.ts
  import { getDb } from "@/features/notes/db/client";
  import { ALL_MIGRATIONS } from "@/features/notes/db/schema";
  import { deleteImage } from "@/lib/tauri/fs";
  import type { Note, NoteVersion, Backlink } from "@/types";
  import { blobToVector, vectorToBlob } from "@/features/ai/lib/provider"
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
    await backfillNoteBlocks();
  }

  // ─── Notes ────────────────────────────────────────────────────────────────────

  export async function getAllNotes(): Promise<Note[]> {
    const db = await getDb();
    return db.select<Note[]>(
      `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order 
      FROM notes WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
    );
  }

  export async function getNoteById(id: string): Promise<Note | null> {
    const db = await getDb();
    const rows = await db.select<Note[]>(
      `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order 
      FROM notes WHERE id = $1`, 
      [id]
    );
    return rows[0] ?? null;
  }

  export async function getNotesByParent(parentId: string | null): Promise<Note[]> {
    const db = await getDb();
    if (parentId === null) {
      return db.select<Note[]>(
        `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order 
        FROM notes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
      );
    }
    return db.select<Note[]>(
      `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order 
      FROM notes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
      [parentId]
    );
  }

  export interface CreateNoteInput {
    title?: string;
    content?: string;
    plaintext?: string;
    tags?: string | null;
    frontmatter?: string | null;
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
      frontmatter: input.frontmatter ?? null,
      parent_id: input.parent_id ?? null,
      sync_id: uuid(),
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
      sort_order,
    };

    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [note.id, note.title, note.content, note.plaintext, note.tags, note.frontmatter,
      note.parent_id, note.sync_id, note.created_at, note.updated_at, null, note.sort_order]
    );

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
      `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order 
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
  }

  export async function purgeTrashedNotes(): Promise<void> {
    const db = await getDb();
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expired = await db.select<Note[]>(
      `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order 
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
      `SELECT n.id, n.title, n.content, n.plaintext, n.tags, n.frontmatter, n.parent_id, n.sync_id, n.created_at, n.updated_at, n.deleted_at, n.sort_order
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

  // ─── Stale notes (not visited in N days) ─────────────────────────────────────

  export interface StaleNote extends Note {
    last_visit: number | null; // unix ms of most recent visit, null if never visited
  }

  export async function getStaleNotes(dayThreshold: number, limit = 5): Promise<StaleNote[]> {
    const db = await getDb();
    const cutoff = Date.now() - dayThreshold * 24 * 60 * 60 * 1000;

    return db.select<StaleNote[]>(
      `SELECT n.id, n.title, n.content, n.plaintext, n.tags, n.frontmatter, n.parent_id, n.sync_id, n.created_at, n.updated_at, n.deleted_at, n.sort_order, v.last_visit
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
      `SELECT id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order 
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
    const frontmatter = typeof raw.frontmatter === "string" ? raw.frontmatter : null;
    const parent_id  = typeof raw.parent_id  === "string" ? raw.parent_id  : null;
    const sort_order = typeof raw.sort_order === "number" ? raw.sort_order : 0;
    const id         = typeof raw.id         === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID();
    const sync_id    = typeof raw.sync_id    === "string" && raw.sync_id.trim() ? raw.sync_id.trim() : crypto.randomUUID();
    const created_at = typeof raw.created_at === "number" ? raw.created_at : now_;
    const updated_at = typeof raw.updated_at === "number" ? raw.updated_at : now_;
    return { id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at: null, sort_order };
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
    const rows = await db.select<{ id: string; deleted_at: number | null }[]>(
      `SELECT id, deleted_at FROM notes WHERE id = $1`, [note.id]
    );
    if (rows.length > 0 && rows[0].deleted_at === null) continue; // active — skip
    if (rows.length > 0) {
      // Trashed — restore and overwrite
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
  return count;
}

  export async function importNotesAsCopies(json: string): Promise<number> {
  const db = await getDb();
  const raw = JSON.parse(json);
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of notes.");
  const notes: Note[] = topoSort(raw.map((r) => sanitizeNote(r as Record<string, unknown>)));

  // Build old→new ID map upfront
  const idMap = new Map<string, string>();
  for (const note of notes) idMap.set(note.id, uuid());

  let count = 0;
  for (const note of notes) {
    const newId = idMap.get(note.id)!;
    const newParentId = note.parent_id ? (idMap.get(note.parent_id) ?? null) : null;

    // Remap any noteLink IDs inside the TipTap JSON content
    let remappedContent = note.content;
    for (const [oldId, newId_] of idMap.entries()) {
  remappedContent = remappedContent.replace(new RegExp(oldId, 'g'), newId_);
}

    await db.execute(
      `INSERT INTO notes (id, title, content, plaintext, tags, frontmatter, parent_id, sync_id, created_at, updated_at, deleted_at, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [newId, note.title, remappedContent, note.plaintext, note.tags, note.frontmatter,
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

  // ─── ADD THESE FUNCTIONS to the bottom of queries.ts ─────────────────────────
  //
  // Also add this import at the top of queries.ts:
  //   import { emit } from "@tauri-apps/api/event";

  // ─── Block Registry ───────────────────────────────────────────────────────────

  export interface BlockSearchResult {
    noteId:    string;
    noteTitle: string;
    blockId:   string;
    blockType: string;
    plaintext: string;
  }

  // Nodes worth indexing as standalone blocks
  const INDEXABLE_BLOCK_TYPES = new Set([
    "paragraph", "heading", "bulletList", "orderedList",
    "listItem", "taskItem", "codeBlock", "blockquote",
  ]);

  // Walk a TipTap JSON doc and yield all indexable blocks that have a blockId attr
  function* walkIndexableBlocks(
    node: { type: string; attrs?: Record<string, unknown>; content?: unknown[] },
    depth = 0
  ): Generator<{ blockId: string; blockType: string; plaintext: string }> {
    if (!node.content) return;
    for (const child of node.content as typeof node[]) {
      const blockId = child.attrs?.blockId as string | undefined;
      if (blockId && INDEXABLE_BLOCK_TYPES.has(child.type)) {
        yield { blockId, blockType: child.type, plaintext: extractNodeText(child) };
      }
      // Recurse into container nodes (lists, toggles, callouts)
      if (child.content && depth < 3) {
        yield* walkIndexableBlocks(child, depth + 1);
      }
    }
  }

  function extractNodeText(node: { type: string; text?: string; content?: unknown[] }): string {
    if (node.text) return node.text;
    if (!node.content) return "";
    return (node.content as typeof node[]).map(extractNodeText).join(" ").trim();
  }

  /**
   * Called by useAutoSave after every successful save.
   * Diffs the block registry for this note, upserts changed blocks,
   * deletes removed ones, and emits "block-updated" Tauri events
   * so live BlockRefNodeViews in other tabs re-render.
   */
  export async function syncNoteBlocks(
  noteId: string,
  contentJson: string
): Promise<void> {
  const db = await getDb();

  let doc: { type: string; attrs?: Record<string, unknown>; content?: unknown[] };
  try { doc = JSON.parse(contentJson); } catch { return; }

  const freshBlocks = [...walkIndexableBlocks(doc)];
  const freshIds    = new Set(freshBlocks.map((b) => b.blockId));
  const ts          = Date.now();

  // Fetch existing block IDs for this note
  const existing = await db.select<{ block_id: string }[]>(
    `SELECT block_id FROM note_blocks WHERE note_id = $1`, [noteId]
  );

  // Hoist emit import once — not inside the loop
  let emit: ((event: string, payload: unknown) => Promise<void>) | null = null;
  try {
    const mod = await import("@tauri-apps/api/event");
    emit = mod.emit;
  } catch { /**/ }

  // Upsert fresh blocks — DB writes only, no IPC per block
  for (const block of freshBlocks) {
    await db.execute(
      `INSERT INTO note_blocks (block_id, note_id, block_type, plaintext, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT(block_id) DO UPDATE SET
        block_type = excluded.block_type,
        plaintext  = excluded.plaintext,
        updated_at = excluded.updated_at`,
      [block.blockId, noteId, block.blockType, block.plaintext, ts]
    );
  }

  // Delete blocks that were removed from the note
  for (const { block_id } of existing) {
    if (!freshIds.has(block_id)) {
      await db.execute(`DELETE FROM note_blocks WHERE block_id = $1`, [block_id]);
    }
  }

  // One single IPC call for all changed blocks instead of N calls
  if (emit && freshBlocks.length > 0) {
    emit("blocks-updated", {
      noteId,
      blocks: freshBlocks.map((b) => ({ blockId: b.blockId, plaintext: b.plaintext })),
    }).catch(() => {});
  }
}

  /**
   * Full-text block search for the (( picker.
   * Excludes blocks from the currently-open note (you can't embed blocks in
   * the same note you're editing — avoids circular reference confusion).
   */
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
      // Split into lines, find all lines containing the query, return each as a separate result
      const lines = r.plaintext.split("\n").map((l) => l.trim()).filter(Boolean);
      const matchedLines = lines.filter((l) => l.toLowerCase().includes(q));

      // If no line matches (FTS matched title or tags), fall back to first non-empty line
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
    const notes = await getAllNotes();
    for (const note of notes) {
      if (!note.content) continue;
      const db = await getDb();
      const existing = await db.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM note_blocks WHERE note_id = $1`, [note.id]
      );
      if ((existing[0]?.count ?? 0) > 0) continue;
      await syncNoteBlocks(note.id, note.content);
    }
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
    if (row.note_hash !== noteUpdatedAt) return null; // stale
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
  
  // ── ai_tag_cache ──────────────────────────────────────────────────────────────
  
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
  
  // ── ai_history ────────────────────────────────────────────────────────────────
  
  export interface AIHistoryRow {
    id: string;
    note_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
  }
  
  const AI_HISTORY_LIMIT = 6; // 3 pairs (user + assistant)
  
  export async function getAIHistory(noteId: string): Promise<AIHistoryRow[]> {
    const db = await getDb();
    const rows = await db.select<AIHistoryRow[]>(
      `SELECT * FROM ai_history
      WHERE note_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
      [noteId, AI_HISTORY_LIMIT]
    );
    return rows.reverse(); // chronological order for prompt injection
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
    // Prune to last AI_HISTORY_LIMIT rows for this note
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
  
  // ── Bulk summary fetch for chat context ──────────────────────────────────────
  
  /**
   * Returns all stored summaries — used by chat.ts to build vault-wide context.
   * Maps noteId → summary string.
   */
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
  vector:     string   // base64 BLOB as stored in SQLite
  updated_at: number
}

export interface EmbeddingWithVector {
  block_id:  string
  note_id:   string
  model_id:  string
  vector:    Float32Array
  updated_at: number
}

/**
 * Upsert one embedding. Called by the indexer after a successful embed() call.
 * Uses INSERT OR REPLACE so re-embedding a block just overwrites the old row.
 */
export async function upsertEmbedding(
  blockId:  string,
  noteId:   string,
  modelId:  string,
  vector:   Float32Array
): Promise<void> {
  const db   = await getDb()
  const blob = vectorToBlob(vector)
  await db.execute(
    `INSERT INTO embeddings (block_id, note_id, model_id, vector, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(block_id, model_id) DO UPDATE SET
       vector     = excluded.vector,
       updated_at = excluded.updated_at`,
    [blockId, noteId, modelId, blob, Date.now()]
  )
}

/**
 * Load all embeddings for a given model — used by semantic search.
 * Deserializes BLOB → Float32Array for each row.
 * For large vaults this is the hot path — kept as a single SELECT.
 */
export async function getAllEmbeddings(modelId: string): Promise<EmbeddingWithVector[]> {
  const db   = await getDb()
  const rows = await db.select<EmbeddingRow[]>(
    `SELECT block_id, note_id, model_id, vector, updated_at
     FROM embeddings
     WHERE model_id = $1`,
    [modelId]
  )
  return rows.map((r) => ({
    ...r,
    vector: blobToVector(r.vector),
  }))
}

/**
 * Delete all embeddings for a note — called automatically via CASCADE
 * when a note is deleted, but exposed here for explicit use if needed.
 */
export async function deleteNoteEmbeddings(noteId: string): Promise<void> {
  const db = await getDb()
  await db.execute(`DELETE FROM embeddings WHERE note_id = $1`, [noteId])
}

/**
 * Detect embedding model mismatch — returns true if any embeddings exist
 * for this note under a different model_id than the one currently active.
 * Used by the indexer on startup to trigger re-embedding when provider changes.
 */
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

/**
 * Enqueue blocks for embedding. Called by useAutoSave after every save.
 * Uses INSERT OR IGNORE — if a block is already pending or processing,
 * we don't reset its state. If it's done or failed, OR REPLACE re-queues it.
 * This is the correct behaviour: a re-saved block should always be re-embedded.
 */
export async function enqueueEmbeddingJobs(
  blocks: { blockId: string; noteId: string }[]
): Promise<void> {
  if (blocks.length === 0) return
  const db = await getDb()
  const ts = Date.now()

  for (const { blockId, noteId } of blocks) {
    await db.execute(
      `INSERT INTO embedding_jobs
         (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
       VALUES ($1, $2, 'pending', 0, NULL, 0, $3)
       ON CONFLICT(block_id) DO UPDATE SET
         status          = CASE
                             WHEN excluded.status = 'pending'
                               AND embedding_jobs.status IN ('pending', 'processing')
                             THEN embedding_jobs.status   -- don't reset in-flight jobs
                             ELSE 'pending'
                           END,
         attempts        = 0,
         last_error      = NULL,
         next_attempt_at = 0,
         updated_at      = $3`,
      [blockId, noteId, ts]
    )
  }
}

/**
 * Pick up to `limit` jobs ready to process right now.
 * Skips jobs where next_attempt_at is in the future (backoff).
 * Atomically marks them 'processing' so concurrent workers don't double-pick.
 */
export async function claimPendingJobs(limit = 3): Promise<EmbeddingJobRow[]> {
  const db  = await getDb()
  const now = Date.now()

  // Fetch candidates first
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

  // Mark them processing
  for (const row of rows) {
    await db.execute(
      `UPDATE embedding_jobs
       SET status = 'processing', updated_at = $1
       WHERE block_id = $2 AND status = 'pending'`,
      [now, row.block_id]
    )
  }

  return rows
}

/**
 * Mark a job done after a successful embed.
 */
export async function markJobDone(blockId: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    `UPDATE embedding_jobs
     SET status = 'done', last_error = NULL, updated_at = $1
     WHERE block_id = $2`,
    [Date.now(), blockId]
  )
}

/**
 * Mark a job failed after an error.
 * If attempts < maxAttempts, requeues as pending with exponential backoff.
 * If attempts >= maxAttempts, marks permanently failed — indexer won't retry.
 */
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

  // Exponential backoff: 30s → 5min → 30min
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

/**
 * On app startup, reset any jobs stuck in 'processing' from a previous session.
 * A crash or force-quit can leave jobs mid-flight — this rescues them.
 */
export async function resetStuckJobs(): Promise<void> {
  const db = await getDb()
  await db.execute(
    `UPDATE embedding_jobs
     SET status = 'pending', updated_at = $1
     WHERE status = 'processing'`,
    [Date.now()]
  )
}

/**
 * Returns a live count of pending + processing jobs.
 * Used by the status indicator in the UI.
 */
export async function getPendingJobCount(): Promise<number> {
  const db   = await getDb()
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM embedding_jobs
     WHERE status IN ('pending', 'processing')`
  )
  return rows[0]?.count ?? 0
}

/**
 * Enqueue all blocks for a note that don't yet have embeddings
 * under the active model. Called on startup to catch notes that
 * were created before the indexer existed, or after a model switch.
 */
export async function enqueueUnindexedBlocks(activeModelId: string): Promise<number> {
  const db = await getDb()
  const ts = Date.now()

  // Blocks that exist but have no embedding for the active model
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
 
  // Get all blocks for this note in insertion order (proxy for document order)
  const allBlocks = await db.select<{ block_id: string; plaintext: string }[]>(
    `SELECT block_id, plaintext
     FROM note_blocks
     WHERE note_id = $1
       AND plaintext != ''
     ORDER BY rowid ASC`,
    [noteId]
  )
 
  if (allBlocks.length === 0) return []
 
  const idx = allBlocks.findIndex((b) => b.block_id === blockId)
  if (idx === -1) return []
 
  const start = Math.max(0, idx - windowSize)
  const end   = Math.min(allBlocks.length - 1, idx + windowSize)
 
  return allBlocks.slice(start, end + 1).map((b) => b.plaintext).filter(Boolean)
}

// ─── Phase 4: Rolling conversation summary ────────────────────────────────────

export interface ConversationSummaryRow {
  note_id:       string
  summary:       string
  message_count: number
  updated_at:    number
}

/**
 * Get the rolling summary for a note's conversation history.
 * Returns null if no summary exists yet.
 */
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

/**
 * Save or update the rolling summary for a note's conversation.
 */
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

/**
 * Clear the rolling summary for a note — called when user clears conversation.
 */
export async function clearConversationSummary(noteId: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    `DELETE FROM ai_conversation_summary WHERE note_id = $1`,
    [noteId]
  )
}