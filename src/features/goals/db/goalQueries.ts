// src/features/goals/db/goalQueries.ts

import { getDb } from "@/features/notes/db/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GoalColourState = "blue" | "green" | "yellow" | "red";
export type GoalStatusFilter = "active" | "upcoming" | "completed" | "missed" | "unresolved";
export type GoalLinkSourceType = "note" | "task" | "cde_project";

export type GoalClass =
  | "deep_work" | "quick_task" | "deadline_driven"
  | "maintenance" | "finish_this" | "flexible";

export interface Goal {
  id:           string;
  title:        string;
  description:  string | null;
  start_date:   string;        // ISO: 2026-05-01
  target_date:  string;        // ISO: 2026-05-01
  colour_state: GoalColourState;
  progress:     number;        // 0–100
  category:     string | null;
  created_at:   number;
  updated_at:   number;
  // Scheduler v1 fields — see scheduler-data-model-v1.md
  goal_class:                  GoalClass;
  significance:                number;        // 1–10
  estimated_duration_minutes:  number | null;
  last_progress_at:            number | null; // epoch ms, null = never progressed
  deep_work_protected:         0 | 1;         // SQLite has no native boolean;
                                               // use isDeepWorkProtected() below
                                               // to read this as a real boolean
}

export function isDeepWorkProtected(goal: Goal): boolean {
  return goal.deep_work_protected === 1;
}

export interface GoalInput {
  title:        string;
  description?: string | null;
  start_date:   string;
  target_date:  string;
  colour_state?: GoalColourState;
  progress?:    number;
  category?:    string | null;
  // Scheduler v1 fields — columns already exist on `goals` (see schema.ts
  // Scheduler v1 migration) but were previously write-only-by-SQL-console:
  // nothing in createGoal/updateGoal populated them. See Coverage Engine
  // Handoff #1 §5, first bullet.
  goal_class?:                  GoalClass;
  significance?:                number;        // 1–10
  estimated_duration_minutes?:  number | null;
  deep_work_protected?:         boolean;       // stored as 0/1, see isDeepWorkProtected()
}

export interface GoalMilestone {
  id:           string;
  goal_id:      string;
  title:        string;
  date:         string;        // ISO: 2026-05-01
  time:         string | null; // "HH:MM", null = date-only (unchanged legacy behavior)
  duration_mins: number | null;
  colour_state: GoalColourState;
  created_at:   number;
  updated_at:   number;
}

export interface MilestoneInput {
  goal_id: string;
  title:   string;
  date:    string;
  time?:          string | null;
  duration_mins?: number | null;
  colour_state?: GoalColourState;
}

export interface GoalLink {
  id:          string;
  goal_id:     string;
  source_id:   string;
  source_type: GoalLinkSourceType;
  weight:      number;         // 0–100
  created_at:  number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Goal CRUD ────────────────────────────────────────────────────────────────

export async function createGoal(input: GoalInput): Promise<string> {
  const db = await getDb();
  const id = uuid();
  const ts = now();

  await db.execute(
    `INSERT INTO goals
       (id, title, description, start_date, target_date, colour_state,
        progress, category, created_at, updated_at,
        goal_class, significance, estimated_duration_minutes, deep_work_protected)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id,
      input.title,
      input.description ?? null,
      input.start_date,
      input.target_date,
      input.colour_state ?? "blue",
      input.progress ?? 0,
      input.category ?? null,
      ts,
      ts,
      // Scheduler v1 fields — defaults mirror the column defaults in schema.ts
      // (goal_class='flexible', significance=5, deep_work_protected=1) so an
      // AI-created goal without these fields behaves identically to one
      // inserted before this change.
      input.goal_class ?? "flexible",
      input.significance ?? 5,
      input.estimated_duration_minutes ?? null,
      input.deep_work_protected === undefined ? 1 : (input.deep_work_protected ? 1 : 0),
    ]
  );

  return id;
}

export async function getGoal(id: string): Promise<Goal | null> {
  const db = await getDb();
  const rows = await db.select<Goal[]>(
    `SELECT * FROM goals WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateGoal(
  id: string,
  updates: Partial<GoalInput>
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title       !== undefined) { fields.push(`title = $${idx++}`);       values.push(updates.title); }
  if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }
  if (updates.start_date  !== undefined) { fields.push(`start_date = $${idx++}`);  values.push(updates.start_date); }
  if (updates.target_date !== undefined) { fields.push(`target_date = $${idx++}`); values.push(updates.target_date); }
  if (updates.colour_state !== undefined){ fields.push(`colour_state = $${idx++}`);values.push(updates.colour_state); }
  if (updates.category    !== undefined) { fields.push(`category = $${idx++}`);    values.push(updates.category); }

  // Scheduler v1 fields — see Coverage Engine Handoff #1 §5.
  if (updates.goal_class !== undefined) { fields.push(`goal_class = $${idx++}`); values.push(updates.goal_class); }
  if (updates.significance !== undefined) { fields.push(`significance = $${idx++}`); values.push(updates.significance); }
  if (updates.estimated_duration_minutes !== undefined) {
    fields.push(`estimated_duration_minutes = $${idx++}`);
    values.push(updates.estimated_duration_minutes);
  }
  if (updates.deep_work_protected !== undefined) {
    fields.push(`deep_work_protected = $${idx++}`);
    values.push(updates.deep_work_protected ? 1 : 0);
  }

  // progress is deliberately routed through updateGoalProgress() below,
  // not handled inline here, so there is exactly one place that decides
  // whether last_progress_at advances (see scheduler-data-model-v1.md §3).
  // Handling it inline here too would let a caller bump progress without
  // ever touching the Aging Engine's signal.
  if (updates.progress !== undefined) {
    await updateGoalProgress(id, updates.progress);
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = $${idx++}`);
  values.push(now());
  values.push(id);

  await db.execute(
    `UPDATE goals SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

export async function updateGoalColourState(
  id: string,
  state: GoalColourState
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE goals SET colour_state = $1, updated_at = $2 WHERE id = $3`,
    [state, now(), id]
  );
}

export async function updateGoalProgress(
  id: string,
  progress: number
): Promise<void> {
  const db = await getDb();
  const clamped = Math.min(100, Math.max(0, Math.round(progress)));
  const ts = now();

  // last_progress_at only advances when progress actually increases
  // ($1 > progress, evaluated against the pre-update row), so a no-op or
  // decreasing edit can't be used to fake "meaningful progress" for the
  // Aging Engine (see scheduler-data-model-v1.md §3, §9).
  await db.execute(
    `UPDATE goals
     SET progress = $1,
         updated_at = $2,
         last_progress_at = CASE WHEN $1 > progress THEN $2 ELSE last_progress_at END
     WHERE id = $3`,
    [clamped, ts, id]
  );
}

export async function deleteGoal(id: string): Promise<void> {
  const db = await getDb();
  // ON DELETE CASCADE handles goal_milestones and goal_links automatically
  await db.execute(`DELETE FROM goals WHERE id = $1`, [id]);
}

export async function listGoals(
  filter?: GoalStatusFilter | null
): Promise<Goal[]> {
  const db = await getDb();
  const today = todayISO();

  if (!filter) {
    return db.select<Goal[]>(
      `SELECT * FROM goals ORDER BY target_date ASC, created_at ASC`
    );
  }

  switch (filter) {
    case "active":
      return db.select<Goal[]>(
        `SELECT * FROM goals
         WHERE colour_state = 'blue' AND target_date >= $1
         ORDER BY target_date ASC`,
        [today]
      );
    case "upcoming":
      return db.select<Goal[]>(
        `SELECT * FROM goals
         WHERE start_date > $1
         ORDER BY start_date ASC`,
        [today]
      );
    case "completed":
      return db.select<Goal[]>(
        `SELECT * FROM goals
         WHERE colour_state = 'green'
         ORDER BY updated_at DESC`
      );
    case "missed":
      return db.select<Goal[]>(
        `SELECT * FROM goals
         WHERE colour_state = 'red'
         ORDER BY updated_at DESC`
      );
    case "unresolved":
      return db.select<Goal[]>(
        `SELECT * FROM goals
         WHERE colour_state = 'yellow'
         ORDER BY target_date ASC`
      );
  }
}

export async function findGoalByTitle(title: string): Promise<Goal | null> {
  const db = await getDb();
  const rows = await db.select<Goal[]>(
    `SELECT * FROM goals WHERE title = $1 LIMIT 1`,
    [title]
  );
  return rows[0] ?? null;
}

export async function getGoalCategories(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ category: string }[]>(
    `SELECT DISTINCT category FROM goals
     WHERE category IS NOT NULL
     ORDER BY category ASC`
  );
  return rows.map((r) => r.category);
}

// ─── Milestone CRUD ───────────────────────────────────────────────────────────

export async function createMilestone(
  input: MilestoneInput
): Promise<string> {
  const db = await getDb();
  const id = uuid();
  const ts = now();

  await db.execute(
    `INSERT INTO goal_milestones
       (id, goal_id, title, date, time, duration_mins, colour_state, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.goal_id,
      input.title,
      input.date,
      input.time ?? null,
      input.duration_mins ?? null,
      input.colour_state ?? "blue",
      ts,
      ts,
    ]
  );

  return id;
}

export async function getMilestonesForGoal(
  goalId: string
): Promise<GoalMilestone[]> {
  const db = await getDb();
  return db.select<GoalMilestone[]>(
    `SELECT * FROM goal_milestones
     WHERE goal_id = $1
     ORDER BY date ASC`,
    [goalId]
  );
}

export async function getMilestoneById(
  id: string
): Promise<GoalMilestone | null> {
  const db = await getDb();
  const rows = await db.select<GoalMilestone[]>(
    `SELECT * FROM goal_milestones WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateMilestone(
  id: string,
  updates: Partial<Omit<MilestoneInput, "goal_id">> & { colour_state?: GoalColourState }
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title         !== undefined) { fields.push(`title = $${idx++}`);         values.push(updates.title); }
  if (updates.date          !== undefined) { fields.push(`date = $${idx++}`);          values.push(updates.date); }
  if (updates.time          !== undefined) { fields.push(`time = $${idx++}`);          values.push(updates.time); }
  if (updates.duration_mins !== undefined) { fields.push(`duration_mins = $${idx++}`); values.push(updates.duration_mins); }
  if (updates.colour_state  !== undefined) { fields.push(`colour_state = $${idx++}`);  values.push(updates.colour_state); }

  if (fields.length === 0) return;

  fields.push(`updated_at = $${idx++}`);
  values.push(now());
  values.push(id);

  await db.execute(
    `UPDATE goal_milestones SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );

  // A milestone reaching 'green' counts as "meaningful progress" on its
  // parent goal for aging purposes (scheduler-data-model-v1.md §3, spec §9).
  // Look up the goal_id fresh rather than trusting a caller-supplied one,
  // since MilestoneInput's goal_id is omitted from `updates` by design.
  if (updates.colour_state === "green") {
    const milestone = await getMilestoneById(id);
    if (milestone) {
      await db.execute(
        `UPDATE goals SET last_progress_at = $1 WHERE id = $2`,
        [now(), milestone.goal_id]
      );
    }
  }
}

export async function deleteMilestone(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM goal_milestones WHERE id = $1`, [id]);
}

// ─── Goal Links ───────────────────────────────────────────────────────────────

export async function addGoalLink(
  goalId: string,
  sourceId: string,
  sourceType: GoalLinkSourceType,
  weight: number = 100
): Promise<string> {
  const db = await getDb();
  const id = uuid();
  const ts = now();

  await db.execute(
    `INSERT INTO goal_links
       (id, goal_id, source_id, source_type, weight, created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, goalId, sourceId, sourceType, weight, ts]
  );

  return id;
}

export async function getGoalLinks(goalId: string): Promise<GoalLink[]> {
  const db = await getDb();
  return db.select<GoalLink[]>(
    `SELECT * FROM goal_links WHERE goal_id = $1`,
    [goalId]
  );
}

export async function updateGoalLinkWeight(
  id: string,
  weight: number
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE goal_links SET weight = $1 WHERE id = $2`,
    [Math.min(100, Math.max(0, weight)), id]
  );
}

export async function removeGoalLink(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM goal_links WHERE id = $1`, [id]);
}

// ─── Bulk milestone fetch (for layerSync on startup) ──────────────────────────

export async function getAllMilestones(): Promise<GoalMilestone[]> {
  const db = await getDb();
  return db.select<GoalMilestone[]>(
    `SELECT * FROM goal_milestones ORDER BY date ASC`
  );
}