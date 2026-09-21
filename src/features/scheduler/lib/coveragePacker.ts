// src/features/scheduler/lib/coveragePacker.ts
//
// Coverage Engine — packer. Order-preserving greedy walk that assigns
// coverable_units into session capacities. Pure function: no DB, no AI,
// no UI. See "Scheduler — Coverage Engine: Design & Handoff #1" §8.1–§8.2.
//
// Scope note: this module only packs. It does not write assigned_event_id
// back to the DB, does not call createCoverableUnits, and does not decide
// which tool shape the AI writes through — that's §7's still-open question,
// deliberately not resolved here. Callers own persistence.

export interface CoverableUnitInput {
  id:                      string;
  position:                number;  // caller-supplied order; packer walks this order,
                                     // does NOT re-sort — sorting is the caller's job if
                                     // the input isn't already ordered (see packUnitsIntoSessions)
  title:                   string;
  effortEstimateMinutes:   number;
}

export interface SessionCapacityInput {
  eventId:           string;
  capacityMinutes:   number;
}

export interface PackedSession {
  eventId: string;
  units:   CoverableUnitInput[];
}

export interface PackResult {
  sessions:        PackedSession[];
  unassignedUnits: CoverableUnitInput[];  // insufficient committed session time —
                                            // surfaced, never silently dropped (§8.2)
}

/**
 * Order-preserving greedy walk. No subject-specific logic — operates
 * purely on (position, effortEstimateMinutes) and a queue of session
 * capacities, in the order both arrays are given.
 *
 * Contract:
 * - `units` MUST already be sorted by position ascending. This function
 *   does not sort, so a goal's own outline order is never silently
 *   reordered by a packer implementation detail — sort at the call site
 *   (e.g. right after reading from coverable_units, which is itself
 *   indexed and queried in position order per Handoff #1 §8.1).
 * - `sessions` MUST already be in chronological order. Same reasoning:
 *   which session is "next" is a calendar concern, not the packer's.
 * - A unit larger than every remaining session's capacity is never
 *   split — splitting a unit changes what "covered through position N"
 *   means for §8.4's coverage reporting, so it's out of scope for v1.
 *   Such a unit ends up in `unassignedUnits`.
 */
export function packUnitsIntoSessions(
  units:    CoverableUnitInput[],
  sessions: SessionCapacityInput[]
): PackResult {
  const packedSessions: PackedSession[] = [];
  let unitIdx = 0;

  for (const session of sessions) {
    let remaining = session.capacityMinutes;
    const assigned: CoverableUnitInput[] = [];

    while (
      unitIdx < units.length &&
      units[unitIdx].effortEstimateMinutes <= remaining
    ) {
      assigned.push(units[unitIdx]);
      remaining -= units[unitIdx].effortEstimateMinutes;
      unitIdx += 1;
    }

    packedSessions.push({ eventId: session.eventId, units: assigned });
  }

  return {
    sessions:        packedSessions,
    unassignedUnits: units.slice(unitIdx),
  };
}

/**
 * Convenience wrapper: sorts defensively by position before packing.
 * Prefer this at real call sites; packUnitsIntoSessions itself stays
 * strict (no implicit sort) so tests can exercise out-of-order input
 * as a deliberate case rather than having it silently corrected.
 */
export function packUnitsIntoSessionsSorted(
  units:    CoverableUnitInput[],
  sessions: SessionCapacityInput[]
): PackResult {
  const sorted = [...units].sort((a, b) => a.position - b.position);
  return packUnitsIntoSessions(sorted, sessions);
}