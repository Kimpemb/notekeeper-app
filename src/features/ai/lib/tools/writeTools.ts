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
  getEventsForDateRange,
  type CalendarEventInput,
  type CalendarEvent,
} from "@/features/calendar/db/calendarQueries";
import { getGoal, updateGoal as dbUpdateGoal, type GoalInput } from "@/features/goals/db/goalQueries";
import { prosemirrorBodyToMarkdown } from "@/lib/exporters/markdown";
import { markdownToDoc }             from "@/features/ai/lib/save/parseMarkdown";

// ─── Store refresh helpers ────────────────────────────────────────────────────

async function refreshNoteInStore(noteId: string): Promise<void> {
  try {
    const { useNoteStore } = await import("@/features/notes/store/useNoteStore");
    await useNoteStore.getState().refreshNote(noteId);
  } catch { /* non-fatal */ }
}

async function refreshNotesListInStore(): Promise<void> {
  try {
    const { useNoteStore } = await import("@/features/notes/store/useNoteStore");
    await useNoteStore.getState().loadNotes();
  } catch { /* non-fatal */ }
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface WriteToolResult {
  success:              boolean;
  error?:               string;
  noteId?:              string;
  noteTitle?:           string;
  undoData?:            unknown;        // tool-specific, opaque to the gate
  insertedViaFallback?: boolean;        // true when insertInNote fell back to append
  conflicts?:           CalendarConflict[];
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
  after_heading?: string;
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

    // Resolution 3: fallback — append to end
    if (!input.after_heading && !input.after_block_id) {
      insertedViaFallback = true;
    }

    // All paths: operate at JSON level to preserve custom nodes.
    // Convert only the new content through markdownToDoc, then splice
    // into the existing doc JSON rather than round-tripping the whole doc.
    let doc: { type: string; content?: unknown[] };
    try {
      doc = note.content ? JSON.parse(note.content) : { type: "doc", content: [] };
    } catch {
      doc = { type: "doc", content: [] };
    }
    if (!Array.isArray(doc.content)) doc.content = [];

    const newNodes = ((markdownToDoc(input.content) as { content?: unknown[] }).content ?? []);

    let mergedDoc: { type: string; content: unknown[] };

    if (insertedViaFallback || !input.after_heading) {
      // Append to end
      mergedDoc = { ...doc, content: [...doc.content, ...newNodes] };
    } else {
      // Insert after heading — find the heading node in JSON and splice after it
      mergedDoc = insertNodesAfterHeading(doc, input.after_heading, newNodes);
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
    const { newDoc, found } = replaceNodeByBlockId(
      doc as { type: string; content: unknown[] },
      input.block_id,
      (markdownToDoc(input.new_content) as { content?: unknown[] }).content ?? []
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

    // Refresh the sidebar and notify
    await refreshNotesListInStore();
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
  await refreshNotesListInStore();
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
 * Find the first heading node whose text matches headingText (case-insensitive)
 * and insert newNodes immediately after the end of that heading's section
 * (before the next heading of equal or higher level, or at end of doc).
 * Falls back to appending at end if heading not found.
 */
function insertNodesAfterHeading(
  doc: { type: string; content?: unknown[] },
  headingText: string,
  newNodes: unknown[]
): { type: string; content: unknown[] } {
  const nodes = doc.content ?? [];
  const needle = headingText.toLowerCase().trim();

  function nodeText(node: Record<string, unknown>): string {
    if (node.type === "text" && typeof node.text === "string") return node.text;
    if (Array.isArray(node.content)) {
      return (node.content as Record<string, unknown>[]).map(nodeText).join("");
    }
    return "";
  }

  // Find heading index
  let headingIdx = -1;
  let headingLevel = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Record<string, unknown>;
    if (node.type === "heading") {
      const text = nodeText(node).toLowerCase().trim();
      if (text === needle || text.startsWith(needle)) {
        headingIdx  = i;
        headingLevel = ((node.attrs as Record<string, unknown>)?.level as number) ?? 1;
        break;
      }
    }
  }

  if (headingIdx === -1) {
    // Heading not found — append to end
    return { ...doc, content: [...nodes, ...newNodes] };
  }

  // Find where this heading's section ends
  let insertIdx = nodes.length;
  for (let i = headingIdx + 1; i < nodes.length; i++) {
    const node = nodes[i] as Record<string, unknown>;
    if (node.type === "heading") {
      const level = ((node.attrs as Record<string, unknown>)?.level as number) ?? 1;
      if (level <= headingLevel) {
        insertIdx = i;
        break;
      }
    }
  }

  const result = [...nodes];
  result.splice(insertIdx, 0, ...newNodes);
  return { ...doc, content: result };
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

    // Validate new parent exists if provided
    if (input.parent_id) {
      const parent = await getNoteById(input.parent_id);
      if (!parent) {
        return { success: false, error: `Parent note ${input.parent_id} not found. Call getFileTree to find the correct id.` };
      }
    }

    const originalParentId = note.parent_id ?? null;

    const { moveNote } = await import("@/features/notes/db/queries");
    await moveNote(input.note_id, input.parent_id ?? null);

    await refreshNotesListInStore();
    window.dispatchEvent(new CustomEvent("idemora:note-updated", { detail: { noteId: input.note_id } }));

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
  const { moveNote } = await import("@/features/notes/db/queries");
  await moveNote(undoData.noteId, undoData.originalParentId);
  await refreshNotesListInStore();
  window.dispatchEvent(new CustomEvent("idemora:note-updated", { detail: { noteId: undoData.noteId } }));
}