// src/features/ai/lib/tools/confirmationGate.ts
//
// Zustand store for pending write operations.
// Holds write tool calls between model proposal and user decision.
// Executes writes only after explicit user confirmation.
// Manages the 60-second undo window after execution.

import { create } from "zustand";
import {
  executeAppendToNote,
  executeInsertInNote,
  executeReplaceInNote,
  executeCreateNote,
  executeMoveNote,
  executeCreateCalendarEvents,
  executeDeleteCalendarEvent,
  executeUpdateGoal,
  executeLinkNoteToEvent,
  undoAppendToNote,
  undoInsertInNote,
  undoReplaceInNote,
  undoCreateNote,
  undoMoveNote,
  undoCreateCalendarEvents,
  undoDeleteCalendarEvent,
  undoUpdateGoal,
  undoLinkNoteToEvent,
  type AppendToNoteInput,
  type InsertInNoteInput,
  type ReplaceInNoteInput,
  type CreateNoteInput,
  type MoveNoteInput,
  type CreateCalendarEventsInput,
  type DeleteCalendarEventInput,
  type UpdateGoalInput,
  type LinkNoteToEventInput,
  type AppendToNoteUndoData,
  type InsertInNoteUndoData,
  type ReplaceInNoteUndoData,
  type CreateNoteUndoData,
  type MoveNoteUndoData,
  type CreateCalendarEventsUndoData,
  type DeleteCalendarEventUndoData,
  type UpdateGoalUndoData,
  type LinkNoteToEventUndoData,
} from "./writeTools";
import type { CalendarConflict } from "./writeTools";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WritePreview {
  title:         string;          // "Write to [note title]", "Create 5 calendar events", etc.
  description:   string;          // "Inserting after heading X", "Deleting event on Mon Jun 16", etc.
  content:       string;          // truncated to 200 words for display
  fullContent?:  string;          // set when content was truncated
  isDestructive: boolean;         // drives red Apply button
  isBatch:       boolean;         // drives table preview variant
  conflicts?:    CalendarConflict[];
  wordCount:     number;
}

export type PendingWriteStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "executed"
  | "undone"
  | "error";

export interface PendingWrite {
  id:                  string;
  toolName:            string;
  toolInput:           unknown;
  preview:             WritePreview;
  status:              PendingWriteStatus;
  assistantMessageId:  string;        // which chat message triggered this
  undoData?:           unknown;       // populated after execution
  undoExpiry?:         number;        // Date.now() + 60_000
  insertedViaFallback?: boolean;      // set when insertInNote fell back to append
  errorMessage?:       string;
  createdEvents?:      { id: string; title: string; date: string; time: string | null }[];
}

// ─── Resolver callbacks ───────────────────────────────────────────────────────
// The tool loop in chat.ts awaits a decision per pending write.
// These callbacks let confirmWrite / cancelWrite signal the loop.

type ResolveDecision = (decision: "confirmed" | "cancelled") => void;
const _pendingResolvers = new Map<string, ResolveDecision>();

// ─── Store ────────────────────────────────────────────────────────────────────

interface ConfirmationGateState {
  pendingWrites: Map<string, PendingWrite>;

  addPendingWrite:   (write: PendingWrite) => void;
  confirmWrite:      (id: string) => Promise<void>;
  cancelWrite:       (id: string) => void;
  undoWrite:         (id: string) => Promise<void>;
  clearExpiredUndos: () => void;
  clearAll:          () => void;

  // internal
  _setPendingWrite: (write: PendingWrite) => void;
}

export const useConfirmationGate = create<ConfirmationGateState>((set, get) => ({
  pendingWrites: new Map(),

  // ── addPendingWrite ─────────────────────────────────────────────────────────
  addPendingWrite(write) {
    set((s) => {
      const next = new Map(s.pendingWrites);
      next.set(write.id, write);
      return { pendingWrites: next };
    });
  },

  // ── _setPendingWrite ────────────────────────────────────────────────────────
  _setPendingWrite(write) {
    set((s) => {
      const next = new Map(s.pendingWrites);
      next.set(write.id, write);
      return { pendingWrites: next };
    });
  },

  // ── confirmWrite ────────────────────────────────────────────────────────────
  async confirmWrite(id) {
    const { pendingWrites, _setPendingWrite } = get();
    const pw = pendingWrites.get(id);
    if (!pw || pw.status !== "pending") return;

    _setPendingWrite({ ...pw, status: "confirmed" });

    try {
      console.log("[confirmWrite] dispatching:", pw.toolName, JSON.stringify(pw.toolInput).slice(0, 300));
      const result = await dispatch(pw.toolName, pw.toolInput);
      console.log("[confirmWrite] result:", JSON.stringify(result).slice(0, 300));

      if (!result.success) {
        _setPendingWrite({
          ...pw,
          status:       "error",
          errorMessage: result.error ?? "Write failed.",
        });
        _pendingResolvers.get(id)?.("cancelled");
        _pendingResolvers.delete(id);
        return;
      }

      _setPendingWrite({
        ...pw,
        status:              "executed",
        undoData:            result.undoData,
        undoExpiry:          Date.now() + 60_000,
        insertedViaFallback: result.insertedViaFallback ?? pw.insertedViaFallback,
        createdEvents:       (result as unknown as { createdEvents?: PendingWrite["createdEvents"] }).createdEvents,
      });

      _pendingResolvers.get(id)?.("confirmed");
      _pendingResolvers.delete(id);
    } catch (err) {
      _setPendingWrite({
        ...pw,
        status:       "error",
        errorMessage: err instanceof Error ? err.message : "Write failed.",
      });
      _pendingResolvers.get(id)?.("cancelled");
      _pendingResolvers.delete(id);
    }
  },

  // ── cancelWrite ─────────────────────────────────────────────────────────────
  cancelWrite(id) {
    const { pendingWrites, _setPendingWrite } = get();
    const pw = pendingWrites.get(id);
    if (!pw || pw.status !== "pending") return;

    _setPendingWrite({ ...pw, status: "cancelled" });

    _pendingResolvers.get(id)?.("cancelled");
    _pendingResolvers.delete(id);
  },

  // ── undoWrite ───────────────────────────────────────────────────────────────
  async undoWrite(id) {
    const { pendingWrites, _setPendingWrite } = get();
    const pw = pendingWrites.get(id);
    if (!pw || pw.status !== "executed") return;
    if (!pw.undoExpiry || Date.now() > pw.undoExpiry) return;

    try {
      await dispatchUndo(pw.toolName, pw.undoData);
      _setPendingWrite({ ...pw, status: "undone" });
    } catch (err) {
      console.error("[confirmationGate] undo failed:", err);
      // Don't change status — let the user retry or accept the state
    }
  },

  // ── clearExpiredUndos ───────────────────────────────────────────────────────
  clearExpiredUndos() {
    const { pendingWrites } = get();
    const now = Date.now();
    let changed = false;
    const next = new Map(pendingWrites);
    for (const [id, pw] of next) {
      if (pw.status === "executed" && pw.undoExpiry && now > pw.undoExpiry) {
        next.set(id, { ...pw, undoExpiry: undefined });
        changed = true;
      }
    }
    if (changed) set({ pendingWrites: next });
  },

  // ── clearAll ────────────────────────────────────────────────────────────────
  clearAll() {
    // Reject any pending resolvers so tool loops don't hang
    for (const resolve of _pendingResolvers.values()) {
      resolve("cancelled");
    }
    _pendingResolvers.clear();
    set({ pendingWrites: new Map() });
  },
}));

// ─── Public awaitable gate ────────────────────────────────────────────────────
// Called from the tool loop in chat.ts.
// Returns a promise that resolves once the user confirms or cancels.

export function awaitWriteDecision(
  writeId: string
): Promise<"confirmed" | "cancelled"> {
  return new Promise((resolve) => {
    _pendingResolvers.set(writeId, resolve);
  });
}

// ─── Preview builder ──────────────────────────────────────────────────────────
// Builds the WritePreview shown in ConfirmationCard from raw tool input.
// Called in chat.ts before addPendingWrite.

export function buildWritePreview(
  toolName:   string,
  toolInput:  Record<string, unknown>,
  noteTitleMap: Map<string, string>,   // noteId → title, pre-fetched by chat.ts
  conflicts?: CalendarConflict[]
): WritePreview {
  switch (toolName) {

    case "appendToNote": {
      const noteId  = toolInput.note_id as string;
      const content = toolInput.content as string;
      const heading = toolInput.heading as string | undefined;
      const title   = noteTitleMap.get(noteId) ?? noteId;
      const full    = heading ? `## ${heading}\n\n${content}` : content;
      return {
        title:         `Write to "${title}"`,
        description:   heading ? `Appending under new heading "${heading}"` : "Appending to end of note",
        ...truncateContent(full),
        isDestructive: false,
        isBatch:       false,
      };
    }

    case "insertInNote": {
      const noteId      = toolInput.note_id as string;
      const content     = toolInput.content as string;
      const afterHeading = toolInput.after_heading as string | undefined;
      const afterBlock   = toolInput.after_block_id as string | undefined;
      const title        = noteTitleMap.get(noteId) ?? noteId;
      const description  = afterHeading
        ? `Inserting after heading "${afterHeading}"`
        : afterBlock
          ? `Inserting after block ${afterBlock}`
          : "Inserting (position to be resolved)";
      return {
        title:         `Write to "${title}"`,
        description,
        ...truncateContent(content),
        isDestructive: false,
        isBatch:       false,
      };
    }

    case "replaceInNote": {
      const noteId     = toolInput.note_id as string;
      const oldContent = toolInput.old_content as string;
      const newContent = toolInput.new_content as string;
      const title      = noteTitleMap.get(noteId) ?? noteId;
      // Show old → new as the "content" for the diff preview
      const diffPreview = `**Before:**\n${oldContent}\n\n**After:**\n${newContent}`;
      return {
        title:         `Replace in "${title}"`,
        description:   "Replacing existing content",
        ...truncateContent(diffPreview),
        isDestructive: true,
        isBatch:       false,
      };
    }

    case "createNote": {
      const noteTitle = toolInput.title as string;
      const content   = toolInput.content as string;
      return {
        title:         `Create note "${noteTitle}"`,
        description:   "New note will appear in the sidebar",
        ...truncateContent(content),
        isDestructive: false,
        isBatch:       false,
      };
    }

    case "createCalendarEvents": {
      let events: unknown[] = [];
      const rawEv = toolInput.events;
      if (Array.isArray(rawEv)) {
        events = rawEv;
      } else if (typeof rawEv === "string") {
        try { events = JSON.parse(rawEv); } catch { /* malformed */ }
      }
      const count = events.length;
      const contentStr = Array.isArray(rawEv) ? JSON.stringify(rawEv) : (rawEv as string ?? "[]");
      return {
        title:         `Create ${count} calendar event${count === 1 ? "" : "s"}`,
        description:   conflicts && conflicts.length > 0
          ? `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} detected`
          : "No conflicts detected",
        content:       contentStr,
        wordCount:     count,
        isDestructive: false,
        isBatch:       true,
        conflicts,
      };
    }

    case "deleteCalendarEvent": {
      const eventId = toolInput.event_id as string;
      const reason  = toolInput.reason as string | undefined;
      return {
        title:         "Delete calendar event",
        description:   reason ? `Reason: ${reason}` : `Event ID: ${eventId}`,
        content:       `Deleting event ${eventId}`,
        wordCount:     4,
        isDestructive: true,
        isBatch:       false,
      };
    }

    case "updateGoal": {
      const goalId  = toolInput.goal_id as string;
      let updates: Record<string, unknown> = {};
      try {
        updates = JSON.parse(toolInput.updates as string);
      } catch { /* malformed */ }
      const fields  = Object.keys(updates).join(", ");
      const preview = Object.entries(updates)
        .map(([k, v]) => `**${k}:** ${String(v)}`)
        .join("\n");
      return {
        title:         "Update goal",
        description:   `Changing: ${fields || goalId}`,
        ...truncateContent(preview),
        isDestructive: false,
        isBatch:       false,
      };
    }

    case "moveNote": {
      const noteId   = toolInput.note_id as string;
      const parentId = toolInput.parent_id as string | undefined;
      const title    = noteTitleMap.get(noteId) ?? noteId;
      const dest     = parentId ? (noteTitleMap.get(parentId) ?? parentId) : "root level";
      return {
        title:         `Move "${title}"`,
        description:   `Moving to ${dest}`,
        content:       `Note: "${title}"\nDestination: ${dest}`,
        wordCount:     6,
        isDestructive: false,
        isBatch:       false,
      };
    }
    default:
      return {
        title:         toolName,
        description:   "",
        content:       JSON.stringify(toolInput, null, 2),
        wordCount:     0,
        isDestructive: false,
        isBatch:       false,
      };
  }
}

// ─── Content truncation ───────────────────────────────────────────────────────

function truncateContent(
  text: string,
  wordLimit = 200
): { content: string; fullContent?: string; wordCount: number } {
  const words    = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount <= wordLimit) {
    return { content: text, wordCount };
  }
  const truncated = words.slice(0, wordLimit).join(" ") + "…";
  return { content: truncated, fullContent: text, wordCount };
}

// ─── Write dispatcher ─────────────────────────────────────────────────────────

async function dispatch(
  toolName:  string,
  toolInput: unknown
): Promise<{
  success:             boolean;
  error?:              string;
  undoData?:           unknown;
  insertedViaFallback?: boolean;
}> {
  const input = toolInput as Record<string, unknown>;

  switch (toolName) {
    case "appendToNote":
      return executeAppendToNote(toolInput as unknown as AppendToNoteInput);

    case "insertInNote":
      return executeInsertInNote(toolInput as unknown as InsertInNoteInput);

    case "replaceInNote":
      return executeReplaceInNote(toolInput as unknown as ReplaceInNoteInput);

    case "createNote":
      return executeCreateNote(toolInput as unknown as CreateNoteInput);

    case "createCalendarEvents": {
      let events: unknown[] = [];
      const raw = input.events;
      if (Array.isArray(raw)) {
        events = raw;
      } else if (typeof raw === "string") {
        try { events = JSON.parse(raw); } catch { /* malformed */ }
      }
      return executeCreateCalendarEvents({ events } as unknown as CreateCalendarEventsInput);
    }

    case "deleteCalendarEvent":
      return executeDeleteCalendarEvent(toolInput as unknown as DeleteCalendarEventInput);

    case "updateGoal": {
      let updates: Record<string, unknown> = {};
      try { updates = JSON.parse(input.updates as string); } catch { /* malformed */ }
      return executeUpdateGoal({
        goal_id: input.goal_id as string,
        updates,
      } as unknown as UpdateGoalInput);
    }

    case "moveNote":
      return executeMoveNote(toolInput as unknown as MoveNoteInput);

    case "linkNoteToEvent":
      return executeLinkNoteToEvent(toolInput as unknown as LinkNoteToEventInput);

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// ─── Undo dispatcher ──────────────────────────────────────────────────────────

async function dispatchUndo(toolName: string, undoData: unknown): Promise<void> {
  switch (toolName) {
    case "appendToNote":
      return undoAppendToNote(undoData as AppendToNoteUndoData);
    case "insertInNote":
      return undoInsertInNote(undoData as InsertInNoteUndoData);
    case "replaceInNote":
      return undoReplaceInNote(undoData as ReplaceInNoteUndoData);
    case "createNote":
      return undoCreateNote(undoData as CreateNoteUndoData);
    case "createCalendarEvents":
      return undoCreateCalendarEvents(undoData as CreateCalendarEventsUndoData);
    case "deleteCalendarEvent":
      return undoDeleteCalendarEvent(undoData as DeleteCalendarEventUndoData);
    case "updateGoal":
      return undoUpdateGoal(undoData as UpdateGoalUndoData);
    case "moveNote":
      return undoMoveNote(undoData as MoveNoteUndoData);
    case "linkNoteToEvent":
      return undoLinkNoteToEvent(undoData as LinkNoteToEventUndoData);
  }
}

// ─── Interval to expire undo windows ─────────────────────────────────────────

let _undoIntervalStarted = false;

export function startUndoExpiryInterval(): void {
  if (_undoIntervalStarted) return;
  _undoIntervalStarted = true;
  setInterval(() => {
    useConfirmationGate.getState().clearExpiredUndos();
  }, 5_000);
}