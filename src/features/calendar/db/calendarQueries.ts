// src/features/calendar/db/calendarQueries.ts
//
// Phase 12 changes:
//   - getEventsForDateRange: now joins calendar_event_occurrences for recurring events.
//     Non-recurring events still use calendar_events.date directly.
//     The returned CalendarEvent shape is unchanged — occurrence_date is aliased to `date`
//     and occurrence colour_state overrides the parent's, so all view components work
//     without modification.
//   - getAgendaEvents: same join applied.
//   - New: getOccurrenceById, updateOccurrenceColourState (used by midnight transitions
//     and YellowQueue resolution for individual occurrences).
//   - CalendarEvent gains `occurrence_id` (nullable) so callers can tell whether a
//     returned row is a virtual occurrence row or a real standalone event, and pass
//     the right id to editOccurrence / deleteOccurrence.

import { getDb } from "@/features/notes/db/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ColourState = "blue" | "green" | "yellow" | "red";
export type LayerKey    = "personal" | "notes" | "tasks" | "goals" | "cde";
export type CategoryKey = "personal" | "note" | "task" | "goal" | "cde";

export interface CalendarEvent {
  id:             string;
  title:          string;
  date:           string;          // ISO: effective date (occurrence_date for recurring rows)
  time:           string | null;
  duration_mins:  number | null;
  category:       CategoryKey;
  source_id:      string | null;
  source_type:    string | null;
  colour_state:   ColourState;
  recurrence:     string | null;
  recurrence_end: string | null;
  notes:          string | null;
  group_id:       string | null;
  linked_note_id: string | null;
  created_at:     number;
  updated_at:     number;

  /**
   * Set to the calendar_event_occurrences.id when this row was generated
   * from a recurring event occurrence. Null for standalone events.
   * View components can use this to show the "recurring" indicator and to
   * route edit/delete through EditModeModal rather than direct updateEvent.
   */
  occurrence_id:  string | null;
}

export interface CalendarEventInput {
  title:           string;
  date:            string;
  time?:           string | null;
  duration_mins?:  number | null;
  category?:       CategoryKey;
  source_id?:      string | null;
  source_type?:    string | null;
  colour_state?:   ColourState;
  recurrence?:     string | null;
  recurrence_end?: string | null;
  notes?:          string | null;
  group_id?:       string | null;
  linked_note_id?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

const CATEGORY_MAP: Record<LayerKey, CategoryKey> = {
  personal: "personal",
  notes:    "note",
  tasks:    "task",
  goals:    "goal",
  cde:      "cde",
};

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
      input.time           ?? null,
      input.duration_mins  ?? null,
      input.category       ?? "personal",
      input.source_id      ?? null,
      input.source_type    ?? null,
      input.colour_state   ?? "blue",
      input.recurrence     ?? null,
      input.recurrence_end ?? null,
      input.notes          ?? null,
      input.group_id       ?? null,
      input.linked_note_id ?? null,
      ts,
      ts,
    ]
  );

  return id;
}

export async function getEvent(id: string): Promise<CalendarEvent | null> {
  const db = await getDb();
  const rows = await db.select<Omit<CalendarEvent, "occurrence_id">[]>(
    `SELECT * FROM calendar_events WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  return { ...rows[0], occurrence_id: null };
}

export async function updateEvent(
  id: string,
  updates: Partial<CalendarEventInput>
): Promise<void> {
  const db = await getDb();
  const fields: string[]  = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title          !== undefined) { fields.push(`title = $${idx++}`);          values.push(updates.title); }
  if (updates.date           !== undefined) { fields.push(`date = $${idx++}`);            values.push(updates.date); }
  if (updates.time           !== undefined) { fields.push(`time = $${idx++}`);            values.push(updates.time); }
  if (updates.duration_mins  !== undefined) { fields.push(`duration_mins = $${idx++}`);  values.push(updates.duration_mins); }
  if (updates.category       !== undefined) { fields.push(`category = $${idx++}`);        values.push(updates.category); }
  if (updates.source_id      !== undefined) { fields.push(`source_id = $${idx++}`);       values.push(updates.source_id); }
  if (updates.source_type    !== undefined) { fields.push(`source_type = $${idx++}`);     values.push(updates.source_type); }
  if (updates.colour_state   !== undefined) { fields.push(`colour_state = $${idx++}`);    values.push(updates.colour_state); }
  if (updates.recurrence     !== undefined) { fields.push(`recurrence = $${idx++}`);      values.push(updates.recurrence); }
  if (updates.recurrence_end !== undefined) { fields.push(`recurrence_end = $${idx++}`);  values.push(updates.recurrence_end); }
  if (updates.notes          !== undefined) { fields.push(`notes = $${idx++}`);           values.push(updates.notes); }
  if (updates.group_id       !== undefined) { fields.push(`group_id = $${idx++}`);        values.push(updates.group_id); }
  if (updates.linked_note_id !== undefined) { fields.push(`linked_note_id = $${idx++}`);  values.push(updates.linked_note_id); }

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
  // ON DELETE CASCADE removes calendar_event_occurrences rows automatically.
  // score_event_log rows are intentionally NOT deleted — anti-gaming preserved.
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
  const rows = await db.select<Omit<CalendarEvent, "occurrence_id">[]>(
    `SELECT * FROM calendar_events
     WHERE source_id = $1 AND source_type = $2
     LIMIT 1`,
    [sourceId, sourceType]
  );
  if (!rows[0]) return null;
  return { ...rows[0], occurrence_id: null };
}

export async function getEventsBySourceType(
  sourceType: string
): Promise<CalendarEvent[]> {
  const db = await getDb();
  const rows = await db.select<Omit<CalendarEvent, "occurrence_id">[]>(
    `SELECT * FROM calendar_events WHERE source_type = $1`,
    [sourceType]
  );
  return rows.map((r) => ({ ...r, occurrence_id: null }));
}

// ─── Occurrence colour state (used by YellowQueue and midnight transitions) ───

export async function updateOccurrenceColourState(
  occurrenceId: string,
  state: ColourState
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_event_occurrences SET colour_state = $1 WHERE id = $2`,
    [state, occurrenceId]
  );
}

export async function getOccurrenceById(occurrenceId: string): Promise<{
  id: string;
  event_id: string;
  occurrence_date: string;
  colour_state: ColourState;
  overridden: number;
} | null> {
  const db = await getDb();
  const rows = await db.select<{
    id: string;
    event_id: string;
    occurrence_date: string;
    colour_state: ColourState;
    overridden: number;
  }[]>(
    `SELECT * FROM calendar_event_occurrences WHERE id = $1`,
    [occurrenceId]
  );
  return rows[0] ?? null;
}

// ─── Date-range query — Phase 12 refactor ────────────────────────────────────
//
// Returns CalendarEvent[] for a date range, merging:
//   A) Non-recurring events: queried by calendar_events.date (unchanged from Phase 5)
//   B) Recurring events: queried via calendar_event_occurrences.occurrence_date
//
// For (B), occurrence_date is aliased to `date` and the occurrence's colour_state
// overrides the parent's — so yellow/green/red occurrences show correctly even
// when siblings are still blue. All view components (Month, Week, Day, Agenda) are
// untouched because the returned shape is identical to what they already consume.
//
// occurrence_id is populated for recurring rows so EventDetail can route
// edit/delete through EditModeModal. It is null for standalone events.

export async function getEventsForDateRange(params: {
  startDate: string;
  endDate:   string;
  layers:    LayerKey[];
}): Promise<CalendarEvent[]> {
  const db = await getDb();
  const { startDate, endDate, layers } = params;
  if (layers.length === 0) return [];

  const categories   = layers.map((l) => CATEGORY_MAP[l]);
  const placeholders = categories.map((_, i) => `$${i + 3}`).join(", ");

  // Query A: standalone (non-recurring) events
  const standaloneRows = await db.select<Omit<CalendarEvent, "occurrence_id">[]>(
    `SELECT * FROM calendar_events
     WHERE date >= $1
       AND date <= $2
       AND recurrence IS NULL
       AND category IN (${placeholders})
     ORDER BY date ASC, time ASC NULLS LAST`,
    [startDate, endDate, ...categories]
  );

  // Query B: recurring events via their occurrences
  // We join calendar_events for the parent fields, then overlay
  // occurrence_date and occurrence colour_state.
  const recurringRows = await db.select<{
    // parent fields
    id:             string;
    title:          string;
    time:           string | null;
    duration_mins:  number | null;
    category:       CategoryKey;
    source_id:      string | null;
    source_type:    string | null;
    recurrence:     string | null;
    recurrence_end: string | null;
    notes:          string | null;
    group_id:       string | null;
    linked_note_id: string | null;
    created_at:     number;
    updated_at:     number;
    // occurrence fields
    occ_id:         string;
    occurrence_date: string;
    occ_colour:     ColourState;
  }[]>(
    `SELECT
       ce.id,
       ce.title,
       ce.time,
       ce.duration_mins,
       ce.category,
       ce.source_id,
       ce.source_type,
       ce.recurrence,
       ce.recurrence_end,
       ce.notes,
       ce.group_id,
       ce.linked_note_id,
       ce.created_at,
       ce.updated_at,
       ceo.id          AS occ_id,
       ceo.occurrence_date,
       ceo.colour_state AS occ_colour
     FROM calendar_events ce
     INNER JOIN calendar_event_occurrences ceo ON ceo.event_id = ce.id
     WHERE ce.recurrence IS NOT NULL
       AND ceo.occurrence_date >= $1
       AND ceo.occurrence_date <= $2
       AND ce.category IN (${placeholders})
     ORDER BY ceo.occurrence_date ASC, ce.time ASC NULLS LAST`,
    [startDate, endDate, ...categories]
  );

  const standalone: CalendarEvent[] = standaloneRows.map((r) => ({
    ...r,
    occurrence_id: null,
  }));

  const recurring: CalendarEvent[] = recurringRows.map((r) => ({
    id:             r.id,
    title:          r.title,
    date:           r.occurrence_date,   // ← occurrence_date is the effective date
    time:           r.time,
    duration_mins:  r.duration_mins,
    category:       r.category,
    source_id:      r.source_id,
    source_type:    r.source_type,
    colour_state:   r.occ_colour,        // ← occurrence colour overrides parent
    recurrence:     r.recurrence,
    recurrence_end: r.recurrence_end,
    notes:          r.notes,
    group_id:       r.group_id,
    linked_note_id: r.linked_note_id,
    created_at:     r.created_at,
    updated_at:     r.updated_at,
    occurrence_id:  r.occ_id,           // ← lets EventDetail route to EditModeModal
  }));

  // Merge and sort by effective date then time
  const all = [...standalone, ...recurring].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  });

  return all;
}

// ─── Agenda query — Phase 12 refactor ────────────────────────────────────────
//
// Same dual-query approach as getEventsForDateRange.
// Excludes green events (already-completed) for the present/future window.
// The caller (useCalendarEvents) handles merging green events back for past windows.

export async function getAgendaEvents(params: {
  startDate: string;
  endDate:   string;
  layers:    LayerKey[];
  limit?:    number;
}): Promise<CalendarEvent[]> {
  const db = await getDb();
  const { startDate, endDate, layers, limit = 200 } = params;
  if (layers.length === 0) return [];

  const categories   = layers.map((l) => CATEGORY_MAP[l]);
  const placeholders = categories.map((_, i) => `$${i + 4}`).join(", ");

  // Standalone non-recurring, excluding green
  const standaloneRows = await db.select<Omit<CalendarEvent, "occurrence_id">[]>(
    `SELECT * FROM calendar_events
     WHERE date >= $1
       AND date <= $2
       AND colour_state != $3
       AND recurrence IS NULL
       AND category IN (${placeholders})
     ORDER BY date ASC, time ASC NULLS LAST
     LIMIT ${limit}`,
    [startDate, endDate, "green", ...categories]
  );

  // Recurring via occurrences, excluding green occurrences
  const recurringRows = await db.select<{
    id:             string;
    title:          string;
    time:           string | null;
    duration_mins:  number | null;
    category:       CategoryKey;
    source_id:      string | null;
    source_type:    string | null;
    recurrence:     string | null;
    recurrence_end: string | null;
    notes:          string | null;
    group_id:       string | null;
    linked_note_id: string | null;
    created_at:     number;
    updated_at:     number;
    occ_id:         string;
    occurrence_date: string;
    occ_colour:     ColourState;
  }[]>(
    `SELECT
       ce.id,
       ce.title,
       ce.time,
       ce.duration_mins,
       ce.category,
       ce.source_id,
       ce.source_type,
       ce.recurrence,
       ce.recurrence_end,
       ce.notes,
       ce.group_id,
       ce.linked_note_id,
       ce.created_at,
       ce.updated_at,
       ceo.id           AS occ_id,
       ceo.occurrence_date,
       ceo.colour_state  AS occ_colour
     FROM calendar_events ce
     INNER JOIN calendar_event_occurrences ceo ON ceo.event_id = ce.id
     WHERE ce.recurrence IS NOT NULL
       AND ceo.occurrence_date >= $1
       AND ceo.occurrence_date <= $2
       AND ceo.colour_state != $3
       AND ce.category IN (${placeholders})
     ORDER BY ceo.occurrence_date ASC, ce.time ASC NULLS LAST
     LIMIT ${limit}`,
    [startDate, endDate, "green", ...categories]
  );

  const standalone: CalendarEvent[] = standaloneRows.map((r) => ({
    ...r,
    occurrence_id: null,
  }));

  const recurring: CalendarEvent[] = recurringRows.map((r) => ({
    id:             r.id,
    title:          r.title,
    date:           r.occurrence_date,
    time:           r.time,
    duration_mins:  r.duration_mins,
    category:       r.category,
    source_id:      r.source_id,
    source_type:    r.source_type,
    colour_state:   r.occ_colour,
    recurrence:     r.recurrence,
    recurrence_end: r.recurrence_end,
    notes:          r.notes,
    group_id:       r.group_id,
    linked_note_id: r.linked_note_id,
    created_at:     r.created_at,
    updated_at:     r.updated_at,
    occurrence_id:  r.occ_id,
  }));

  const all = [...standalone, ...recurring].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  });

  return all.slice(0, limit);
}

// ─── Yellow events count (for sidebar badge) ──────────────────────────────────

export async function getYellowEventCount(): Promise<number> {
  const db = await getDb();

  // Standalone yellow events
  const standaloneRows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM calendar_events
     WHERE colour_state = 'yellow' AND recurrence IS NULL`
  );

  // Yellow occurrences (recurring events)
  const occurrenceRows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM calendar_event_occurrences
     WHERE colour_state = 'yellow'`
  );

  return (standaloneRows[0]?.count ?? 0) + (occurrenceRows[0]?.count ?? 0);
}

// ─── Window score query ────────────────────────────────────────────────────────

export async function getWindowScore(params: {
  startDate: string;
  endDate:   string;
}): Promise<{ completed: number; total: number }> {
  const db = await getDb();
  const { startDate, endDate } = params;

  const standaloneRows = await db.select<{ completed: number; total: number }[]>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN colour_state = 'green' THEN 1 ELSE 0 END) as completed
     FROM calendar_events
     WHERE date >= $1
       AND date <= $2
       AND colour_state != 'red'
       AND recurrence IS NULL`,
    [startDate, endDate]
  );

  const occurrenceRows = await db.select<{ completed: number; total: number }[]>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN colour_state = 'green' THEN 1 ELSE 0 END) as completed
     FROM calendar_event_occurrences
     WHERE occurrence_date >= $1
       AND occurrence_date <= $2
       AND colour_state != 'red'`,
    [startDate, endDate]
  );

  return {
    completed: (standaloneRows[0]?.completed ?? 0) + (occurrenceRows[0]?.completed ?? 0),
    total:     (standaloneRows[0]?.total     ?? 0) + (occurrenceRows[0]?.total     ?? 0),
  };
}

// ─── Today blue count (for sidebar badge) ─────────────────────────────────────

export async function getTodayBlueCount(): Promise<number> {
  const db   = await getDb();
  const today = new Date().toISOString().split("T")[0];

  const standaloneRows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM calendar_events
     WHERE colour_state = 'blue' AND date = $1 AND recurrence IS NULL`,
    [today]
  );

  const occurrenceRows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM calendar_event_occurrences
     WHERE colour_state = 'blue' AND occurrence_date = $1`,
    [today]
  );

  return (standaloneRows[0]?.count ?? 0) + (occurrenceRows[0]?.count ?? 0);
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
  await db.execute(`DELETE FROM event_groups WHERE id = $1`, [id]);
}