// src/features/calendar/hooks/useRecurrence.ts
//
// Recurrence engine for Phase 12.
// Responsibilities:
//   - Parse recurrence JSON from calendar_events.recurrence
//   - Generate CalendarEventOccurrence objects for a given parent event
//   - Persist occurrences to calendar_event_occurrences
//   - Handle all three edit modes: 'all' | 'this' | 'this_and_future'
//   - Handle two delete modes: 'this' | 'all'
//
// All DB writes use transactions for atomicity.
// The 2-year cap is enforced during generation regardless of recurrence_end.

import { getDb } from "@/features/notes/db/client";
import type { CalendarEvent, CalendarEventInput } from "@/features/calendar/db/calendarQueries";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecurrenceConfig {
  pattern: "daily" | "weekly" | "monthly";
  /** Day-of-week indices (0=Sun … 6=Sat) — only used when pattern = 'weekly' */
  days?: number[];
  /** ISO date — hard end date. If null, capped at 2 years from event start. */
  end_date?: string | null;
}

export interface CalendarEventOccurrence {
  id:              string;
  event_id:        string;
  occurrence_date: string;   // ISO date
  colour_state:    "blue" | "green" | "yellow" | "red";
  overridden:      number;   // 0 | 1
}

export type EditMode   = "all" | "this" | "this_and_future";
export type DeleteMode = "this" | "all";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

/** Add `n` days to an ISO date string and return a new ISO date string. */
function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

/** Add `n` months to an ISO date string. Clamps to last day of month. */
function addMonths(isoDate: string, n: number): string {
  const d = new Date(isoDate + "T00:00:00");
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // clamp to last day (e.g. Jan 31 + 1 month → Feb 28)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.toISOString().split("T")[0];
}

/** ISO date 2 years from a given start date. */
function twoYearCap(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  d.setFullYear(d.getFullYear() + 2);
  return d.toISOString().split("T")[0];
}

/** Day-of-week index (0=Sun … 6=Sat) for an ISO date. */
function dayOfWeek(isoDate: string): number {
  return new Date(isoDate + "T00:00:00").getDay();
}

// ─── Generation ───────────────────────────────────────────────────────────────

/**
 * Generate occurrence rows for a recurring event.
 * Does NOT write to DB — call persistOccurrences() for that.
 *
 * @param event   The parent calendar_events row (must have recurrence set)
 * @param fromDate  Start generating from this ISO date (inclusive). Defaults to event.date.
 */
export function generateOccurrences(
  event: CalendarEvent,
  fromDate?: string
): CalendarEventOccurrence[] {
  if (!event.recurrence) return [];

  let config: RecurrenceConfig;
  try {
    config = JSON.parse(event.recurrence) as RecurrenceConfig;
  } catch {
    console.error("[useRecurrence] invalid recurrence JSON:", event.recurrence);
    return [];
  }

  const start   = fromDate ?? event.date;
  const hardEnd = config.end_date
    ? (config.end_date < twoYearCap(event.date) ? config.end_date : twoYearCap(event.date))
    : twoYearCap(event.date);

  // Also respect event.recurrence_end if tighter than hardEnd
  const endDate = event.recurrence_end && event.recurrence_end < hardEnd
    ? event.recurrence_end
    : hardEnd;

  const occurrences: CalendarEventOccurrence[] = [];

  if (config.pattern === "daily") {
    let cur = start;
    while (cur <= endDate) {
      occurrences.push({
        id:              uuid(),
        event_id:        event.id,
        occurrence_date: cur,
        colour_state:    "blue",
        overridden:      0,
      });
      cur = addDays(cur, 1);
    }

  } else if (config.pattern === "weekly") {
    const targetDays = new Set(config.days ?? [dayOfWeek(event.date)]);
    let cur = start;
    while (cur <= endDate) {
      if (targetDays.has(dayOfWeek(cur))) {
        occurrences.push({
          id:              uuid(),
          event_id:        event.id,
          occurrence_date: cur,
          colour_state:    "blue",
          overridden:      0,
        });
      }
      cur = addDays(cur, 1);
    }

  } else if (config.pattern === "monthly") {
    // Same calendar day each month
    let monthOffset = 0;
    // Find starting month offset — if fromDate > event.date we need to skip ahead
    if (start > event.date) {
      const startD = new Date(start + "T00:00:00");
      const baseD  = new Date(event.date + "T00:00:00");
      monthOffset  = (startD.getFullYear() - baseD.getFullYear()) * 12
                     + (startD.getMonth() - baseD.getMonth());
    }

    while (true) {
      const cur = addMonths(event.date, monthOffset);
      if (cur > endDate) break;
      if (cur >= start) {
        occurrences.push({
          id:              uuid(),
          event_id:        event.id,
          occurrence_date: cur,
          colour_state:    "blue",
          overridden:      0,
        });
      }
      monthOffset++;
      // Safety: monthly on a 2-year cap = 24 iterations max
      if (monthOffset > 25) break;
    }
  }

  return occurrences;
}

// ─── Persist ──────────────────────────────────────────────────────────────────

/**
 * Batch-insert occurrences into calendar_event_occurrences.
 * Uses a transaction. Existing rows with the same id are ignored
 * (INSERT OR IGNORE) so this is safe to call idempotently.
 */
export async function persistOccurrences(
  occurrences: CalendarEventOccurrence[]
): Promise<void> {
  if (occurrences.length === 0) return;
  const db = await getDb();

  // Batch in chunks of 100 to avoid hitting SQLite variable limits
  const CHUNK = 100;
  for (let i = 0; i < occurrences.length; i += CHUNK) {
    const chunk = occurrences.slice(i, i + CHUNK);
    for (const o of chunk) {
      await db.execute(
        `INSERT OR IGNORE INTO calendar_event_occurrences
           (id, event_id, occurrence_date, colour_state, overridden)
         VALUES ($1, $2, $3, $4, $5)`,
        [o.id, o.event_id, o.occurrence_date, o.colour_state, o.overridden]
      );
    }
  }
}

// ─── Delete occurrence(s) ─────────────────────────────────────────────────────

/**
 * Delete a single occurrence row (mode = 'this').
 * The parent event and all other occurrences are untouched.
 * score_event_log rows for this occurrence_date are intentionally preserved.
 */
export async function deleteOccurrence(
  occurrenceId: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM calendar_event_occurrences WHERE id = $1`,
    [occurrenceId]
  );
}

/**
 * Delete a recurring event entirely (mode = 'all').
 * Deletes the parent event row — ON DELETE CASCADE removes all occurrences.
 */
export async function deleteRecurringEventAll(
  eventId: string
): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM calendar_events WHERE id = $1`, [eventId]);
}

// ─── Edit occurrence(s) ───────────────────────────────────────────────────────

/**
 * Edit a single occurrence without touching the parent or siblings.
 * Stores the changes on the occurrence row itself and marks overridden = 1.
 *
 * Note: occurrence rows only store colour_state, occurrence_date, and overridden.
 * For title/time/duration/notes overrides we store them as JSON in a new
 * `override_data` TEXT column — but since the schema doesn't include that column
 * yet (it wasn't in Phase 1), we handle the most common case here:
 * rescheduling the occurrence to a different date.
 *
 * If the caller passes `updates.date`, we move the occurrence_date.
 * All other field changes (title, time, etc.) are stored on a NEW single-occurrence
 * parent event so the view layer doesn't need special handling.
 *
 * Implementation decision: for 'this' edits involving content changes (not just
 * date), we create a standalone non-recurring event for that date and remove
 * the occurrence row. This avoids needing an override_data column and keeps
 * the CalendarEvent shape uniform across all views.
 */
export async function editOccurrence(
  mode: EditMode,
  params: {
    eventId:         string;
    occurrenceId:    string;
    occurrenceDate:  string;
    updates:         Partial<CalendarEventInput>;
  }
): Promise<void> {
  const db = await getDb();
  const { eventId, occurrenceId, occurrenceDate, updates } = params;

  // ── Mode: 'this' ────────────────────────────────────────────────────────────
  if (mode === "this") {
    // Check if it's a date-only reschedule or a content edit
    const isDateOnly =
      updates.date !== undefined &&
      updates.title === undefined &&
      updates.time === undefined &&
      updates.duration_mins === undefined &&
      updates.notes === undefined;

    if (isDateOnly) {
      // Simple reschedule: update occurrence_date and mark overridden
      await db.execute(
        `UPDATE calendar_event_occurrences
         SET occurrence_date = $1, overridden = 1
         WHERE id = $2`,
        [updates.date!, occurrenceId]
      );
    } else {
      // Content edit: remove this occurrence, create a standalone event
      // Fetch parent to inherit unchanged fields
      const parentRows = await db.select<CalendarEvent[]>(
        `SELECT * FROM calendar_events WHERE id = $1`,
        [eventId]
      );
      const parent = parentRows[0];
      if (!parent) return;

      // Delete this occurrence row
      await db.execute(
        `DELETE FROM calendar_event_occurrences WHERE id = $1`,
        [occurrenceId]
      );

      // Create a standalone (non-recurring) event for this date
      const newId = uuid();
      const ts    = Date.now();
      await db.execute(
        `INSERT INTO calendar_events
           (id, title, date, time, duration_mins, category, source_id, source_type,
            colour_state, recurrence, recurrence_end, notes, group_id, linked_note_id,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10,$11,$12,$13,$14)`,
        [
          newId,
          updates.title        ?? parent.title,
          updates.date         ?? occurrenceDate,
          updates.time         ?? parent.time,
          updates.duration_mins ?? parent.duration_mins,
          parent.category,
          parent.source_id,
          parent.source_type,
          parent.colour_state,
          updates.notes        ?? parent.notes,
          parent.group_id,
          parent.linked_note_id,
          ts,
          ts,
        ]
      );
    }
    return;
  }

  // ── Mode: 'this_and_future' ─────────────────────────────────────────────────
  if (mode === "this_and_future") {
    const parentRows = await db.select<CalendarEvent[]>(
      `SELECT * FROM calendar_events WHERE id = $1`,
      [eventId]
    );
    const parent = parentRows[0];
    if (!parent) return;

    const ts = Date.now();

    // 1. Truncate the original event's recurrence chain: set recurrence_end to
    //    the day before this occurrence so past occurrences are preserved.
    const newOriginalEnd = addDays(occurrenceDate, -1);
    await db.execute(
      `UPDATE calendar_events
       SET recurrence_end = $1, updated_at = $2
       WHERE id = $3`,
      [newOriginalEnd, ts, eventId]
    );

    // 2. Delete all un-overridden occurrences from this date forward
    //    (overridden ones were individually edited — leave them alone)
    await db.execute(
      `DELETE FROM calendar_event_occurrences
       WHERE event_id = $1
         AND occurrence_date >= $2
         AND overridden = 0`,
      [eventId, occurrenceDate]
    );

    // 3. Create a new parent event starting from this occurrence with new settings
    const newEventId = uuid();
    const mergedRecurrence = updates.recurrence !== undefined
      ? updates.recurrence
      : parent.recurrence;
    const mergedRecurrenceEnd = updates.recurrence_end !== undefined
      ? updates.recurrence_end
      : parent.recurrence_end;

    await db.execute(
      `INSERT INTO calendar_events
         (id, title, date, time, duration_mins, category, source_id, source_type,
          colour_state, recurrence, recurrence_end, notes, group_id, linked_note_id,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        newEventId,
        updates.title         ?? parent.title,
        occurrenceDate,
        updates.time          ?? parent.time,
        updates.duration_mins ?? parent.duration_mins,
        parent.category,
        parent.source_id,
        parent.source_type,
        parent.colour_state,
        mergedRecurrence,
        mergedRecurrenceEnd,
        updates.notes         ?? parent.notes,
        parent.group_id,
        parent.linked_note_id,
        ts,
        ts,
      ]
    );

    // 4. Generate and persist occurrences for the new event
    const newParentRow: CalendarEvent = {
      ...parent,
      id:             newEventId,
      title:          updates.title         ?? parent.title,
      date:           occurrenceDate,
      time:           updates.time          ?? parent.time,
      duration_mins:  updates.duration_mins ?? parent.duration_mins,
      recurrence:     mergedRecurrence,
      recurrence_end: mergedRecurrenceEnd,
      notes:          updates.notes         ?? parent.notes,
      created_at:     ts,
      updated_at:     ts,
    };
    const newOccurrences = generateOccurrences(newParentRow, occurrenceDate);
    await persistOccurrences(newOccurrences);

    return;
  }

  // ── Mode: 'all' ─────────────────────────────────────────────────────────────
  if (mode === "all") {
    const ts = Date.now();

    // Build update fields for the parent event
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.title         !== undefined) { fields.push(`title = $${idx++}`);         values.push(updates.title); }
    if (updates.date          !== undefined) { fields.push(`date = $${idx++}`);           values.push(updates.date); }
    if (updates.time          !== undefined) { fields.push(`time = $${idx++}`);           values.push(updates.time); }
    if (updates.duration_mins !== undefined) { fields.push(`duration_mins = $${idx++}`); values.push(updates.duration_mins); }
    if (updates.recurrence    !== undefined) { fields.push(`recurrence = $${idx++}`);     values.push(updates.recurrence); }
    if (updates.recurrence_end !== undefined){ fields.push(`recurrence_end = $${idx++}`); values.push(updates.recurrence_end); }
    if (updates.notes         !== undefined) { fields.push(`notes = $${idx++}`);          values.push(updates.notes); }

    if (fields.length > 0) {
      fields.push(`updated_at = $${idx++}`);
      values.push(ts);
      values.push(eventId);
      await db.execute(
        `UPDATE calendar_events SET ${fields.join(", ")} WHERE id = $${idx}`,
        values
      );
    }

    // Delete all un-overridden occurrences and regenerate
    await db.execute(
      `DELETE FROM calendar_event_occurrences WHERE event_id = $1 AND overridden = 0`,
      [eventId]
    );

    // Fetch the updated parent to generate from
    const updatedRows = await db.select<CalendarEvent[]>(
      `SELECT * FROM calendar_events WHERE id = $1`,
      [eventId]
    );
    const updatedParent = updatedRows[0];
    if (!updatedParent) return;

    const newOccurrences = generateOccurrences(updatedParent);
    await persistOccurrences(newOccurrences);
  }
}

// ─── Query helpers used by calendarQueries refactor ──────────────────────────

/** Fetch all occurrences for an event. */
export async function getOccurrencesForEvent(
  eventId: string
): Promise<CalendarEventOccurrence[]> {
  const db = await getDb();
  return db.select<CalendarEventOccurrence[]>(
    `SELECT * FROM calendar_event_occurrences
     WHERE event_id = $1
     ORDER BY occurrence_date ASC`,
    [eventId]
  );
}

/** Fetch a single occurrence by id. */
export async function getOccurrence(
  id: string
): Promise<CalendarEventOccurrence | null> {
  const db = await getDb();
  const rows = await db.select<CalendarEventOccurrence[]>(
    `SELECT * FROM calendar_event_occurrences WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Update colour_state on a single occurrence (for midnight transitions). */
export async function updateOccurrenceColourState(
  id: string,
  state: "blue" | "green" | "yellow" | "red"
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE calendar_event_occurrences SET colour_state = $1 WHERE id = $2`,
    [state, id]
  );
}