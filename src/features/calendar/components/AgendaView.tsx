// src/features/calendar/components/AgendaView.tsx

import type { CalendarEvent, ColourState } from "@/features/calendar/db/calendarQueries";

const STATE_DOT: Record<ColourState, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  yellow: "bg-yellow-500",
  red:    "bg-red-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  personal: "Personal",
  note:     "Note",
  task:     "Task",
  goal:     "Goal",
  cde:      "CDE",
};

interface Props {
  events: CalendarEvent[];
  loading: boolean;
  onEventClick: (event: CalendarEvent) => void;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  const today    = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  if (isoDate === today)    return "Today";
  if (isoDate === tomorrow) return "Tomorrow";

  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

// Days between today and the given date (negative = past, 0 = today).
export function daysUntil(isoDate: string): number {
  const today  = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

// Urgency badge shown next to a date-group header.
function UrgencyBadge({ isoDate, hasUnresolved }: { isoDate: string; hasUnresolved: boolean }) {
  const diff = daysUntil(isoDate);

  if (diff < 0) {
    if (!hasUnresolved) return null;
    return (
      <span className="text-xs font-semibold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
        Overdue
      </span>
    );
  }
  if (diff === 0 || diff === 1) return null; // "Today"/"Tomorrow" already conveys urgency
  if (diff <= 7) {
    return (
      <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
        in {diff} days
      </span>
    );
  }
  return null;
}

function formatTime(time: string | null): string {
  if (!time) return "All day";
  return time;
}

export function AgendaView({ events, loading, onEventClick }: Props) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-idemora-text-muted text-sm">
        Loading…
      </div>
    );
  }

  // ── Group by date first (DB already returns events sorted by date ASC) ──────
  // Then within each group float yellow to top.
  // Previously we sorted yellow to top globally BEFORE grouping, which corrupted
  // Map insertion order: a yellow event on 2026-06-12 would cause the 2026-06-12
  // group to be inserted before 2026-06-16 even when navigating forward in time,
  // making future-dated events appear under past date headers.
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const existing = grouped.get(event.date) ?? [];
    grouped.set(event.date, [...existing, event]);
  }

  // Sort within each group: yellow first, green (completed) last, others in between
  for (const [date, dayEvents] of grouped) {
    grouped.set(date, [
      ...dayEvents.filter((e) => e.colour_state === "yellow"),
      ...dayEvents.filter((e) => e.colour_state !== "yellow" && e.colour_state !== "green"),
      ...dayEvents.filter((e) => e.colour_state === "green"),
    ]);
  }

  // Total yellow count for the notice banner
  const yellowCount = events.filter((e) => e.colour_state === "yellow").length;

  if (grouped.size === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-idemora-text-muted">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p className="text-sm">No upcoming events</p>
        <p className="text-xs opacity-60">Create one with the + button above</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Yellow queue notice */}
      {yellowCount > 0 && (
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
          <p className="text-xs text-yellow-400 font-medium">
            {yellowCount} event{yellowCount !== 1 ? "s" : ""} need{yellowCount === 1 ? "s" : ""} your attention
          </p>
        </div>
      )}

      {[...grouped.entries()].map(([date, dayEvents]) => (
        <div key={date}>
          {/* Date header */}
          <div className="px-4 py-2 sticky top-0 bg-idemora-bg-primary border-b border-idemora-border z-10 flex items-center gap-2">
            <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wide">
              {formatDate(date)}
            </span>
            <UrgencyBadge
              isoDate={date}
              hasUnresolved={dayEvents.some((e) => e.colour_state !== "green")}
            />
          </div>

          {/* Events for this date */}
          {dayEvents.map((event) => {
            const isCompleted = event.colour_state === "green";
            return (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className={`w-full flex items-center gap-3 px-4 py-3 border-b border-idemora-border/50
                         hover:bg-idemora-bg-secondary transition-colors text-left group
                         ${isCompleted ? "opacity-45" : ""}`}
            >
              {/* Colour dot — checkmark for completed */}
              {isCompleted ? (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="3" className="text-green-500 shrink-0">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              ) : (
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_DOT[event.colour_state]}`} />
              )}

              {/* Event info */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${
                  isCompleted
                    ? "text-idemora-text-muted line-through"
                    : "text-idemora-text-normal"
                }`}>
                  {event.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-idemora-text-muted">{formatTime(event.time)}</span>
                  <span className="text-xs text-idemora-text-muted opacity-50">·</span>
                  <span className="text-xs text-idemora-text-muted">{CATEGORY_LABELS[event.category] ?? event.category}</span>
                </div>
              </div>

              {/* Arrow on hover */}
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.5"
                className="text-idemora-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          );})}
        </div>
      ))}
    </div>
  );
}