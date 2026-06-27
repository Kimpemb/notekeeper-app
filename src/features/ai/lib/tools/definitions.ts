// src/features/ai/lib/tools/definitions.ts
//
// All tool schemas passed to the model on every action-mode call.
// Read tools execute immediately; write tools are held at the confirmation gate.
// This file exports only static data — no imports from store or DB.

export interface ToolDefinition {
  name:         string;
  description:  string;
  input_schema: {
    type:       "object";
    properties: Record<string, { type: string; description: string; items?: unknown; enum?: string[] }>;
    required:   string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [

  // ─── Read tools ────────────────────────────────────────────────────────────

  {
    name: "getNote",
    description:
      "Retrieve a note's full content by title or ID. " +
      "Call this before proposing any write to a named note. " +
      "Prefer title when the user names a note; prefer id when you already have it.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title to search for (case-insensitive prefix match)." },
        id:    { type: "string", description: "Exact note UUID. Takes precedence over title if both supplied." },
      },
      required: [],
    },
  },

  {
    name: "searchNotes",
    description:
      "Search notes by content when the exact title is unknown. " +
      "Returns ranked excerpts. Use getNote on the best match to retrieve full content. " +
      "Do NOT use this to find a parent note ID — use getFileTree instead.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        limit: { type: "string", description: "Max results to return (default 5, max 20)." },
      },
      required: ["query"],
    },
  },

  {
    name: "getCalendarEvents",
    description:
      "Fetch calendar events for a date range. " +
      "Always call this before proposing createCalendarEvents — use it to detect conflicts.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "ISO date string YYYY-MM-DD (inclusive)." },
        end_date:   { type: "string", description: "ISO date string YYYY-MM-DD (inclusive)." },
        layers: {
          type: "string",
          description:
            "Comma-separated layer keys to include: personal, notes, tasks, goals, cde. " +
            "Omit to include all layers.",
        },
      },
      required: ["start_date", "end_date"],
    },
  },

  {
    name: "getGoals",
    description:
      "Fetch the user's goals, optionally filtered by status. " +
      "Call this before generating a timetable so sessions align with active goals.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Status filter: active | upcoming | completed | missed | unresolved. Omit for all goals.",
          enum: ["active", "upcoming", "completed", "missed", "unresolved"],
        },
      },
      required: [],
    },
  },

  {
    name: "getCurrentNote",
    description:
      "Return the note currently open in the editor. " +
      "Use this when the user says 'this note', 'the current note', or refers to content " +
      "visible in the editor without naming it explicitly.",
    input_schema: {
      type:       "object",
      properties: {},
      required:   [],
    },
  },

  {
    name: "getFileTree",
    description:
      "Return the full note hierarchy as a flat list with parent_id relationships. " +
      "ALWAYS call this (not searchNotes) when the user wants to create a note under " +
      "a specific parent, or uses words like 'under', 'inside', 'nested in', 'as a subpage of'. " +
      "Each entry includes id, title, and parent_id (null = root level).",
    input_schema: {
      type:       "object",
      properties: {},
      required:   [],
    },
  },

  // ─── Write tools ───────────────────────────────────────────────────────────
  // These are NEVER executed directly. The app holds them at the confirmation
  // gate and awaits user approval before calling any executor.

  {
    name: "appendToNote",
    description:
      "Append content to the end of a note, optionally under a new heading. " +
      "Use as the fallback when an insertion position cannot be resolved with confidence — " +
      "state explicitly in your response that you are appending to the end.",
    input_schema: {
      type: "object",
      properties: {
        note_id: { type: "string", description: "UUID of the target note." },
        content: { type: "string", description: "Markdown content to append." },
        heading: { type: "string", description: "Optional heading text (e.g. 'Summary'). Added as ## before the content." },
      },
      required: ["note_id", "content"],
    },
  },

  {
    name: "insertInNote",
    description:
      "Insert content at a specific position in a note. " +
      "Resolution order: (1) after_block_id — exact block by data-block-id attribute; " +
      "(2) after_heading — find heading text and insert immediately after; " +
      "(3) if neither resolves, fall back to appendToNote instead and say so. " +
      "Never guess a position silently.",
    input_schema: {
      type: "object",
      properties: {
        note_id:        { type: "string", description: "UUID of the target note." },
        content:        { type: "string", description: "Markdown content to insert." },
        after_block_id: { type: "string", description: "Insert after the block with this data-block-id value." },
        after_heading:  { type: "string", description: "Insert after the first heading matching this text." },
      },
      required: ["note_id", "content"],
    },
  },

  {
    name: "replaceInNote",
    description:
      "Replace a specific block in a note by its block_id. " +
      "Always call getNote first — the response includes a 'nodes' array where each entry has a block_id and a summary of what it contains. " +
      "Pick the block_id of the node you want to replace and pass it here along with the new content as markdown. " +
      "This is the correct tool for swapping a table, rewriting a paragraph, or replacing a heading section. " +
      "Never attempt to match content by string — always use block_id.",
    input_schema: {
      type: "object",
      properties: {
        note_id:     { type: "string", description: "UUID of the target note." },
        block_id:    { type: "string", description: "The blockId of the node to replace, taken from the 'nodes' array returned by getNote." },
        new_content: { type: "string", description: "Replacement content as markdown. Will be parsed into the appropriate node types." },
      },
      required: ["note_id", "block_id", "new_content"],
    },
  },

  {
    name: "createNote",
    description:
      "Create a new note with the given title and content. " +
      "Use for document drafting, study plans, project briefs, or any standalone content.",
    input_schema: {
      type: "object",
      properties: {
        title:   { type: "string", description: "Note title." },
        content: { type: "string", description: "Full note content in Markdown." },
        frontmatter: {
          type: "string",
          description: "Optional JSON string of frontmatter key-value pairs (e.g. '{\"course\":\"Math\"}').",
        },
        parent_id: { type: "string", description: "Optional UUID of a parent note to nest this note under." },
      },
      required: ["title", "content"],
    },
  },

  {
    name: "createCalendarEvents",
    description:
      "Batch-create one or more calendar events. " +
      "Always call getCalendarEvents first to check for conflicts — report any conflicts in the confirmation. " +
      "All events are created atomically on a single user confirmation.",
    input_schema: {
      type: "object",
      properties: {
        events: {
          type: "string",
          description:
            "JSON array of event objects. Each object: " +
            "{ title: string, date: string (YYYY-MM-DD), time?: string (HH:MM 24h), " +
            "duration_mins?: number, category?: 'personal'|'note'|'task'|'goal'|'cde', notes?: string }",
        },
      },
      required: ["events"],
    },
  },

  {
    name: "deleteCalendarEvent",
    description:
      "Delete a calendar event by ID. " +
      "The score_event_log row is preserved — deleting does not change the user's score. " +
      "Always requires user confirmation. Warn explicitly if the event is today or in the past.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "UUID of the calendar event to delete." },
        reason:   { type: "string", description: "Optional reason shown in the confirmation card." },
      },
      required: ["event_id"],
    },
  },

  {
    name: "moveNote",
    description:
      "Move a note to a different parent, or to root level. " +
      "Always call getFileTree first to find the correct parent_id. " +
      "Use this when the user says 'move X under Y' or 'move X to root'.",
    input_schema: {
      type: "object",
      properties: {
        note_id:   { type: "string", description: "UUID of the note to move." },
        parent_id: { type: "string", description: "UUID of the new parent note. Omit or pass null to move to root level." },
      },
      required: ["note_id"],
    },
  },

  {
    name: "updateGoal",
    description:
      "Update fields on an existing goal (title, dates, progress, colour_state, etc). " +
      "Read the goal first with getGoals. Show a field-by-field before/after in the confirmation.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "UUID of the goal to update." },
        updates: {
          type: "string",
          description:
            "JSON object with fields to update: " +
            "{ title?: string, description?: string, start_date?: string, " +
            "target_date?: string, colour_state?: 'blue'|'green'|'yellow'|'red', " +
            "progress?: number (0-100), category?: string }",
        },
      },
      required: ["goal_id", "updates"],
    },
  },
];

// ─── Convenience sets for routing ────────────────────────────────────────────

export const READ_TOOL_NAMES = new Set([
  "getNote",
  "searchNotes",
  "getCalendarEvents",
  "getGoals",
  "getCurrentNote",
  "getFileTree",
]);

export const WRITE_TOOL_NAMES = new Set([
  "appendToNote",
  "insertInNote",
  "replaceInNote",
  "createNote",
  "moveNote",
  "createCalendarEvents",
  "deleteCalendarEvent",
  "updateGoal",
]);