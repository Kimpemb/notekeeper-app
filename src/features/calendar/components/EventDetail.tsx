// src/features/calendar/components/EventDetail.tsx

import { useState, useEffect } from "react";
import type { CalendarEvent, CalendarEventInput, ColourState } from "@/features/calendar/db/calendarQueries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { EditMode, DeleteMode } from "@/features/calendar/hooks/useRecurrence";

// ─── Types ────────────────────────────────────────────────────────────────────

type FooterState =
  | "idle"
  | "editing"
  | "scope-pick"       // recurring edit: pick this / this+future / all
  | "delete-confirm"   // non-recurring delete: are you sure?
  | "delete-scope";    // recurring delete: pick this / all

const STATE_LABELS: Record<ColourState, { label: string; className: string }> = {
  blue:   { label: "Scheduled",  className: "bg-blue-500/15 text-blue-400" },
  green:  { label: "Completed",  className: "bg-green-500/15 text-green-400" },
  yellow: { label: "Unresolved", className: "bg-yellow-500/15 text-yellow-400" },
  red:    { label: "Missed",     className: "bg-red-500/15 text-red-400" },
};

const CATEGORY_LABELS: Record<string, string> = {
  personal: "Personal",
  note:     "Note",
  task:     "Task",
  goal:     "Goal",
  cde:      "CDE",
};

interface Props {
  event:            CalendarEvent;
  onClose:          () => void;
  onDelete:         (id: string) => Promise<void>;
  onResolve?:       (id: string, state: ColourState, occurrenceId?: string | null) => Promise<void>;
  onOpenNote?:      (noteId: string) => void;
  updateEvent:      (id: string, updates: Partial<CalendarEventInput>) => Promise<void>;
  editOccurrence:   (mode: EditMode, params: { eventId: string; occurrenceId: string; occurrenceDate: string; updates: Partial<CalendarEventInput> }) => Promise<void>;
  deleteOccurrence: (mode: DeleteMode, params: { eventId: string; occurrenceId: string }) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function formatDateShort(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(time: string | null, duration: number | null): string {
  if (!time) return "All day";
  if (!duration) return time;
  const [h, m] = time.split(":").map(Number);
  const endMins = h * 60 + m + duration;
  const endH    = Math.floor(endMins / 60) % 24;
  const endM    = endMins % 60;
  return `${time} – ${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventDetail({
  event,
  onClose,
  onDelete,
  onResolve,
  onOpenNote,
  updateEvent,
  editOccurrence,
  deleteOccurrence,
}: Props) {
  const isRecurring = !!event.occurrence_id;
  const isReadOnly  = event.source_type === "cde";

  // ── Footer state machine ───────────────────────────────────────────────────
  const [footerState, setFooterState] = useState<FooterState>("idle");

  // ── Edit field state (mirrors event, only committed on save) ──────────────
  const [editTitle,    setEditTitle]    = useState(event.title);
  const [editDate,     setEditDate]     = useState(event.date);
  const [editTime,     setEditTime]     = useState(event.time ?? "");
  const [editDuration, setEditDuration] = useState(String(event.duration_mins ?? ""));
  const [editNotes,    setEditNotes]    = useState(event.notes ?? "");

  // ── Async state ────────────────────────────────────────────────────────────
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [resolving, setResolving] = useState<ColourState | null>(null);
  const [error,     setError]     = useState("");

  // Reset edit fields if event prop changes (e.g. after a reload)
  useEffect(() => {
    setEditTitle(event.title);
    setEditDate(event.date);
    setEditTime(event.time ?? "");
    setEditDuration(String(event.duration_mins ?? ""));
    setEditNotes(event.notes ?? "");
    setFooterState("idle");
    setError("");
  }, [event.id]);

  // Esc closes or goes back
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (footerState === "scope-pick") { setFooterState("editing"); return; }
      if (footerState === "editing")    { setFooterState("idle");    return; }
      if (footerState === "delete-confirm" || footerState === "delete-scope") {
        setFooterState("idle");
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [footerState, onClose]);

  // ── Note resolution ────────────────────────────────────────────────────────
  const linkedNote = useNoteStore((s) => {
    if (!event.linked_note_id) return null;
    return s.notes.find((n) => n.id === event.linked_note_id)
        ?? s.trashedNotes.find((n) => n.id === event.linked_note_id)
        ?? null;
  });
  const linkedNoteDeleted =
    (linkedNote != null && linkedNote.deleted_at != null) ||
    (event.linked_note_id != null && linkedNote === null);

  const sourceNote = useNoteStore((s) => {
    if (event.source_type !== "note" || !event.source_id) return null;
    return s.notes.find((n) => n.id === event.source_id)
        ?? s.trashedNotes.find((n) => n.id === event.source_id)
        ?? null;
  });
  const sourceNoteDeleted =
    event.source_type === "note" &&
    event.source_id != null &&
    (sourceNote === null || sourceNote.deleted_at != null);

  // ── Build updates from edit fields ─────────────────────────────────────────
  function buildUpdates(): Partial<CalendarEventInput> {
    const updates: Partial<CalendarEventInput> = {};
    if (editTitle.trim() !== event.title)           updates.title         = editTitle.trim();
    if (editDate !== event.date)                    updates.date          = editDate;
    if ((editTime || null) !== event.time)          updates.time          = editTime || null;
    const durNum = editDuration ? parseInt(editDuration, 10) : null;
    if (durNum !== event.duration_mins)             updates.duration_mins = durNum;
    if ((editNotes.trim() || null) !== event.notes) updates.notes         = editNotes.trim() || null;
    return updates;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSaveConfirmed(mode?: EditMode) {
    if (!editTitle.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    try {
      const updates = buildUpdates();
      if (isRecurring && mode) {
        await editOccurrence(mode, {
          eventId:        event.id,
          occurrenceId:   event.occurrence_id!,
          occurrenceDate: event.date,
          updates,
        });
      } else {
        await updateEvent(event.id, updates);
      }
      onClose();
    } catch (err) {
      console.error("[EventDetail] save failed:", err);
      setError("Failed to save. Please try again.");
      setSaving(false);
      setFooterState(isRecurring ? "scope-pick" : "editing");
    }
  }

  function handleSaveClick() {
    if (!editTitle.trim()) { setError("Title is required."); return; }
    if (isRecurring) {
      setFooterState("scope-pick");
    } else {
      handleSaveConfirmed();
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDeleteConfirmed(mode?: DeleteMode) {
    setDeleting(true);
    try {
      if (isRecurring && mode) {
        await deleteOccurrence(mode, {
          eventId:      event.id,
          occurrenceId: event.occurrence_id!,
        });
      } else {
        await onDelete(event.id);
      }
      onClose();
    } catch (err) {
      console.error("[EventDetail] delete failed:", err);
      setDeleting(false);
      setFooterState("idle");
    }
  }

  function handleDeleteClick() {
    if (isRecurring) {
      setFooterState("delete-scope");
    } else {
      setFooterState("delete-confirm");
    }
  }

  // ── Resolve ────────────────────────────────────────────────────────────────
  async function handleResolve(newState: ColourState) {
    if (!onResolve) return;
    setResolving(newState);
    try {
      await onResolve(event.id, newState, event.occurrence_id);
    } catch (err) {
      console.error("[EventDetail] resolve failed:", err);
      setResolving(null);
    }
  }

  const showCompleteButton = event.colour_state === "blue"   && onResolve;
  const showDoneMissed     = event.colour_state === "yellow" && onResolve;

  const stateInfo = STATE_LABELS[event.colour_state];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={footerState === "idle" ? onClose : undefined} />

      <div className="w-80 h-full bg-idemora-bg-primary border-l border-idemora-border
                      flex flex-col shadow-xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stateInfo.className}`}>
              {stateInfo.label}
            </span>
            {isRecurring && (
              <span className="text-xs text-idemora-text-muted flex items-center gap-1">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M17 2l4 4-4 4"/>
                  <path d="M3 11V9a4 4 0 014-4h14"/>
                  <path d="M7 22l-4-4 4-4"/>
                  <path d="M21 13v2a4 4 0 01-4 4H3"/>
                </svg>
                Recurring
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">

          {/* Title */}
          {footerState === "editing" ? (
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => { setEditTitle(e.target.value); setError(""); }}
              className="text-base font-semibold text-idemora-text-normal bg-idemora-bg-secondary
                         border border-idemora-border rounded-lg px-3 py-2
                         focus:outline-none focus:border-blue-500 transition-colors"
            />
          ) : (
            <h2 className="text-base font-semibold text-idemora-text-normal leading-snug">
              {event.title}
            </h2>
          )}

          {/* Meta fields */}
          <div className="flex flex-col gap-2 text-sm text-idemora-text-muted">

            {/* Date */}
            {footerState === "editing" ? (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-idemora-border
                             bg-idemora-bg-secondary text-sm text-idemora-text-normal
                             focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span>{formatDate(event.date)}</span>
              </div>
            )}

            {/* Time */}
            {footerState === "editing" ? (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-idemora-border
                             bg-idemora-bg-secondary text-sm text-idemora-text-normal
                             focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                <span>{formatTime(event.time, event.duration_mins)}</span>
              </div>
            )}

            {/* Duration — only shown in edit mode when time is set */}
            {footerState === "editing" && editTime && (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                  <path d="M12 2v10l6 3"/>
                  <circle cx="12" cy="12" r="10"/>
                </svg>
                <input
                  type="number"
                  min="5"
                  step="5"
                  placeholder="Duration (mins)"
                  value={editDuration}
                  onChange={(e) => setEditDuration(e.target.value)}
                  className="flex-1 px-2 py-1 rounded-lg border border-idemora-border
                             bg-idemora-bg-secondary text-sm text-idemora-text-normal
                             placeholder-idemora-text-muted
                             focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            )}

            {/* Category — display only */}
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6h16M4 10h16M4 14h8"/>
              </svg>
              <span>{CATEGORY_LABELS[event.category] ?? event.category}</span>
            </div>

            {/* Linked note */}
            {event.linked_note_id && onOpenNote && (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M7 8h10M7 12h7"/>
                </svg>
                {linkedNoteDeleted ? (
                  <span className="flex items-center gap-1.5">
                    <span className="line-through">{linkedNote?.title ?? "Deleted note"}</span>
                    <span className="text-xs text-red-400/70 bg-red-500/10 px-1.5 py-0.5 rounded font-medium">
                      Deleted
                    </span>
                  </span>
                ) : (
                  <button
                    onClick={() => onOpenNote(event.linked_note_id!)}
                    className="text-blue-400 hover:text-blue-300 transition-colors hover:underline"
                  >
                    Open note →
                  </button>
                )}
              </div>
            )}

            {/* Source note */}
            {event.source_type === "note" && event.source_id && onOpenNote && (
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M7 8h10M7 12h7"/>
                </svg>
                {sourceNoteDeleted ? (
                  <span className="flex items-center gap-1.5">
                    <span className="line-through">{sourceNote?.title ?? "Deleted note"}</span>
                    <span className="text-xs text-red-400/70 bg-red-500/10 px-1.5 py-0.5 rounded font-medium">
                      Deleted
                    </span>
                  </span>
                ) : (
                  <button
                    onClick={() => onOpenNote(event.source_id!)}
                    className="text-idemora-text-muted hover:text-idemora-text-normal
                               transition-colors hover:underline text-sm flex items-center gap-1"
                  >
                    {sourceNote?.title ?? "Open note"}
                    <span className="opacity-50">→</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          {footerState === "editing" ? (
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={3}
              placeholder="Add notes…"
              className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                         text-sm text-idemora-text-normal placeholder-idemora-text-muted
                         focus:outline-none focus:border-blue-500 transition-colors resize-none"
            />
          ) : (
            event.notes && (
              <div className="text-sm text-idemora-text-muted bg-idemora-bg-secondary
                              rounded-lg px-3 py-2 leading-relaxed">
                {event.notes}
              </div>
            )
          )}

          {/* Resolve buttons — only in idle mode */}
          {footerState === "idle" && (
            <>
              {showCompleteButton && (
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => handleResolve("green")}
                    disabled={resolving !== null}
                    className="w-full px-3 py-2 rounded-lg text-sm font-medium
                               bg-green-600/20 hover:bg-green-600/30 text-green-400
                               transition-colors disabled:opacity-50
                               flex items-center justify-center gap-2"
                  >
                    {resolving === "green" ? "Marking…" : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2.5">
                          <path d="M20 6L9 17l-5-5"/>
                        </svg>
                        Mark completed
                      </>
                    )}
                  </button>
                  <p className="text-xs text-idemora-text-muted text-center opacity-60">
                    Stays visible today, gone tomorrow
                  </p>
                </div>
              )}

              {showDoneMissed && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleResolve("green")}
                    disabled={resolving !== null}
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                               bg-green-600/20 hover:bg-green-600/30 text-green-400
                               transition-colors disabled:opacity-50"
                  >
                    {resolving === "green" ? "Saving…" : "Done ✓"}
                  </button>
                  <button
                    onClick={() => handleResolve("red")}
                    disabled={resolving !== null}
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                               bg-red-600/20 hover:bg-red-600/30 text-red-400
                               transition-colors disabled:opacity-50"
                  >
                    {resolving === "red" ? "Saving…" : "Missed ✗"}
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        {/* ── Footer — state machine ── */}
        {!isReadOnly && (
          <div className="px-4 py-3 border-t border-idemora-border shrink-0">

            {/* idle */}
            {footerState === "idle" && (
              <div className="flex gap-2">
                <button
                  onClick={() => setFooterState("editing")}
                  className="flex-1 px-3 py-2 rounded-lg text-sm border border-idemora-border
                             hover:bg-idemora-bg-secondary text-idemora-text-normal transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleDeleteClick}
                  className="flex-1 px-3 py-2 rounded-lg text-sm text-red-400
                             border border-red-500/30 hover:bg-red-500/10 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}

            {/* editing */}
            {footerState === "editing" && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setFooterState("idle"); setError(""); }}
                  className="flex-1 px-3 py-2 rounded-lg text-sm text-idemora-text-muted
                             border border-idemora-border hover:bg-idemora-bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveClick}
                  disabled={saving}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                             bg-blue-600 hover:bg-blue-700 text-white
                             transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            )}

            {/* scope-pick — recurring edit scope */}
            {footerState === "scope-pick" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={() => setFooterState("editing")}
                    className="text-idemora-text-muted hover:text-idemora-text-normal
                               transition-colors flex items-center gap-1 text-xs"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2">
                      <path d="M19 12H5M12 5l-7 7 7 7"/>
                    </svg>
                    Back
                  </button>
                  <span className="text-xs text-idemora-text-muted">
                    Save changes to…
                  </span>
                </div>

                {(
                  [
                    {
                      mode:     "this" as EditMode,
                      label:    "This event",
                      sublabel: `Only ${formatDateShort(event.date)} changes`,
                    },
                    {
                      mode:     "this_and_future" as EditMode,
                      label:    "This & future",
                      sublabel: `From ${formatDateShort(event.date)} onwards`,
                    },
                    {
                      mode:     "all" as EditMode,
                      label:    "All events",
                      sublabel: "Every occurrence is updated",
                    },
                  ] as const
                ).map(({ mode, label, sublabel }) => (
                  <button
                    key={mode}
                    onClick={() => handleSaveConfirmed(mode)}
                    disabled={saving}
                    className="w-full px-3 py-2.5 rounded-lg border border-idemora-border
                               hover:border-blue-500/50 hover:bg-blue-500/5
                               text-left transition-colors disabled:opacity-50 group"
                  >
                    <span className="block text-sm font-medium text-idemora-text-normal
                                     group-hover:text-blue-400 transition-colors">
                      {saving ? "Saving…" : label}
                    </span>
                    <span className="block text-xs text-idemora-text-muted mt-0.5">
                      {sublabel}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* delete-confirm — non-recurring */}
            {footerState === "delete-confirm" && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-idemora-text-muted text-center">
                  Delete this event?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setFooterState("idle")}
                    className="flex-1 px-3 py-2 rounded-lg text-sm text-idemora-text-muted
                               border border-idemora-border hover:bg-idemora-bg-secondary
                               transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteConfirmed()}
                    disabled={deleting}
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                               bg-red-600 hover:bg-red-700 text-white
                               transition-colors disabled:opacity-50"
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            )}

            {/* delete-scope — recurring */}
            {footerState === "delete-scope" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-idemora-text-muted">Delete…</span>
                  <button
                    onClick={() => setFooterState("idle")}
                    className="text-xs text-idemora-text-muted hover:text-idemora-text-normal
                               transition-colors"
                  >
                    Cancel
                  </button>
                </div>

                {(
                  [
                    {
                      mode:     "this" as DeleteMode,
                      label:    "This event only",
                      sublabel: `Removes ${formatDateShort(event.date)}, series continues`,
                    },
                    {
                      mode:     "all" as DeleteMode,
                      label:    "All events",
                      sublabel: "Deletes the entire recurring series",
                    },
                  ] as const
                ).map(({ mode, label, sublabel }) => (
                  <button
                    key={mode}
                    onClick={() => handleDeleteConfirmed(mode)}
                    disabled={deleting}
                    className="w-full px-3 py-2.5 rounded-lg border border-red-500/20
                               hover:border-red-500/50 hover:bg-red-500/5
                               text-left transition-colors disabled:opacity-50 group"
                  >
                    <span className="block text-sm font-medium text-red-400
                                     group-hover:text-red-300 transition-colors">
                      {deleting ? "Deleting…" : label}
                    </span>
                    <span className="block text-xs text-idemora-text-muted mt-0.5">
                      {sublabel}
                    </span>
                  </button>
                ))}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}