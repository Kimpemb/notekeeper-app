// src/features/ai/lib/tools/readTools.ts
//
// Read tool executors — called immediately when the model requests a read tool.
// Each function takes raw tool input and returns a ReadToolResult.
// All functions fail gracefully: { success: false, error } — never throw.
//
// Also exports classifyActionIntent, which routes messages to the tool loop
// vs the existing RAG pipeline.

import { getNoteById, searchNotes }             from "@/features/notes/db/queries";
import { getEventsForDateRange }                from "@/features/calendar/db/calendarQueries";
import { listGoals }                            from "@/features/goals/db/goalQueries";
import { hybridSearch }                         from "@/features/ai/lib/search/hybrid";
import { promptProcessing }                     from "@/features/ai/lib/client";
import { ProcessingExhaustedError }             from "@/features/ai/lib/client";
import type { Note }                            from "@/types";
import type { GoalStatusFilter }                from "@/features/goals/db/goalQueries";
import type { LayerKey }                        from "@/features/calendar/db/calendarQueries";
import { prosemirrorBodyToMarkdown }            from "@/lib/exporters/markdown";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ReadToolResult {
  success: boolean;
  data?:   unknown;
  error?:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface NodeIndexEntry {
  block_id:  string | null;
  type:      string;
  level?:    number;
  summary:   string;
  index:     number;                       // position in document order (top-level + recursed sequence)
  section_heading_block_id: string | null;  // block_id of the heading this entry logically falls under, or null
  last_block_id_in_section?: string | null; // only set on heading entries — block_id of the last item in its section
}

function buildNodeIndex(contentJson: string | null | undefined): NodeIndexEntry[] {
  if (!contentJson) return [];
  let doc: { type: string; content?: unknown[] };
  try { doc = JSON.parse(contentJson); } catch { return []; }

  const entries: NodeIndexEntry[] = [];
  let nextIndex = 0;

  // Tracks the heading section each entry currently falls under. A new heading
  // at level L closes out any open section at level >= L (matches the same
  // "section ends at next heading of equal-or-shallower level" rule used by
  // insertInNote's executor) and opens a new section keyed by its own block_id.
  const sectionStack: { blockId: string; level: number }[] = [];

  function currentSectionId(): string | null {
    return sectionStack.length > 0 ? sectionStack[sectionStack.length - 1].blockId : null;
  }

  function nodeText(node: Record<string, unknown>): string {
    if (node.type === "text" && typeof node.text === "string") return node.text;
    if (Array.isArray(node.content)) {
      return (node.content as Record<string, unknown>[]).map(nodeText).join("");
    }
    return "";
  }

  function walk(nodes: unknown[]) {
    for (const n of nodes) {
      const node = n as Record<string, unknown>;
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      const blockId = typeof attrs.blockId === "string" ? attrs.blockId : null;
      const type = node.type as string;

      if (type === "table") {
        const rows = (node.content ?? []) as Record<string, unknown>[];
        const firstRow = rows[0];
        const headers = firstRow
          ? ((firstRow.content ?? []) as Record<string, unknown>[])
              .map((cell) =>
                nodeText((((cell.content ?? []) as Record<string, unknown>[])[0]) ?? {})
              )
              .filter(Boolean)
              .join(" | ")
          : "";
        entries.push({
          block_id: blockId,
          type:     "table",
          summary:  `Table: | ${headers} | (${rows.length} rows)`,
          index:    nextIndex++,
          section_heading_block_id: currentSectionId(),
        });

      } else if (type === "heading") {
        const level = typeof attrs.level === "number" ? attrs.level : 1;
        // Close any open sections at this level or deeper
        while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].level >= level) {
          sectionStack.pop();
        }
        entries.push({
          block_id: blockId,
          type:     "heading",
          level,
          summary:  nodeText(node),
          index:    nextIndex++,
          section_heading_block_id: currentSectionId(),
        });
        // Open this heading's own section for subsequent siblings, if it has a block_id
        if (blockId) {
          sectionStack.push({ blockId, level });
        }

      } else if (type === "toggle") {
        const inlineNodes = ((node.content ?? []) as Record<string, unknown>[])
          .filter((c) => c.type !== "toggleBody");
        const body = ((node.content ?? []) as Record<string, unknown>[])
          .find((c) => c.type === "toggleBody");
        const title = inlineNodes.map(nodeText).join("");
        entries.push({
          block_id: blockId,
          type:     "toggle",
          summary:  `Toggle: "${title}"`,
          index:    nextIndex++,
          section_heading_block_id: currentSectionId(),
        });
        // Recurse into toggleBody so nested tables/headings are reachable
        if (body && Array.isArray((body as Record<string, unknown>).content)) {
          walk((body as Record<string, unknown>).content as unknown[]);
        }

      } else if (type === "bulletList" || type === "orderedList" || type === "taskList") {
        const items = (node.content ?? []) as Record<string, unknown>[];
        const preview = items
          .slice(0, 3)
          .map((item) => nodeText(item).trim())
          .filter(Boolean)
          .join("; ");
        entries.push({
          block_id: blockId,
          type,
          summary:  `${items.length} items — ${preview}${items.length > 3 ? "…" : ""}`,
          index:    nextIndex++,
          section_heading_block_id: currentSectionId(),
        });

      } else if (type === "paragraph") {
        const text = nodeText(node).trim();
        if (text) {
          entries.push({
            block_id: blockId,
            type:     "paragraph",
            summary:  text.length > 120 ? text.slice(0, 120) + "…" : text,
            index:    nextIndex++,
            section_heading_block_id: currentSectionId(),
          });
        }

      } else if (type === "codeBlock") {
        const lang = typeof attrs.language === "string" ? attrs.language : "";
        const code = nodeText(node).trim();
        entries.push({
          block_id: blockId,
          type:     "codeBlock",
          summary:  `Code block (${lang || "no lang"}): ${code.slice(0, 60)}${code.length > 60 ? "…" : ""}`,
          index:    nextIndex++,
          section_heading_block_id: currentSectionId(),
        });

      } else if (type === "blockquote") {
        entries.push({
          block_id: blockId,
          type:     "blockquote",
          summary:  nodeText(node).trim().slice(0, 120),
          index:    nextIndex++,
          section_heading_block_id: currentSectionId(),
        });

      } else if (Array.isArray((node as Record<string, unknown>).content)) {
        // Unknown container — recurse
        walk((node as Record<string, unknown>).content as unknown[]);
      }
    }
  }

  walk(doc.content ?? []);

  // Second pass: for each heading entry, compute the block_id of the LAST
  // entry that belongs to its section (highest index with matching
  // section_heading_block_id). Exposed as last_block_id_in_section so the
  // model can do a direct lookup instead of a search+filter+max computation —
  // models reliably read a precomputed field but unreliably perform that
  // computation inline from raw index/section data.
  for (const entry of entries) {
    if (entry.type !== "heading" || !entry.block_id) continue;
    let lastMatch: NodeIndexEntry | null = null;
    for (const candidate of entries) {
      if (candidate.section_heading_block_id === entry.block_id) {
        if (!lastMatch || candidate.index > lastMatch.index) {
          lastMatch = candidate;
        }
      }
    }
    entry.last_block_id_in_section = lastMatch ? lastMatch.block_id : entry.block_id;
  }

  return entries;
}

function noteToReadShape(note: Note) {
  return {
    id:          note.id,
    title:       note.title,
    content:     prosemirrorBodyToMarkdown(note.content ?? ""),
    nodes:       buildNodeIndex(note.content),
    nodes_note:
      "Each entry has a block_id and an index (document order). Heading entries also have " +
      "last_block_id_in_section — the block_id of the LAST item belonging to that heading's " +
      "section. To insert content at the END of a section (e.g. a new numbered subsection " +
      "like '6.5' as the last item under section 6), find section 6's heading entry and pass " +
      "ITS last_block_id_in_section as after_block_id — NOT the heading's own block_id, which " +
      "would insert right under the heading instead of at the end of its content. " +
      "To insert immediately after a specific item (not at section end), use that item's own " +
      "block_id directly. Never use heading text strings to target a position — always use block_id. " +
      "TOGGLE WRITE SYNTAX: the 'content' shown above for a toggle uses <details>/<summary> — " +
      "that is a DISPLAY-ONLY format for reading, not valid write syntax. To WRITE a toggle, use " +
      "exactly this HTML shape instead: " +
      "<div data-toggle=\"false\"><div data-toggle-summary>TITLE TEXT</div>" +
      "<div data-toggle-body>BODY CONTENT</div></div> " +
      "— where BODY CONTENT can contain any block markdown (paragraphs, tables, lists, even " +
      "another nested toggle in the same shape). Writing <details>/<summary> will silently fail " +
      "and produce plain flattened paragraphs instead of a real toggle.",
    frontmatter: note.frontmatter ?? null,
    updated_at:  note.updated_at,
  };
}

// ─── getNote ──────────────────────────────────────────────────────────────────

export async function executeGetNote(input: {
  title?: string;
  id?:    string;
}): Promise<ReadToolResult> {
  try {
    // ID takes precedence
    if (input.id) {
      const note = await getNoteById(input.id);
      if (!note || note.deleted_at !== null) {
        return { success: false, error: `Note with id "${input.id}" not found.` };
      }
      return { success: true, data: noteToReadShape(note) };
    }

   if (input.title) {
  // Try exact match first (case-insensitive) before FTS
  const { getDb } = await import("@/features/notes/db/client");
  const db = await getDb();
  const exact = await db.select<{ id: string }[]>(
    `SELECT id FROM notes WHERE LOWER(title) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
    [input.title]
  );
  const topId = exact[0]?.id ?? (await searchNotes(input.title, 5))[0]?.id;
  if (!topId) {
    return { success: false, error: `No note found matching title "${input.title}".` };
  }
  const note = await getNoteById(topId);
      if (!note || note.deleted_at !== null) {
        return { success: false, error: `Note "${input.title}" found in search but could not be retrieved.` };
      }
      if (note.rag_excluded === 1) {
        return { success: false, error: `Note "${note.title}" is excluded from AI access (.env).` };
      }
      return { success: true, data: noteToReadShape(note) };
    }

    return { success: false, error: "Provide either a note title or id." };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── searchNotes ──────────────────────────────────────────────────────────────

export async function executeSearchNotes(input: {
  query: string;
  limit?: number;
}): Promise<ReadToolResult> {
  try {
    if (!input.query?.trim()) {
      return { success: false, error: "Search query must not be empty." };
    }

    // Try hybrid search first (semantic + keyword), fall back to keyword-only
    let results: { id: string; title: string; excerpt: string; updated_at: number }[] = [];

    try {
      const { results: hybridResults } = await hybridSearch(
        input.query,
        input.limit ?? 5,
      );

      // HybridResult carries no timestamp — look up real updated_at per unique
      // note_id (deduped, since multiple block hits can belong to the same note).
      // A single failed lookup must not sink the whole search.
      const uniqueNoteIds = [...new Set(hybridResults.map((r) => r.note_id))];
      const noteRows = await Promise.all(
        uniqueNoteIds.map((id) => getNoteById(id).catch(() => null)),
      );
      const updatedAtByNoteId = new Map<string, number>();
      noteRows.forEach((note, i) => {
        if (note) updatedAtByNoteId.set(uniqueNoteIds[i], note.updated_at);
      });

      results = hybridResults.map((r) => ({
        id:         r.note_id,
        title:      r.note_title,
        excerpt:    r.plaintext?.slice(0, 200) ?? "",
        updated_at: updatedAtByNoteId.get(r.note_id) ?? 0,
      }));
    } catch {
      // hybridSearch may fail if embeddings aren't ready — fall back to keyword
      const keyword = await searchNotes(input.query, input.limit ?? 5);
      // searchNotes doesn't filter rag_excluded — filter here to match hybridSearch behaviour
      const nonExcluded = await Promise.all(
        keyword.map(async (r) => {
          const note = await getNoteById(r.id);
          return note?.rag_excluded === 1 ? null : r;
        })
      );
      results = nonExcluded.filter(Boolean).map((r) => ({
        id:         r!.id,
        title:      r!.title,
        excerpt:    r!.snippet ?? "",
        updated_at: r!.updated_at,
      }));
    }

    return { success: true, data: results };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── getCalendarEvents ────────────────────────────────────────────────────────

const ALL_LAYERS: LayerKey[] = ["personal", "notes", "tasks", "goals", "cde"];

export async function executeGetCalendarEvents(input: {
  start_date: string;
  end_date:   string;
  layers?:    string;           // comma-separated from tool input
}): Promise<ReadToolResult> {
  try {
    if (!input.start_date || !input.end_date) {
      return { success: false, error: "start_date and end_date are required (YYYY-MM-DD)." };
    }

    let layers: LayerKey[] = ALL_LAYERS;
    if (input.layers) {
      const parsed = input.layers
        .split(",")
        .map((l) => l.trim())
        .filter((l): l is LayerKey =>
          ["personal", "notes", "tasks", "goals", "cde"].includes(l)
        );
      if (parsed.length > 0) layers = parsed;
    }

    const events = await getEventsForDateRange({
      startDate: input.start_date,
      endDate:   input.end_date,
      layers,
    });

    const data = events.map((e) => ({
      id:            e.id,
      title:         e.title,
      date:          e.date,
      time:          e.time,
      duration_mins: e.duration_mins,
      colour_state:  e.colour_state,
      category:      e.category,
      recurrence:    e.recurrence,
      occurrence_id: e.occurrence_id,
      is_recurring:  e.recurrence !== null,
    }));

    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── getGoals ─────────────────────────────────────────────────────────────────

const VALID_FILTERS = new Set<GoalStatusFilter>([
  "active", "upcoming", "completed", "missed", "unresolved",
]);

export async function executeGetGoals(input: {
  filter?: string;
}): Promise<ReadToolResult> {
  try {
    const filter =
      input.filter && VALID_FILTERS.has(input.filter as GoalStatusFilter)
        ? (input.filter as GoalStatusFilter)
        : null;

    const goals = await listGoals(filter);

    const data = goals.map((g) => ({
      id:           g.id,
      title:        g.title,
      target_date:  g.target_date,
      progress:     g.progress,
      colour_state: g.colour_state,
      category:     g.category,
    }));

    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── getCurrentNote ───────────────────────────────────────────────────────────

export async function executeGetCurrentNote(
  currentNote: Note | null | undefined,
): Promise<ReadToolResult> {
  if (!currentNote) {
    return { success: false, error: "no_note_open" };
  }

  // IMPORTANT: currentNote is sourced from the in-memory useNoteStore.notes
  // array via React state, not read fresh from the DB. useAutoSave's debounced
  // save calls updateNote(id, input, silent: true) — the `silent` flag
  // deliberately skips patching the store's `notes` array (to avoid a mounted
  // TipTap editor re-reading a stale `content` prop mid-keystroke and jumping
  // the cursor). That means a note edited and then immediately acted on via
  // chat in the same session can have its store copy still pointing at
  // whatever content it had at creation — stale/empty — even though the DB
  // (and the visible editor) has the real content. getNote/searchNotes/
  // getFileTree don't have this problem because they query the DB directly.
  // Re-fetch by id here so this tool is never fooled by a stale store entry.
  const fresh = await getNoteById(currentNote.id);
  if (!fresh || fresh.deleted_at !== null) {
    return { success: false, error: "no_note_open" };
  }
  if (fresh.rag_excluded === 1) {
    return { success: false, error: `The current note "${fresh.title}" is excluded from AI access (.env).` };
  }
  return { success: true, data: noteToReadShape(fresh) };
}

// ─── Read tool dispatcher ─────────────────────────────────────────────────────

export async function executeGetFileTree(): Promise<ReadToolResult> {
  try {
    const { getDb } = await import("@/features/notes/db/client");
    const db = await getDb();
    const rows = await db.select<{ id: string; title: string; parent_id: string | null }[]>(
      `SELECT id, title, parent_id FROM notes WHERE deleted_at IS NULL AND COALESCE(rag_excluded, 0) = 0 ORDER BY sort_order ASC, created_at ASC`
    );
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeReadTool(
  toolName:    string,
  toolInput:   Record<string, unknown>,
  currentNote: Note | null | undefined,
): Promise<ReadToolResult> {
  switch (toolName) {
    case "getNote":
      return executeGetNote(toolInput as { title?: string; id?: string });

    case "searchNotes":
      return executeSearchNotes(toolInput as { query: string; limit?: number });

    case "getCalendarEvents":
      return executeGetCalendarEvents(
        toolInput as { start_date: string; end_date: string; layers?: string }
      );

    case "getGoals":
      return executeGetGoals(toolInput as { filter?: string });

    case "getCurrentNote":
      return executeGetCurrentNote(currentNote);

    case "getFileTree":
      return executeGetFileTree();

    default:
      return { success: false, error: `Unknown read tool: ${toolName}` };
  }
}

// ─── Action intent classifier ─────────────────────────────────────────────────
//
// Routes messages to the tool loop (action mode) vs the existing RAG pipeline.
// Returns "chat" on any failure — never blocks the user-facing response.
// Threshold: confidence >= 0.85 required to route as "action".

const INTENT_SYSTEM = `You classify user messages as either "action" or "chat".

"action" = the user wants the AI to read or modify their notes, calendar, or goals.
Examples:
- "write the solution beneath question 2"
- "create a study plan note"
- "add 3 study blocks next week"
- "summarise this note and append it"
- "look at my automata assignment and solve question 1"
- "delete Tuesday's study block"
- "mark my physics goal as complete"
- "it happens twice, change both" (follow-up correction to a previous write)
- "do the other one too" (follow-up to complete a partial write)
- "now replace X with Y" (follow-up replacement)
- "you missed one, fix it" (follow-up correction)
- "change all instances" (follow-up to replace all)
- "do it for the other occurrence" (follow-up)
- "create a note under X" (needs getFileTree to find parent ID, not searchNotes)
- "what's free today" (needs getCalendarEvents to check availability)
- "when am I free this week" (needs getCalendarEvents)
- "do I have time for X on Thursday" (needs getCalendarEvents to check availability)
- "am I busy tomorrow" (needs getCalendarEvents)
- "what's on my calendar" (needs getCalendarEvents)
- "do I have any gaps this afternoon" (needs getCalendarEvents)

"chat" = everything else: questions, explanations, analysis, summarisation
without writing, general conversation. Pure questions with no write intent.

IMPORTANT: If the message is a follow-up that implies a previous write was
incomplete or needs correction, classify as "action" with high confidence.

Respond ONLY with a JSON object: { "intent": "action" | "chat", "confidence": 0.0–1.0 }
No other text. No markdown.`;

export async function classifyActionIntent(
  query: string,
): Promise<{ intent: "action" | "chat"; confidence: number }> {
  const fallback = { intent: "chat" as const, confidence: 1.0 };

  try {
    const raw = await promptProcessing(
      `Classify this message: "${query.slice(0, 500)}"`,
      INTENT_SYSTEM,
    );

    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed  = JSON.parse(cleaned) as { intent: string; confidence: number };

    if (
      (parsed.intent === "action" || parsed.intent === "chat") &&
      typeof parsed.confidence === "number"
    ) {
      return { intent: parsed.intent, confidence: parsed.confidence };
    }

    return fallback;
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      return fallback;
    }
    return fallback;
  }
}