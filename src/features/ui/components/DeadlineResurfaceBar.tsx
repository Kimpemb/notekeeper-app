// src/features/ui/components/DeadlineResurfaceBar.tsx
//
// Startup heads-up bar for upcoming deadlines.
// Surfaces the top N calendar events due in the configured lookahead window,
// scored 1–10 by urgency. Amber/orange colour scheme.
//
// Behaviour is driven by the "deadlineBarVigor" setting (Settings → Editor →
// Notifications): off | minimal | normal | vigilant. Each level maps to a
// VigorConfig controlling lookahead window, minimum score to surface, item
// count, yellow carryover, urgency-reshow, and snooze duration.
//
// Display logic (within a given config):
//   - Always shows on first open of a new calendar day
//   - Same day: shows again if new events appeared since last dismissal,
//     OR (vigilant only) if an existing event's urgency score increased
//   - Never shows if all events in window are already green
//   - Dismiss applies a snooze (vigilant) or hides until tomorrow (others)
//   - Persists lastShownAt + lastEventIds + lastEventScores + snoozedUntil
//     to localStorage
//
// Animation: reuses ResurfaceBar's slide-down pattern exactly.

import { useEffect, useRef, useState } from "react";
import { getDb } from "@/features/notes/db/client";
import { getLocalDateISO } from "@/features/score/lib/scoreComputer";
import { daysUntil } from "@/features/calendar/components/AgendaView";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import type { CalendarEvent } from "@/features/calendar/db/calendarQueries";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeadlineItem {
  event:  CalendarEvent;
  score:  number;   // 1–10 urgency
  label:  string;   // "in 3h", "today", "tomorrow", "in 2 days"
}

// ─── Vigor presets ──────────────────────────────────────────────────────────

type VigorLevel = "off" | "minimal" | "normal" | "vigilant";

interface VigorConfig {
  lookaheadDays:           number;        // days beyond today included in the window
  minScore:                number;        // minimum urgency score to surface (1-10)
  maxItems:                number;        // top N items shown
  includeYesterdayYellow:  boolean;       // pull in yesterday's unresolved (yellow) events
  reshowOnUrgencyIncrease: boolean;       // re-show same-day if an event's score climbs
  snoozeHours:             number | null; // null = "until tomorrow" (calendar day reset)
}

const VIGOR_PRESETS: Record<Exclude<VigorLevel, "off">, VigorConfig> = {
  minimal: {
    lookaheadDays: 0,
    minScore: 9,
    maxItems: 1,
    includeYesterdayYellow: false,
    reshowOnUrgencyIncrease: false,
    snoozeHours: null,
  },
  normal: {
    lookaheadDays: 2,
    minScore: 0,
    maxItems: 3,
    includeYesterdayYellow: true,
    reshowOnUrgencyIncrease: false,
    snoozeHours: null,
  },
  vigilant: {
    lookaheadDays: 5,
    minScore: 0,
    maxItems: 5,
    includeYesterdayYellow: true,
    reshowOnUrgencyIncrease: true,
    snoozeHours: 4,
  },
};

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "idemora:deadlineBar";

interface BarMeta {
  lastShownDate:   string;                 // ISO date — not timestamp, so it resets each day
  lastEventIds:    string[];
  lastEventScores?: Record<string, number>; // for urgency-increase detection (vigilant)
  snoozedUntil?:   number;                  // epoch ms — suppress until this time regardless of date
}

function loadMeta(): BarMeta | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveMeta(meta: BarMeta) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(meta)); } catch { /**/ }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function hoursUntil(event: CalendarEvent): number | null {
  if (!event.time) return null;
  const now = new Date();
  const [hh, mm] = event.time.split(":").map(Number);
  const eventTime = new Date(event.date + "T00:00:00");
  eventTime.setHours(hh, mm, 0, 0);
  return (eventTime.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function scoreEvent(event: CalendarEvent): number {
  const days  = daysUntil(event.date);
  const hours = hoursUntil(event);

  // Yellow (unresolved past) — highest urgency, needs verdict
  if (event.colour_state === "yellow") return days < 0 ? 9 : 8;

  // Today with a time set — score by hours remaining
  if (days === 0 && hours !== null) {
    if (hours <= 1)  return 10;
    if (hours <= 3)  return 9;
    if (hours <= 6)  return 8;
    return 7;
  }

  // Today, all-day
  if (days === 0) return 7;

  // Tomorrow
  if (days === 1) return 5;

  // Day after tomorrow (and beyond, for vigilant's wider window)
  return 3;
}

function formatLabel(event: CalendarEvent): string {
  const days  = daysUntil(event.date);
  const hours = hoursUntil(event);

  if (days < 0)  return `${Math.abs(days)}d overdue`;
  if (days === 0 && hours !== null) {
    if (hours < 1) return "in <1h";
    if (hours < 24) return `in ${Math.round(hours)}h`;
    return "today";
  }
  if (days === 0)  return "today";
  if (days === 1)  return "tomorrow";
  return `in ${days} days`;
}

// ─── DB query ─────────────────────────────────────────────────────────────────

async function fetchUpcomingEvents(config: VigorConfig): Promise<CalendarEvent[]> {
  const db    = await getDb();
  const today = getLocalDateISO();

  const d = new Date(today + "T00:00:00");
  d.setDate(d.getDate() + config.lookaheadDays);
  const endDate = getLocalDateISO(d);

  // Include yellow (overdue unresolved) from yesterday too — they need attention
  let startDate = today;
  if (config.includeYesterdayYellow) {
    const yesterday = new Date(today + "T00:00:00");
    yesterday.setDate(yesterday.getDate() - 1);
    startDate = getLocalDateISO(yesterday);
  }

  return db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE date >= $1
       AND date <= $2
       AND colour_state != 'green'
       AND colour_state != 'red'
     ORDER BY date ASC, time ASC NULLS LAST`,
    [startDate, endDate]
  );
}

// ─── Should show? ─────────────────────────────────────────────────────────────

function shouldShow(
  events:  CalendarEvent[],
  meta:    BarMeta | null,
  config:  VigorConfig,
  now = Date.now()
): boolean {
  if (events.length === 0) return false;

  // Snooze takes priority over everything else
  if (meta?.snoozedUntil && now < meta.snoozedUntil) return false;

  const today = getLocalDateISO();

  // New calendar day — always show
  if (!meta || meta.lastShownDate !== today) return true;

  // Same day — show if event IDs changed (new deadline appeared, or one resolved)
  const currentIds = events.map((e) => e.id).sort().join(",");
  const lastIds    = (meta.lastEventIds ?? []).sort().join(",");
  if (currentIds !== lastIds) return true;

  // Vigilant only — show if any event's urgency score has climbed since last check
  if (config.reshowOnUrgencyIncrease && meta.lastEventScores) {
    for (const event of events) {
      const newScore = scoreEvent(event);
      const oldScore = meta.lastEventScores[event.id];
      if (oldScore !== undefined && newScore > oldScore) return true;
    }
  }

  return false;
}

// ─── Component ────────────────────────────────────────────────────────────────

const SHOW_DELAY = 1400; // slightly longer than ResurfaceBar — less urgent feel

export function DeadlineResurfaceBar() {
  const vigor = useAppSettings((s) => s.settings.deadlineBarVigor ?? "normal");

  const [items,    setItems]    = useState<DeadlineItem[]>([]);
  const [rendered, setRendered] = useState(false);
  const [visible,  setVisible]  = useState(false);
  const [exiting,  setExiting]  = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (vigor === "off") return;

    let cancelled = false;
    const config = VIGOR_PRESETS[vigor];

    async function check() {
      try {
        const events = await fetchUpcomingEvents(config);
        const meta   = loadMeta();

        if (!shouldShow(events, meta, config)) return;
        if (cancelled) return;

        // Score everything (for meta persistence + urgency tracking),
        // then filter by minScore and take top N for display.
        const allScored = events
          .map((e) => ({ event: e, score: scoreEvent(e), label: formatLabel(e) }))
          .sort((a, b) => b.score - a.score);

        const visible = allScored
          .filter((d) => d.score >= config.minScore)
          .slice(0, config.maxItems);

        if (visible.length === 0) {
          // Nothing meets the threshold — persist meta so we don't re-check
          // pointlessly until something changes, but don't show the bar.
          saveMeta({
            lastShownDate:   getLocalDateISO(),
            lastEventIds:    events.map((e) => e.id),
            lastEventScores: Object.fromEntries(allScored.map((d) => [d.event.id, d.score])),
          });
          return;
        }

        setItems(visible);
        setRendered(true);
        timerRef.current = setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, SHOW_DELAY);

        // Persist meta immediately so rapid restarts don't double-show
        saveMeta({
          lastShownDate:   getLocalDateISO(),
          lastEventIds:    events.map((e) => e.id),
          lastEventScores: Object.fromEntries(allScored.map((d) => [d.event.id, d.score])),
        });
      } catch (err) {
        console.error("[DeadlineResurfaceBar] check failed:", err);
      }
    }

    check();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [vigor]);

  function animateOut(then?: () => void) {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
      then?.();
      setTimeout(() => setRendered(false), 300);
    }, 260);
  }

  function handleDismiss() {
    const config = VIGOR_PRESETS[vigor === "off" ? "normal" : vigor];

    if (config.snoozeHours !== null) {
      const meta = loadMeta();
      saveMeta({
        lastShownDate:   meta?.lastShownDate   ?? getLocalDateISO(),
        lastEventIds:    meta?.lastEventIds    ?? [],
        lastEventScores: meta?.lastEventScores,
        snoozedUntil:    Date.now() + config.snoozeHours * 60 * 60 * 1000,
      });
    }

    animateOut();
  }

  function handleOpenCalendar() {
    window.dispatchEvent(new CustomEvent("idemora:open-calendar"));
    animateOut();
  }

  if (vigor === "off" || !rendered || items.length === 0) return null;

  const direstScore = items[0]?.score ?? 0;

  // Header colour shifts from amber → red as urgency increases
  const headerAccent = direstScore >= 9
    ? { icon: "text-red-400",   bg: "bg-red-500/10",   border: "border-red-500/20"   }
    : { icon: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" };

  return (
    <div
      style={{
        position:  "absolute",
        top:       0,
        left:      "50%",
        transform: `translateX(-50%) translateY(${visible && !exiting ? "12px" : "-110%"})`,
        transition: "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease",
        opacity:   visible && !exiting ? 1 : 0,
        zIndex:    60,
        width:     400,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        className="rounded-xl shadow-2xl border border-idemora-border bg-idemora-bg-secondary overflow-hidden"
        style={{ backdropFilter: "blur(12px)" }}
      >
        {/* Header */}
        <div className={`flex items-center gap-2 px-4 pt-3 pb-2 border-b ${headerAccent.border}`}>
          <div className={`w-6 h-6 rounded-full ${headerAccent.bg} flex items-center justify-center shrink-0`}>
            {/* Clock / deadline icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                 className={headerAccent.icon}>
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">
              Upcoming deadlines
            </span>
          </div>
          <button
            onClick={handleDismiss}
            title="Dismiss"
            className="w-5 h-5 flex items-center justify-center rounded-md text-idemora-text-muted
                       hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                       transition-colors duration-100"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Event list */}
        <div className="px-4 py-2 flex flex-col gap-1.5">
          {items.map(({ event, score, label }) => {
            const isUrgent  = score >= 9;
            const isWarning = score >= 7 && score < 9;

            return (
              <div key={event.id} className="flex items-center gap-3 py-1">
                {/* Score pill */}
                <span className={`text-xs font-bold tabular-nums w-5 text-right shrink-0 ${
                  isUrgent  ? "text-red-400"   :
                  isWarning ? "text-amber-400" :
                              "text-idemora-text-muted"
                }`}>
                  {score}
                </span>

                {/* Colour dot */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  event.colour_state === "yellow" ? "bg-yellow-500" : "bg-blue-500"
                }`} />

                {/* Title */}
                <p className="flex-1 text-sm text-idemora-text-normal truncate">
                  {event.title}
                </p>

                {/* Time label */}
                <span className={`text-xs font-medium shrink-0 ${
                  isUrgent  ? "text-red-400"   :
                  isWarning ? "text-amber-400" :
                              "text-idemora-text-muted"
                }`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 pb-3 pt-1">
          <button
            onClick={handleDismiss}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-idemora-border
                       text-idemora-text-muted hover:text-idemora-text-normal
                       hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
                       transition-colors duration-100 text-center"
          >
            Dismiss
          </button>
          <button
            onClick={handleOpenCalendar}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold
                       bg-amber-500/10 text-amber-400 hover:bg-amber-500/20
                       transition-colors duration-100 text-center"
          >
            Open calendar
          </button>
        </div>
      </div>
    </div>
  );
}