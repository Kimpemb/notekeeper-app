// src/features/calendar/lib/colourState.ts
//
// Phase 12 change: applyMidnightTransitions now handles calendar_event_occurrences
// in addition to parent calendar_events. Recurring events whose individual
// occurrences are past-and-unresolved must turn yellow at the occurrence level,
// not just at the parent level (the parent event's date is the series start date,
// not each occurrence date).
//
// Standalone (non-recurring) events use calendar_events.date as before.
// Recurring events are identified by `recurrence IS NOT NULL` on the parent.

import { getDb } from "@/features/notes/db/client";

export type ColourState = "blue" | "green" | "yellow" | "red";

function getLocalDateISO(): string {
  const d    = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function applyMidnightTransitions(): Promise<void> {
  const db    = await getDb();
  const today = getLocalDateISO();
  const ts    = Date.now();

  // ── 1. Personal + note events (standalone, non-recurring): blue → yellow ──
  const r1 = await db.execute(
    `UPDATE calendar_events
     SET colour_state = 'yellow', updated_at = $1
     WHERE colour_state = 'blue'
       AND date < $2
       AND recurrence IS NULL
       AND (source_type IS NULL OR source_type IN ('note', 'personal'))`,
    [ts, today]
  );

  // ── 2. Task events (standalone, non-recurring): blue → yellow ─────────────
  const r2 = await db.execute(
    `UPDATE calendar_events
     SET colour_state = 'yellow', updated_at = $1
     WHERE colour_state = 'blue'
       AND date < $2
       AND recurrence IS NULL
       AND source_type = 'task'`,
    [ts, today]
  );

  // ── 3. Goal milestone calendar events (standalone): blue → yellow ─────────
  //    Also sync goal_milestones table.
  const overdueMilestoneEvents = await db.select<{ id: string; source_id: string }[]>(
    `SELECT id, source_id FROM calendar_events
     WHERE colour_state = 'blue'
       AND date < $1
       AND recurrence IS NULL
       AND source_type = 'goal'`,
    [today]
  );

  for (const row of overdueMilestoneEvents) {
    await db.execute(
      `UPDATE calendar_events
       SET colour_state = 'yellow', updated_at = $1
       WHERE id = $2`,
      [ts, row.id]
    );
    await db.execute(
      `UPDATE goal_milestones
       SET colour_state = 'yellow', updated_at = $1
       WHERE id = $2`,
      [ts, row.source_id]
    );
  }

  // ── 4. Goals: blue → yellow (target_date passed, progress < 100) ──────────
  const r4 = await db.execute(
    `UPDATE goals
     SET colour_state = 'yellow', updated_at = $1
     WHERE colour_state = 'blue'
       AND target_date < $2
       AND progress < 100`,
    [ts, today]
  );

  // ── 5. Recurring event occurrences: blue → yellow ─────────────────────────
  //    These are rows in calendar_event_occurrences where occurrence_date has
  //    passed and the occurrence was never resolved (still blue).
  //    We do NOT touch the parent calendar_events row — the parent's date is the
  //    series start date, which may still be in the future for other occurrences.
  const r5 = await db.execute(
    `UPDATE calendar_event_occurrences
     SET colour_state = 'yellow'
     WHERE colour_state = 'blue'
       AND occurrence_date < $1`,
    [today]
  );

  const total =
    (r1.rowsAffected  ?? 0) +
    (r2.rowsAffected  ?? 0) +
    overdueMilestoneEvents.length +
    (r4.rowsAffected  ?? 0) +
    (r5.rowsAffected  ?? 0);

  if (total > 0) {
    console.log(
      `[colourState] ${total} items transitioned blue → yellow` +
      ` (standalone: ${(r1.rowsAffected ?? 0) + (r2.rowsAffected ?? 0) + overdueMilestoneEvents.length}` +
      `, goals: ${r4.rowsAffected ?? 0}` +
      `, occurrences: ${r5.rowsAffected ?? 0})`
    );
  }
}