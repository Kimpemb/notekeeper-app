// src/features/calendar/db/calendarQueries.ts

import { getDb } from "@/features/notes/db/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColourState = "blue" | "green" | "yellow" | "red";
export type LayerKey = "personal" | "notes" | "tasks" | "goals" | "cde";
export type CategoryKey = "personal" | "note" | "task" | "goal" | "cde";

export interface CalendarEvent {
  id:            string;
  title:         string;
  date:          string;         // ISO: 2026-05-01
  time:          string | null;  // HH:MM 24h, null = all-day
  duration_mins: number | null;
  category:      CategoryKey;
  source_id:     string | null;
  source_type:   string | null;
  colour_state:  ColourState;
  recurrence:    string | null;  // JSON
  recurrence_end: string | null;
  notes:         string | null;
  group_id:      string | null;
  linked_note_id: string | null;
  created_at:    number;
  updated_at:    number;
}

export interface CalendarEventInput {
  title:          string;
  date:           string;
  time?:          string | null;
  duration_mins?: number | null;
  category?:      CategoryKey;
  source_id?:     string | null;
  source_type?:   string | null;
  colour_state?:  ColourState;
  recurrence?:    string | null;
  recurrence_end?: string | null;
  notes?:         string | null;
  group_id?:      string | null;
  linked_note_id?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createEvent(input: CalendarEventInput): Promise<string> {
  const db = await getDb();
  const id = uuid();
  const ts = now();

  await db.execute(
    `INSERT INTO calendar_events
       (id, title, date, time, duration_mins, category, source_id, source_type,
        colour_state, recurrence, recurrence_end, notes, group_id, linked_note_id,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id,
      input.title,
      input.date,
      input.time ?? null,
      input.duration_mins ?? null,
      input.category ?? "personal",
      input.source_id ?? null,
      input.source_type ?? null,
      input.colour_state ?? "blue",
      input.recurrence ?? null,
      input.recurrence_end ?? null,
      input.notes ?? null,
      input.group_id ?? null,
      input.linked_note_id ?? null,
      ts,
      ts,
    ]
  );

  return id;
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const db = await getDb();
  const rows = await db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function updateEvent(
  id: string,
  updates: Partial<CalendarEventInput>
): Promise<void> {
  const db = await getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined)         { fields.push(`title = $${idx++}`);         values.push(updates.title); }
  if (updates.date !== undefined)          { fields.push(`date = $${idx++}`);           values.push(updates.date); }
  if (updates.time !== undefined)          { fields.push(`time = $${idx++}`);           values.push(updates.time); }
  if (updates.duration_mins !== undefined) { fields.push(`duration_mins = $${idx++}`); values.push(updates.duration_mins); }
  if (updates.category !== undefined)      { fields.push(`category = $${idx++}`);       values.push(updates.category); }
  if (updates.source_id !== undefined)     { fields.push(`source_id = $${idx++}`);      values.push(updates.source_id); }
  if (updates.source_type !== undefined)   { fields.push(`source_type = $${idx++}`);    values.push(updates.source_type); }
  if (updates.colour_state !== undefined)  { fields.push(`colour_state = $${idx++}`);   values.push(updates.colour_state); }
  if (updates.recurrence !== undefined)    { fields.push(`recurrence = $${idx++}`);     values.push(updates.recurrence); }
  if (updates.recurrence_end !== undefined){ fields.push(`recurrence_end = $${idx++}`); values.push(updates.recurrence_end); }
  if (updates.notes !== undefined)         { fields.push(`notes = $${idx++}`);          values.push(updates.notes); }
  if (updates.group_id !== undefined)      { fields.push(`group_id = $${idx++}`);       values.push(updates.group_id); }
  if (updates.linked_note_id !== undefined){ fields.push(`linked_note_id = $${idx++}`); values.push(updates.linked_note_id); }

  if (fields.length === 0) return;

  fields.push(`updated_at = $${idx++}`);
  values.push(now());
  values.push(id);

  await db.execute(
    `UPDATE calendar_events SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

export async function deleteEvent(id: string): Promise<void> {
  const db = await getDb();
  // ON DELETE CASCADE handles calendar_event_occurrences automatically
  // score_event_log rows intentionally NOT deleted — anti-gaming preserved
  await db.execute(`DELETE FROM calendar_events WHERE id = $1`, [id]);
}

export async function updateColourState(
  id: string,
  state: ColourState
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_events SET colour_state = $1, updated_at = $2 WHERE id = $3`,
    [state, now(), id]
  );
}

export async function getEventBySource(
  sourceId: string,
  sourceType: string
): Promise<CalendarEvent | null> {
  const db = await getDb();
  const rows = await db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE source_id = $1 AND source_type = $2
     LIMIT 1`,
    [sourceId, sourceType]
  );
  return rows[0] ?? null;
}

// ─── Agenda query ─────────────────────────────────────────────────────────────

export async function getAgendaEvents(params: {
  startDate: string;
  endDate:   string;   // ← NEW: was previously hardcoded to "9999-12-31" by callers
  layers:    LayerKey[];
  limit?:    number;
}): Promise<CalendarEvent[]> {
  const db = await getDb();
  const { startDate, endDate, layers, limit = 200 } = params;
 
  if (layers.length === 0) return [];
 
  const categoryMap: Record<LayerKey, CategoryKey> = {
    personal: "personal",
    notes:    "note",
    tasks:    "task",
    goals:    "goal",
    cde:      "cde",
  };
  const categories    = layers.map((l) => categoryMap[l]);
  const placeholders  = categories.map((_, i) => `$${i + 4}`).join(", ");
  // Note: placeholder index starts at $4 now (startDate=$1, endDate=$2, "green"=$3)
 
  return db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE date >= $1
       AND date <= $2
       AND colour_state != $3
       AND category IN (${placeholders})
     ORDER BY date ASC, time ASC NULLS LAST
     LIMIT ${limit}`,
    [startDate, endDate, "green", ...categories]
  );
}

// ─── Date-range query (for Month/Week/Day views — Phase 5) ───────────────────

export async function getEventsForDateRange(params: {
  startDate: string;
  endDate: string;
  layers: LayerKey[];
}): Promise<CalendarEvent[]> {
  const db = await getDb();
  const { startDate, endDate, layers } = params;

  if (layers.length === 0) return [];

  const categoryMap: Record<LayerKey, CategoryKey> = {
    personal: "personal",
    notes:    "note",
    tasks:    "task",
    goals:    "goal",
    cde:      "cde",
  };
  const categories = layers.map((l) => categoryMap[l]);
  const placeholders = categories.map((_, i) => `$${i + 3}`).join(", ");

  // Phase 5 query — Phase 12 will extend this to join calendar_event_occurrences
  // for recurring events. Keep rendering logic decoupled from date source.
  return db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events
     WHERE date >= $1
       AND date <= $2
       AND category IN (${placeholders})
     ORDER BY date ASC, time ASC NULLS LAST`,
    [startDate, endDate, ...categories]
  );
}

// ─── Yellow events count (for sidebar badge — Phase 11) ──────────────────────

export async function getYellowEventCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM calendar_events WHERE colour_state = 'yellow'`
  );
  return rows[0]?.count ?? 0;
}

// ─── Window score query (for Day/Week/Month toggle — Phase 12) ───────────────

export async function getWindowScore(params: {
  startDate: string; // ISO: 2026-06-13
  endDate:   string; // ISO: 2026-06-19
}): Promise<{ completed: number; total: number }> {
  const db = await getDb();
  const { startDate, endDate } = params;

  const rows = await db.select<{ completed: number; total: number }[]>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN colour_state = 'green' THEN 1 ELSE 0 END) as completed
     FROM calendar_events
     WHERE date >= $1
       AND date <= $2
       AND colour_state != 'red'`,
    [startDate, endDate]
  );

  return {
    completed: rows[0]?.completed ?? 0,
    total:     rows[0]?.total     ?? 0,
  };
}

// ─── Today blue count (for sidebar badge — Phase 12) ─────────────────────────

export async function getTodayBlueCount(): Promise<number> {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM calendar_events
     WHERE colour_state = 'blue' AND date = $1`,
    [today]
  );
  return rows[0]?.count ?? 0;
}

// ─── Event Groups ─────────────────────────────────────────────────────────────

export interface EventGroup {
  id:         string;
  name:       string;
  created_at: number;
}

export async function listEventGroups(): Promise<EventGroup[]> {
  const db = await getDb();
  return db.select<EventGroup[]>(
    `SELECT * FROM event_groups ORDER BY name ASC`
  );
}

export async function createEventGroup(name: string): Promise<string> {
  const db = await getDb();
  const id = uuid();
  await db.execute(
    `INSERT INTO event_groups (id, name, created_at) VALUES ($1, $2, $3)`,
    [id, name.trim(), now()]
  );
  return id;
}

export async function deleteEventGroup(id: string): Promise<void> {
  const db = await getDb();
  // calendar_events.group_id SET NULL via ON DELETE SET NULL
  await db.execute(`DELETE FROM event_groups WHERE id = $1`, [id]);
}

export async function getEventsBySourceType(
  sourceType: string
): Promise<CalendarEvent[]> {
  const db = await getDb();
  return db.select<CalendarEvent[]>(
    `SELECT * FROM calendar_events WHERE source_type = $1`,
    [sourceType]
  );
}