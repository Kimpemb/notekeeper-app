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

  {
    name: "getThoughtGraph",
    description:
      "Retrieve the merged thought graph for a note — all reasoning nodes/edges " +
      "across every conversation episode that note has had. Call this before " +
      "proposing createThoughtNode to check for existing nodes and avoid duplicates.",
    input_schema: {
      type: "object",
      properties: {
        note_id: { type: "string", description: "UUID of the note." },
      },
      required: ["note_id"],
    },
  },

  {
    name: "getThoughtNodes",
    description:
      "Retrieve nodes and edges for a single thought graph by its graph_id " +
      "(obtained from getThoughtGraph). Use this to check existing nodes before " +
      "proposing an edge between two of them.",
    input_schema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "UUID of the thought graph." },
      },
      required: ["graph_id"],
    },
  },

  // ─── Write tools ───────────────────────────────────────────────────────────  // These are NEVER executed directly. The app holds them at the confirmation
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
    name: "deleteBlocksInNote",
    description:
      "Delete a contiguous range of blocks in a note, from from_block_id to to_block_id inclusive. " +
      "Always call getNote first — the response includes a 'nodes' array where each entry has a block_id. " +
      "To delete a single block, pass the same block_id for both from_block_id and to_block_id. " +
      "This is destructive and only reversible within the 60-second undo window — use it deliberately, " +
      "not as a way to 'clean up' content you could instead replace with replaceInNote.",
    input_schema: {
      type: "object",
      properties: {
        note_id:       { type: "string", description: "UUID of the target note." },
        from_block_id: { type: "string", description: "blockId of the first block to delete (from the 'nodes' array returned by getNote)." },
        to_block_id:   { type: "string", description: "blockId of the last block to delete, inclusive. Same as from_block_id for a single-block delete." },
      },
      required: ["note_id", "from_block_id", "to_block_id"],
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
        parent_id: { type: "string", description: "Optional UUID of a parent note to nest this note under. If the user names a parent by title (e.g. 'under Y'), call getFileTree first to resolve the correct id — do not guess." },
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
            "duration_mins?: number, category?: 'personal'|'note'|'task'|'goal'|'cde', notes?: string }. " +
            "category defaults to 'personal' — use that unless the event is clearly, " +
            "directly derived from or about a specific note's content. Do not default " +
            "to 'note' just because this conversation is happening inside a note's chat panel; " +
            "generic, test, or unrelated events should be 'personal'.",
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
      "Always requires user confirmation. Warn explicitly if the event is today or in the past. " +
      "IMPORTANT: For recurring events (is_recurring: true), deleting by the event id removes ALL occurrences in the series — only one deletion is needed. Do not attempt to delete each occurrence separately.",
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
    name: "linkNoteToEvent",
    description:
      "Link a note to a calendar event by setting linked_note_id on the event. " +
      "Call getNote and getCalendarEvents first to confirm both exist. " +
      "Use this when the user says 'link X note to Y event' or 'connect this note to that event'.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "UUID of the calendar event to update." },
        note_id:  { type: "string", description: "UUID of the note to link to the event." },
      },
      required: ["event_id", "note_id"],
    },
  },

  {
    name: "linkNoteToGoal",
    description:
      "Link a note to a goal. Call getNote and getGoals first to confirm both exist. " +
      "Use this when the user says 'link X note to Y goal' or 'connect this note to that goal', " +
      "or when attaching supporting material to an existing goal after the fact.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "UUID of the goal to link." },
        note_id: { type: "string", description: "UUID of the note to link to the goal." },
      },
      required: ["goal_id", "note_id"],
    },
  },

  {
    name: "unlinkNoteFromGoal",
    description:
      "Remove an existing link between a note and a goal. Call getGoals first if you need to " +
      "confirm the link exists before proposing this.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "UUID of the goal." },
        note_id: { type: "string", description: "UUID of the note to unlink." },
      },
      required: ["goal_id", "note_id"],
    },
  },
{
    name: "updateCalendarEvent",
    description:
      "Update fields on an existing calendar event (title, date, time, duration, category, notes). " +
      "If the user refers to an event's 'body', 'description', or 'details', this maps to the notes field — " +
      "use this tool, not a note-writing tool. " +
      "Call getCalendarEvents first to find the event_id and check is_recurring/recurrence. " +
      "For recurring events, this updates the whole series (the parent event), not a single occurrence — " +
      "state this explicitly to the user before proposing the write. " +
      "Show a field-by-field before/after in the confirmation.",
    input_schema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "UUID of the calendar event to update." },
        updates: {
          type: "string",
          description:
            "JSON object with fields to update: " +
            "{ title?: string, date?: string (YYYY-MM-DD), time?: string (HH:MM 24h), " +
            "duration_mins?: number, category?: 'personal'|'note'|'task'|'goal'|'cde', notes?: string }. " +
            "Only change category if the user explicitly asks — don't default to 'note' " +
            "just because this update was requested from within a note's chat panel.",
        },
      },
      required: ["event_id", "updates"],
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

  {
    name: "createGoal",
    description:
      "Create a new goal, optionally with milestones. " +
      "Always call getGoals first to check a goal with the same title doesn't already exist. " +
      "Use this when the user wants to track a deadline, exam, project, or objective as a goal — " +
      "not for one-off calendar events (use createCalendarEvents for those).",
    input_schema: {
      type: "object",
      properties: {
        title:        { type: "string", description: "Goal title." },
        description:  { type: "string", description: "Optional goal description." },
        start_date:   { type: "string", description: "ISO date string YYYY-MM-DD — when work on the goal begins." },
        target_date:  { type: "string", description: "ISO date string YYYY-MM-DD — the goal's deadline." },
        colour_state: {
          type: "string",
          description: "Initial status. Defaults to 'blue' (active) if omitted.",
          enum: ["blue", "green", "yellow", "red"],
        },
        category: { type: "string", description: "Optional free-text category, e.g. 'academic', 'work'." },
        milestones: {
          type: "string",
          description:
            "Optional JSON array of milestone objects to create alongside the goal: " +
            "{ title: string, date: string (YYYY-MM-DD), colour_state?: 'blue'|'green'|'yellow'|'red' }. " +
            "Use this to break the goal into checkpoints (e.g. study phases before an exam).",
        },
      },
      required: ["title", "start_date", "target_date"],
    },
  },

  {
    name: "deleteGoal",
    description:
      "Delete a goal and all of its milestones. This is destructive and only reversible within " +
      "the 60-second undo window — call getGoals first to confirm the correct goal_id and show " +
      "the user what will be removed (title, milestone count) before proposing this.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "UUID of the goal to delete." },
        reason:  { type: "string", description: "Optional reason shown in the confirmation card." },
      },
      required: ["goal_id"],
    },
  },

  {
    name: "createThoughtNode",
    description:
      "Propose a new reasoning node (Claim, Idea, Question, Counterargument, Evidence, " +
      "Assumption, or Conclusion) extracted from the current conversation. Only propose " +
      "this for genuine reasoning structure in your own response — a distinct claim, " +
      "open question, or counterargument worth tracking — not for routine answers. " +
      "Call getThoughtGraph first to avoid proposing a near-duplicate of an existing node.",
    input_schema: {
      type: "object",
      properties: {
        note_id: { type: "string", description: "UUID of the note whose conversation this reasoning belongs to." },
        type: {
          type: "string",
          description: "The reasoning unit type.",
          enum: ["claim", "idea", "question", "counterargument", "evidence", "assumption", "conclusion"],
        },
        summary:     { type: "string", description: "One-sentence summary of the node, shown in hover previews." },
        body:        { type: "string", description: "Optional longer-form elaboration." },
        source_ref:  { type: "string", description: "Optional note_id or external reference this node relates to." },
        source_kind: {
          type: "string",
          description: "What source_ref points to, if provided.",
          enum: ["conversation", "note", "external"],
        },
      },
      required: ["note_id", "type", "summary"],
    },
  },

  {
    name: "createThoughtEdge",
    description:
      "Propose a logical relationship between two existing thought nodes. Call " +
      "getThoughtNodes first to get valid node ids from the same graph — never guess an id.",
    input_schema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "UUID of the thought graph both nodes belong to." },
        from_id:  { type: "string", description: "UUID of the source node." },
        to_id:    { type: "string", description: "UUID of the target node." },
        relation: {
          type: "string",
          description: "The logical relationship from from_id to to_id.",
          enum: ["supports", "challenges", "answers", "leads_to", "depends_on", "refines"],
        },
      },
      required: ["graph_id", "from_id", "to_id", "relation"],
    },
  },

  {
    name: "updateThoughtNodeState",
    description:
      "Change a thought node's state — mark a question as Resolved once answered, " +
      "or Parked if the discussion moves on without resolving it.",
    input_schema: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "UUID of the thought node." },
        state: {
          type: "string",
          description: "New state.",
          enum: ["open", "resolved", "parked"],
        },
      },
      required: ["node_id", "state"],
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
  "getThoughtGraph",
  "getThoughtNodes",
]);

export const WRITE_TOOL_NAMES = new Set([
  "appendToNote",
  "insertInNote",
  "replaceInNote",
  "deleteBlocksInNote",
  "createNote",
  "moveNote",
  "createCalendarEvents",
  "deleteCalendarEvent",
  "updateCalendarEvent",
  "updateGoal",
  "linkNoteToEvent",
  "createGoal",
  "deleteGoal",
  "linkNoteToGoal",
  "unlinkNoteFromGoal",
  "createThoughtNode",
  "createThoughtEdge",
  "updateThoughtNodeState",
]);