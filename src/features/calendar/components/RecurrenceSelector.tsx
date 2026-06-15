// src/features/calendar/components/RecurrenceSelector.tsx
//
// Self-contained recurrence configuration widget used inside EventCreationForm.
// Emits a RecurrenceConfig JSON string (or null) whenever the user changes settings.
// The parent form passes the value through to CalendarEventInput.recurrence.

import { useState } from "react";
import type { RecurrenceConfig } from "@/features/calendar/hooks/useRecurrence";

interface Props {
  /** ISO date of the event — used to pre-select the weekday for weekly recurrence. */
  eventDate: string;
  /** Current recurrence JSON string from the form, or null. */
  value: string | null;
  /** Current recurrence_end ISO date from the form, or null. */
  endDate: string | null;
  onChange: (recurrence: string | null, recurrenceEnd: string | null) => void;
}

type Pattern = "daily" | "weekly" | "monthly";
type EndMode = "date" | "never";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_NAMES  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOfWeekFromISO(isoDate: string): number {
  return new Date(isoDate + "T00:00:00").getDay();
}

function defaultEndDate(from: string): string {
  const d = new Date(from + "T00:00:00");
  d.setMonth(d.getMonth() + 3); // default: 3 months from event start
  return d.toISOString().split("T")[0];
}

export function RecurrenceSelector({ eventDate, value, endDate, onChange }: Props) {
  const [enabled,  setEnabled]  = useState<boolean>(value !== null);
  const [pattern,  setPattern]  = useState<Pattern>(() => {
    if (!value) return "weekly";
    try {
      return (JSON.parse(value) as RecurrenceConfig).pattern ?? "weekly";
    } catch { return "weekly"; }
  });
  const [days, setDays] = useState<number[]>(() => {
    if (!value) return [dayOfWeekFromISO(eventDate)];
    try {
      const cfg = JSON.parse(value) as RecurrenceConfig;
      return cfg.days ?? [dayOfWeekFromISO(eventDate)];
    } catch { return [dayOfWeekFromISO(eventDate)]; }
  });
  const [endMode,  setEndMode]  = useState<EndMode>(endDate ? "date" : "never");
  const [endInput, setEndInput] = useState<string>(endDate ?? defaultEndDate(eventDate));

  function emit(
    newEnabled: boolean,
    newPattern: Pattern,
    newDays: number[],
    newEndMode: EndMode,
    newEndInput: string
  ) {
    if (!newEnabled) {
      onChange(null, null);
      return;
    }
    const cfg: RecurrenceConfig = {
      pattern: newPattern,
      ...(newPattern === "weekly" ? { days: newDays } : {}),
    };
    const recurrenceEnd = newEndMode === "date" ? newEndInput : null;
    onChange(JSON.stringify(cfg), recurrenceEnd);
  }

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    emit(next, pattern, days, endMode, endInput);
  }

  function handlePattern(p: Pattern) {
    setPattern(p);
    emit(enabled, p, days, endMode, endInput);
  }

  function toggleDay(d: number) {
    const next = days.includes(d)
      ? days.filter((x) => x !== d)
      : [...days, d].sort();
    // Must have at least one day selected
    if (next.length === 0) return;
    setDays(next);
    emit(enabled, pattern, next, endMode, endInput);
  }

  function handleEndMode(m: EndMode) {
    setEndMode(m);
    emit(enabled, pattern, days, m, endInput);
  }

  function handleEndInput(v: string) {
    setEndInput(v);
    emit(enabled, pattern, days, endMode, v);
  }

  const monthDay = new Date(eventDate + "T00:00:00")
    .toLocaleDateString("en-GB", { day: "numeric" });
  const monthOrdinal = `the ${monthDay}${
    ["th","st","nd","rd"][ Number(monthDay) < 20 ? [0,1,2,3,4,5,6,7,8,9,10,11,12,13].includes(Number(monthDay)) ? (Number(monthDay) % 10 < 4 ? Number(monthDay) % 10 : 0) : 0 : 0] ?? "th"
  }`;

  return (
    <div className="flex flex-col gap-3">
      {/* Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-idemora-text-muted">Repeat</label>
        <button
          type="button"
          onClick={toggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200
            ${enabled ? "bg-blue-600" : "bg-idemora-border"}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow
              transition-transform duration-200
              ${enabled ? "translate-x-4" : "translate-x-1"}`}
          />
        </button>
      </div>

      {enabled && (
        <>
          {/* Pattern selector */}
          <div className="flex gap-1.5">
            {(["daily", "weekly", "monthly"] as Pattern[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePattern(p)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                  ${pattern === p
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal hover:border-blue-500/40"
                  }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          {/* Weekly day picker */}
          {pattern === "weekly" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-idemora-text-muted">Repeat on</span>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    title={DAY_NAMES[i]}
                    onClick={() => toggleDay(i)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                      ${days.includes(i)
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal hover:border-blue-500/40"
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-idemora-text-muted">
                Every {days.map((d) => DAY_NAMES[d]).join(", ")}
              </p>
            </div>
          )}

          {/* Monthly hint */}
          {pattern === "monthly" && (
            <p className="text-xs text-idemora-text-muted">
              Repeats on {monthOrdinal} of each month
            </p>
          )}

          {/* End control */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-idemora-text-muted">Ends</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => handleEndMode("date")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                  ${endMode === "date"
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal"
                  }`}
              >
                On date
              </button>
              <button
                type="button"
                onClick={() => handleEndMode("never")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors
                  ${endMode === "never"
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal"
                  }`}
              >
                Never
              </button>
            </div>

            {endMode === "date" && (
              <input
                type="date"
                value={endInput}
                min={eventDate}
                onChange={(e) => handleEndInput(e.target.value)}
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal
                           focus:outline-none focus:border-blue-500 transition-colors"
              />
            )}

            {endMode === "never" && (
              <p className="text-xs text-idemora-text-muted">
                Capped at 2 years from the start date
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}