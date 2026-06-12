// src/features/calendar/hooks/useCalendar.ts

import { useCalendarStore } from "@/features/calendar/store/useCalendarStore";

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function useCalendar() {
  const activeView      = useCalendarStore((s) => s.activeView);
  const selectedDate    = useCalendarStore((s) => s.selectedDate);
  const setActiveView   = useCalendarStore((s) => s.setActiveView);
  const setSelectedDate = useCalendarStore((s) => s.setSelectedDate);

  function goToPreviousPeriod() {
    const d = new Date(selectedDate + "T00:00:00");

    if (activeView === "day" || activeView === "agenda") {
      setSelectedDate(addDays(selectedDate, -1));
      return;
    }

    if (activeView === "week") {
      setSelectedDate(addDays(selectedDate, -7));
      return;
    }

    if (activeView === "month") {
      const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      setSelectedDate(prev.toISOString().split("T")[0]);
      return;
    }
  }

  function goToNextPeriod() {
    const d = new Date(selectedDate + "T00:00:00");

    if (activeView === "day" || activeView === "agenda") {
      setSelectedDate(addDays(selectedDate, 1));
      return;
    }

    if (activeView === "week") {
      setSelectedDate(addDays(selectedDate, 7));
      return;
    }

    if (activeView === "month") {
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      setSelectedDate(next.toISOString().split("T")[0]);
      return;
    }
  }

  function goToToday() {
    setSelectedDate(todayISO());
  }

  function formatPeriodLabel(): string {
    const d = new Date(selectedDate + "T00:00:00");

    if (activeView === "day") {
      return d.toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
    }

    if (activeView === "agenda") {
      return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    }

    if (activeView === "week") {
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const mLabel = monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const sLabel = sunday.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      return `${mLabel} – ${sLabel}`;
    }

    if (activeView === "month") {
      return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    }

    return selectedDate;
  }

  return {
    activeView,
    selectedDate,
    setActiveView,
    setSelectedDate,
    goToPreviousPeriod,
    goToNextPeriod,
    goToToday,
    formatPeriodLabel,
  };
}