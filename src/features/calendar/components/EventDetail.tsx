// src/features/calendar/components/EventDetail.tsx

import { useState } from "react";
import type { CalendarEvent, ColourState } from "@/features/calendar/db/calendarQueries";

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
  event: CalendarEvent;
  onEdit:   (event: CalendarEvent) => void;
  onDelete: (id: string) => Promise<void>;
  onResolve?: (id: string, state: ColourState) => Promise<void>;
  onClose: () => void;
}

export function EventDetail({ event, onEdit, onDelete, onResolve, onClose }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const state = STATE_LABELS[event.colour_state];
  const isReadOnly = event.source_type === "cde"; // Phase 3: CDE events are read-only

  function formatDate(isoDate: string): string {
    const d = new Date(isoDate + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function formatTime(time: string | null, duration: number | null): string {
    if (!time) return "All day";
    if (!duration) return time;
    const [h, m] = time.split(":").map(Number);
    const endMins = h * 60 + m + duration;
    const endH = Math.floor(endMins / 60) % 24;
    const endM = endMins % 60;
    return `${time} – ${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await onDelete(event.id);
      onClose();
    } catch (err) {
      console.error("[EventDetail] delete failed:", err);
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />

      <div className="w-80 h-full bg-idemora-bg-primary border-l border-idemora-border flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${state.className}`}>
            {state.label}
          </span>
          <button onClick={onClose} className="text-idemora-text-muted hover:text-idemora-text-normal transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-idemora-text-normal leading-snug">
            {event.title}
          </h2>

          <div className="flex flex-col gap-2 text-sm text-idemora-text-muted">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span>{formatDate(event.date)}</span>
            </div>

            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
              <span>{formatTime(event.time, event.duration_mins)}</span>
            </div>

            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6h16M4 10h16M4 14h8"/>
              </svg>
              <span>{CATEGORY_LABELS[event.category] ?? event.category}</span>
            </div>
          </div>

          {event.notes && (
            <div className="text-sm text-idemora-text-muted bg-idemora-bg-secondary rounded-lg px-3 py-2 leading-relaxed">
              {event.notes}
            </div>
          )}

          {/* Yellow resolution — Phase 11 will move this to YellowQueue too */}
          {event.colour_state === "yellow" && onResolve && (
            <div className="flex gap-2">
              <button
                onClick={() => onResolve(event.id, "green")}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                           bg-green-600/20 hover:bg-green-600/30 text-green-400 transition-colors"
              >
                Done ✓
              </button>
              <button
                onClick={() => onResolve(event.id, "red")}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                           bg-red-600/20 hover:bg-red-600/30 text-red-400 transition-colors"
              >
                Missed ✗
              </button>
            </div>
          )}

          {/* TODO Phase 3: CDE read-only mode — add "Go to project" link */}
          {/* TODO Phase 11: Goal context link */}
        </div>

        {/* Footer — actions */}
        {!isReadOnly && (
          <div className="px-4 py-3 border-t border-idemora-border flex gap-2">
            {confirmDelete ? (
              <>
                <span className="flex-1 text-xs text-red-400 self-center">Are you sure?</span>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 rounded-lg text-sm text-idemora-text-muted
                             border border-idemora-border hover:bg-idemora-bg-secondary transition-colors"
                >
                  No
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-2 rounded-lg text-sm font-medium
                             bg-red-600 hover:bg-red-700 text-white transition-colors
                             disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onEdit(event)}
                  className="flex-1 px-3 py-2 rounded-lg text-sm
                             border border-idemora-border hover:bg-idemora-bg-secondary
                             text-idemora-text-normal transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 px-3 py-2 rounded-lg text-sm
                             text-red-400 border border-red-500/30
                             hover:bg-red-500/10 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}