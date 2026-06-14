import { useState, useEffect } from "react";
import { useCalendar } from "@/features/calendar/hooks/useCalendar";
import { useCalendarEvents } from "@/features/calendar/hooks/useCalendarEvents";
import { LayerFilterBar } from "@/features/calendar/components/LayerFilterBar";
import { AgendaView } from "@/features/calendar/components/AgendaView";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { EventCreationForm } from "@/features/calendar/components/EventCreationForm";
import { EventDetail } from "@/features/calendar/components/EventDetail";
import { DailyScoreWidget } from "@/features/score/components/DailyScoreWidget";
import {
  listEventGroups,
  type EventGroup,
  type CalendarEvent,
  type CalendarEventInput,
  type ColourState,
} from "@/features/calendar/db/calendarQueries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { CalendarView } from "@/features/calendar/store/useCalendarStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useGoals } from "@/features/goals/hooks/useGoals";
import { useGoalStore } from "@/features/goals/store/useGoalStore";
import { getBannersForDateRange, type GoalBanner } from "@/features/calendar/lib/calendarMerge";
import { useCalendarStore } from "@/features/calendar/store/useCalendarStore";


const VIEW_LABELS: { key: CalendarView; label: string }[] = [
  { key: "month",  label: "Month" },
  { key: "week",   label: "Week" },
  { key: "day",    label: "Day" },
  { key: "agenda", label: "Agenda" },
];

interface CalendarPanelProps {
  onInnerModalChange?: (open: boolean) => void;
}

export function CalendarPanel({ onInnerModalChange }: CalendarPanelProps) {
  const {
    activeView,
    selectedDate,
    setActiveView,
    setSelectedDate,
    goToPreviousPeriod,
    goToNextPeriod,
    goToToday,
    formatPeriodLabel,
  } = useCalendar();

  const {
    events,
    loading,
    createEvent,
    updateEvent,
    deleteEvent,
    updateColourState,
  } = useCalendarEvents();

  const { goals, loadGoals } = useGoals();
  const layerVisibility = useCalendarStore((s) => s.layerVisibility);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingEvent,   setEditingEvent]   = useState<CalendarEvent | null>(null);
  const [selectedEvent,  setSelectedEvent]  = useState<CalendarEvent | null>(null);
  const [groups,         setGroups]         = useState<EventGroup[]>([]);
  const [slotDate,       setSlotDate]       = useState<string | null>(null);
  const [slotTime,       setSlotTime]       = useState<string | null>(null);

  // Load goals on mount
  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  useEffect(() => {
    listEventGroups().then(setGroups).catch(console.error);
  }, []);

  // Whenever selectedEvent, creationFormOpen, or notePickerOpen changes,
  // report whether any inner layer is open:
  useEffect(() => {
    const anyOpen = !!selectedEvent || showCreateForm || !!editingEvent;
    onInnerModalChange?.(anyOpen);
  }, [selectedEvent, showCreateForm, editingEvent, onInnerModalChange]);

  // TODO: replace selectNote with your actual note navigation function once confirmed
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  // ── Create / Edit ──────────────────────────────────────────────────────────

  async function handleSubmitCreate(input: CalendarEventInput) {
    await createEvent(input);
    // Refresh groups in case a new one was created inside the form
    listEventGroups().then(setGroups).catch(console.error);
  }

  async function handleSubmitEdit(input: CalendarEventInput) {
    if (!editingEvent) return;
    await updateEvent(editingEvent.id, input);
    setEditingEvent(null);
    setSelectedEvent(null);
    listEventGroups().then(setGroups).catch(console.error);
  }

  function handleEditFromDetail(event: CalendarEvent) {
    setSelectedEvent(null);
    setEditingEvent(event);
  }

  function handleSlotClick(isoDate: string, time: string) {
    setSlotDate(isoDate);
    setSlotTime(time);
    setShowCreateForm(true);
  }

  async function handleDelete(id: string) {
    await deleteEvent(id);
    setSelectedEvent(null);
  }

  async function handleResolve(id: string, state: ColourState) {
    await updateColourState(id, state);
    setSelectedEvent(null);
  }

  function handleOpenNote(noteId: string) {
    useUIStore.getState().replaceTab(noteId);
    setActiveNote(noteId, true);
    useUIStore.getState().closeCalendar();
    setSelectedEvent(null);
  }

  function handleGoalClick(goalId: string) {
    useGoalStore.getState().setSelectedGoalId(goalId);
    useUIStore.getState().closeCalendar();
    useUIStore.getState().setActiveSidebarPanel("goals");
  }

  // Derive start/end dates for the current view window (for banner filtering)
  function getViewDateRange(): { startDate: string; endDate: string } {
    const d = new Date(selectedDate + "T00:00:00");
    if (activeView === "day" || activeView === "agenda") {
      return { startDate: selectedDate, endDate: selectedDate };
    }
    if (activeView === "week") {
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        startDate: monday.toISOString().split("T")[0],
        endDate:   sunday.toISOString().split("T")[0],
      };
    }
    // month
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    const lastDay  = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      startDate: firstDay.toISOString().split("T")[0],
      endDate:   lastDay.toISOString().split("T")[0],
    };
  }

  const { startDate: viewStart, endDate: viewEnd } = getViewDateRange();
  const banners: GoalBanner[] = layerVisibility.goals
    ? getBannersForDateRange(goals, viewStart, viewEnd)
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-idemora-bg-primary overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 pl-4 pr-20 py-2 border-b border-idemora-border shrink-0">
        {/* View switcher */}
        <div className="flex items-center rounded-lg border border-idemora-border overflow-hidden">
          {VIEW_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveView(key)}
              className={[
                "px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                activeView === key
                  ? "bg-idemora-bg-secondary text-idemora-text-normal"
                  : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary/50",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={goToPreviousPeriod}
            className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted
                       hover:bg-idemora-bg-secondary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>

          <button
            onClick={goToToday}
            className="px-2.5 py-1 text-xs text-idemora-text-muted border border-idemora-border
                       rounded hover:bg-idemora-bg-secondary transition-colors"
          >
            Today
          </button>

          <button
            onClick={goToNextPeriod}
            className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted
                       hover:bg-idemora-bg-secondary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>

        {/* Period label */}
        <span className="text-sm text-idemora-text-normal font-medium flex-1 truncate">
          {formatPeriodLabel()}
        </span>

        {/* Daily score — renders only when total > 0, lives here contextually */}
        <DailyScoreWidget />

        {/* New event button */}
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New event
        </button>
      </div>

      {/* ── Layer filter bar ── */}
      <LayerFilterBar />

      {/* ── Main view area ── */}
      {activeView === "agenda" && (
        <AgendaView
          events={events}
          groups={groups}
          banners={banners}
          loading={loading}
          onEventClick={setSelectedEvent}
          onOpenNote={handleOpenNote}
          onGoalClick={handleGoalClick}
          onResolve={handleResolve}
        />
      )}

      {activeView === "month" && (
        <MonthView
          selectedDate={selectedDate}
          events={events}
          banners={banners}
          onEventClick={setSelectedEvent}
          onDayClick={(isoDate) => { setSelectedDate(isoDate); setActiveView("day"); }}
          onGoalClick={handleGoalClick}
        />
      )}

      {activeView === "week" && (
        <WeekView
          selectedDate={selectedDate}
          events={events}
          banners={banners}
          onEventClick={setSelectedEvent}
          onSlotClick={handleSlotClick}
          onGoalClick={handleGoalClick}
        />
      )}

      {activeView === "day" && (
        <DayView
          selectedDate={selectedDate}
          events={events}
          banners={banners}
          onEventClick={setSelectedEvent}
          onSlotClick={handleSlotClick}
          onGoalClick={handleGoalClick}
        />
      )}

      {/* ── Modals ── */}

      {showCreateForm && (
        <EventCreationForm
          initialDate={slotDate ?? selectedDate}
          initialTime={slotTime ?? undefined}
          onSubmit={handleSubmitCreate}
          onClose={() => { setShowCreateForm(false); setSlotDate(null); setSlotTime(null); }}
        />
      )}

      {editingEvent && (
        <EventCreationForm
          event={editingEvent}
          onSubmit={handleSubmitEdit}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {selectedEvent && !editingEvent && (
        <EventDetail
          event={selectedEvent}
          onEdit={handleEditFromDetail}
          onDelete={handleDelete}
          onResolve={handleResolve}
          onOpenNote={handleOpenNote}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}