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
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  if (isoDate === today) return "Today";
  if (isoDate === tomorrow) return "Tomorrow";

  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
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

  // Yellow events float to top
  const yellowEvents = events.filter((e) => e.colour_state === "yellow");
  const otherEvents  = events.filter((e) => e.colour_state !== "yellow");
  const sorted = [...yellowEvents, ...otherEvents];

  if (sorted.length === 0) {
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

  // Group events by date
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of sorted) {
    const existing = grouped.get(event.date) ?? [];
    grouped.set(event.date, [...existing, event]);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Yellow queue notice */}
      {yellowEvents.length > 0 && (
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
          <p className="text-xs text-yellow-400 font-medium">
            {yellowEvents.length} event{yellowEvents.length !== 1 ? "s" : ""} need{yellowEvents.length === 1 ? "s" : ""} your attention
          </p>
        </div>
      )}

      {[...grouped.entries()].map(([date, dayEvents]) => (
        <div key={date}>
          {/* Date header */}
          <div className="px-4 py-2 sticky top-0 bg-idemora-bg-primary border-b border-idemora-border z-10">
            <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wide">
              {formatDate(date)}
            </span>
          </div>

          {/* Events for this date */}
          {dayEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-idemora-border/50
                         hover:bg-idemora-bg-secondary transition-colors text-left group"
            >
              {/* Colour dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_DOT[event.colour_state]}`} />

              {/* Event info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-idemora-text-normal truncate">{event.title}</p>
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
          ))}
        </div>
      ))}
    </div>
  );
}