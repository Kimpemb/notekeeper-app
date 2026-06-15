// src/features/calendar/components/DayView.tsx

import { useRef } from "react";
import type { CalendarEvent, ColourState } from "@/features/calendar/db/calendarQueries";
import type { GoalBanner } from "@/features/calendar/lib/calendarMerge";

const STATE_BG: Record<ColourState, string> = {
  blue:   "bg-blue-500/20 border-blue-500/60 text-idemora-text-normal",
  green:  "bg-green-500/20 border-green-500/60 text-idemora-text-normal",
  yellow: "bg-yellow-500/20 border-yellow-500/60 text-idemora-text-normal",
  red:    "bg-red-500/20 border-red-500/60 text-idemora-text-normal",
};

const STATE_DOT: Record<ColourState, string> = {
  blue:   "bg-blue-400",
  green:  "bg-green-400",
  yellow: "bg-yellow-400",
  red:    "bg-red-400",
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MIN_BLOCK_PX  = 28;
const HOUR_HEIGHT_PX = 64;
const DAY_TOTAL_PX  = HOUR_HEIGHT_PX * 24;

interface Props {
  selectedDate:  string;
  events:        CalendarEvent[];
  banners:       GoalBanner[];
  onEventClick:  (event: CalendarEvent) => void;
  onSlotClick:   (isoDate: string, time: string) => void;
  onGoalClick:   (goalId: string) => void;
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

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function DayView({ selectedDate, events, banners, onEventClick, onSlotClick, onGoalClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const allDayEvents = events.filter((e) => !e.time);
  const timedEvents  = events.filter((e) => !!e.time);
  const activeBanners = banners.filter(
    (b) => b.startDate <= selectedDate && b.targetDate >= selectedDate
  );

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect    = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const minutes = Math.floor((offsetY / DAY_TOTAL_PX) * 24 * 60);
    const snapped = Math.round(minutes / 15) * 15;
    const h = Math.floor(snapped / 60).toString().padStart(2, "0");
    const m = (snapped % 60).toString().padStart(2, "0");
    onSlotClick(selectedDate, `${h}:${m}`);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* All-day strip + active goal banners */}
      {(allDayEvents.length > 0 || activeBanners.length > 0) && (
        <div className="shrink-0 border-b border-idemora-border px-4 py-2 flex flex-col gap-1">
          {activeBanners.map((b) => (
            <button
              key={b.goalId}
              onClick={() => onGoalClick(b.goalId)}
              className={[
                "w-full text-left text-xs px-2 py-1.5 rounded border-l-2 flex items-center gap-2",
                b.colourState === "green"  ? "bg-green-500/10 border-green-500"  :
                b.colourState === "yellow" ? "bg-yellow-500/10 border-yellow-500" :
                b.colourState === "red"    ? "bg-red-500/10 border-red-500"    :
                "bg-blue-500/10 border-blue-500",
                "text-idemora-text-normal",
              ].join(" ")}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" className="shrink-0">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="6"/>
                <circle cx="12" cy="12" r="2"/>
              </svg>
              <span className="font-medium truncate">{b.title}</span>
              <span className="ml-auto text-xs opacity-60 tabular-nums shrink-0">{b.progress}%</span>
            </button>
          ))}
          {allDayEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => onEventClick(event)}
              className={[
                "w-full text-left text-xs px-2 py-1.5 rounded border-l-2",
                STATE_BG[event.colour_state],
                event.colour_state === "green" ? "opacity-60" : "",
              ].join(" ")}
            >
              <span className="font-medium">{event.title}</span>
              {event.notes && (
                <p className="opacity-70 mt-0.5 line-clamp-1">{event.notes}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: DAY_TOTAL_PX }}>
          {/* Hour gutter */}
          <div className="w-16 shrink-0 relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute w-full flex items-start justify-end pr-3"
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

          {/* Single day column */}
          <div
            className="flex-1 relative border-l border-idemora-border/50 cursor-pointer"
            onClick={handleGridClick}
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

            {/* Timed event blocks — fuller detail since single column */}
            {timedEvents.map((event) => {
              const startMins = timeToMinutes(event.time!);
              const durMins   = event.duration_mins ?? 60;
              const top       = minutesToPx(startMins);
              const height    = Math.max(MIN_BLOCK_PX, minutesToPx(durMins));

              return (
                <button
                  key={event.id}
                  onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                  className={[
                    "absolute left-1 right-2 rounded text-left px-2 py-1.5",
                    "border-l-2 overflow-hidden hover:brightness-110 transition-all",
                    STATE_BG[event.colour_state],
                    event.colour_state === "green" ? "opacity-60" : "",
                  ].join(" ")}
                  style={{ top, height }}
                  title={event.title}
                >
                  <div className="flex items-start gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${STATE_DOT[event.colour_state]}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">{event.title}</p>
                      {height >= 44 && (
                        <p className="text-xs opacity-70 leading-tight mt-0.5">
                          {event.time?.slice(0, 5)}
                          {event.duration_mins ? ` · ${formatDuration(event.duration_mins)}` : ""}
                        </p>
                      )}
                      {height >= 72 && event.notes && (
                        <p className="text-xs opacity-60 leading-snug mt-1 line-clamp-2">
                          {event.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}