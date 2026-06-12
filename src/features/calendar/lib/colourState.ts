// src/features/calendar/lib/colourState.ts

import { getDb } from "@/features/notes/db/client";

export type ColourState = "blue" | "green" | "yellow" | "red";

function getLocalDateISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── Midnight transitions ──────────────────────────────────────────────────────
//
// Called once at app startup from App.tsx — NOT on panel mount.
// Yellow state must apply even if the user never opens the calendar.
// Phase 2: handles personal + note events only.
// Phase 11: extended to task, goal milestones, and goals table.

export async function applyMidnightTransitions(): Promise<void> {
  const db    = await getDb();
  const today = getLocalDateISO();

  // Personal and note-sourced events: blue → yellow
  const result = await db.execute(
    `UPDATE calendar_events
     SET colour_state = 'yellow', updated_at = $1
     WHERE colour_state = 'blue'
       AND date < $2
       AND (source_type IS NULL OR source_type IN ('note', 'personal'))`,
    [Date.now(), today]
  );

  if (result.rowsAffected > 0) {
    console.log(`[colourState] ${result.rowsAffected} events transitioned blue → yellow`);
  }

  // TODO Phase 11: task events blue → yellow
  // TODO Phase 11: goal milestones blue → yellow (update both calendar_events and goal_milestones)
  // TODO Phase 11: goals table blue → yellow (target_date < today AND progress < 100)
}

// ─── CDE-specific transitions (Phase 3) ──────────────────────────────────────
// TODO Phase 3: voting deadline red on no-vote detection
// TODO Phase 3: submission deadline red on missed export