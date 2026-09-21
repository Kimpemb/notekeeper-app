// src/features/scheduler/lib/coveragePacker.test.ts
//
// Phase A synthetic testing (Design v5 §18) for the Coverage Engine
// packer. Covers exact-fit packing, overflow into unassignedUnits,
// units too large for any session, empty inputs, order preservation,
// and the concrete regression case named in Handoff #1 §6: a single
// 7-8 hour session should not collapse a multi-unit outline into one
// giant "unit" — the packer must fan units out across the session's
// actual capacity, not swallow it whole.

import { describe, it, expect } from "vitest";
import {
  packUnitsIntoSessions,
  packUnitsIntoSessionsSorted,
  type CoverableUnitInput,
  type SessionCapacityInput,
} from "./coveragePacker";

function unit(
  position: number,
  effortEstimateMinutes: number,
  overrides: Partial<CoverableUnitInput> = {}
): CoverableUnitInput {
  return {
    id: `u${position}`,
    position,
    title: `Unit ${position}`,
    effortEstimateMinutes,
    ...overrides,
  };
}

function session(eventId: string, capacityMinutes: number): SessionCapacityInput {
  return { eventId, capacityMinutes };
}

describe("packUnitsIntoSessions", () => {
  it("packs units into a single session up to its capacity", () => {
    const units = [unit(0, 30), unit(1, 30), unit(2, 30)];
    const sessions = [session("evt-1", 90)];

    const result = packUnitsIntoSessions(units, sessions);

    expect(result.sessions).toEqual([
      { eventId: "evt-1", units: [unit(0, 30), unit(1, 30), unit(2, 30)] },
    ]);
    expect(result.unassignedUnits).toEqual([]);
  });

  it("stops packing a session once the next unit no longer fits, without splitting it", () => {
    const units = [unit(0, 40), unit(1, 40), unit(2, 40)]; // 3rd doesn't fit in 90min after first two
    const sessions = [session("evt-1", 90)];

    const result = packUnitsIntoSessions(units, sessions);

    expect(result.sessions[0].units).toEqual([unit(0, 40), unit(1, 40)]);
    expect(result.unassignedUnits).toEqual([unit(2, 40)]);
  });

  it("carries overflow forward into the next chronological session", () => {
    const units = [unit(0, 60), unit(1, 60), unit(2, 60)];
    const sessions = [session("evt-mon", 90), session("evt-wed", 90)];

    const result = packUnitsIntoSessions(units, sessions);

    expect(result.sessions).toEqual([
      { eventId: "evt-mon", units: [unit(0, 60)] },
      { eventId: "evt-wed", units: [unit(1, 60)] },
    ]);
    // 90min capacity, 60min already used by unit(1) leaves 30min — unit(2) at
    // 60min doesn't fit evt-wed either, so it's genuinely unassigned, not lost.
    expect(result.unassignedUnits).toEqual([unit(2, 60)]);
  });

  it("Handoff #1 §6 regression: a single 7-8h session fans out multiple units instead of collapsing to one", () => {
    // Concrete scenario from the live test: Friday's CN block previously
    // produced exactly one 7-8 hour milestone. With real content units,
    // the same session capacity should hold several distinct units.
    const units = [
      unit(0, 90, { title: "Ch 4 — Routing algorithms" }),
      unit(1, 90, { title: "Ch 5 — TCP congestion control" }),
      unit(2, 60, { title: "Practice problem set 3" }),
      unit(3, 120, { title: "Past exam — timed run" }),
      unit(4, 90, { title: "Review flagged topics" }),
    ]; // total 450min = 7.5h
    const sessions = [session("evt-fri-cn", 450)];

    const result = packUnitsIntoSessions(units, sessions);

    expect(result.sessions[0].units).toHaveLength(5);
    expect(result.sessions[0].units.map((u) => u.title)).toEqual([
      "Ch 4 — Routing algorithms",
      "Ch 5 — TCP congestion control",
      "Practice problem set 3",
      "Past exam — timed run",
      "Review flagged topics",
    ]);
    expect(result.unassignedUnits).toEqual([]);
  });

  it("returns a unit larger than every remaining session as unassigned, never split", () => {
    const units = [unit(0, 200)];
    const sessions = [session("evt-1", 60), session("evt-2", 90)];

    const result = packUnitsIntoSessions(units, sessions);

    expect(result.sessions).toEqual([
      { eventId: "evt-1", units: [] },
      { eventId: "evt-2", units: [] },
    ]);
    expect(result.unassignedUnits).toEqual([unit(0, 200)]);
  });

  it("handles zero sessions by leaving all units unassigned", () => {
    const units = [unit(0, 30), unit(1, 30)];
    const result = packUnitsIntoSessions(units, []);

    expect(result.sessions).toEqual([]);
    expect(result.unassignedUnits).toEqual(units);
  });

  it("handles zero units by returning empty, non-null session buckets", () => {
    const sessions = [session("evt-1", 60), session("evt-2", 60)];
    const result = packUnitsIntoSessions([], sessions);

    expect(result.sessions).toEqual([
      { eventId: "evt-1", units: [] },
      { eventId: "evt-2", units: [] },
    ]);
    expect(result.unassignedUnits).toEqual([]);
  });

  it("does not sort out-of-order input — caller's responsibility per contract", () => {
    // position 1 listed before position 0: packUnitsIntoSessions walks the
    // array as given, so this deliberately packs "out of order" rather than
    // silently correcting it.
    const units = [unit(1, 30), unit(0, 30)];
    const sessions = [session("evt-1", 30)];

    const result = packUnitsIntoSessions(units, sessions);

    expect(result.sessions[0].units).toEqual([unit(1, 30)]);
    expect(result.unassignedUnits).toEqual([unit(0, 30)]);
  });
});

describe("packUnitsIntoSessionsSorted", () => {
  it("sorts by position before packing, unlike the strict variant", () => {
    const units = [unit(1, 30), unit(0, 30)];
    const sessions = [session("evt-1", 30)];

    const result = packUnitsIntoSessionsSorted(units, sessions);

    expect(result.sessions[0].units).toEqual([unit(0, 30)]);
    expect(result.unassignedUnits).toEqual([unit(1, 30)]);
  });
});