// src/features/score/hooks/useScore.ts
//
// Exports:
//   useScore()          — existing hook, unchanged. Day-scoped, reads from store.
//   useWindowScore()    — new hook. Accepts 'day' | 'week' | 'month'.
//
// Hooks are never called conditionally — three concrete implementations
// (useDayScore, useWeekScore, useMonthScore) are selected at the call site
// inside useWindowScore via a stable window string, not branching hook logic.

import { useEffect, useRef, useState } from "react";
import { useScoreStore } from "@/features/score/store/useScoreStore";
import { computeLiveScore, getLocalDateISO } from "@/features/score/lib/scoreComputer";
import { getWindowScore } from "@/features/calendar/db/calendarQueries";

export type ScoreWindow = "day" | "week" | "month";

// ─── Existing hook — DO NOT CHANGE ───────────────────────────────────────────

export function useScore() {
  const todayEvents = useScoreStore((s) => s.todayEvents);
  const streak      = useScoreStore((s) => s.streak);
  const { completed, total } = computeLiveScore(todayEvents);
  const percentage = total === 0 ? 1 : completed / total;
  return { completed, total, percentage, streak };
}

// ─── Window helpers ───────────────────────────────────────────────────────────

function getWindowBounds(window: ScoreWindow): { startDate: string; endDate: string } {
  const today = getLocalDateISO();

  if (window === "day") {
    return { startDate: today, endDate: today };
  }

  if (window === "week") {
    const end = new Date(today + "T00:00:00");
    end.setDate(end.getDate() + 6);
    return { startDate: today, endDate: getLocalDateISO(end) };
  }

  // month — today through end of current calendar month
  const d = new Date(today + "T00:00:00");
  const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { startDate: today, endDate: getLocalDateISO(endOfMonth) };
}

// ─── Day score — reads from store, always synchronous ────────────────────────

function useDayScore() {
  const todayEvents = useScoreStore((s) => s.todayEvents);
  const { completed, total } = computeLiveScore(todayEvents);
  return { completed, total, loading: false as const };
}

// ─── DB-backed score — polls every 30s ───────────────────────────────────────

function useDbScore(window: "week" | "month") {
  const [result, setResult] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  // Track window changes so the effect re-runs and resets loading state
  const prevWindow = useRef(window);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      const bounds = getWindowBounds(window);
      const data = await getWindowScore(bounds);
      if (!cancelled) {
        setResult(data);
        setLoading(false);
      }
    }

    // Reset to loading if window changed between week/month
    if (prevWindow.current !== window) {
      prevWindow.current = window;
      setLoading(true);
    }

    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [window]);

  return { ...result, loading };
}

// ─── Public hook — always calls all hooks, selects result after ───────────────

export function useWindowScore(window: ScoreWindow): {
  completed: number;
  total:     number;
  loading:   boolean;
} {
  // All three hooks always called unconditionally — no rules-of-hooks violation.
  // The window determines which result we return, not which hooks we call.
  const dayResult = useDayScore();
  const dbResult  = useDbScore(window === "day" ? "week" : window);
  //                                               ↑ "week" is a safe dummy value
  //                                               when window === "day" — the
  //                                               result is discarded anyway.

  return window === "day" ? dayResult : dbResult;
}