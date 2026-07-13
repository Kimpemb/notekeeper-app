// src/features/ai/components/ConfirmationCard.tsx
//
// Inline confirmation UI rendered in the chat message list after a write tool
// is proposed by the model. The user must explicitly approve before any write
// executes. All card variants (small write, large write, batch calendar,
// destructive, bulk destructive) are handled here.

import { useState, useEffect, useRef } from "react";
import type { PendingWrite } from "@/features/ai/lib/tools/confirmationGate";

interface Props {
  pendingWrite: PendingWrite;
  onConfirm:   (id: string) => Promise<void>;
  onCancel:    (id: string) => void;
  onUndo:      (id: string) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function parseCalendarEvents(content: string): CalendarEventRow[] {
  try {
    return JSON.parse(content) as CalendarEventRow[];
  } catch {
    return [];
  }
}

interface CalendarEventRow {
  title:         string;
  date:          string;
  time?:         string | null;
  duration_mins?: number | null;
  category?:     string | null;
}

function formatEventTime(ev: CalendarEventRow): string {
  if (!ev.time) return "All day";
  if (!ev.duration_mins) return ev.time;
  const [h, m] = ev.time.split(":").map(Number);
  const endMins = (h ?? 0) * 60 + (m ?? 0) + (ev.duration_mins ?? 0);
  const eh = Math.floor(endMins / 60).toString().padStart(2, "0");
  const em = (endMins % 60).toString().padStart(2, "0");
  return `${ev.time}–${eh}:${em}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─── Undo countdown hook ──────────────────────────────────────────────────────

function useUndoCountdown(undoExpiry: number | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!undoExpiry) { setRemaining(null); return; }

    function tick() {
      const secs = Math.ceil((undoExpiry! - Date.now()) / 1000);
      if (secs <= 0) {
        setRemaining(null);
        return;
      }
      setRemaining(secs);
      rafRef.current = window.setTimeout(tick, 250);
    }
    tick();

    return () => {
      if (rafRef.current) clearTimeout(rafRef.current);
    };
  }, [undoExpiry]);

  return remaining;
}

// ─── ConfirmationCard ─────────────────────────────────────────────────────────

export function ConfirmationCard({ pendingWrite: pw, onConfirm, onCancel, onUndo }: Props) {
  const [expanded, setExpanded]         = useState(false);
  const [confirming, setConfirming]     = useState(false);
  const [bulkStep, setBulkStep]         = useState<"idle" | "confirm">("idle");
  const undoSecondsLeft                 = useUndoCountdown(pw.undoExpiry);

  const isBulkDestructive =
    pw.preview.isDestructive &&
    (pw.preview.wordCount > 200 ||
      (pw.toolName === "deleteCalendarEvent" && pw.preview.isBatch));

  const needsExpansion =
    !pw.preview.isBatch &&
    !!pw.preview.fullContent &&
    pw.preview.wordCount > 200;

  const applyDisabled = needsExpansion && !expanded;

  // ── Executed / undone states ───────────────────────────────────────────────

  if (pw.status === "undone") {
    return (
      <div className="mx-3 mt-1 mb-1 px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary flex items-center gap-2">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-idemora-text-muted shrink-0">
          <path d="M1.5 5a3.5 3.5 0 103.5-3.5c-1 0-1.9.4-2.5 1L1 1"
            stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M1 1v2.5h2.5"
            stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-[11px] text-idemora-text-muted">Undone</span>
      </div>
    );
  }

  if (pw.status === "error") {
    return (
      <div className="mx-3 mt-1 mb-1 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2 flex items-center gap-2">
        <svg width="10" height="10" viewBox="0 0 11 11" fill="none" className="text-red-400 shrink-0">
          <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5.5 3.5v2.5M5.5 7.5v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <span className="text-[11px] text-red-500 leading-relaxed">
          {pw.errorMessage ?? "Write failed — please try again."}
        </span>
      </div>
    );
  }

  if (pw.status === "executed") {
    return (
      <div className="mx-3 mt-1 mb-1 px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-primary">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-violet-400 shrink-0">
              <path d="M1.5 5l2.5 2.5 4.5-4.5"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[11px] text-idemora-text-muted truncate">{pw.preview.title}</span>
          </div>
          {undoSecondsLeft != null && (
            <button
              onClick={() => onUndo(pw.id)}
              className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium text-idemora-text-muted border border-idemora-border/60 hover:text-idemora-text-normal hover:border-idemora-border transition-colors duration-100"
            >
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5a3.5 3.5 0 103.5-3.5c-1 0-1.9.4-2.5 1L1 1"
                  stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M1 1v2.5h2.5"
                  stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Undo — {undoSecondsLeft}s
            </button>
          )}
        </div>
        {pw.insertedViaFallback && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <svg width="9" height="9" viewBox="0 0 11 11" fill="none" className="text-amber-400 shrink-0">
              <path d="M5.5 1L10 9.5H1L5.5 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
              <path d="M5.5 4.5v2M5.5 8v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            <span className="text-[10px] text-amber-500">
              Couldn't find the exact position — added at end of note instead.
            </span>
          </div>
        )}
      </div>
    );
  }

  if (pw.status === "cancelled") {
    return null;
  }

  // ── Pending state ──────────────────────────────────────────────────────────

  async function handleApply() {
    if (isBulkDestructive && bulkStep === "idle") {
      setBulkStep("confirm");
      return;
    }
    console.log("[ConfirmationCard] handleApply fired, pw.id:", pw.id, "pw.status:", pw.status);
    setConfirming(true);
    await onConfirm(pw.id);
    setConfirming(false);
  }

  const applyLabel = pw.preview.isDestructive
    ? pw.toolName === "deleteCalendarEvent" ? "Delete" : "Replace"
    : "Apply";

  const applyClass = pw.preview.isDestructive
    ? "bg-red-500 hover:bg-red-600 text-white"
    : "bg-violet-500 hover:bg-violet-400 text-white";

  return (
    <div className="mx-3 mt-1 mb-1 rounded-lg border border-idemora-border bg-idemora-bg-primary overflow-hidden">

      {/* ── Header ── */}
      <div className="px-3 pt-2.5 pb-1.5">
        <div className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5 shrink-0">
            {pw.preview.isBatch ? "📅" : pw.preview.isDestructive ? "⚠️" : "📝"}
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-idemora-text-normal leading-snug">
              {pw.preview.title}
            </p>
            {pw.preview.description && (
              <p className="text-[10px] text-idemora-text-muted mt-0.5 leading-relaxed">
                {pw.preview.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div className="border-t border-idemora-border/50 mx-3" />

      {/* ── Content preview ── */}
      <div className="px-3 py-2">
        {pw.preview.isBatch ? (
          <BatchCalendarPreview content={pw.preview.content} conflicts={pw.preview.conflicts} />
        ) : (
          <TextPreview
            content={pw.preview.content}
            fullContent={pw.preview.fullContent}
            expanded={expanded}
            onExpand={() => setExpanded(true)}
            isDestructive={pw.preview.isDestructive}
          />
        )}
      </div>

      {/* ── Destructive warning ── */}
      {pw.preview.isDestructive && (
        <div className="px-3 pb-1.5">
          <p className="text-[10px] text-red-400 leading-relaxed">
            This cannot be undone after 60 seconds.
          </p>
        </div>
      )}

      {/* ── Two-step confirmation prompt ── */}
      {bulkStep === "confirm" && (
        <div className="mx-3 mb-2 px-2.5 py-2 rounded-md bg-red-50/40 border border-red-100">
          <p className="text-[11px] text-red-600 font-medium">Are you sure?</p>
          <p className="text-[10px] text-red-500 mt-0.5">
            This will {pw.toolName === "deleteCalendarEvent" ? "permanently delete" : "overwrite"} the content.
          </p>
        </div>
      )}

      {/* ── Divider ── */}
      <div className="border-t border-idemora-border/50 mx-3" />

      {/* ── Action row ── */}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        {/* Expand hint */}
        {needsExpansion && !expanded && (
          <p className="text-[10px] text-idemora-text-muted">
            Expand to enable Apply
          </p>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => onCancel(pw.id)}
            disabled={confirming}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-idemora-text-muted border border-idemora-border/60 hover:text-idemora-text-normal hover:border-idemora-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applyDisabled || confirming}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${applyClass}`}
          >
            {confirming && (
              <svg width="10" height="10" viewBox="0 0 10 10" className="animate-spin" fill="none">
                <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5"
                  strokeDasharray="12 6" strokeLinecap="round"/>
              </svg>
            )}
            {bulkStep === "confirm" ? "Yes, " + applyLabel.toLowerCase() : applyLabel}
            {pw.preview.isBatch ? " all" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TextPreview ──────────────────────────────────────────────────────────────

function TextPreview({
  content, fullContent, expanded, onExpand, isDestructive,
}: {
  content:      string;
  fullContent?: string;
  expanded:     boolean;
  onExpand:     () => void;
  isDestructive: boolean;
}) {
  const displayText = expanded && fullContent ? fullContent : content;
  const isTruncated = !!fullContent && !expanded;

  return (
    <div className={`rounded-md text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto ${
      isDestructive
        ? "bg-red-50/30 text-red-700 border border-red-100 p-2"
        : "bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border/40 p-2"
    }`}>
      {displayText}
      {isTruncated && (
        <button
          onClick={onExpand}
          className="block mt-1.5 text-[10px] text-violet-400 hover:text-violet-300 transition-colors duration-100"
        >
          Show all ↓ ({fullContent ? wordCount(fullContent) : 0} words)
        </button>
      )}
    </div>
  );
}

// ─── BatchCalendarPreview ─────────────────────────────────────────────────────

export function BatchCalendarPreview({
  content,
  conflicts,
}: {
  content:    string;
  conflicts?: import("@/features/ai/lib/tools/writeTools").CalendarConflict[];
}) {
  const events = parseCalendarEvents(content);

  const conflictSet = new Set(
    conflicts?.map((c) => `${c.date}|${c.time ?? ""}`) ?? []
  );

  if (events.length === 0) {
    return (
      <p className="text-[11px] text-idemora-text-muted">No events to preview.</p>
    );
  }

  return (
    <div className="space-y-1">
      {events.map((ev, i) => {
        const key    = `${ev.date}|${ev.time ?? ""}`;
        const hasConflict = conflictSet.has(key);
        return (
          <div
            key={i}
            className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-[11px] ${
              hasConflict
                ? "bg-amber-50/40 border border-amber-100"
                : "bg-idemora-bg-secondary border border-idemora-border/40"
            }`}
          >
            {hasConflict && (
              <svg width="9" height="9" viewBox="0 0 11 11" fill="none"
                className="text-amber-400 shrink-0 mt-px">
                <path d="M5.5 1L10 9.5H1L5.5 1z"
                  stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                <path d="M5.5 4.5v2M5.5 8v.1"
                  stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={`font-medium truncate ${
                  hasConflict ? "text-amber-700" : "text-idemora-text-normal"
                }`}>
                  {ev.title}
                </span>
                <span className="text-idemora-text-muted shrink-0">
                  {formatEventTime(ev)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={hasConflict ? "text-amber-500" : "text-idemora-text-muted"}>
                  {formatDate(ev.date)}
                </span>
                {ev.category && (
                  <>
                    <span className="text-idemora-text-faint">·</span>
                    <span className="text-idemora-text-muted">{ev.category}</span>
                  </>
                )}
                {hasConflict && (
                  <>
                    <span className="text-amber-400">·</span>
                    <span className="text-amber-500">conflict</span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {conflicts && conflicts.length > 0 && (
        <div className="mt-1.5 px-1">
          {conflicts.map((c, i) => (
            <p key={i} className="text-[10px] text-amber-500 leading-relaxed">
              ⚠ {formatDate(c.date)}{c.time ? ` at ${c.time}` : ""} conflicts with "{c.existingTitle}"
            </p>
          ))}
        </div>
      )}
    </div>
  );
}