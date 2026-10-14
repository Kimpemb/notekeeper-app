// src/features/notes/lib/reconcileSession.ts
//
// Stage 3 — Reconcile-session data shape. Wraps diffNoteRevisions()'s
// BlockDiffResult[] output into the shape the batched review UI needs,
// following the same pattern as PendingWrite / confirmationGate.ts (per
// Note Publishing & Fork/Reconcile doc §3.4: "an extension of the
// existing BatchConfirmationModal pattern... not new UX machinery").
//
// Categorization, per design doc §3.3:
//   - Auto-safe (pulled_theirs, kept_mine, added): staged silently, no
//     decision needed, never shown as a review row — only as a rollup
//     count ("12 changes auto-merged").
//   - Needs decision (conflict, source_deleted, mine_deleted_theirs_edited):
//     surfaced individually, each pre-selected to its defaultAction where
//     one exists.
//
// Nothing is written back to the note here — this is the data shape and
// decision-tracking only. Actually applying a committed session's
// decisions to the note's document tree (replacing/removing blocks by
// blockId) is Stage 6's "mechanical auto-merge" work, not Stage 3's.
// commitReconcileSession() below marks a session committed and returns
// the resolved item list for that step to consume — it does not itself
// touch notes.content.

import { create } from "zustand";
import type { BlockDiffResult, DiffClassification, BlockSnapshot } from "./threeWayDiff";

// ─── Per-classification action sets ──────────────────────────────────────
// Mirrors the three decision cards described in the Note Publishing doc
// §3.3: true conflicts get a three-way choice (mine / theirs / AI merge);
// the two delete-vs-edit cases each get a two-way keep/remove choice.

export type ConflictAction      = "keep_mine" | "take_theirs" | "merge_ai";
export type SourceDeletedAction = "keep_local" | "remove_here_too";
export type MineDeletedAction   = "keep_local" | "restore_theirs";

export type ReconcileAction = ConflictAction | SourceDeletedAction | MineDeletedAction;

// Classifications that need a user decision: "conflict", "source_deleted",
// "mine_deleted_theirs_edited". (Handled per-case below; no shared set needed.)

const AUTO_SAFE: ReadonlySet<DiffClassification> = new Set([
  "pulled_theirs",
  "kept_mine",
  "added",
]);

export type ReconcileItemStatus =
  | "auto"      // auto-safe, staged silently — never surfaced for decision
  | "pending"   // needs a decision, not yet resolved
  | "resolved"; // user picked (or bulk-accepted the default) an action

export interface ReconcileItem {
  blockId:        string;
  classification: DiffClassification;
  status:         ReconcileItemStatus;
  base?:          BlockSnapshot;
  theirs?:        BlockSnapshot;
  mine?:          BlockSnapshot;
  defaultAction?: ReconcileAction; // pre-selected choice shown for "pending" items
  chosenAction?:  ReconcileAction; // set once resolved
  // Populated only after "merge_ai" runs on a conflict item — an LLM-
  // proposed merged version the user can hand-edit before accepting, per
  // doc §3.3. Left undefined until that path is built (Stage 6).
  mergedContent?: string;
}

export interface ReconcileSession {
  id:             string;  // sessionId, generated at build time
  noteId:         string;  // the fork's local note id
  sourceNoteId:   string;  // forked_from_note_id
  sourceOwnerId:  string;  // forked_from_owner_id
  baseRevision:   number;  // fork's base_revision at last fork/reconcile
  sourceRevision: number;  // source note's revision at diff time
  items:          ReconcileItem[];
  createdAt:      number;
  committedAt?:   number;  // set once commitReconcileSession() runs
}

// ─── Builder ──────────────────────────────────────────────────────────────
// Consumes diffNoteRevisions()'s output directly — this is the only place
// BlockDiffResult[] gets turned into review-UI-ready state.

export function buildReconcileSession(
  diffResults:    BlockDiffResult[],
  noteId:         string,
  sourceNoteId:   string,
  sourceOwnerId:  string,
  baseRevision:   number,
  sourceRevision: number
): ReconcileSession {
  const items: ReconcileItem[] = diffResults.map((r) => {
    if (AUTO_SAFE.has(r.classification)) {
      return {
        blockId:        r.blockId,
        classification: r.classification,
        status:         "auto",
        base:           r.base,
        theirs:         r.theirs,
        mine:           r.mine,
      };
    }

    // NEEDS_DECISION. A true conflict has no safe default — the user must
    // actively choose. The two delete-vs-edit cases DO have a confirmed
    // default (both currently "keep_local", per §4.2/§4.3 of the diff
    // design doc) which diffNoteRevisions already sets on the result.
    const defaultAction: ReconcileAction | undefined =
      r.classification === "conflict" ? undefined : r.defaultAction;

    return {
      blockId:        r.blockId,
      classification: r.classification,
      status:         "pending",
      base:           r.base,
      theirs:         r.theirs,
      mine:           r.mine,
      defaultAction,
    };
  });

  return {
    id:             crypto.randomUUID(),
    noteId,
    sourceNoteId,
    sourceOwnerId,
    baseRevision,
    sourceRevision,
    items,
    createdAt:      Date.now(),
  };
}

// ─── Derived view helpers (for the review UI) ────────────────────────────

export function pendingItems(session: ReconcileSession): ReconcileItem[] {
  return session.items.filter((i) => i.status === "pending");
}

export function autoAppliedCount(session: ReconcileSession): number {
  return session.items.filter((i) => i.status === "auto").length;
}

export function resolvedCount(session: ReconcileSession): number {
  return session.items.filter((i) => i.status === "resolved").length;
}

export function allResolved(session: ReconcileSession): boolean {
  return pendingItems(session).length === 0;
}

// ─── Store ────────────────────────────────────────────────────────────────
// Mirrors confirmationGate.ts's shape closely on purpose: a map keyed by
// id, an action to resolve one item, a "bulk-accept everything still
// pending" action (mirrors confirmBatch), and a commit step. No undo
// window here — unlike a write tool's 60s undo, a reconcile commit isn't
// meant to be silently reversible; if that's wanted later, it should read
// from block_revision_snapshots history rather than reinvent undoData.

interface ReconcileSessionState {
  sessions: Map<string, ReconcileSession>;

  startSession:      (session: ReconcileSession) => void;
  resolveItem:       (sessionId: string, blockId: string, action: ReconcileAction) => void;
  acceptAllDefaults: (sessionId: string) => void; // bulk-resolve every pending item to its defaultAction; conflicts (no default) are left pending
  commitSession:     (sessionId: string) => ReconcileItem[] | null; // returns the full resolved+auto item list for Stage 6's apply step to consume; null if items still pending
  discardSession:    (sessionId: string) => void;
}

export const useReconcileSessionStore = create<ReconcileSessionState>((set, get) => ({
  sessions: new Map(),

  startSession(session) {
    set((s) => {
      const next = new Map(s.sessions);
      next.set(session.id, session);
      return { sessions: next };
    });
  },

  resolveItem(sessionId, blockId, action) {
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session) return s;
      const items = session.items.map((item) =>
        item.blockId === blockId
          ? { ...item, status: "resolved" as const, chosenAction: action }
          : item
      );
      const next = new Map(s.sessions);
      next.set(sessionId, { ...session, items });
      return { sessions: next };
    });
  },

  acceptAllDefaults(sessionId) {
    set((s) => {
      const session = s.sessions.get(sessionId);
      if (!session) return s;
      const items = session.items.map((item) =>
        item.status === "pending" && item.defaultAction
          ? { ...item, status: "resolved" as const, chosenAction: item.defaultAction }
          : item
      );
      const next = new Map(s.sessions);
      next.set(sessionId, { ...session, items });
      return { sessions: next };
    });
  },

  commitSession(sessionId) {
    const session = get().sessions.get(sessionId);
    if (!session) return null;
    if (!allResolved(session)) return null; // still pending items — refuse to commit

    set((s) => {
      const next = new Map(s.sessions);
      next.set(sessionId, { ...session, committedAt: Date.now() });
      return { sessions: next };
    });

    // Caller (Stage 6) takes this list and applies it to the note's
    // document tree: for each item, replace/keep/remove the block per its
    // classification + chosenAction, then write the merged content back
    // via the normal note-save path (so revision bump + snapshot write
    // happen exactly as any other edit would).
    return session.items;
  },

  discardSession(sessionId) {
    set((s) => {
      const next = new Map(s.sessions);
      next.delete(sessionId);
      return { sessions: next };
    });
  },
}));