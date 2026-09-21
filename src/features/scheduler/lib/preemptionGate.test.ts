// src/features/scheduler/lib/preemptionGate.test.ts
//
// Phase A synthetic testing (Design v5 §18) for the Preemption Gate.
// Covers the three independently-testable conditions from §10 (SRTF
// condition, cost gate, Deep Work protection), the check-order requirement
// from §11 (protection is checked before SRTF/cost, not just "either would
// have failed anyway"), and exact boundary conditions per §10.3's
// "explainable" requirement.

import { describe, it, expect } from "vitest";
import {
  evaluatePreemption,
  DEFAULT_COST_FACTOR,
  type RunningTask,
  type IncomingTask,
} from "./preemptionGate";

function running(overrides: Partial<RunningTask> = {}): RunningTask {
  return {
    goalId: "running-goal",
    remainingDurationMinutes: 60,
    priority: 5,
    isProtectedDeepWork: false,
    ...overrides,
  };
}

function incoming(overrides: Partial<IncomingTask> = {}): IncomingTask {
  return {
    goalId: "incoming-goal",
    estimatedDurationMinutes: 20,
    priority: 8,
    ...overrides,
  };
}

describe("preemptionGate — SRTF condition (§10.1)", () => {
  it("fails when incoming duration is longer than remaining", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 90 }),
      running({ remainingDurationMinutes: 60 })
    );
    expect(decision).toEqual({ preempt: false, reason: "srtf_condition_failed" });
  });

  it("fails when incoming duration exactly equals remaining (strict less-than, not <=)", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 60, priority: 100 }),
      running({ remainingDurationMinutes: 60, priority: 1 })
    );
    expect(decision).toEqual({ preempt: false, reason: "srtf_condition_failed" });
  });

  it("passes SRTF (and the full gate) when incoming is strictly shorter and cost gate clears", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 10, priority: 10 }),
      running({ remainingDurationMinutes: 60, priority: 5 })
    );
    expect(decision).toEqual({ preempt: true, reason: "gate_passed" });
  });

  it("SRTF is evaluated before the cost gate — a task that fails SRTF is reported as such even if it would also fail cost", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 90, priority: 1 }),
      running({ remainingDurationMinutes: 60, priority: 100 })
    );
    expect(decision.reason).toBe("srtf_condition_failed");
  });
});

describe("preemptionGate — cost gate (§10.3)", () => {
  it("fails when incoming priority does not clear COST_FACTOR × running priority", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 10, priority: 6 }),
      running({ remainingDurationMinutes: 60, priority: 5 }) // needs > 7.5
    );
    expect(decision).toEqual({ preempt: false, reason: "cost_gate_failed" });
  });

  it("fails at the exact boundary: incoming == costFactor × running (strict >, not >=)", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 10, priority: 7.5 }),
      running({ remainingDurationMinutes: 60, priority: 5 }) // 1.5 * 5 = 7.5 exactly
    );
    expect(decision).toEqual({ preempt: false, reason: "cost_gate_failed" });
  });

  it("passes at just above the boundary", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 10, priority: 7.5001 }),
      running({ remainingDurationMinutes: 60, priority: 5 })
    );
    expect(decision).toEqual({ preempt: true, reason: "gate_passed" });
  });

  it("respects a custom costFactor override", () => {
    // With the default 1.5, incoming(8) > 1.5*5(7.5) would pass. A stricter
    // custom factor (3.0, requiring incoming > 15) forces a failure the
    // default would not produce — proving costFactor is actually threaded
    // through, not just the default constant being read.
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 10, priority: 8 }),
      running({ remainingDurationMinutes: 60, priority: 5 }),
      3.0 // requires incoming > 15
    );
    expect(decision).toEqual({ preempt: false, reason: "cost_gate_failed" });
  });

  it("default export constant matches spec §10.3 default of 1.5", () => {
    expect(DEFAULT_COST_FACTOR).toBe(1.5);
  });
});

describe("preemptionGate — Deep Work protection (§11)", () => {
  it("never preempts a protected running task, even when SRTF and cost gate would both trivially pass", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 1, priority: 1000 }),
      running({ remainingDurationMinutes: 999, priority: 0.001, isProtectedDeepWork: true })
    );
    expect(decision).toEqual({ preempt: false, reason: "protected_deep_work" });
  });

  it("protection is checked before SRTF — reason is protected_deep_work, not srtf_condition_failed, even when SRTF would also have failed", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 90 }), // would fail SRTF against 60 remaining
      running({ remainingDurationMinutes: 60, isProtectedDeepWork: true })
    );
    expect(decision.reason).toBe("protected_deep_work");
  });

  it("an otherwise-identical unprotected task can be preempted", () => {
    const decision = evaluatePreemption(
      incoming({ estimatedDurationMinutes: 10, priority: 10 }),
      running({ remainingDurationMinutes: 60, priority: 5, isProtectedDeepWork: false })
    );
    expect(decision.preempt).toBe(true);
  });
});

describe("preemptionGate — combined realistic scenarios", () => {
  it("thesis writing (protected) is not interrupted by a short high-priority email task", () => {
    const decision = evaluatePreemption(
      incoming({ goalId: "email", estimatedDurationMinutes: 5, priority: 9 }),
      running({
        goalId: "thesis",
        remainingDurationMinutes: 45,
        priority: 8,
        isProtectedDeepWork: true,
      })
    );
    expect(decision.preempt).toBe(false);
    expect(decision.reason).toBe("protected_deep_work");
  });

  it("a genuinely urgent short task can interrupt ordinary (unprotected) work", () => {
    const decision = evaluatePreemption(
      incoming({ goalId: "urgent-fix", estimatedDurationMinutes: 5, priority: 9 }),
      running({
        goalId: "routine-admin",
        remainingDurationMinutes: 30,
        priority: 3,
        isProtectedDeepWork: false,
      })
    );
    expect(decision).toEqual({ preempt: true, reason: "gate_passed" });
  });

  it("a low-priority short task does not interrupt higher-priority ordinary work", () => {
    const decision = evaluatePreemption(
      incoming({ goalId: "trivial-task", estimatedDurationMinutes: 2, priority: 2 }),
      running({
        goalId: "important-work",
        remainingDurationMinutes: 40,
        priority: 6,
        isProtectedDeepWork: false,
      })
    );
    expect(decision).toEqual({ preempt: false, reason: "cost_gate_failed" });
  });
});