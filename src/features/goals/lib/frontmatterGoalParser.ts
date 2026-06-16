// src/features/goals/lib/frontmatterGoalParser.ts

import {
  findGoalByTitle,
  createGoal,
  addGoalLink,
  getGoalLinks,
  updateGoalColourState,
  updateGoalProgress,  // add this
  type GoalColourState,
} from "@/features/goals/db/goalQueries";

// ─── Status map ───────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, GoalColourState> = {
  "planned":     "blue",
  "in-progress": "blue",
  "complete":    "green",
  "abandoned":   "red",
  "on-hold":     "yellow",
};

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Main parser ──────────────────────────────────────────────────────────────
//
// Called after every frontmatter save where date + status are present.
// Idempotent — safe to call multiple times on the same note.
// Fire and forget — does not block the note save.

export async function parseAndSyncFrontmatter(
  noteId:    string,
  noteTitle: string,
  frontmatter: string | null
): Promise<void> {
  if (!frontmatter) return;

  let fm: Record<string, string>;
  try {
    fm = JSON.parse(frontmatter);
  } catch {
    return;
  }

  const date   = fm["date"];
  const status = fm["status"];
  if (!date || !status) return;

  const colourState = STATUS_MAP[status.toLowerCase()];
  if (!colourState) return; // unrecognised status — ignore silently

  // Match by explicit 'goal' field or fall back to note title
  const matchTitle = fm["goal"] ?? noteTitle;

  let existingGoal = await findGoalByTitle(matchTitle);

  if (existingGoal) {
    // Link this note if not already linked
    const links = await getGoalLinks(existingGoal.id);
    const alreadyLinked = links.some((l) => l.source_id === noteId);
    if (!alreadyLinked) {
      await addGoalLink(existingGoal.id, noteId, "note", 100);
    }

    // Sync colour state if it changed
    if (existingGoal.colour_state !== colourState) {
      await updateGoalColourState(existingGoal.id, colourState);
    }

    // Sync progress — complete = 100, everything else leave as is
    if (colourState === "green" && existingGoal.progress < 100) {
      await updateGoalProgress(existingGoal.id, 100);
    }

  } else {
    // Create new goal from this note
    const newGoalId = await createGoal({
      title:        matchTitle,
      start_date:   todayISO(),
      target_date:  date,
      colour_state: colourState,
      progress:     colourState === "green" ? 100 : 0,  // add this
    });
    await addGoalLink(newGoalId, noteId, "note", 100);
  }

  // Always notify GoalsPanel to reload — covers both create and update paths
  window.dispatchEvent(new CustomEvent("idemora:goals-updated"));
}