// src/features/calendar/components/MonthView.tsx

import type { CalendarEvent, ColourState } from "@/features/calendar/db/calendarQueries";

const STATE_BG: Record<ColourState, string> = {
  blue:   "bg-blue-500/80",
  green:  "bg-green-500/80",
  yellow: "bg-yellow-500/80",
  red:    "bg-red-500/80",
};

const STATE_DOT: Record<ColourState, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  yellow: "bg-yellow-500",
  red:    "bg-red-500",
};

interface Props {
  selectedDate:  string;
  events:        CalendarEvent[];
  onEventClick:  (event: CalendarEvent) => void;
  onDayClick:    (isoDate: string) => void; // navigates to DayView
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function buildMonthGrid(selectedDate: string): string[] {
  const d         = new Date(selectedDate + "T00:00:00");
  const firstDay  = new Date(d.getFullYear(), d.getMonth(), 1);
  const lastDay   = new Date(d.getFullYear(), d.getMonth() + 1, 0);

  // Monday-aligned: 0=Mon … 6=Sun
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStart   = addDays(firstDay.toISOString().split("T")[0], -startOffset);

  // Always 6 rows × 7 cols = 42 cells
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  return cells;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PILLS = 3;

export function MonthView({ selectedDate, events, onEventClick, onDayClick }: Props) {
  const today         = new Date().toISOString().split("T")[0];
  const currentMonth  = selectedDate.slice(0, 7); // "2026-06"
  const cells         = buildMonthGrid(selectedDate);

  // Index events by date
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const bucket = byDate.get(e.date) ?? [];
    byDate.set(e.date, [...bucket, e]);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-idemora-border shrink-0">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-medium text-idemora-text-muted uppercase tracking-wide"
          >
            {day}
          </div>
        ))}
      </div>

      {/* 6-row grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-6 overflow-hidden">
        {cells.map((isoDate) => {
          const isToday       = isoDate === today;
          const isCurrentMonth = isoDate.slice(0, 7) === currentMonth;
          const dayEvents     = byDate.get(isoDate) ?? [];
          const visible       = dayEvents.slice(0, MAX_PILLS);
          const overflow      = dayEvents.length - MAX_PILLS;
          const dayNum        = parseInt(isoDate.split("-")[2], 10);

          return (
            <div
              key={isoDate}
              onClick={() => onDayClick(isoDate)}
              className={[
                "flex flex-col border-b border-r border-idemora-border/50 p-1.5 cursor-pointer",
                "hover:bg-idemora-bg-secondary/50 transition-colors overflow-hidden",
                !isCurrentMonth ? "opacity-35" : "",
              ].join(" ")}
            >
              {/* Date number */}
              <div className="flex items-center justify-between mb-1 shrink-0">
                <span
                  className={[
                    "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full",
                    isToday
                      ? "bg-blue-600 text-white font-semibold"
                      : "text-idemora-text-muted",
                  ].join(" ")}
                >
                  {dayNum}
                </span>
              </div>

              {/* Event pills */}
              <div className="flex flex-col gap-0.5 min-h-0">
                {visible.map((event) => (
                  <button
                    key={event.id}
                    onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                    className={[
                      "w-full text-left text-xs px-1.5 py-0.5 rounded truncate",
                      "text-white transition-opacity hover:opacity-80",
                      STATE_BG[event.colour_state],
                      event.colour_state === "green" ? "opacity-60" : "",
                    ].join(" ")}
                    title={event.title}
                  >
                    {event.time && (
                      <span className="opacity-70 mr-1">{event.time.slice(0, 5)}</span>
                    )}
                    {event.title}
                  </button>
                ))}

                {overflow > 0 && (
                  <span className="text-xs text-idemora-text-muted px-1">
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}