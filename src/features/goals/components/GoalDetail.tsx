// src/features/goals/components/GoalDetail.tsx

import { useEffect, useState } from "react";
import type { Goal, GoalMilestone, MilestoneInput } from "@/features/goals/db/goalQueries";
import { getGoalLinks } from "@/features/goals/db/goalQueries";
import { getNoteById } from "@/features/notes/db/queries";
import { MilestoneList } from "./MilestoneList";

interface LinkedNoteRef {
  noteId: string;
  title:  string;
}

interface GoalDetailProps {
  goal:              Goal;
  milestones:        GoalMilestone[];
  onEdit:            (goal: Goal) => void;
  onDelete:          (id: string) => void;
  onClose:           () => void;
  onAddMilestone:    (input: MilestoneInput) => Promise<string | void>;
  onUpdateMilestone: (id: string, goalId: string, updates: Partial<Omit<MilestoneInput, "goal_id">>) => Promise<void>;
  onDeleteMilestone: (id: string, goalId: string) => Promise<void>;
  onOpenNote?:       (noteId: string) => void;
}

const STATE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  blue:   { bg: "bg-blue-500/10",   text: "text-blue-400",   label: "Active"      },
  green:  { bg: "bg-green-500/10",  text: "text-green-400",  label: "Completed"   },
  yellow: { bg: "bg-yellow-500/10", text: "text-yellow-400", label: "Unresolved"  },
  red:    { bg: "bg-red-500/10",    text: "text-red-400",    label: "Missed"      },
};

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function timelinePercent(start: string, target: string): number {
  const s   = new Date(start  + "T00:00:00").getTime();
  const t   = new Date(target + "T00:00:00").getTime();
  const now = Date.now();
  if (t <= s) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - s) / (t - s)) * 100)));
}

function milestonePercent(start: string, target: string, date: string): number {
  const s = new Date(start  + "T00:00:00").getTime();
  const t = new Date(target + "T00:00:00").getTime();
  const d = new Date(date   + "T00:00:00").getTime();
  if (t <= s) return 100;
  return Math.min(100, Math.max(0, Math.round(((d - s) / (t - s)) * 100)));
}

const MILESTONE_DOT: Record<string, string> = {
  blue:   "bg-blue-500   border-blue-500",
  green:  "bg-green-500  border-green-500",
  yellow: "bg-yellow-500 border-yellow-500",
  red:    "bg-red-500    border-red-500",
};

export function GoalDetail({
  goal,
  milestones,
  onEdit,
  onDelete,
  onClose,
  onAddMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onOpenNote,
}: GoalDetailProps) {
  const badge     = STATE_BADGE[goal.colour_state] ?? STATE_BADGE.blue;
  const elapsed   = timelinePercent(goal.start_date, goal.target_date);

  const [linkedNotes, setLinkedNotes] = useState<LinkedNoteRef[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLinksLoading(true);
    (async () => {
      try {
        const links = await getGoalLinks(goal.id);
        const noteLinks = links.filter((l) => l.source_type === "note");
        const resolved = await Promise.all(
          noteLinks.map(async (l) => {
            const note = await getNoteById(l.source_id);
            return note ? { noteId: note.id, title: note.title } : null;
          })
        );
        if (!cancelled) {
          setLinkedNotes(resolved.filter((r): r is LinkedNoteRef => r !== null));
        }
      } catch {
        if (!cancelled) setLinkedNotes([]);
      } finally {
        if (!cancelled) setLinksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [goal.id]);

  function handleOpenLinkedNote(noteId: string) {
    if (onOpenNote) {
      onOpenNote(noteId);
    } else {
      window.dispatchEvent(new CustomEvent("idemora:open-note", { detail: { noteId } }));
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-[61] w-[520px] max-w-full
                      flex flex-col bg-idemora-bg-primary border-l border-idemora-border
                      shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4
                        border-b border-idemora-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0
                             ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
            {goal.category && (
              <span className="text-xs px-2 py-0.5 rounded-full
                               bg-idemora-bg-secondary text-idemora-text-muted
                               border border-idemora-border shrink-0">
                {goal.category}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onEdit(goal)}
              className="w-7 h-7 flex items-center justify-center rounded
                         text-idemora-text-muted hover:text-idemora-text-normal
                         hover:bg-idemora-bg-secondary transition-colors"
              title="Edit goal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              onClick={() => onDelete(goal.id)}
              className="w-7 h-7 flex items-center justify-center rounded
                         text-idemora-text-muted hover:text-red-400
                         hover:bg-idemora-bg-secondary transition-colors"
              title="Delete goal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded
                         text-idemora-text-muted hover:text-idemora-text-normal
                         hover:bg-idemora-bg-secondary transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

          {/* Title */}
          <h1 className="text-base font-semibold text-idemora-text-normal leading-snug">
            {goal.title}
          </h1>

          {/* Description */}
          {goal.description && (
            <p className="text-sm text-idemora-text-muted leading-relaxed">
              {goal.description}
            </p>
          )}

          {/* Progress bar — read-only, automatically computed from milestones */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-idemora-text-muted">Progress</span>
              <span className="text-xs font-medium text-idemora-text-normal tabular-nums">
                {goal.progress}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-idemora-bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  goal.colour_state === "green"  ? "bg-green-500"  :
                  goal.colour_state === "yellow" ? "bg-yellow-500" :
                  goal.colour_state === "red"    ? "bg-red-500"    :
                  "bg-blue-500"
                }`}
                style={{ width: `${goal.progress}%` }}
              />
            </div>
            {milestones.length === 0 && (
              <p className="text-xs text-idemora-text-faint">
                Add milestones to track progress automatically.
              </p>
            )}
          </div>

          {/* Timeline */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-idemora-text-muted">Timeline</span>
            <div className="relative">
              {/* Track */}
              <div className="h-1.5 rounded-full bg-idemora-bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500/40 transition-all duration-500"
                  style={{ width: `${elapsed}%` }}
                />
              </div>

              {/* Milestone dots on track */}
              {milestones.map((m) => {
                const pct = milestonePercent(goal.start_date, goal.target_date, m.date);
                return (
                  <div
                    key={m.id}
                    className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full
                               border-2 border-idemora-bg-primary
                               ${MILESTONE_DOT[m.colour_state] ?? MILESTONE_DOT.blue}`}
                    style={{ left: `calc(${pct}% - 6px)` }}
                    title={`${m.title} — ${formatDate(m.date)}`}
                  />
                );
              })}
            </div>

            {/* Date labels */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-idemora-text-faint">
                {formatDate(goal.start_date)}
              </span>
              <span className="text-xs text-idemora-text-faint">
                {formatDate(goal.target_date)}
              </span>
            </div>
          </div>

          {/* Milestones */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-idemora-text-muted">Milestones</span>
            <MilestoneList
              goalId={goal.id}
              milestones={milestones}
              onAdd={onAddMilestone}
              onUpdate={onUpdateMilestone}
              onDelete={onDeleteMilestone}
            />
          </div>

          {/* Linked notes */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-idemora-text-muted">Linked notes</span>
            {linksLoading ? (
              <p className="text-xs text-idemora-text-faint">Loading…</p>
            ) : linkedNotes.length === 0 ? (
              <p className="text-xs text-idemora-text-faint">
                No notes linked yet. Ask the AI to link a note, or link one from chat.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {linkedNotes.map((n) => (
                  <button
                    key={n.noteId}
                    onClick={() => handleOpenLinkedNote(n.noteId)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs
                               text-idemora-text-normal border border-idemora-border
                               hover:border-violet-400/40 hover:text-violet-400
                               bg-idemora-bg-secondary transition-colors duration-100 max-w-[220px]"
                    title={`Open note: ${n.title}`}
                  >
                    <svg width="10" height="10" viewBox="0 0 8 8" fill="none" className="shrink-0">
                      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
                      <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
                    </svg>
                    <span className="truncate">{n.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="pt-2 border-t border-idemora-border space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-idemora-text-faint">Created</span>
              <span className="text-xs text-idemora-text-faint">
                {new Date(goal.created_at).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-idemora-text-faint">Last updated</span>
              <span className="text-xs text-idemora-text-faint">
                {new Date(goal.updated_at).toLocaleDateString("en-GB", {
                  day: "numeric", month: "short", year: "numeric",
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}