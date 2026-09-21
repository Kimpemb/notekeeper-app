// src/features/scheduler/lib/priorityEngine.test.ts
//
// Phase A synthetic testing (Design v5 §18). Covers the pathological
// cases named explicitly by the spec: extremely short tasks, extremely
// long tasks, high-significance tasks, neglected tasks, and mixed
// workloads. Also covers realistic (non-extreme) duration ranges, since
// a fix that only works at extreme outliers isn't validated for the
// common case.

import { describe, it, expect } from "vitest";
import {
  computePriority,
  rankByPriority,
  inverseDuration,
  logDuration,
  boundedDuration,
  type PriorityInput,
} from "./priorityEngine";

const NOW = new Date("2026-08-27T12:00:00Z").getTime();
const DAY = 1000 * 60 * 60 * 24;

function goal(overrides: Partial<PriorityInput> & { goalId: string }): PriorityInput {
  return {
    goalClass: "flexible", // tie-breaker weight profile by default; class-specific tests override this
    significance: 5,
    estimatedDurationMinutes: 60,
    lastProgressAt: null,
    agingSensitivityDays: 3,
    ...overrides,
  };
}

describe("priorityEngine — basic scoring", () => {
  it("falls back to significance alone (no duration bonus, no aging) for a fresh, unestimated goal", () => {
    const result = computePriority(
      goal({ goalId: "g1", significance: 5, estimatedDurationMinutes: null, lastProgressAt: null }),
      NOW
    );
    expect(result.parts.timeEfficiency).toBe(0);
    expect(result.parts.agingBoost).toBe(0);
    expect(result.score).toBe(5); // significance is the base term now, not a multiplicand
  });

  it("gives a higher score to higher significance at equal duration and aging", () => {
    const low = computePriority(goal({ goalId: "low", significance: 2 }), NOW);
    const high = computePriority(goal({ goalId: "high", significance: 9 }), NOW);
    expect(high.score).toBeGreaterThan(low.score);
  });
});

describe("priorityEngine — extreme duration pathology (spec §6)", () => {
  it("[KNOWN LIMITATION] raw inverseDuration lets a 1-min low-significance task beat an 8-hr high-significance task", () => {
    const tiny = computePriority(
      goal({ goalId: "tiny", significance: 2, estimatedDurationMinutes: 1 }),
      NOW
    );
    // manually apply the known-bad baseline transform to demonstrate the failure mode
    const tinyRaw = tiny.parts.significance * inverseDuration(1);
    const thesisRaw = 9 * inverseDuration(480);
    expect(tinyRaw).toBeGreaterThan(thesisRaw); // documents why inverseDuration is not the active transform
  });

  it("significance floor prevents a 1-min low-significance task from beating an 8-hr high-significance task", () => {
    const tiny = computePriority(
      goal({ goalId: "tiny", significance: 2, estimatedDurationMinutes: 1 }),
      NOW
    );
    const thesis = computePriority(
      goal({ goalId: "thesis", significance: 9, estimatedDurationMinutes: 480 }),
      NOW
    );
    expect(thesis.score).toBeGreaterThan(tiny.score);
  });

  it("significance floor holds even for a 30-second-equivalent (1 min, floor) task at minimum significance vs. max significance/duration", () => {
    const trivial = computePriority(
      goal({ goalId: "trivial", significance: 1, estimatedDurationMinutes: 1 }),
      NOW
    );
    const critical = computePriority(
      goal({ goalId: "critical", significance: 10, estimatedDurationMinutes: 600 }),
      NOW
    );
    expect(critical.score).toBeGreaterThan(trivial.score);
  });

  it("logDuration alone (no floor) still lets tiny tasks beat far more significant long tasks at extreme ratios", () => {
    const tinyEff = logDuration(1);
    const thesisEff = logDuration(480);
    const tinyScore = 2 * tinyEff;
    const thesisScore = 9 * thesisEff;
    // This documents the Phase A finding: logDuration alone is insufficient
    // at extreme ratios — it's the significance floor doing the real work.
    expect(tinyScore).toBeGreaterThan(thesisScore);
  });

  it("boundedDuration alone (no floor) is worse, not better, at extreme ratios", () => {
    const bounded = boundedDuration(0.5);
    const tinyScore = 2 * bounded(1);
    const thesisScore = 9 * bounded(480);
    expect(tinyScore).toBeGreaterThan(thesisScore);
  });
});

describe("priorityEngine — realistic duration ranges (not just extreme outliers)", () => {
  it("a 15-min low-significance task does not beat a 90-min high-significance task", () => {
    const quick = computePriority(
      goal({ goalId: "quick", significance: 3, estimatedDurationMinutes: 15 }),
      NOW
    );
    const important = computePriority(
      goal({ goalId: "important", significance: 8, estimatedDurationMinutes: 90 }),
      NOW
    );
    expect(important.score).toBeGreaterThan(quick.score);
  });

  it("among two similarly-significant tasks, the shorter one still scores higher (efficiency signal preserved)", () => {
    const shortTask = computePriority(
      goal({ goalId: "short", significance: 6, estimatedDurationMinutes: 20 }),
      NOW
    );
    const longTask = computePriority(
      goal({ goalId: "long", significance: 6, estimatedDurationMinutes: 120 }),
      NOW
    );
    expect(shortTask.score).toBeGreaterThan(longTask.score);
  });
});

describe("priorityEngine — aging boost cap", () => {
  it("[KNOWN LIMITATION] raw uncapped aging boost would let a 60-day-neglected low-significance goal beat a fresh high-significance goal", () => {
    const daysSince = 60;
    const sensitivity = 3;
    const rawUncappedBoost = Math.floor(daysSince / sensitivity); // = 20, no ceiling
    const neglectedRawScore = 2 * logDuration(60) + rawUncappedBoost;
    const freshRawScore = 9 * logDuration(60) + 0;
    expect(neglectedRawScore).toBeGreaterThan(freshRawScore); // documents why an uncapped boost is unsafe
  });

  it("capped aging boost does not let a 60-day-neglected low-significance goal beat a fresh high-significance goal", () => {
    const neglected = computePriority(
      goal({
        goalId: "neglected",
        significance: 2,
        estimatedDurationMinutes: 60,
        lastProgressAt: NOW - 60 * DAY,
      }),
      NOW
    );
    const fresh = computePriority(
      goal({
        goalId: "fresh",
        significance: 9,
        estimatedDurationMinutes: 60,
        lastProgressAt: NOW, // progressed just now
      }),
      NOW
    );
    expect(fresh.score).toBeGreaterThan(neglected.score);
  });

  it("aging boost is 0 for a goal that has never been progressed (not treated as infinitely stale)", () => {
    const result = computePriority(
      goal({ goalId: "never", lastProgressAt: null, estimatedDurationMinutes: 60 }),
      NOW
    );
    expect(result.parts.agingBoost).toBe(0);
  });

  it("aging boost still meaningfully increases score for moderately neglected goals (starvation prevention preserved)", () => {
    const barelyStale = computePriority(
      goal({ goalId: "barely", lastProgressAt: NOW - 1 * DAY, estimatedDurationMinutes: 60 }),
      NOW
    );
    const staleWeek = computePriority(
      goal({ goalId: "week", lastProgressAt: NOW - 9 * DAY, estimatedDurationMinutes: 60 }),
      NOW
    );
    expect(staleWeek.score).toBeGreaterThan(barelyStale.score);
  });

  it("aging boost plateaus at the cap rather than growing without bound", () => {
    const neglected30 = computePriority(
      goal({ goalId: "n30", lastProgressAt: NOW - 30 * DAY, estimatedDurationMinutes: 60 }),
      NOW
    );
    const neglected365 = computePriority(
      goal({ goalId: "n365", lastProgressAt: NOW - 365 * DAY, estimatedDurationMinutes: 60 }),
      NOW
    );
    expect(neglected365.parts.agingBoost).toBe(neglected30.parts.agingBoost);
  });
});

describe("priorityEngine — mixed workload ranking (spec §18)", () => {
  it("ranks a mixed workload in a stable, explainable order", () => {
    const inputs: PriorityInput[] = [
      goal({ goalId: "thesis", significance: 9, estimatedDurationMinutes: 480, lastProgressAt: NOW - 2 * DAY }),
      goal({ goalId: "email", significance: 3, estimatedDurationMinutes: 5, lastProgressAt: NOW }),
      goal({ goalId: "exercise", significance: 5, estimatedDurationMinutes: 30, lastProgressAt: NOW - 8 * DAY }),
      goal({ goalId: "admin", significance: 2, estimatedDurationMinutes: 10, lastProgressAt: NOW - 1 * DAY }),
    ];

    const ranked = rankByPriority(inputs, NOW);
    expect(ranked).toHaveLength(4);
    // thesis (high significance, moderately fresh) should not be crowded out
    // by the quick low-significance email task
    const thesisRank = ranked.findIndex((r) => r.goalId === "thesis");
    const emailRank = ranked.findIndex((r) => r.goalId === "email");
    expect(thesisRank).toBeLessThan(emailRank);
  });
});