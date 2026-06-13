// src/features/score/components/DailyScoreWidget.tsx
//
// Inline score counter with a Day / Week / Month window toggle.
// Toggle state persists to localStorage (key: idemora:scoreWindow).
// Default window is "week" — most useful landing view.
//
// Day   → reads from score store (live/reactive)
// Week  → today + 6 days, queries DB, polls every 30s
// Month → today + end of calendar month, same
//
// Red events excluded from all counts — they're closed past verdicts.
// Only renders when total > 0 to avoid noise on empty windows.

import { useEffect, useRef, useState } from "react";
import { useWindowScore } from "@/features/score/hooks/useScore";
import { useScoreStore } from "@/features/score/store/useScoreStore";
import type { ScoreWindow } from "@/features/score/hooks/useScore";

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "idemora:scoreWindow";

function loadWindow(): ScoreWindow {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "day" || v === "week" || v === "month") return v;
  } catch {
    // localStorage unavailable — fall through to default
  }
  return "week";
}

function saveWindow(w: ScoreWindow) {
  try {
    localStorage.setItem(STORAGE_KEY, w);
  } catch {
    // ignore
  }
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

const WINDOWS: { key: ScoreWindow; label: string; ariaLabel: string }[] = [
  { key: "day",   label: "Day",   ariaLabel: "Today only" },
  { key: "week",  label: "Week",  ariaLabel: "This week" },
  { key: "month", label: "Month", ariaLabel: "This month" },
];

function windowLabel(w: ScoreWindow): string {
  if (w === "day")   return "today";
  if (w === "week")  return "this week";
  return "this month";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DailyScoreWidget() {
  const [activeWindow, setActiveWindow] = useState<ScoreWindow>(loadWindow);
  const streak = useScoreStore((s) => s.streak);

  const { completed, total, loading } = useWindowScore(activeWindow);

  const percentage = total === 0 ? 1 : completed / total;
  const [justCompleted, setJustCompleted] = useState(false);
  const prevPercentage = useRef(percentage);

  // Brief "all done" highlight when reaching 100%
  useEffect(() => {
    if (percentage === 1 && prevPercentage.current !== 1 && total > 0) {
      setJustCompleted(true);
      const t = setTimeout(() => setJustCompleted(false), 1800);
      return () => clearTimeout(t);
    }
    prevPercentage.current = percentage;
  }, [percentage, total]);

  function handleWindowChange(w: ScoreWindow) {
    setActiveWindow(w);
    saveWindow(w);
  }

  // Don't render if window is empty — avoids "0 / 0" noise
  if (!loading && total === 0) return null;

  const pct = Math.round(percentage * 100);

  return (
    <div className="flex items-center gap-3">
      {/* Window toggle */}
      <div className="flex items-center rounded-md border border-idemora-border overflow-hidden text-xs">
        {WINDOWS.map(({ key, label, ariaLabel }) => (
          <button
            key={key}
            aria-label={ariaLabel}
            aria-pressed={activeWindow === key}
            onClick={() => handleWindowChange(key)}
            className={`px-2.5 py-1 transition-colors duration-150 font-medium
              ${activeWindow === key
                ? "bg-idemora-accent text-idemora-accent-fg"
                : "text-idemora-text-muted hover:text-idemora-text-primary hover:bg-idemora-bg-hover"
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Score pill */}
      <div
        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-xs transition-colors duration-300
          ${justCompleted
            ? "bg-green-500/15 border border-green-500/30"
            : "bg-idemora-bg-secondary border border-idemora-border"
          }`}
        title={streak > 0 ? `${streak}-day streak` : undefined}
      >
        {/* Progress bar */}
        <div className="w-20 h-1 rounded-full bg-idemora-border overflow-hidden shrink-0">
          {loading ? (
            <div className="h-full w-full animate-pulse bg-idemora-border rounded-full" />
          ) : (
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                justCompleted
                  ? "bg-green-400"
                  : percentage >= 0.75
                  ? "bg-green-500"
                  : percentage >= 0.4
                  ? "bg-amber-500"
                  : "bg-idemora-text-muted"
              }`}
              style={{ width: `${pct}%` }}
            />
          )}
        </div>

        {/* Counter + label */}
        <span
          className={`font-medium tabular-nums whitespace-nowrap transition-colors duration-300 ${
            justCompleted ? "text-green-400" : "text-idemora-text-muted"
          }`}
        >
          {loading ? "…" : `${completed}/${total}`}{" "}
          <span className="font-normal">{windowLabel(activeWindow)}</span>
        </span>

        {/* Streak flame — only shown when streak > 1 */}
        {streak > 1 && (
          <span className="flex items-center gap-0.5 text-orange-400 font-medium shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2c-1 4-5 6-5 11a5 5 0 0010 0c0-2-1-3-1-3s1.5 1 1.5 3.5A6.5 6.5 0 0112 22a6.5 6.5 0 01-6.5-6.5C5.5 9 8 7 8 4c1.5 1.5 2 3 2 3s.5-3 2-5z"/>
            </svg>
            {streak}
          </span>
        )}
      </div>
    </div>
  );
}