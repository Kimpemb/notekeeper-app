// src/features/calendar/components/EventCreationForm.tsx

import { useState } from "react";
import type { CalendarEvent, CalendarEventInput } from "@/features/calendar/db/calendarQueries";

interface Props {
  initialDate?: string;
  initialTime?: string;
  event?: CalendarEvent | null;  // if set, editing mode
  onSubmit: (input: CalendarEventInput) => Promise<void>;
  onClose: () => void;
}

export function EventCreationForm({ initialDate, initialTime, event, onSubmit, onClose }: Props) {
  const [title,    setTitle]    = useState(event?.title ?? "");
  const [date,     setDate]     = useState(event?.date ?? initialDate ?? new Date().toISOString().split("T")[0]);
  const [time,     setTime]     = useState(event?.time ?? initialTime ?? "");
  const [duration, setDuration] = useState(String(event?.duration_mins ?? ""));
  const [notes,    setNotes]    = useState(event?.notes ?? "");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  const isEditing = !!event;

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    if (!date)         { setError("Date is required."); return; }

    setSaving(true);
    setError("");

    try {
      await onSubmit({
        title: title.trim(),
        date,
        time:          time || null,
        duration_mins: duration ? parseInt(duration, 10) : null,
        category:      "personal",
        notes:         notes.trim() || null,
        colour_state:  event?.colour_state ?? "blue",
      });
      onClose();
    } catch (err) {
      console.error("[EventCreationForm] submit failed:", err);
      setError("Failed to save event. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div className="w-80 h-full bg-idemora-bg-primary border-l border-idemora-border flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border">
          <h2 className="text-sm font-semibold text-idemora-text-normal">
            {isEditing ? "Edit event" : "New event"}
          </h2>
          <button
            onClick={onClose}
            className="text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-idemora-text-muted">Title *</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Event title"
              className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                         text-sm text-idemora-text-normal placeholder-idemora-text-muted
                         focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-idemora-text-muted">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                         text-sm text-idemora-text-normal
                         focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Time */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-idemora-text-muted">Time (optional)</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                         text-sm text-idemora-text-normal
                         focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Duration — only shown if time is set */}
          {time && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-idemora-text-muted">Duration (minutes)</label>
              <input
                type="number"
                min="5"
                step="5"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="60"
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal placeholder-idemora-text-muted
                           focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          )}

          {/* Notes */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-idemora-text-muted">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add any details…"
              className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                         text-sm text-idemora-text-normal placeholder-idemora-text-muted
                         focus:outline-none focus:border-blue-500 transition-colors resize-none"
            />
          </div>

          {/* Category note */}
          <p className="text-xs text-idemora-text-muted">
            Category: <span className="font-medium">Personal</span> — Notes, tasks, and goal events are created from their respective homes.
          </p>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-idemora-border flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg text-sm text-idemora-text-muted
                       border border-idemora-border hover:bg-idemora-bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium
                       bg-blue-600 hover:bg-blue-700 text-white transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : isEditing ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}