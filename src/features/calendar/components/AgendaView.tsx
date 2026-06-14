// src/features/calendar/components/AgendaView.tsx

import { useState, useCallback } from "react";
import type { CalendarEvent, ColourState, EventGroup } from "@/features/calendar/db/calendarQueries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

const STATE_DOT: Record<ColourState, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  yellow: "bg-yellow-500",
  red:    "bg-red-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  personal: "Personal",
  note:     "Note",
  task:     "Task",
  goal:     "Goal",
  cde:      "CDE",
};

interface Props {
  events:       CalendarEvent[];
  groups:       EventGroup[];
  loading:      boolean;
  onEventClick: (event: CalendarEvent) => void;
}

function formatDate(isoDate: string): string {
  const d        = new Date(isoDate + "T00:00:00");
  const today    = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  if (isoDate === today)    return "Today";
  if (isoDate === tomorrow) return "Tomorrow";

  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

export function daysUntil(isoDate: string): number {
  const today  = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function UrgencyBadge({ isoDate, hasUnresolved }: { isoDate: string; hasUnresolved: boolean }) {
  const diff = daysUntil(isoDate);

  if (diff < 0) {
    if (!hasUnresolved) return null;
    return (
      <span className="text-xs font-semibold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
        Overdue
      </span>
    );
  }
  if (diff === 0 || diff === 1) return null;
  if (diff <= 7) {
    return (
      <span className="text-xs font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
        in {diff} days
      </span>
    );
  }
  return null;
}

function formatTime(time: string | null): string {
  if (!time) return "All day";
  return time;
}

// Stable selector — defined outside the component so the reference never changes
const selectDeletedNoteIds = (s: ReturnType<typeof useNoteStore.getState>) =>
  s.notes
    .filter((n) => n.deleted_at != null)
    .map((n) => n.id)
    .join(",");

export function AgendaView({ events, groups, loading, onEventClick }: Props) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Use a string-join selector to get a stable primitive, then derive the Set locally.
  // This avoids the "getSnapshot should be cached" infinite loop that occurs when
  // returning a new Set() reference from a Zustand selector on every render.
  const deletedIdsStr  = useNoteStore(selectDeletedNoteIds);
  const deletedNoteIds = new Set(deletedIdsStr ? deletedIdsStr.split(",") : []);

  function toggleGroup(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  const groupMap = new Map(groups.map((g) => [g.id, g.name]));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-idemora-text-muted text-sm">
        Loading…
      </div>
    );
  }

  // ── Split into grouped and ungrouped ─────────────────────────────────────

  const groupedEvents   = events.filter((e) => e.group_id);
  const ungroupedEvents = events.filter((e) => !e.group_id);

  const groupBuckets = new Map<string, CalendarEvent[]>();
  for (const event of groupedEvents) {
    const bucket = groupBuckets.get(event.group_id!) ?? [];
    groupBuckets.set(event.group_id!, [...bucket, event]);
  }

  for (const [gid, gevents] of groupBuckets) {
    groupBuckets.set(gid, [...gevents].sort((a, b) => a.date.localeCompare(b.date)));
  }

  const ungroupedByDate = new Map<string, CalendarEvent[]>();
  for (const event of ungroupedEvents) {
    const existing = ungroupedByDate.get(event.date) ?? [];
    ungroupedByDate.set(event.date, [...existing, event]);
  }

  for (const [date, dayEvents] of ungroupedByDate) {
    ungroupedByDate.set(date, [
      ...dayEvents.filter((e) => e.colour_state === "yellow"),
      ...dayEvents.filter((e) => e.colour_state !== "yellow" && e.colour_state !== "green"),
      ...dayEvents.filter((e) => e.colour_state === "green"),
    ]);
  }

  const yellowCount = events.filter((e) => e.colour_state === "yellow").length;

  if (ungroupedByDate.size === 0 && groupBuckets.size === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-idemora-text-muted">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1" opacity="0.4">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p className="text-sm">No upcoming events</p>
        <p className="text-xs opacity-60">Create one with the + button above</p>
      </div>
    );
  }

  // ── Reusable note indicator ───────────────────────────────────────────────

  function NoteIndicator({ linkedNoteId }: { linkedNoteId: string | null }) {
    if (!linkedNoteId) return null;
    const isDeleted = deletedNoteIds.has(linkedNoteId);
    return (
      <span className={`text-xs opacity-70 ${
        isDeleted ? "text-red-400 line-through" : "text-blue-400"
      }`}>
        · note{isDeleted ? " (deleted)" : ""}
      </span>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Yellow queue notice */}
      {yellowCount > 0 && (
        <div className="px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20">
          <p className="text-xs text-yellow-400 font-medium">
            {yellowCount} event{yellowCount !== 1 ? "s" : ""} need{yellowCount === 1 ? "s" : ""} your attention
          </p>
        </div>
      )}

      {/* ── Grouped sections ──────────────────────────────────────────────── */}
      {[...groupBuckets.entries()].map(([groupId, gevents]) => {
        const groupName   = groupMap.get(groupId) ?? "Group";
        const completed   = gevents.filter((e) => e.colour_state === "green").length;
        const total       = gevents.length;
        const allDone     = completed === total && total > 0;
        const isCollapsed = collapsedGroups.has(groupId);
        const nextDue     = gevents.find((e) => e.colour_state !== "green");

        return (
          <div key={groupId} className="border-b border-idemora-border/50">
            {/* Group header */}
            <button
              onClick={() => toggleGroup(groupId)}
              className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-idemora-bg-secondary
                         transition-colors text-left"
            >
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                className={`shrink-0 text-idemora-text-muted transition-transform duration-150
                            ${isCollapsed ? "-rotate-90" : ""}`}
              >
                <path d="M6 9l6 6 6-6"/>
              </svg>

              <span className="flex-1 text-xs font-semibold text-idemora-text-normal uppercase tracking-wide">
                {groupName}
              </span>

              {nextDue && !allDone && (
                <span className="text-xs text-amber-400 font-medium">
                  {formatDate(nextDue.date)}
                </span>
              )}

              {allDone ? (
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="All done" />
              ) : (
                <span className="text-xs text-idemora-text-muted font-medium tabular-nums">
                  {completed}/{total}
                </span>
              )}
            </button>

            {/* Group events */}
            {!isCollapsed && gevents.map((event) => {
              const isCompleted = event.colour_state === "green";
              return (
                <button
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-t border-idemora-border/30
                               hover:bg-idemora-bg-secondary transition-colors text-left group
                               ${isCompleted ? "opacity-45" : ""}`}
                >
                  {isCompleted ? (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="3"
                         className="text-green-500 shrink-0 ml-5">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  ) : (
                    <span className={`w-2 h-2 rounded-full shrink-0 ml-5 ${STATE_DOT[event.colour_state]}`} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${
                      isCompleted ? "text-idemora-text-muted line-through" : "text-idemora-text-normal"
                    }`}>
                      {event.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-idemora-text-muted">{formatDate(event.date)}</span>
                      <span className="text-xs text-idemora-text-muted opacity-50">·</span>
                      <span className="text-xs text-idemora-text-muted">{formatTime(event.time)}</span>
                      <NoteIndicator linkedNoteId={event.linked_note_id} />
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="1.5"
                       className="text-idemora-text-muted opacity-0 group-hover:opacity-100
                                  transition-opacity shrink-0">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>
              );
            })}
          </div>
        );
      })}

      {/* ── Ungrouped events ──────────────────────────────────────────────── */}
      {[...ungroupedByDate.entries()].map(([date, dayEvents]) => (
        <div key={date}>
          <div className="px-4 py-2 sticky top-0 bg-idemora-bg-primary border-b border-idemora-border
                          z-10 flex items-center gap-2">
            <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wide">
              {formatDate(date)}
            </span>
            <UrgencyBadge
              isoDate={date}
              hasUnresolved={dayEvents.some((e) => e.colour_state !== "green")}
            />
          </div>

          {dayEvents.map((event) => {
            const isCompleted = event.colour_state === "green";
            return (
              <button
                key={event.id}
                onClick={() => onEventClick(event)}
                className={`w-full flex items-center gap-3 px-4 py-3 border-b border-idemora-border/50
                             hover:bg-idemora-bg-secondary transition-colors text-left group
                             ${isCompleted ? "opacity-45" : ""}`}
              >
                {isCompleted ? (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="3"
                       className="text-green-500 shrink-0">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                ) : (
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_DOT[event.colour_state]}`} />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${
                    isCompleted ? "text-idemora-text-muted line-through" : "text-idemora-text-normal"
                  }`}>
                    {event.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-idemora-text-muted">{formatTime(event.time)}</span>
                    <span className="text-xs text-idemora-text-muted opacity-50">·</span>
                    <span className="text-xs text-idemora-text-muted">
                      {CATEGORY_LABELS[event.category] ?? event.category}
                    </span>
                    <NoteIndicator linkedNoteId={event.linked_note_id} />
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5"
                     className="text-idemora-text-muted opacity-0 group-hover:opacity-100
                                transition-opacity shrink-0">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}