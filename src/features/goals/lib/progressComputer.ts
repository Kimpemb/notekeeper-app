// src/features/goals/lib/progressComputer.ts

import type { GoalMilestone } from "@/features/goals/db/goalQueries";

/**
 * Computes goal progress as a 0–100 integer based on completed milestones.
 * A milestone is "completed" when its colour_state is "green".
 *
 * Returns 0 if there are no milestones — progress is meaningless without
 * milestones to track. Returns 100 if all milestones are green.
 */
export function computeProgressFromMilestones(
  milestones: GoalMilestone[]
): number {
  if (milestones.length === 0) return 0;
  const completed = milestones.filter((m) => m.colour_state === "green").length;
  return Math.round((completed / milestones.length) * 100);
}