// src/features/calendar/components/EventCreationForm.tsx
//
// Phase 12 additions:
//   - RecurrenceSelector embedded below the Duration field
//   - recurrence and recurrence_end state wired through to CalendarEventInput

import { useState, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { NotePickerModal, getBreadcrumb } from "@/features/ui/components/NotePickerModal";
import { RecurrenceSelector } from "@/features/calendar/components/RecurrenceSelector";
import type {
  CalendarEvent,
  CalendarEventInput,
  EventGroup,
} from "@/features/calendar/db/calendarQueries";
import { listEventGroups, createEventGroup } from "@/features/calendar/db/calendarQueries";

interface Props {
  initialDate?: string;
  initialTime?: string;
  event?: CalendarEvent | null;
  onSubmit: (input: CalendarEventInput) => Promise<void>;
  onClose:  () => void;
}

export function EventCreationForm({ initialDate, initialTime, event, onSubmit, onClose }: Props) {
  const allNotes = useNoteStore((s) => s.notes);

  const [title,      setTitle]      = useState(event?.title ?? "");
  const [date,       setDate]       = useState(
    event?.date ?? initialDate ?? new Date().toISOString().split("T")[0]
  );
  const [time,       setTime]       = useState(event?.time ?? initialTime ?? "");
  const [duration,   setDuration]   = useState(String(event?.duration_mins ?? ""));
  const [notes,      setNotes]      = useState(event?.notes ?? "");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState("");

  // ── Recurrence (Phase 12) ──────────────────────────────────────────────────
  const [recurrence,    setRecurrence]    = useState<string | null>(event?.recurrence     ?? null);
  const [recurrenceEnd, setRecurrenceEnd] = useState<string | null>(event?.recurrence_end ?? null);

  // ── Groups ─────────────────────────────────────────────────────────────────
  const [groups,       setGroups]      = useState<EventGroup[]>([]);
  const [groupId,      setGroupId]     = useState<string | null>(event?.group_id ?? null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);

  // ── Note linking ───────────────────────────────────────────────────────────
  const [linkedNoteId,   setLinkedNoteId]   = useState<string | null>(event?.linked_note_id ?? null);
  const [showNotePicker, setShowNotePicker] = useState(false);

  const isEditing  = !!event;
  const linkedNote    = allNotes.find((n) => n.id === linkedNoteId) ?? null;
  const linkedDeleted = linkedNote?.deleted_at != null;

  useEffect(() => {
    listEventGroups().then(setGroups).catch(console.error);
  }, []);

  async function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      await createEventGroup(name);
      const updated = await listEventGroups();
      const created = updated.find((g) => g.name === name);
      setGroups(updated);
      if (created) setGroupId(created.id);
      setNewGroupName("");
      setShowNewGroup(false);
    } catch (err) {
      console.error("[EventCreationForm] createEventGroup failed:", err);
    }
  }

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required."); return; }
    if (!date)         { setError("Date is required.");  return; }

    setSaving(true);
    setError("");

    try {
      await onSubmit({
        title:           title.trim(),
        date,
        time:            time || null,
        duration_mins:   duration ? parseInt(duration, 10) : null,
        category:        event?.category ?? "personal",
        notes:           notes.trim() || null,
        colour_state:    event?.colour_state ?? "blue",
        group_id:        groupId,
        linked_note_id:  linkedNoteId,
        recurrence:      recurrence,
        recurrence_end:  recurrenceEnd,
      });
      onClose();
    } catch (err) {
      console.error("[EventCreationForm] submit failed:", err);
      setError("Failed to save event. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      {showNotePicker && (
        <NotePickerModal
          onSelect={(note) => {
            setLinkedNoteId(note.id);
            setShowNotePicker(false);
          }}
          onClose={() => setShowNotePicker(false)}
        />
      )}

      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div className="flex-1 bg-black/40" onClick={onClose} />

        {/* Slide-in panel */}
        <div className="w-80 h-full bg-idemora-bg-primary border-l border-idemora-border
                        flex flex-col shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border">
            <h2 className="text-sm font-semibold text-idemora-text-normal">
              {isEditing ? "Edit event" : "New event"}
            </h2>
            <button
              onClick={onClose}
              className="text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Form body */}
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

            {/* Duration */}
            {time && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-idemora-text-muted">
                  Duration (minutes)
                </label>
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

            {/* ── Recurrence (Phase 12) ──────────────────────────────────── */}
            <div className="border-t border-idemora-border/50 pt-3">
              <RecurrenceSelector
                eventDate={date || new Date().toISOString().split("T")[0]}
                value={recurrence}
                endDate={recurrenceEnd}
                onChange={(r, e) => {
                  setRecurrence(r);
                  setRecurrenceEnd(e);
                }}
              />
            </div>

            {/* Group */}
            <div className="flex flex-col gap-1.5 border-t border-idemora-border/50 pt-3">
              <label className="text-xs font-medium text-idemora-text-muted">Group (optional)</label>
              <select
                value={groupId ?? ""}
                onChange={(e) => setGroupId(e.target.value || null)}
                className="px-3 py-2 rounded-lg border border-idemora-border bg-idemora-bg-secondary
                           text-sm text-idemora-text-normal
                           focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>

              {showNewGroup ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")  handleAddGroup();
                      if (e.key === "Escape") setShowNewGroup(false);
                    }}
                    placeholder="Group name"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-idemora-border
                               bg-idemora-bg-secondary text-sm text-idemora-text-normal
                               placeholder-idemora-text-muted focus:outline-none
                               focus:border-blue-500 transition-colors"
                  />
                  <button
                    onClick={handleAddGroup}
                    className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700
                               text-white text-xs font-medium transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowNewGroup(false)}
                    className="px-2.5 py-1.5 rounded-lg border border-idemora-border
                               text-idemora-text-muted hover:bg-idemora-bg-secondary
                               text-xs transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewGroup(true)}
                  className="self-start text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + New group
                </button>
              )}
            </div>

            {/* Linked note */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-idemora-text-muted">
                Linked note (optional)
              </label>

              {linkedNote ? (
                <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border
                                 ${linkedDeleted
                                   ? "border-red-500/20 bg-red-500/5"
                                   : "border-idemora-border bg-idemora-bg-secondary"
                                 }`}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                       className={`shrink-0 mt-0.5 ${
                         linkedDeleted ? "text-red-400/50" : "text-idemora-text-muted"
                       }`}>
                    <rect x="1.5" y="1" width="9" height="10" rx="1"
                          stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor"
                          strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${
                      linkedDeleted
                        ? "text-idemora-text-muted line-through"
                        : "text-idemora-text-normal"
                    }`}>
                      {linkedNote.title}
                    </p>
                    {(() => {
                      const bc = getBreadcrumb(linkedNote, allNotes);
                      return bc ? (
                        <p className="text-xs text-idemora-text-muted truncate mt-0.5">{bc}</p>
                      ) : null;
                    })()}
                    {linkedDeleted && (
                      <p className="text-xs text-red-400/70 mt-0.5 font-medium">
                        In trash — unlink and choose another note
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setLinkedNoteId(null)}
                    className="text-idemora-text-muted hover:text-idemora-text-normal
                               transition-colors text-xs shrink-0 mt-0.5"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNotePicker(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed
                             border-idemora-border text-sm text-idemora-text-muted
                             hover:border-blue-500/50 hover:text-idemora-text-normal
                             transition-colors text-left"
                >
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none"
                       className="shrink-0">
                    <rect x="1.5" y="1" width="9" height="10" rx="1"
                          stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor"
                          strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  Link a note…
                </button>
              )}
            </div>

            {/* Notes / description */}
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

            <p className="text-xs text-idemora-text-muted">
              Category: <span className="font-medium">Personal</span> — Notes, tasks, and goal
              events are created from their respective homes.
            </p>

            {error && <p className="text-xs text-red-500">{error}</p>}
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
    </>
  );
}