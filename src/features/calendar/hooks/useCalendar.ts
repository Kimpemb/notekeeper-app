// src/features/calendar/hooks/useCalendar.ts

import { useCalendarStore } from "@/features/calendar/store/useCalendarStore";

const AGENDA_WINDOW_DAYS = 7;
const AGENDA_MAX_BACK_DAYS = 30; // how far back you can navigate in agenda

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

  // The end date of the current agenda window
  function agendaEndDate(): string {
    return addDays(selectedDate, AGENDA_WINDOW_DAYS);
  }

  // Earliest allowed startDate when navigating back in agenda
  function agendaMinDate(): string {
    return addDays(todayISO(), -AGENDA_MAX_BACK_DAYS);
  }

  function goToPreviousPeriod() {
    const d = new Date(selectedDate + "T00:00:00");

    if (activeView === "agenda") {
      const candidate = addDays(selectedDate, -AGENDA_WINDOW_DAYS);
      // Clamp: don't go further back than 30 days ago
      setSelectedDate(candidate < agendaMinDate() ? agendaMinDate() : candidate);
      return;
    }

    if (activeView === "day") {
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

    if (activeView === "agenda") {
      setSelectedDate(addDays(selectedDate, AGENDA_WINDOW_DAYS));
      return;
    }

    if (activeView === "day") {
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

    if (activeView === "agenda") {
      // Show the window range: "13 Jun – 20 Jun 2026"
      const end = new Date(agendaEndDate() + "T00:00:00");
      const startLabel = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const endLabel   = end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      return `${startLabel} – ${endLabel}`;
    }

    if (activeView === "day") {
      return d.toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
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
    agendaEndDate, // exported so useCalendarEvents can read the window end
  };
}