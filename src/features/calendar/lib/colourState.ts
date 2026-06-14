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

export async function applyMidnightTransitions(): Promise<void> {
  const db    = await getDb();
  const today = getLocalDateISO();
  const ts    = Date.now();

  // 1. Personal + note events: blue → yellow
  const r1 = await db.execute(
    `UPDATE calendar_events
     SET colour_state = 'yellow', updated_at = $1
     WHERE colour_state = 'blue'
       AND date < $2
       AND (source_type IS NULL OR source_type IN ('note', 'personal'))`,
    [ts, today]
  );

  // 2. Task events: blue → yellow
  const r2 = await db.execute(
    `UPDATE calendar_events
     SET colour_state = 'yellow', updated_at = $1
     WHERE colour_state = 'blue'
       AND date < $2
       AND source_type = 'task'`,
    [ts, today]
  );

  // 3. Goal milestone calendar events: blue → yellow
  //    Also update goal_milestones table to keep them in sync
  const overdueMilestoneEvents = await db.select<{ id: string; source_id: string }[]>(
    `SELECT id, source_id FROM calendar_events
     WHERE colour_state = 'blue'
       AND date < $1
       AND source_type = 'goal'`,
    [today]
  );

  for (const row of overdueMilestoneEvents) {
    await db.execute(
      `UPDATE calendar_events SET colour_state = 'yellow', updated_at = $1 WHERE id = $2`,
      [ts, row.id]
    );
    await db.execute(
      `UPDATE goal_milestones SET colour_state = 'yellow', updated_at = $1 WHERE id = $2`,
      [ts, row.source_id]
    );
  }

  // 4. Goals: blue → yellow (target_date passed, progress < 100)
  const r4 = await db.execute(
    `UPDATE goals
     SET colour_state = 'yellow', updated_at = $1
     WHERE colour_state = 'blue'
       AND target_date < $2
       AND progress < 100`,
    [ts, today]
  );

  const total = (r1.rowsAffected ?? 0) + (r2.rowsAffected ?? 0) +
                overdueMilestoneEvents.length + (r4.rowsAffected ?? 0);

  if (total > 0) {
    console.log(`[colourState] ${total} items transitioned blue → yellow`);
  }
}