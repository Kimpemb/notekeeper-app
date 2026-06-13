// src/features/goals/components/GoalCard.tsx

import type { Goal } from "@/features/goals/db/goalQueries";

interface GoalCardProps {
  goal:    Goal;
  onClick: (goal: Goal) => void;
}

function getDaysLabel(targetDate: string): { label: string; overdue: boolean } {
  const today  = new Date(new Date().toISOString().split("T")[0] + "T00:00:00");
  const target = new Date(targetDate + "T00:00:00");
  const diff   = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diff === 0)  return { label: "Due today",            overdue: false };
  if (diff === 1)  return { label: "Due tomorrow",         overdue: false };
  if (diff > 1)    return { label: `${diff} days left`,    overdue: false };
  if (diff === -1) return { label: "1 day overdue",        overdue: true  };
  return               { label: `${Math.abs(diff)} days overdue`, overdue: true };
}

const STATE_STYLES: Record<string, { dot: string; badge: string; label: string }> = {
  blue:   { dot: "bg-blue-500",   badge: "bg-blue-500/10 text-blue-400",   label: "Active"     },
  green:  { dot: "bg-green-500",  badge: "bg-green-500/10 text-green-400", label: "Completed"  },
  yellow: { dot: "bg-yellow-500", badge: "bg-yellow-500/10 text-yellow-400",label: "Unresolved" },
  red:    { dot: "bg-red-500",    badge: "bg-red-500/10 text-red-400",     label: "Missed"     },
};

export function GoalCard({ goal, onClick }: GoalCardProps) {
  const state   = STATE_STYLES[goal.colour_state] ?? STATE_STYLES.blue;
  const days    = getDaysLabel(goal.target_date);
  const isTerminal = goal.colour_state === "green" || goal.colour_state === "red";

  return (
    <button
      onClick={() => onClick(goal)}
      className="w-full text-left px-3 py-3 rounded-lg border border-idemora-border
                 bg-idemora-bg-primary hover:bg-idemora-bg-secondary
                 transition-colors group"
    >
      {/* Top row: title + state badge */}
      <div className="flex items-start gap-2 min-w-0">
        <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${state.dot}`} />
        <span className="flex-1 text-sm font-medium text-idemora-text-normal truncate">
          {goal.title}
        </span>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${state.badge}`}>
          {state.label}
        </span>
      </div>

      {/* Middle row: category + target date */}
      <div className="mt-1.5 ml-4 flex items-center gap-2 flex-wrap">
        {goal.category && (
          <span className="text-xs px-2 py-0.5 rounded-full
                           bg-idemora-bg-secondary text-idemora-text-muted
                           border border-idemora-border">
            {goal.category}
          </span>
        )}
        <span className="text-xs text-idemora-text-faint">
          {new Date(goal.target_date + "T00:00:00").toLocaleDateString("en-GB", {
            day: "numeric", month: "short", year: "numeric",
          })}
        </span>
      </div>

      {/* Bottom row: progress bar + days label */}
      <div className="mt-2 ml-4 flex items-center gap-3">
        {/* Progress bar */}
        <div className="flex-1 h-1 rounded-full bg-idemora-bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              goal.colour_state === "green" ? "bg-green-500" :
              goal.colour_state === "red"   ? "bg-red-500"   :
              goal.colour_state === "yellow"? "bg-yellow-500":
              "bg-blue-500"
            }`}
            style={{ width: `${goal.progress}%` }}
          />
        </div>
        <span className="shrink-0 text-xs text-idemora-text-faint tabular-nums">
          {goal.progress}%
        </span>

        {/* Days label — hidden for terminal states */}
        {!isTerminal && (
          <span className={`shrink-0 text-xs font-medium ${
            days.overdue ? "text-red-400" : "text-idemora-text-muted"
          }`}>
            {days.label}
          </span>
        )}
      </div>
    </button>
  );
}