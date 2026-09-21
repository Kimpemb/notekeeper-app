// src/features/scheduler/lib/sequencer.test.ts
//
// Phase A synthetic testing (Design v5 §18) for the Sequencer. Covers
// tier-assignment correctness for the Tier 1–5 hierarchy (§8.1) and
// aging-cap enforcement (§8.1 Tier 4: max 1 recommendation/day), including
// cap persistence and reset across separate sequence() calls.

import { describe, it, expect } from "vitest";
import {
  sequence,
  type SequencableGoal,
  type AgingRecommendationState,
  type GoalClass,
} from "./sequencer";
import type { PriorityResult } from "./priorityEngine";
import { computePriority } from "./priorityEngine";
import type { CalendarEvent } from "@/features/calendar/db/calendarQueries";

const NOW = new Date("2026-08-27T12:00:00Z").getTime();
const HOUR = 1000 * 60 * 60;
const DAY = 24 * HOUR;
const NO_EVENTS: CalendarEvent[] = [];
const NO_AGING_STATE: AgingRecommendationState = {
  lastRecommendationAt: null,
  lastRecommendedGoalId: null,
};

function priority(score: number, goalId: string): PriorityResult {
  return { goalId, score, parts: { significance: 0, timeEfficiency: 0, agingBoost: 0 } };
}

function makeGoal(overrides: Partial<SequencableGoal> & { goalId: string }): SequencableGoal {
  return {
    goalClass: "flexible" as GoalClass,
    priority: priority(0, overrides.goalId),
    deadlineISO: null,
    milestoneDeadlineISO: null,
    lastProgressAt: null,
    ...overrides,
  };
}

describe("sequencer — Tier 1: Protected Deep Work", () => {
  it("assigns deep_work goals to protected_deep_work regardless of other conditions", () => {
    const goal = makeGoal({
      goalId: "focus",
      goalClass: "deep_work",
      lastProgressAt: NOW - 30 * DAY, // would otherwise qualify for aging recovery
    });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0]).toEqual({ goalId: "focus", tier: "protected_deep_work" });
  });
});

describe("sequencer — Tier 2: Deadline Criticality", () => {
  it("flags a deadline-driven goal within 48h of its deadline as deadline_critical", () => {
    const goal = makeGoal({
      goalId: "report",
      goalClass: "deadline_driven",
      deadlineISO: new Date(NOW + 24 * HOUR).toISOString(),
    });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).toBe("deadline_critical");
  });

  it("flags a deadline-driven goal within 24h of a required milestone as deadline_critical, even if the final deadline is far off", () => {
    const goal = makeGoal({
      goalId: "milestone-goal",
      goalClass: "deadline_driven",
      deadlineISO: new Date(NOW + 30 * DAY).toISOString(),
      milestoneDeadlineISO: new Date(NOW + 12 * HOUR).toISOString(),
    });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).toBe("deadline_critical");
  });

  it("does NOT flag a deadline-driven goal as critical when its deadline is beyond 48h and no milestone is near", () => {
    const goal = makeGoal({
      goalId: "distant",
      goalClass: "deadline_driven",
      deadlineISO: new Date(NOW + 10 * DAY).toISOString(),
    });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).not.toBe("deadline_critical");
  });

  it("does NOT flag a non-deadline-driven goal as critical even with a near-term deadlineISO set", () => {
    // deadlineISO can technically be set on any goal class; only
    // deadline_driven goals should be evaluated for Tier 2.
    const goal = makeGoal({
      goalId: "flexible-with-date",
      goalClass: "flexible",
      deadlineISO: new Date(NOW + 1 * HOUR).toISOString(),
    });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).not.toBe("deadline_critical");
  });
});

describe("sequencer — Tier 4: Aging Recovery", () => {
  it("flags a goal neglected >= 7 days as aging_recovery", () => {
    const goal = makeGoal({ goalId: "neglected", lastProgressAt: NOW - 8 * DAY });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).toBe("aging_recovery");
  });

  it("does NOT flag a goal neglected fewer than 7 days", () => {
    const goal = makeGoal({ goalId: "recent", lastProgressAt: NOW - 3 * DAY });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).not.toBe("aging_recovery");
  });

  it("treats a goal with no progress history as unstarted, not neglected", () => {
    const goal = makeGoal({ goalId: "never-started", lastProgressAt: null });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).not.toBe("aging_recovery");
  });

  it("enforces the daily cap: only the first of two starved goals in one call gets aging_recovery", () => {
    const goals = [
      makeGoal({ goalId: "starved-a", lastProgressAt: NOW - 20 * DAY }),
      makeGoal({ goalId: "starved-b", lastProgressAt: NOW - 15 * DAY }),
    ];
    const result = sequence(goals, NO_EVENTS, NO_AGING_STATE, NOW);
    const tiers = result.items.map((i) => i.tier);
    expect(tiers.filter((t) => t === "aging_recovery")).toHaveLength(1);
    expect(result.items[0].tier).toBe("aging_recovery"); // first starved goal wins
    expect(result.items[1].tier).not.toBe("aging_recovery"); // second falls through to general_priority
  });

  it("persists the cap across calls: a second call within 24h of the first recommendation does not grant another", () => {
    const first = sequence(
      [makeGoal({ goalId: "starved-a", lastProgressAt: NOW - 20 * DAY })],
      NO_EVENTS,
      NO_AGING_STATE,
      NOW
    );
    expect(first.items[0].tier).toBe("aging_recovery");

    const secondCallTime = NOW + 2 * HOUR;
    const second = sequence(
      [makeGoal({ goalId: "starved-b", lastProgressAt: NOW - 15 * DAY })],
      NO_EVENTS,
      first.agingState, // caller correctly persists and passes state back
      secondCallTime
    );
    expect(second.items[0].tier).not.toBe("aging_recovery");
  });

  it("resets the cap once 24h have passed since the last recommendation", () => {
    const first = sequence(
      [makeGoal({ goalId: "starved-a", lastProgressAt: NOW - 20 * DAY })],
      NO_EVENTS,
      NO_AGING_STATE,
      NOW
    );

    const nextDay = NOW + 25 * HOUR;
    const second = sequence(
      [makeGoal({ goalId: "starved-b", lastProgressAt: NOW - 15 * DAY })],
      NO_EVENTS,
      first.agingState,
      nextDay
    );
    expect(second.items[0].tier).toBe("aging_recovery");
  });

  it("[REGRESSION GUARD] a naive call-scoped counter (ignoring agingState) would incorrectly reset every call — this asserts persistence is actually load-bearing", () => {
    // Two separate calls, no state persisted between them (caller bug/omission).
    const first = sequence(
      [makeGoal({ goalId: "starved-a", lastProgressAt: NOW - 20 * DAY })],
      NO_EVENTS,
      NO_AGING_STATE,
      NOW
    );
    const secondWithoutPersistence = sequence(
      [makeGoal({ goalId: "starved-b", lastProgressAt: NOW - 15 * DAY })],
      NO_EVENTS,
      NO_AGING_STATE, // bug: caller forgot to pass first.agingState back
      NOW + 2 * HOUR
    );
    // Documents that the cap is only as good as the caller's persistence —
    // sequence() itself is pure and cannot enforce this on its own.
    expect(first.items[0].tier).toBe("aging_recovery");
    expect(secondWithoutPersistence.items[0].tier).toBe("aging_recovery");
  });
});

describe("sequencer — Tier 5: Maintenance Rotation", () => {
  it("assigns maintenance-class goals to maintenance_rotation when not starved or deadline-critical", () => {
    const goal = makeGoal({ goalId: "chores", goalClass: "maintenance", lastProgressAt: NOW - 1 * DAY });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).toBe("maintenance_rotation");
  });

  it("aging recovery takes precedence over maintenance rotation for a starved maintenance goal (Tier 4 before Tier 5)", () => {
    const goal = makeGoal({ goalId: "neglected-chore", goalClass: "maintenance", lastProgressAt: NOW - 10 * DAY });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).toBe("aging_recovery");
  });
});

describe("sequencer — Tier 3: General Priority (fallback)", () => {
  it("falls back to general_priority for a flexible, non-critical, non-starved goal", () => {
    const goal = makeGoal({ goalId: "misc", goalClass: "flexible" });
    const result = sequence([goal], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items[0].tier).toBe("general_priority");
  });

  it("orders general_priority items by Priority Engine score, descending — input order does not leak through (fixes prior [KNOWN GAP])", () => {
    // Spec §8.1 Tier 3: "ordered using the Priority Engine." Deliberately
    // fed in reverse of priority order to prove the fix isn't accidental —
    // if sequence() just preserved input order, this would fail.
    const lowPriorityFirst = makeGoal({ goalId: "low", priority: priority(1, "low") });
    const highPrioritySecond = makeGoal({ goalId: "high", priority: priority(99, "high") });
    const result = sequence([lowPriorityFirst, highPrioritySecond], NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items.map((i) => i.goalId)).toEqual(["high", "low"]);
  });

  it("orders three or more general_priority items correctly, not just a two-item swap", () => {
    const goals = [
      makeGoal({ goalId: "mid", priority: priority(5, "mid") }),
      makeGoal({ goalId: "top", priority: priority(9, "top") }),
      makeGoal({ goalId: "bottom", priority: priority(1, "bottom") }),
    ];
    const result = sequence(goals, NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items.map((i) => i.goalId)).toEqual(["top", "mid", "bottom"]);
  });

  it("only reorders the general_priority slots — other tiers keep their original relative positions", () => {
    // Interleaved input: deep_work, then two general_priority goals in
    // reverse-priority order, then maintenance. Only the two
    // general_priority items should move relative to each other; the
    // deep_work and maintenance items should stay exactly where they were.
    const deepWork = makeGoal({ goalId: "focus", goalClass: "deep_work" });
    const lowGeneral = makeGoal({ goalId: "low", priority: priority(1, "low") });
    const highGeneral = makeGoal({ goalId: "high", priority: priority(99, "high") });
    const maintenance = makeGoal({ goalId: "chores", goalClass: "maintenance" });

    const result = sequence(
      [deepWork, lowGeneral, highGeneral, maintenance],
      NO_EVENTS,
      NO_AGING_STATE,
      NOW
    );

    expect(result.items).toEqual([
      { goalId: "focus", tier: "protected_deep_work" },
      { goalId: "high", tier: "general_priority" },  // moved ahead of "low"
      { goalId: "low", tier: "general_priority" },
      { goalId: "chores", tier: "maintenance_rotation" }, // stayed in its original slot
    ]);
  });
});

describe("sequencer — quick_task / finish_this differentiation (fixes prior blind spot)", () => {
  // Neither goal class has a dedicated Sequencer tier (both fall through to
  // general_priority, per spec §8.1 — only Tiers 1/2/4/5 are class-specific).
  // Before the class-aware duration weight (priorityEngine.ts) and the Tier 3
  // ordering fix above, quick_task and finish_this were indistinguishable
  // from flexible: nothing in the system expressed their designed "favor
  // short/near-complete work" behavior (spec §4). These tests exercise the
  // combination of both fixes together, using computePriority for realistic
  // scores rather than hand-picked priority() stand-ins.

  it("a short quick_task genuinely outranks a similarly-significant longer flexible goal in Tier 3 order", () => {
    const quickTaskScore = computePriority(
      { goalId: "quick", goalClass: "quick_task", significance: 5, estimatedDurationMinutes: 10, lastProgressAt: null, agingSensitivityDays: 3 },
      NOW
    );
    const flexibleScore = computePriority(
      { goalId: "flex", goalClass: "flexible", significance: 5, estimatedDurationMinutes: 180, lastProgressAt: null, agingSensitivityDays: 3 },
      NOW
    );

    const result = sequence(
      [
        makeGoal({ goalId: "flex", goalClass: "flexible", priority: flexibleScore }),
        makeGoal({ goalId: "quick", goalClass: "quick_task", priority: quickTaskScore }),
      ],
      NO_EVENTS,
      NO_AGING_STATE,
      NOW
    );

    expect(result.items.map((i) => i.goalId)).toEqual(["quick", "flex"]);
  });

  it("duration weighting still cannot let a low-significance quick_task beat a much higher-significance goal (pathology stays fixed even for the boosted classes)", () => {
    const tinyQuickTask = computePriority(
      { goalId: "tiny", goalClass: "quick_task", significance: 2, estimatedDurationMinutes: 1, lastProgressAt: null, agingSensitivityDays: 3 },
      NOW
    );
    const importantFlexible = computePriority(
      { goalId: "thesis", goalClass: "flexible", significance: 9, estimatedDurationMinutes: 480, lastProgressAt: null, agingSensitivityDays: 3 },
      NOW
    );

    const result = sequence(
      [
        makeGoal({ goalId: "tiny", goalClass: "quick_task", priority: tinyQuickTask }),
        makeGoal({ goalId: "thesis", goalClass: "flexible", priority: importantFlexible }),
      ],
      NO_EVENTS,
      NO_AGING_STATE,
      NOW
    );

    expect(result.items.map((i) => i.goalId)).toEqual(["thesis", "tiny"]);
  });
});

describe("sequencer — mixed workload", () => {
  it("assigns each goal to exactly one tier across a realistic mixed batch", () => {
    const goals: SequencableGoal[] = [
      makeGoal({ goalId: "focus-block", goalClass: "deep_work" }),
      makeGoal({
        goalId: "urgent-report",
        goalClass: "deadline_driven",
        deadlineISO: new Date(NOW + 6 * HOUR).toISOString(),
      }),
      makeGoal({ goalId: "exercise", lastProgressAt: NOW - 9 * DAY }),
      makeGoal({ goalId: "laundry", goalClass: "maintenance", lastProgressAt: NOW - 1 * DAY }),
      makeGoal({ goalId: "reading", goalClass: "flexible", lastProgressAt: NOW - 1 * DAY }),
    ];
    const result = sequence(goals, NO_EVENTS, NO_AGING_STATE, NOW);
    expect(result.items.map((i) => i.tier)).toEqual([
      "protected_deep_work",
      "deadline_critical",
      "aging_recovery",
      "maintenance_rotation",
      "general_priority",
    ]);
  });
});