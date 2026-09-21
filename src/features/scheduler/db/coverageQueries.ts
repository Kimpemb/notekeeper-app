// src/features/scheduler/db/coverageQueries.ts
//
// Persistence for coverable_units (Coverage Engine v1 — see "Scheduler —
// Coverage Engine: Design & Handoff #1" §8.1). Additive alongside
// goal_milestones, not a replacement — see goalQueries.ts for the
// unaffected plain-milestone path.
//
// This module is DB access only. Packing (coveragePacker.ts), tool-layer
// orchestration (writeTools.ts), and pace-check (not yet built) are
// deliberately kept out of here, matching the separation already used for
// Priority/Sequencer/Preemption.

import { getDb } from "@/features/notes/db/client";

export type CoverableUnitStatus = "pending" | "covered" | "skipped";

export interface CoverableUnit {
  id:                       string;
  goal_id:                  string;
  position:                 number;
  title:                    string;
  effort_estimate_minutes:  number;
  status:                   CoverableUnitStatus;
  assigned_event_id:        string | null;
  actual_minutes_spent:     number | null;
  created_at:               number;
  updated_at:               number;
}

// Caller-supplied creation shape. `position` is NOT accepted here —
// position is derived from array order at the call site (see
// createCoverableUnits below), matching the §8.1 tool sketch's
// "caller-supplied order = position" contract. Accepting an explicit
// position field here would let a caller desync array order from the
// stored order.
export interface CoverableUnitCreateInput {
  title:                    string;
  effort_estimate_minutes:  number;
  assigned_event_id?:       string | null;  // set by the packer, null if unassigned
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

/**
 * Bulk-creates coverable_units for a goal, in the order given. Position is
 * assigned as the 0-based index into `units` — this is the single source
 * of truth for outline order, so callers must pass units already in the
 * order they should appear (the packer's own contract — see
 * coveragePacker.ts — requires the same thing).
 *
 * Returns the created rows so the caller (writeTools.ts) can report exactly
 * what was written and undo can delete exactly these ids, nothing else.
 */
export async function createCoverableUnits(
  goalId: string,
  units:  CoverableUnitCreateInput[]
): Promise<CoverableUnit[]> {
  const db = await getDb();
  const ts = now();
  const created: CoverableUnit[] = [];

  for (let position = 0; position < units.length; position++) {
    const u = units[position];
    const id = uuid();

    await db.execute(
      `INSERT INTO coverable_units
         (id, goal_id, position, title, effort_estimate_minutes, status,
          assigned_event_id, actual_minutes_spent, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,NULL,$7,$8)`,
      [id, goalId, position, u.title, u.effort_estimate_minutes, u.assigned_event_id ?? null, ts, ts]
    );

    created.push({
      id,
      goal_id: goalId,
      position,
      title: u.title,
      effort_estimate_minutes: u.effort_estimate_minutes,
      status: "pending",
      assigned_event_id: u.assigned_event_id ?? null,
      actual_minutes_spent: null,
      created_at: ts,
      updated_at: ts,
    });
  }

  return created;
}

export async function getCoverableUnitsForGoal(goalId: string): Promise<CoverableUnit[]> {
  const db = await getDb();
  return db.select<CoverableUnit[]>(
    `SELECT * FROM coverable_units WHERE goal_id = $1 ORDER BY position ASC`,
    [goalId]
  );
}

export async function getCoverableUnitsForSession(eventId: string): Promise<CoverableUnit[]> {
  const db = await getDb();
  return db.select<CoverableUnit[]>(
    `SELECT * FROM coverable_units WHERE assigned_event_id = $1 ORDER BY position ASC`,
    [eventId]
  );
}

/**
 * Deletes a specific set of units by id. Used by undoCreateCoverableUnits
 * to delete exactly the batch just created — never the whole goal's units,
 * since an earlier batch may already exist and must survive.
 */
export async function deleteCoverableUnitsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  await db.execute(`DELETE FROM coverable_units WHERE id IN (${placeholders})`, ids);
}