// src/features/calendar/components/CalendarPanel.tsx

import { useState } from "react";
import { useCalendar } from "@/features/calendar/hooks/useCalendar";
import { useCalendarEvents } from "@/features/calendar/hooks/useCalendarEvents";
import { LayerFilterBar } from "@/features/calendar/components/LayerFilterBar";
import { AgendaView } from "@/features/calendar/components/AgendaView";
import { EventCreationForm } from "@/features/calendar/components/EventCreationForm";
import { EventDetail } from "@/features/calendar/components/EventDetail";
import type { CalendarEvent, CalendarEventInput, ColourState } from "@/features/calendar/db/calendarQueries";
import type { CalendarView } from "@/features/calendar/store/useCalendarStore";

// Phase 5 placeholders — imported when built
// import { MonthView } from "./MonthView";
// import { WeekView }  from "./WeekView";
// import { DayView }   from "./DayView";

const VIEW_LABELS: { key: CalendarView; label: string }[] = [
  { key: "month",  label: "Month" },
  { key: "week",   label: "Week" },
  { key: "day",    label: "Day" },
  { key: "agenda", label: "Agenda" },
];

export function CalendarPanel() {
  const {
    activeView,
    selectedDate,
    setActiveView,
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

  const [showCreateForm, setShowCreateForm]  = useState(false);
  const [editingEvent,   setEditingEvent]    = useState<CalendarEvent | null>(null);
  const [selectedEvent,  setSelectedEvent]   = useState<CalendarEvent | null>(null);

  // ── Create / Edit ────────────────────────────────────────────────────────

  async function handleSubmitCreate(input: CalendarEventInput) {
    await createEvent(input);
  }

  async function handleSubmitEdit(input: CalendarEventInput) {
    if (!editingEvent) return;
    await updateEvent(editingEvent.id, input);
    setEditingEvent(null);
    setSelectedEvent(null);
  }

  function handleEditFromDetail(event: CalendarEvent) {
    setSelectedEvent(null);
    setEditingEvent(event);
  }

  async function handleDelete(id: string) {
    await deleteEvent(id);
    setSelectedEvent(null);
  }

  async function handleResolve(id: string, state: ColourState) {
    await updateColourState(id, state);
    setSelectedEvent(null);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-idemora-bg-primary overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-idemora-border shrink-0">
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
          loading={loading}
          onEventClick={setSelectedEvent}
        />
      )}

      {/* Phase 5 placeholders */}
      {activeView === "month" && (
        <div className="flex-1 flex items-center justify-center text-idemora-text-muted text-sm">
          Month view — coming in Phase 5
        </div>
      )}
      {activeView === "week" && (
        <div className="flex-1 flex items-center justify-center text-idemora-text-muted text-sm">
          Week view — coming in Phase 5
        </div>
      )}
      {activeView === "day" && (
        <div className="flex-1 flex items-center justify-center text-idemora-text-muted text-sm">
          Day view — coming in Phase 5
        </div>
      )}

      {/* ── Modals ── */}

      {showCreateForm && (
        <EventCreationForm
          initialDate={selectedDate}
          onSubmit={handleSubmitCreate}
          onClose={() => setShowCreateForm(false)}
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
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}