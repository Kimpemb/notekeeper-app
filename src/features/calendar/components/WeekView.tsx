// src/features/calendar/components/WeekView.tsx

import { useRef } from "react";
import type { CalendarEvent, ColourState } from "@/features/calendar/db/calendarQueries";
import type { GoalBanner } from "@/features/calendar/lib/calendarMerge";

const STATE_BG: Record<ColourState, string> = {
  blue:   "bg-blue-500/20 border-blue-500/60 text-blue-200",
  green:  "bg-green-500/20 border-green-500/60 text-green-200",
  yellow: "bg-yellow-500/20 border-yellow-500/60 text-yellow-200",
  red:    "bg-red-500/20 border-red-500/60 text-red-200",
};

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0..23
const MIN_BLOCK_PX = 28;
const HOUR_HEIGHT_PX = 56; // height of one hour row in px
const DAY_TOTAL_PX = HOUR_HEIGHT_PX * 24;

interface Props {
  selectedDate:  string; // ISO — any date in the target week
  events:        CalendarEvent[];
  banners:       GoalBanner[];
  onEventClick:  (event: CalendarEvent) => void;
  onSlotClick:   (isoDate: string, time: string) => void;
  onGoalClick:   (goalId: string) => void;
}

function getMondayOfWeek(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return monday.toISOString().split("T")[0];
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToPx(minutes: number): number {
  return (minutes / 60) * HOUR_HEIGHT_PX;
}

function formatHour(h: number): string {
  if (h === 0)  return "12 AM";
  if (h < 12)   return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeekView({ selectedDate, events, banners, onEventClick, onSlotClick, onGoalClick }: Props) {
  const today  = new Date().toISOString().split("T")[0];
  const monday = getMondayOfWeek(selectedDate);
  const days   = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const scrollRef = useRef<HTMLDivElement>(null);

  // Split all-day vs timed
  const allDayEvents  = events.filter((e) => !e.time);
  const timedEvents   = events.filter((e) => !!e.time);

  // Index timed events by date
  const timedByDate = new Map<string, CalendarEvent[]>();
  for (const e of timedEvents) {
    const bucket = timedByDate.get(e.date) ?? [];
    timedByDate.set(e.date, [...bucket, e]);
  }

  // Index all-day events by date
  const allDayByDate = new Map<string, CalendarEvent[]>();
  for (const e of allDayEvents) {
    const bucket = allDayByDate.get(e.date) ?? [];
    allDayByDate.set(e.date, [...bucket, e]);
  }

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>, isoDate: string) {
    const rect    = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.floor((offsetY / DAY_TOTAL_PX) * 24 * 60);
    const snapped = Math.round(minutes / 15) * 15; // snap to 15-min
    const h = Math.floor(snapped / 60).toString().padStart(2, "0");
    const m = (snapped % 60).toString().padStart(2, "0");
    onSlotClick(isoDate, `${h}:${m}`);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Column headers */}
      <div className="flex shrink-0 border-b border-idemora-border">
        {/* Gutter spacer */}
        <div className="w-14 shrink-0" />
        {days.map((isoDate, i) => {
          const isToday = isoDate === today;
          const dayNum  = parseInt(isoDate.split("-")[2], 10);
          return (
            <div
              key={isoDate}
              className="flex-1 flex flex-col items-center py-2 border-l border-idemora-border/50"
            >
              <span className="text-xs text-idemora-text-muted uppercase tracking-wide">
                {WEEKDAYS_SHORT[i]}
              </span>
              <span
                className={[
                  "text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mt-0.5",
                  isToday ? "bg-blue-600 text-white" : "text-idemora-text-normal",
                ].join(" ")}
              >
                {dayNum}
              </span>
            </div>
          );
        })}
      </div>

      {/* All-day strip + goal banners */}
      {(allDayEvents.length > 0 || banners.length > 0) && (
        <div className="flex shrink-0 border-b border-idemora-border">
          <div className="w-14 shrink-0 flex items-center justify-end pr-2">
            <span className="text-xs text-idemora-text-muted">All day</span>
          </div>
          {days.map((isoDate) => {
            const dayAllDay = allDayByDate.get(isoDate) ?? [];
            const activeBanners = banners.filter(
              (b) => b.startDate <= isoDate && b.targetDate >= isoDate
            );
            return (
              <div
                key={isoDate}
                className="flex-1 border-l border-idemora-border/50 py-1 px-0.5 flex flex-col gap-0.5 min-h-[32px]"
              >
                {dayAllDay.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className={[
                      "w-full text-left text-xs px-1.5 py-0.5 rounded truncate border-l-2",
                      STATE_BG[event.colour_state],
                    ].join(" ")}
                  >
                    {event.title}
                  </button>
                ))}
                {activeBanners.map((b) => (
                  <button
                    key={b.goalId}
                    onClick={() => onGoalClick(b.goalId)}
                    className={[
                      "w-full text-left text-xs px-1.5 py-0.5 rounded truncate border-l-2",
                      b.colourState === "green"  ? "bg-green-500/10 border-green-500 text-green-300"  :
                      b.colourState === "yellow" ? "bg-yellow-500/10 border-yellow-500 text-yellow-300" :
                      b.colourState === "red"    ? "bg-red-500/10 border-red-500 text-red-300"    :
                      "bg-blue-500/10 border-blue-500 text-blue-300",
                    ].join(" ")}
                    title={b.title}
                  >
                    ◎ {b.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: DAY_TOTAL_PX }}>
          {/* Hour gutter */}
          <div className="w-14 shrink-0 relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute w-full flex items-start justify-end pr-2"
                style={{ top: h * HOUR_HEIGHT_PX - 8 }}
              >
                {h > 0 && (
                  <span className="text-xs text-idemora-text-muted/60 leading-none">
                    {formatHour(h)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((isoDate) => {
            const dayTimed = timedByDate.get(isoDate) ?? [];

            return (
              <div
                key={isoDate}
                className="flex-1 relative border-l border-idemora-border/50 cursor-pointer"
                onClick={(e) => handleGridClick(e, isoDate)}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-idemora-border/30"
                    style={{ top: h * HOUR_HEIGHT_PX }}
                  />
                ))}

                {/* Half-hour lines */}
                {HOURS.map((h) => (
                  <div
                    key={`h-${h}`}
                    className="absolute left-0 right-0 border-t border-idemora-border/15"
                    style={{ top: h * HOUR_HEIGHT_PX + HOUR_HEIGHT_PX / 2 }}
                  />
                ))}

                {/* Timed event blocks */}
                {dayTimed.map((event) => {
                  const startMins = timeToMinutes(event.time!);
                  const durMins   = event.duration_mins ?? 60;
                  const top       = minutesToPx(startMins);
                  const height    = Math.max(MIN_BLOCK_PX, minutesToPx(durMins));

                  return (
                    <button
                      key={event.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                      className={[
                        "absolute left-0.5 right-0.5 rounded text-left px-1.5 py-1",
                        "border-l-2 overflow-hidden hover:brightness-110 transition-all",
                        STATE_BG[event.colour_state],
                        event.colour_state === "green" ? "opacity-60" : "",
                      ].join(" ")}
                      style={{ top, height }}
                      title={event.title}
                    >
                      <p className="text-xs font-medium leading-tight truncate">{event.title}</p>
                      {height >= 44 && (
                        <p className="text-xs opacity-70 leading-tight">
                          {event.time?.slice(0, 5)}
                          {event.duration_mins ? ` · ${event.duration_mins}m` : ""}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}