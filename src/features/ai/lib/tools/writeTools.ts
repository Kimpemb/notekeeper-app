// src/features/ai/lib/tools/writeTools.ts
//
// Write tool executors — called ONLY after user confirmation via the
// confirmation gate. Never called directly from the model response handler.
//
// Design: markdown round-trip for all note mutations.
//   Read:  prosemirrorBodyToMarkdown(note.content)  → markdown string
//   Edit:  text-level append / insert / replace in markdown space
//   Write: markdownToDoc(edited markdown) → TipTap JSON → updateNote
//
// This keeps the representation consistent with what executeGetNote and
// executeGetCurrentNote return to the model, so replaceInNote's old_content
// can exact-match what the model was shown.

import { getNoteById, createNote as dbCreateNote, updateNote } from "@/features/notes/db/queries";
import {
  createEvent,
  deleteEvent,
  getEvent,
  updateEvent,
  getEventsForDateRange,
  type CalendarEventInput,
  type CalendarEvent,
} from "@/features/calendar/db/calendarQueries";
import { getGoal, updateGoal as dbUpdateGoal, type GoalInput } from "@/features/goals/db/goalQueries";
import { prosemirrorBodyToMarkdown } from "@/lib/exporters/markdown";
import { markdownToDoc }             from "@/features/ai/lib/save/parseMarkdown";

// ─── Block-ID backfill for tool-generated nodes ──────────────────────────────
//
// Write-tool operations never pass through a mounted TipTap editor, so the
// BlockIdExtension appendTransaction plugin (which normally stamps a fresh
// blockId onto any indexable node missing one) never runs for content that
// markdownToDoc() produces here. Without this, every node an AI write inserts
// or replaces persists with blockId: null — permanently, unless the user later
// happens to edit that exact node inside the editor.
//
// Mirrors BlockIdExtension's TARGET_TYPES. TODO: extract to a single shared
// constant once BlockIdExtension.ts and this file can share an import without
// pulling ProseMirror/TipTap into the tool-execution bundle.
const BACKFILL_TARGET_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
  "table",
  "toggle",
]);

/**
 * Recursively stamp a fresh blockId onto any node of a target type that is
 * missing one. Mutates the nodes in place — safe because these nodes were
 * just produced by markdownToDoc() for this call and aren't shared elsewhere.
 */
function backfillBlockIds(nodes: unknown[]): void {
  for (const node of nodes) {
    const n = node as Record<string, unknown>;
    if (typeof n.type === "string" && BACKFILL_TARGET_TYPES.has(n.type)) {
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      if (!attrs.blockId) {
        n.attrs = { ...attrs, blockId: crypto.randomUUID() };
      }
    }
    if (Array.isArray(n.content)) {
      backfillBlockIds(n.content as unknown[]);
    }
  }
}

// ─── Store refresh helpers ────────────────────────────────────────────────────

async function refreshNoteInStore(noteId: string): Promise<void> {
  try {
    const { useNoteStore } = await import("@/features/notes/store/useNoteStore");
    await useNoteStore.getState().refreshNote(noteId);
  } catch { /* non-fatal */ }
}

// refreshNotesListInStore was removed — it called loadNotes()/getAllNotesMeta(),
// which omits `content` and blanks every open editor when the result replaces
// the store's notes array. Use addNoteToStore/removeNoteFromStore for in-memory
// patches instead (see executeCreateNote / undoCreateNote below).

// ─── Result types ─────────────────────────────────────────────────────────────

export interface WriteToolResult {
  success:              boolean;
  error?:               string;
  noteId?:              string;
  noteTitle?:           string;
  undoData?:            unknown;        // tool-specific, opaque to the gate
  insertedViaFallback?: boolean;        // true when insertInNote fell back to append
  conflicts?:           CalendarConflict[];
  createdEvents?:       { id: string; title: string; date: string; time: string | null }[];
}

export interface CalendarConflict {
  date:          string;
  time:          string | null;
  existingTitle: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Convert a note's TipTap JSON to a markdown body string.
 * Returns "" on parse failure (safe default — produces empty diff).
 */
function noteBodyToMarkdown(contentJson: string | null | undefined): string {
  if (!contentJson) return "";
  return prosemirrorBodyToMarkdown(contentJson);
}

/**
 * Convert a markdown string back to TipTap JSON + plaintext.
 * markdownToDoc returns { type: "doc", content: [...] }.
 */
function markdownToNoteContent(md: string): { contentJson: string; plaintext: string } {
  const doc = markdownToDoc(md);
  const contentJson = JSON.stringify(doc);
  const plaintext   = extractPlaintext(doc);
  return { contentJson, plaintext };
}

/** Naive plaintext extractor — mirrors what the note store does for indexing. */
function extractPlaintext(doc: unknown): string {
  const lines: string[] = [];
  function walk(node: Record<string, unknown>) {
    if (node.type === "text" && typeof node.text === "string") {
      lines.push(node.text);
    }
    if (Array.isArray(node.content)) {
      (node.content as Record<string, unknown>[]).forEach(walk);
    }
  }
  walk(doc as Record<string, unknown>);
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

// ─── appendToNote ─────────────────────────────────────────────────────────────

export interface AppendToNoteInput {
  note_id: string;
  content: string;
  heading?: string;
}

export interface AppendToNoteUndoData {
  noteId:          string;
  originalContent:  string;   // raw TipTap JSON
  originalPlaintext: string;
}

export async function executeAppendToNote(
  input: AppendToNoteInput
): Promise<WriteToolResult> {
  try {
    const note = await getNoteById(input.note_id);
    if (!note) {
      return { success: false, error: `Note ${input.note_id} not found.` };
    }

    const originalContent   = note.content ?? JSON.stringify({ type: "doc", content: [] });
    const originalPlaintext = note.plaintext ?? "";

    // Parse existing doc to append at JSON level — preserves subpages,
    // backlinks, and other custom nodes that don't survive markdown round-trip.
    let doc: { type: string; content?: unknown[] };
    try {
      doc = note.content ? JSON.parse(note.content) : { type: "doc", content: [] };
    } catch {
      doc = { type: "doc", content: [] };
    }
    if (!Array.isArray(doc.content)) doc.content = [];

    // Build the nodes to append via markdownToDoc (only for the NEW content)
    const newMarkdown = input.heading
      ? `## ${input.heading}\n\n${input.content.trimStart()}`
      : input.content.trimStart();
    const newDoc = markdownToDoc(newMarkdown);
    const newNodes = (newDoc as { content?: unknown[] }).content ?? [];
    backfillBlockIds(newNodes);

    // Append new nodes to the existing doc
    const mergedDoc = { ...doc, content: [...doc.content, ...newNodes] };
    const contentJson = JSON.stringify(mergedDoc);
    const plaintext = extractPlaintext(mergedDoc);

    await updateNote(note.id, { content: contentJson, plaintext });

    // Refresh the store and notify editor
    await refreshNoteInStore(note.id);
    window.dispatchEvent(
      new CustomEvent("idemora:note-updated", { detail: { noteId: note.id } })
    );

    return {
      success:    true,
      noteId:     note.id,
      noteTitle:  note.title,
      undoData:   { noteId: note.id, originalContent, originalPlaintext } satisfies AppendToNoteUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoAppendToNote(
  undoData: AppendToNoteUndoData
): Promise<void> {
  await updateNote(undoData.noteId, {
    content:   undoData.originalContent,
    plaintext: undoData.originalPlaintext,
  });
  await refreshNoteInStore(undoData.noteId);
  window.dispatchEvent(
    new CustomEvent("idemora:note-updated", { detail: { noteId: undoData.noteId } })
  );
}

// ─── insertInNote ─────────────────────────────────────────────────────────────

export interface InsertInNoteInput {
  note_id:        string;
  content:        string;
  after_block_id?: string;
}

export interface InsertInNoteUndoData {
  noteId:           string;
  originalContent:  string;   // raw TipTap JSON
  originalPlaintext: string;
}

export async function executeInsertInNote(
  input: InsertInNoteInput
): Promise<WriteToolResult> {
  try {
    const note = await getNoteById(input.note_id);
    if (!note) {
      return { success: false, error: `Note ${input.note_id} not found.` };
    }

    const originalContent   = note.content ?? JSON.stringify({ type: "doc", content: [] });
    const originalPlaintext = note.plaintext ?? "";
    let insertedViaFallback = false;

    // Resolution: fallback — append to end if no anchor block_id supplied
    if (!input.after_block_id) {
      insertedViaFallback = true;
    }

    // Operate at JSON level to preserve custom nodes. Convert only the new
    // content through markdownToDoc, then splice into the existing doc JSON
    // rather than round-tripping the whole doc.
    let doc: { type: string; content?: unknown[] };
    try {
      doc = note.content ? JSON.parse(note.content) : { type: "doc", content: [] };
    } catch {
      doc = { type: "doc", content: [] };
    }
    if (!Array.isArray(doc.content)) doc.content = [];

    const newNodes = ((markdownToDoc(input.content) as { content?: unknown[] }).content ?? []);
    backfillBlockIds(newNodes);

    let mergedDoc: { type: string; content: unknown[] };

    if (insertedViaFallback) {
      // Append to end
      mergedDoc = { ...doc, content: [...doc.content, ...newNodes] };
    } else {
      // Insert immediately after the block matching after_block_id. If the
      // block_id doesn't exist in the note (stale id, model error), this
      // falls back to append and reports found: false — surface that as
      // insertedViaFallback so the confirmation card and model response are
      // honest about what happened, instead of silently appending while
      // claiming a precise insertion.
      const { newDoc, found } = insertNodesAfterBlockId(
        doc as { type: string; content: unknown[] },
        input.after_block_id!,
        newNodes
      );
      mergedDoc = newDoc;
      if (!found) insertedViaFallback = true;
    }

    const contentJson = JSON.stringify(mergedDoc);
    const plaintext   = extractPlaintext(mergedDoc);
    await updateNote(note.id, { content: contentJson, plaintext });

    // Refresh the store and notify editor
    await refreshNoteInStore(note.id);
    window.dispatchEvent(
      new CustomEvent("idemora:note-updated", { detail: { noteId: note.id } })
    );

    return {
      success:              true,
      noteId:               note.id,
      noteTitle:            note.title,
      insertedViaFallback,
      undoData:             { noteId: note.id, originalContent, originalPlaintext } satisfies InsertInNoteUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

 

export async function undoInsertInNote(
  undoData: InsertInNoteUndoData
): Promise<void> {
  await updateNote(undoData.noteId, {
    content:   undoData.originalContent,
    plaintext: undoData.originalPlaintext,
  });
  await refreshNoteInStore(undoData.noteId);
  window.dispatchEvent(
    new CustomEvent("idemora:note-updated", { detail: { noteId: undoData.noteId } })
  );
}

// ─── replaceInNote ────────────────────────────────────────────────────────────

export interface ReplaceInNoteInput {
  note_id:     string;
  block_id:    string;
  new_content: string;
}

export interface ReplaceInNoteUndoData {
  noteId:           string;
  originalContent:  string;   // raw TipTap JSON
  originalPlaintext: string;
}

export async function executeReplaceInNote(
  input: ReplaceInNoteInput
): Promise<WriteToolResult> {
  try {
    const note = await getNoteById(input.note_id);
    if (!note) {
      return { success: false, error: `Note ${input.note_id} not found.` };
    }

    const originalContent   = note.content ?? JSON.stringify({ type: "doc", content: [] });
    const originalPlaintext = note.plaintext ?? "";

    let doc: { type: string; content?: unknown[] };
    try {
      doc = note.content ? JSON.parse(note.content) : { type: "doc", content: [] };
    } catch {
      doc = { type: "doc", content: [] };
    }
    if (!Array.isArray(doc.content)) doc.content = [];

    // Find the node by block_id — walk the full tree recursively
    const replacementNodes = (markdownToDoc(input.new_content) as { content?: unknown[] }).content ?? [];
    backfillBlockIds(replacementNodes);
    const { newDoc, found } = replaceNodeByBlockId(
      doc as { type: string; content: unknown[] },
      input.block_id,
      replacementNodes
    );

    if (!found) {
      return {
        success: false,
        error:   `block_not_found: No node with block_id "${input.block_id}" found in note. Call getNote to refresh the node list and try again.`,
      };
    }

    const contentJson = JSON.stringify(newDoc);
    const plaintext   = extractPlaintext(newDoc);

    await updateNote(note.id, { content: contentJson, plaintext });
    await refreshNoteInStore(note.id);
    window.dispatchEvent(
      new CustomEvent("idemora:note-updated", { detail: { noteId: note.id } })
    );

    return {
      success:   true,
      noteId:    note.id,
      noteTitle: note.title,
      undoData:  { noteId: note.id, originalContent, originalPlaintext } satisfies ReplaceInNoteUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoReplaceInNote(
  undoData: ReplaceInNoteUndoData
): Promise<void> {
  await updateNote(undoData.noteId, {
    content:   undoData.originalContent,
    plaintext: undoData.originalPlaintext,
  });
  await refreshNoteInStore(undoData.noteId);
  window.dispatchEvent(
    new CustomEvent("idemora:note-updated", { detail: { noteId: undoData.noteId } })
  );
}

// ─── deleteBlocksInNote ───────────────────────────────────────────────────────

export interface DeleteBlocksInNoteInput {
  note_id:        string;
  from_block_id:  string;
  to_block_id:    string;
}

export interface DeleteBlocksInNoteUndoData {
  noteId:            string;
  originalContent:   string;   // raw TipTap JSON — full-content snapshot for undo
  originalPlaintext: string;
}

export async function executeDeleteBlocksInNote(
  input: DeleteBlocksInNoteInput
): Promise<WriteToolResult> {
  try {
    const note = await getNoteById(input.note_id);
    if (!note) {
      return { success: false, error: `Note ${input.note_id} not found.` };
    }

    const originalContent   = note.content ?? JSON.stringify({ type: "doc", content: [] });
    const originalPlaintext = note.plaintext ?? "";

    let doc: { type: string; content?: unknown[] };
    try {
      doc = note.content ? JSON.parse(note.content) : { type: "doc", content: [] };
    } catch {
      doc = { type: "doc", content: [] };
    }
    if (!Array.isArray(doc.content)) doc.content = [];

    const { newDoc, found, error: rangeError } = deleteBlocksInRange(
      doc as { type: string; content: unknown[] },
      input.from_block_id,
      input.to_block_id
    );

    if (!found) {
      const detail =
        rangeError === "blocks_not_same_level"
          ? `Blocks "${input.from_block_id}" and "${input.to_block_id}" are not siblings at the same ` +
            `nesting level — a range delete can only span blocks that share the same parent container ` +
            `(e.g. both top-level, or both inside the same toggle/list item). ` +
            `Do NOT retry this same range with a different batch size — resizing does not fix a ` +
            `nesting-level mismatch. Instead, split the operation: (1) delete the top-level siblings ` +
            `in one call, then (2) delete the container itself (the toggle, list item, etc.) in a ` +
            `SEPARATE call, passing the container's own block_id as BOTH from_block_id and to_block_id — ` +
            `this removes the container and everything nested inside it in one operation.`
          : `Could not find a contiguous range from "${input.from_block_id}" to "${input.to_block_id}" ` +
            `in note. Call getNote to refresh the node list and try again.`;
      return {
        success: false,
        error: `${rangeError ?? "blocks_not_found"}: ${detail}`,
      };
    }

    const contentJson = JSON.stringify(newDoc);
    const plaintext   = extractPlaintext(newDoc);

    await updateNote(note.id, { content: contentJson, plaintext });
    await refreshNoteInStore(note.id);
    window.dispatchEvent(
      new CustomEvent("idemora:note-updated", { detail: { noteId: note.id } })
    );

    return {
      success:   true,
      noteId:    note.id,
      noteTitle: note.title,
      undoData:  { noteId: note.id, originalContent, originalPlaintext } satisfies DeleteBlocksInNoteUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoDeleteBlocksInNote(
  undoData: DeleteBlocksInNoteUndoData
): Promise<void> {
  await updateNote(undoData.noteId, {
    content:   undoData.originalContent,
    plaintext: undoData.originalPlaintext,
  });
  await refreshNoteInStore(undoData.noteId);
  window.dispatchEvent(
    new CustomEvent("idemora:note-updated", { detail: { noteId: undoData.noteId } })
  );
}

/**
 * Walk the doc tree and remove every node from the one matching
 * fromBlockId through the one matching toBlockId, inclusive, at the
 * same sibling level. Mirrors the recursive shape of replaceNodeByBlockId
 * so nested containers (toggles, blockquotes, list items) are reachable
 * while searching — but once a range is "open" (deleting), sibling nodes
 * are removed as opaque units rather than recursed into, since a delete
 * range is expected to span whole top-level blocks.
 *
 * Returns found: true only if BOTH endpoints were matched in sequence.
 * On any incomplete match (from found but to never reached, or neither
 * found) the original doc is returned unchanged — no partial deletion.
 */
/**
 * Flatten the doc into an ordered list of (blockId, parent-siblings-array,
 * index-within-that-array) entries, then delete a contiguous range between
 * fromBlockId and toBlockId.
 *
 * The old implementation used a single mutable phase flag shared across the
 * whole recursive walk. Once it flipped to "deleting" it stopped recursing
 * into containers entirely, so any range whose endpoints didn't sit at the
 * exact same nesting depth either (a) never found the second endpoint and
 * silently reverted the whole delete, or (b) deleted a container as one
 * opaque unit while leaving a partially-matched sibling structure behind.
 *
 * This version identifies the endpoints first, requires them to be literal
 * siblings in the same content array, and reports *why* it failed
 * ("blocks_not_found" vs "blocks_not_same_level") instead of collapsing both
 * cases into one unhelpful error.
 */
function deleteBlocksInRange(
  doc: { type: string; content: unknown[] },
  fromBlockId: string,
  toBlockId: string
): { newDoc: { type: string; content: unknown[] }; found: boolean; error?: string } {
  interface FlatEntry {
    blockId: string | null;
    siblings: unknown[];
    index: number;
  }

  function flatten(nodes: unknown[], acc: FlatEntry[]): FlatEntry[] {
    nodes.forEach((node, i) => {
      const n = node as Record<string, unknown>;
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;
      const blockId = typeof attrs.blockId === "string" ? attrs.blockId : null;
      acc.push({ blockId, siblings: nodes, index: i });
      if (Array.isArray(n.content)) {
        flatten(n.content as unknown[], acc);
      }
    });
    return acc;
  }

  const flat      = flatten(doc.content, []);
  const fromEntry = flat.find((e) => e.blockId === fromBlockId);
  const toEntry   = flat.find((e) => e.blockId === toBlockId);

  if (!fromEntry || !toEntry) {
    return { newDoc: doc, found: false, error: "blocks_not_found" };
  }
  if (fromEntry.siblings !== toEntry.siblings) {
    return { newDoc: doc, found: false, error: "blocks_not_same_level" };
  }

  const start = Math.min(fromEntry.index, toEntry.index);
  const end   = Math.max(fromEntry.index, toEntry.index);

  // Mutating the shared siblings array reference in place is safe here:
  // `doc` is a fresh JSON.parse result scoped to this single call and is
  // discarded (or persisted, but never reused) after this function returns.
  fromEntry.siblings.splice(start, end - start + 1);

  return { newDoc: doc, found: true };
}

// ─── createNote ───────────────────────────────────────────────────────────────

export interface CreateNoteInput {
  title:        string;
  content:      string;            // markdown
  frontmatter?: string | null;     // JSON string
  parent_id?:   string | null;
}

export interface CreateNoteUndoData {
  noteId: string;
}

export async function executeCreateNote(
  input: CreateNoteInput
): Promise<WriteToolResult> {
  try {
    // Validate parent_id exists before attempting insert
    if (input.parent_id) {
      const parent = await getNoteById(input.parent_id);
      if (!parent) {
        return { success: false, error: `Parent note ${input.parent_id} not found. Search for the correct note ID first.` };
      }
    }

    const { contentJson, plaintext } = markdownToNoteContent(input.content);

    // Parse frontmatter JSON string if provided
    let frontmatterStr: string | null = null;
    if (input.frontmatter) {
      try {
        JSON.parse(input.frontmatter); // validate — throws if malformed
        frontmatterStr = input.frontmatter;
      } catch {
        // malformed frontmatter — skip it silently
      }
    }

    const note = await dbCreateNote({
      title:      input.title,
      content:    contentJson,
      plaintext,
      frontmatter: frontmatterStr,
      parent_id:  input.parent_id ?? null,
    });

    // Patch the store in-memory — never call loadNotes()/getAllNotesMeta()
    // here, it would strip `content` from every note and blank all open
    // editors (same bug class as the moveNote editor-blanking issue).
    const { useNoteStore } = await import("@/features/notes/store/useNoteStore");
    useNoteStore.getState().addNoteToStore(note);
    window.dispatchEvent(new CustomEvent("idemora:note-created", { detail: { noteId: note.id } }));

    return {
      success:   true,
      noteId:    note.id,
      noteTitle: note.title,
      undoData:  { noteId: note.id } satisfies CreateNoteUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoCreateNote(
  undoData: CreateNoteUndoData
): Promise<void> {
  const { trashNote } = await import("@/features/notes/db/queries");
  await trashNote(undoData.noteId);
  const { useNoteStore } = await import("@/features/notes/store/useNoteStore");
  useNoteStore.getState().removeNoteFromStore(undoData.noteId);
  window.dispatchEvent(
    new CustomEvent("idemora:note-deleted", { detail: { noteId: undoData.noteId } })
  );
}

// ─── createCalendarEvents ─────────────────────────────────────────────────────

export interface CreateCalendarEventsEventInput {
  title:         string;
  date:          string;           // YYYY-MM-DD
  time?:         string | null;    // HH:MM 24h
  duration_mins?: number | null;
  category?:     string | null;
  notes?:        string | null;
}

export interface CreateCalendarEventsInput {
  events: CreateCalendarEventsEventInput[];
}

export interface CreateCalendarEventsUndoData {
  eventIds: string[];
}

export async function executeCreateCalendarEvents(
  input: CreateCalendarEventsInput
): Promise<WriteToolResult> {
  try {
    const events = input.events;
    if (!events || events.length === 0) {
      return { success: false, error: "No events provided." };
    }

    // Conflict detection — check each event's date for existing events
    const conflicts: CalendarConflict[] = [];
    for (const ev of events) {
      const existing = await getEventsForDateRange({
        startDate: ev.date,
        endDate:   ev.date,
        layers:    ["personal", "notes", "tasks", "goals", "cde"],
      });
      for (const ex of existing) {
        if (ev.time && ex.time && timesOverlap(ev, ex)) {
          conflicts.push({
            date:          ev.date,
            time:          ev.time,
            existingTitle: ex.title,
          });
        }
      }
    }

    // Create all events — conflicts are flagged but don't block creation
    const createdIds: string[] = [];
    for (const ev of events) {
      const id = await createEvent({
        title:        ev.title,
        date:         ev.date,
        time:         ev.time        ?? null,
        duration_mins: ev.duration_mins ?? null,
        category:     (ev.category as CalendarEventInput["category"]) ?? "personal",
        notes:        ev.notes ? `${ev.notes} [ai_created]` : "[ai_created]",
        colour_state: "blue",
      });

      // Log to score_event_log (anti-gaming — same as manual createEvent path)
      await logScoreEvent(id, ev.date);

      createdIds.push(id);
    }

    window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));

    return {
      success:   true,
      conflicts,
      undoData:  { eventIds: createdIds } satisfies CreateCalendarEventsUndoData,
      createdEvents: createdIds.map((id, i) => ({
        id,
        title: events[i].title,
        date:  events[i].date,
        time:  events[i].time ?? null,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/** Rough overlap check: two events on the same date overlap if their time windows intersect. */
function timesOverlap(
  a: CreateCalendarEventsEventInput,
  b: CalendarEvent
): boolean {
  if (!a.time || !b.time) return false;
  const aStart = timeToMins(a.time);
  const aEnd   = aStart + (a.duration_mins ?? 60);
  const bStart = timeToMins(b.time);
  const bEnd   = bStart + (b.duration_mins ?? 60);
  return aStart < bEnd && bStart < aEnd;
}

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Insert a row into score_event_log for a newly created event.
 * Mirrors the logic in the existing calendarQueries / score paths.
 * Uses a dynamic import to avoid a circular dependency between tools and score.
 */
async function logScoreEvent(eventId: string, date: string): Promise<void> {
  try {
    const { getDb } = await import("@/features/notes/db/client");
    const db = await getDb();
    // Fetch the event to get title and category for the log row
const event = await getEvent(eventId);
if (event) {
  await db.execute(
    `INSERT OR IGNORE INTO score_event_log
       (id, score_date, event_id, event_title, category, colour_state, locked)
     VALUES ($1, $2, $3, $4, $5, $6, 0)`,
    [crypto.randomUUID(), date, eventId, event.title, event.category ?? "personal", event.colour_state ?? "blue"]
  );
}
  } catch (err) {
    // Non-fatal — log and continue. Score logging failure must not block event creation.
    console.warn("[writeTools] score_event_log insert failed:", err);
  }
}

export async function undoCreateCalendarEvents(
  undoData: CreateCalendarEventsUndoData
): Promise<void> {
  // Delete the created events. score_event_log rows survive (anti-gaming).
  for (const id of undoData.eventIds) {
    await deleteEvent(id);
  }
  window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));
}

// ─── deleteCalendarEvent ──────────────────────────────────────────────────────

export interface DeleteCalendarEventInput {
  event_id: string;
  reason?:  string;
}

export interface DeleteCalendarEventUndoData {
  event: CalendarEvent;
}

export async function executeDeleteCalendarEvent(
  input: DeleteCalendarEventInput
): Promise<WriteToolResult> {
  try {
    const event = await getEvent(input.event_id);
    if (!event) {
      return { success: false, error: `Event ${input.event_id} not found.` };
    }

    // Store full event data for undo (recreate on undo)
    const undoData: DeleteCalendarEventUndoData = { event };

    await deleteEvent(input.event_id);
    // score_event_log row intentionally survives — deleteEvent does not cascade to it.

    window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));

    return {
      success:  true,
      undoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoDeleteCalendarEvent(
  undoData: DeleteCalendarEventUndoData
): Promise<void> {
  const ev = undoData.event;
  // Recreate with original ID is not possible via createEvent (it generates a new UUID).
  // Best effort: recreate the event; the new ID will be different.
  // The original score_event_log row remains intact — no score change either way.
  await createEvent({
    title:        ev.title,
    date:         ev.date,
    time:         ev.time,
    duration_mins: ev.duration_mins,
    category:     ev.category,
    source_id:    ev.source_id,
    source_type:  ev.source_type,
    colour_state: ev.colour_state,
    recurrence:   ev.recurrence,
    recurrence_end: ev.recurrence_end,
    notes:        ev.notes,
    group_id:     ev.group_id,
    linked_note_id: ev.linked_note_id,
  });
  window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));
}

// ─── updateGoal ───────────────────────────────────────────────────────────────

export interface UpdateGoalInput {
  goal_id: string;
  updates: string | Partial<GoalInput>;   // JSON string from model, or parsed object
}

export interface UpdateGoalUndoData {
  goalId:         string;
  originalFields: Partial<GoalInput>;
}

export async function executeUpdateGoal(
  input: UpdateGoalInput
): Promise<WriteToolResult> {
  try {
    const goal = await getGoal(input.goal_id);
    if (!goal) {
      return { success: false, error: `Goal ${input.goal_id} not found.` };
    }

    // Parse updates — the model sends updates as a JSON string per the tool schema
    let updates: Partial<GoalInput>;
    if (typeof input.updates === "string") {
      try {
        updates = JSON.parse(input.updates);
      } catch {
        return { success: false, error: "updates field is not valid JSON." };
      }
    } else {
      updates = input.updates;
    }

    // Capture original values for the fields being changed (for undo)
    const originalFields: Partial<GoalInput> = {};
    const allowedKeys: (keyof GoalInput)[] = [
      "title", "description", "start_date", "target_date",
      "colour_state", "progress", "category",
    ];
    for (const key of allowedKeys) {
      if (key in updates) {
        (originalFields as Record<string, unknown>)[key] =
          (goal as unknown as Record<string, unknown>)[key] ?? null;
      }
    }

    await dbUpdateGoal(input.goal_id, updates);

    // Refresh UI — GoalsPanel listens for this event
    window.dispatchEvent(new CustomEvent("idemora:goals-updated"));

    return {
      success:  true,
      undoData: { goalId: input.goal_id, originalFields } satisfies UpdateGoalUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoUpdateGoal(
  undoData: UpdateGoalUndoData
): Promise<void> {
  await dbUpdateGoal(undoData.goalId, undoData.originalFields);
}

// ─── JSON-level node helpers ──────────────────────────────────────────────────

/**
 * Walk the full doc tree and replace the node whose attrs.blockId matches
 * targetBlockId with replacementNodes. Recurses into all container types
 * so nested nodes (inside toggles, blockquotes, list items) are reachable.
 * Returns { newDoc, found }.
 */
function replaceNodeByBlockId(
  doc: { type: string; content: unknown[] },
  targetBlockId: string,
  replacementNodes: unknown[]
): { newDoc: { type: string; content: unknown[] }; found: boolean } {
  let found = false;

  function walkNodes(nodes: unknown[]): unknown[] {
    const result: unknown[] = [];
    for (const node of nodes) {
      if (found) { result.push(node); continue; }
      const n = node as Record<string, unknown>;
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;

      // Match on blockId attribute
      if (attrs.blockId === targetBlockId) {
        result.push(...replacementNodes);
        found = true;
        continue;
      }

      // Recurse into any node that has children
      if (Array.isArray(n.content)) {
        const newChildren = walkNodes(n.content as unknown[]);
        result.push({ ...n, content: newChildren });
        continue;
      }

      result.push(node);
    }
    return result;
  }

  const newNodes = walkNodes(doc.content);
  return { newDoc: { ...doc, content: newNodes }, found };
}

/**
 * Walk the full doc tree (recursing into containers, same shape as
 * replaceNodeByBlockId) and splice newNodes immediately after the node
 * whose attrs.blockId matches targetBlockId. Returns { newDoc, found }.
 *
 * This replaces the old heading-text matching approach. block_id is a
 * stable identifier the model reads directly from getNote's nodes array —
 * it never has to reconstruct or paraphrase a string to target a position,
 * which eliminates the class of bugs where a heading-text match failed
 * silently and content landed at the end of the note instead of where
 * the model believed it was inserting.
 */
function insertNodesAfterBlockId(
  doc: { type: string; content: unknown[] },
  targetBlockId: string,
  newNodes: unknown[]
): { newDoc: { type: string; content: unknown[] }; found: boolean } {
  let found = false;

  function walkNodes(nodes: unknown[]): unknown[] {
    const result: unknown[] = [];
    for (const node of nodes) {
      const n = node as Record<string, unknown>;
      const attrs = (n.attrs ?? {}) as Record<string, unknown>;

      if (Array.isArray(n.content)) {
        const newChildren = walkNodes(n.content as unknown[]);
        result.push({ ...n, content: newChildren });
      } else {
        result.push(node);
      }

      if (!found && attrs.blockId === targetBlockId) {
        result.push(...newNodes);
        found = true;
      }
    }
    return result;
  }

  const newContent = walkNodes(doc.content);
  return { newDoc: { ...doc, content: newContent }, found };
}

// ─── moveNote ─────────────────────────────────────────────────────────────────

export interface MoveNoteInput {
  note_id:   string;
  parent_id?: string | null;
}

export interface MoveNoteUndoData {
  noteId:          string;
  originalParentId: string | null;
}


export async function executeMoveNote(
  input: MoveNoteInput
): Promise<WriteToolResult> {
  try {
    const note = await getNoteById(input.note_id);
    if (!note) {
      return { success: false, error: `Note ${input.note_id} not found.` };
    }

    if (input.parent_id) {
      const parent = await getNoteById(input.parent_id);
      if (!parent) {
        return { success: false, error: `Parent note ${input.parent_id} not found. Call getFileTree to find the correct id.` };
      }
    }

    const originalParentId = note.parent_id ?? null;

    // Use the store action — updates parent_id in memory without calling
    // loadNotes() / getAllNotesMeta(), so note content is never wiped from
    // the store and open editors don't blank.
    const { useNoteStore } = await import("@/features/notes/store/useNoteStore");
    await useNoteStore.getState().moveNote(input.note_id, input.parent_id ?? null);

    return {
      success:   true,
      noteId:    note.id,
      noteTitle: note.title,
      undoData:  { noteId: note.id, originalParentId } satisfies MoveNoteUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoMoveNote(
  undoData: MoveNoteUndoData
): Promise<void> {
  const { useNoteStore } = await import("@/features/notes/store/useNoteStore");
  await useNoteStore.getState().moveNote(undoData.noteId, undoData.originalParentId);
}

// ─── linkNoteToEvent ──────────────────────────────────────────────────────────

export interface LinkNoteToEventInput {
  event_id: string;
  note_id:  string;
}

export interface LinkNoteToEventUndoData {
  eventId:              string;
  originalLinkedNoteId: string | null;
}

export async function executeLinkNoteToEvent(
  input: LinkNoteToEventInput
): Promise<WriteToolResult> {
  try {
    const event = await getEvent(input.event_id);
    if (!event) {
      return { success: false, error: `Event ${input.event_id} not found.` };
    }

    const note = await getNoteById(input.note_id);
    if (!note) {
      return { success: false, error: `Note ${input.note_id} not found.` };
    }

    const originalLinkedNoteId = event.linked_note_id ?? null;

    await updateEvent(input.event_id, { linked_note_id: input.note_id });

    window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));

    return {
      success:  true,
      undoData: { eventId: input.event_id, originalLinkedNoteId } satisfies LinkNoteToEventUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoLinkNoteToEvent(
  undoData: LinkNoteToEventUndoData
): Promise<void> {
  await updateEvent(undoData.eventId, { linked_note_id: undoData.originalLinkedNoteId });
  window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));
}

// ─── updateCalendarEvent ──────────────────────────────────────────────────────

export interface UpdateCalendarEventInput {
  event_id: string;
  updates:  string | Partial<CalendarEventInput>;   // JSON string from model, or parsed object
}

export interface UpdateCalendarEventUndoData {
  eventId:        string;
  originalFields: Partial<CalendarEventInput>;
}

export async function executeUpdateCalendarEvent(
  input: UpdateCalendarEventInput
): Promise<WriteToolResult> {
  try {
    const event = await getEvent(input.event_id);
    if (!event) {
      return { success: false, error: `Event ${input.event_id} not found.` };
    }

    let updates: Partial<CalendarEventInput>;
    if (typeof input.updates === "string") {
      try {
        updates = JSON.parse(input.updates);
      } catch {
        return { success: false, error: "updates field is not valid JSON." };
      }
    } else {
      updates = input.updates;
    }

    // Capture original values for the fields being changed (for undo)
    const originalFields: Partial<CalendarEventInput> = {};
    const allowedKeys: (keyof CalendarEventInput)[] = [
      "title", "date", "time", "duration_mins", "category", "notes",
    ];
    for (const key of allowedKeys) {
      if (key in updates) {
        (originalFields as Record<string, unknown>)[key] =
          (event as unknown as Record<string, unknown>)[key] ?? null;
      }
    }

    await updateEvent(input.event_id, updates);

    window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));

    return {
      success:  true,
      undoData: { eventId: input.event_id, originalFields } satisfies UpdateCalendarEventUndoData,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function undoUpdateCalendarEvent(
  undoData: UpdateCalendarEventUndoData
): Promise<void> {
  await updateEvent(undoData.eventId, undoData.originalFields);
  window.dispatchEvent(new CustomEvent("idemora:calendar-updated"));
}