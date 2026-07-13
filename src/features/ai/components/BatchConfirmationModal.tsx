// src/features/ai/components/BatchConfirmationModal.tsx
//
// Centered modal shown for batches of 2+ pending writes proposed in the same
// model turn. Left pane = compact tree of proposed items (status glyph +
// NEW/EDIT/MOVE/DELETE badge). Right pane = rendered preview of whichever
// item is selected. Footer = live "N of M resolved" count + single
// "Approve all" button.
//
// Single-write batches (N=1) never reach this component — ChatPanel renders
// a bare <ConfirmationCard /> for those, unchanged.
//
// Cancelling an item here does NOT remove it from view — it stays in the
// tree, struck through, so the whole proposed plan remains visible even
// after partial rejection (resolves the "visible-but-skipped" question).

import { useState, useMemo } from "react";
import type { PendingWrite } from "@/features/ai/lib/tools/confirmationGate";
import { MessageRenderer } from "@/features/ai/components/MessageRenderer";
import { BatchCalendarPreview } from "@/features/ai/components/ConfirmationCard";

interface Props {
  writes:       PendingWrite[];
  onConfirm:    (id: string) => Promise<void>;
  onCancel:     (id: string) => void;
  onApproveAll: (batchId: string) => Promise<void>;
  onClose:      () => void;
  onOpenNote?:  (noteId: string) => void;
}

// Resolves the note id a write touched, so "Open note" can be shown after
// execution. Most write tools carry note_id directly on their input.
// createNote is the exception — it generates a new id, which only exists
// in undoData once the write has actually executed.
function noteIdForWrite(w: PendingWrite): string | undefined {
  const input = w.toolInput as Record<string, unknown> | undefined;
  const direct = input?.note_id;
  if (typeof direct === "string") return direct;

  if (w.toolName === "createNote" && (w.status === "executed" || w.status === "confirmed")) {
    const undo = w.undoData as { noteId?: string } | undefined;
    if (undo?.noteId) return undo.noteId;
  }
  return undefined;
}

// ─── Badge derivation ───────────────────────────────────────────────────────

type WriteKind = "NEW" | "EDIT" | "MOVE" | "DELETE";

const TOOL_KIND: Record<string, WriteKind> = {
  createNote:            "NEW",
  createCalendarEvents:  "NEW",
  appendToNote:          "EDIT",
  insertInNote:          "EDIT",
  replaceInNote:         "EDIT",
  updateGoal:            "EDIT",
  updateCalendarEvent:   "EDIT",
  linkNoteToEvent:       "EDIT",
  moveNote:              "MOVE",
  deleteBlocksInNote:    "DELETE",
  deleteCalendarEvent:   "DELETE",
};

const BADGE_CLASS: Record<WriteKind, string> = {
  NEW:    "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  EDIT:   "bg-sky-500/10 text-sky-400 border-sky-400/30",
  MOVE:   "bg-amber-500/10 text-amber-500 border-amber-500/30",
  DELETE: "bg-red-500/10 text-red-500 border-red-500/30",
};

function kindOf(toolName: string): WriteKind {
  return TOOL_KIND[toolName] ?? "EDIT";
}

// ─── BatchSummaryChip ─────────────────────────────────────────────────────────
// Inline, persistent stand-in for a batch once its modal is closed (or while
// it's queued behind another open modal). Stays in the chat panel for the
// rest of the session — clicking it reopens the full modal, so a resolved
// batch's previews and "Open note" links remain reachable at any time, not
// just in the moment right after approval.

export function BatchSummaryChip({ writes, onOpen }: { writes: PendingWrite[]; onOpen: () => void }) {
  const total = writes.length;
  const resolvedCount = writes.filter((w) => w.status !== "pending").length;
  const allResolved = resolvedCount === total;

  return (
    <button
      onClick={onOpen}
      className="mx-3 mt-1 mb-1 w-[calc(100%-1.5rem)] flex items-center justify-between px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary hover:border-violet-400/40 transition-colors duration-100 text-left"
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-idemora-text-muted shrink-0">
          <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M3.5 4.5h5M3.5 6.5h5M3.5 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
        </svg>
        <span className="text-[11px] font-medium text-idemora-text-normal truncate">
          {total} proposed change{total === 1 ? "" : "s"}
        </span>
      </div>
      <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${
        allResolved
          ? "text-emerald-500 bg-emerald-500/10"
          : "text-amber-500 bg-amber-500/10"
      }`}>
        {allResolved ? `${resolvedCount}/${total} done — View` : `${resolvedCount}/${total} — Review`}
      </span>
    </button>
  );
}

// ─── BatchConfirmationModal ───────────────────────────────────────────────────

export function BatchConfirmationModal({ writes, onConfirm, onCancel, onApproveAll, onClose, onOpenNote }: Props) {
  const sorted = useMemo(
    () => [...writes].sort((a, b) => a.createdAt - b.createdAt),
    [writes]
  );
  const [selectedId, setSelectedId] = useState(sorted[0]?.id);
  const [approvingAll, setApprovingAll] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const selected = sorted.find((w) => w.id === selectedId) ?? sorted[0];
  const batchId  = sorted[0]?.batchId;

  const resolvedCount = sorted.filter(
    (w) => w.status === "confirmed" || w.status === "executed" || w.status === "cancelled"
  ).length;
  const totalCount = sorted.length;
  const anyPending  = sorted.some((w) => w.status === "pending");

  async function handleApproveAll() {
    setApprovingAll(true);
    await onApproveAll(batchId);
    setApprovingAll(false);
  }

  async function handleApproveSelected() {
    if (!selected || selected.status !== "pending") return;
    setConfirmingId(selected.id);
    await onConfirm(selected.id);
    setConfirmingId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-xl bg-idemora-bg-primary border border-idemora-border shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-idemora-text-normal">
              Review {totalCount} proposed change{totalCount === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Body: tree + preview ── */}
        <div className="flex flex-1 min-h-0">

          {/* Tree pane */}
          <div className="w-56 shrink-0 border-r border-idemora-border/60 overflow-y-auto py-2">
            {sorted.map((w) => {
              const kind = kindOf(w.toolName);
              const isSelected = w.id === selected?.id;
              const isCancelled = w.status === "cancelled";
              const isDone = w.status === "executed" || w.status === "confirmed";

              return (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 border-l-2 transition-colors duration-100 ${
                    isSelected
                      ? "border-violet-500 bg-violet-500/5"
                      : "border-transparent hover:bg-white/[0.03]"
                  } ${isCancelled ? "opacity-40" : ""}`}
                >
                  {/* Status glyph */}
                  <span className="mt-0.5 shrink-0 w-3 h-3 flex items-center justify-center">
                    {isDone ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-emerald-500">
                        <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : isCancelled ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-idemora-text-muted">
                        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <span className="block w-1.5 h-1.5 rounded-full border border-idemora-text-muted/50" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className={`text-[11px] font-medium leading-snug truncate ${
                      isCancelled ? "line-through text-idemora-text-muted" : "text-idemora-text-normal"
                    }`}>
                      {w.preview.title}
                    </p>
                    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${BADGE_CLASS[kind]}`}>
                      {kind}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Preview pane */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {selected && (
                <>
                  <p className="text-xs font-semibold text-idemora-text-normal mb-1">
                    {selected.preview.title}
                  </p>
                  {selected.preview.description && (
                    <p className="text-[10px] text-idemora-text-muted mb-2">
                      {selected.preview.description}
                    </p>
                  )}

                  {selected.status === "cancelled" ? (
                    <p className="text-[11px] text-idemora-text-muted italic">Cancelled — excluded from this batch.</p>
                  ) : selected.preview.isBatch ? (
                    <BatchCalendarPreview
                      content={selected.preview.content}
                      conflicts={selected.preview.conflicts}
                    />
                  ) : (
                    <div className={`rounded-md border p-2.5 ${
                      selected.preview.isDestructive
                        ? "bg-red-50/30 border-red-100"
                        : "bg-idemora-bg-secondary border-idemora-border/40"
                    }`}>
                      <MessageRenderer
                        content={selected.preview.fullContent ?? selected.preview.content}
                        isStreaming={false}
                      />
                    </div>
                  )}

                  {(selected.status === "executed" || selected.status === "confirmed") &&
                    onOpenNote && noteIdForWrite(selected) && (
                    <button
                      onClick={() => onOpenNote(noteIdForWrite(selected)!)}
                      className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-violet-400 border border-violet-400/30 hover:bg-violet-500/10 transition-colors duration-100"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5.5L5.5 1.5M5.5 1.5H2.5M5.5 1.5V4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Open note
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Per-item actions */}
            {selected && selected.status === "pending" && (
              <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-idemora-border/40 shrink-0">
                <button
                  onClick={() => onCancel(selected.id)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-idemora-text-muted border border-idemora-border/60 hover:text-idemora-text-normal hover:border-idemora-border transition-colors duration-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApproveSelected}
                  disabled={confirmingId === selected.id}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50 transition-colors duration-100"
                >
                  {confirmingId === selected.id ? "Applying…" : "Approve"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-idemora-border shrink-0">
          <span className="text-[11px] text-idemora-text-muted">
            {resolvedCount} of {totalCount} resolved
          </span>
          {anyPending ? (
            <button
              onClick={handleApproveAll}
              disabled={approvingAll}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-violet-500 hover:bg-violet-400 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100"
            >
              {approvingAll && (
                <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin" fill="none">
                  <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="12 6" strokeLinecap="round"/>
                </svg>
              )}
              Approve all ({sorted.filter((w) => w.status === "pending").length})
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-idemora-bg-secondary border border-idemora-border/60 text-idemora-text-normal hover:border-idemora-border transition-colors duration-100"
            >
              Done — review complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}