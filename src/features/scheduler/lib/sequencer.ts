// src/features/scheduler/lib/sequencer.ts
//
// Layer 2 — Sequencing. Answers "what should happen next, and where
// should it fit?" Consumes Priority Engine output; does NOT decide
// whether to interrupt what's currently running (Preemption Gate).
// See Design v5 §2, §7, §8.

import type { PriorityResult, GoalClass } from "./priorityEngine";
import type { CalendarEvent } from "@/features/calendar/db/calendarQueries";

export type { GoalClass }; // re-exported so existing `import { GoalClass } from "./sequencer"` consumers don't break

export interface SequencableGoal {
  goalId:                   string;
  goalClass:                GoalClass;
  priority:                 PriorityResult;
  deadlineISO:              string | null;
  milestoneDeadlineISO:     string | null; // "required milestone" per spec §8.1 Tier 2
  lastProgressAt:           number | null;
}

export type SequenceTier =
  | "protected_deep_work" | "deadline_critical" | "general_priority"
  | "aging_recovery" | "maintenance_rotation";

export interface SequencedItem {
  goalId: string;
  tier:   SequenceTier;
}

/**
 * Persisted, cross-call state for the aging-recovery cap (spec §8.1 Tier 4:
 * "at most 1 aging-recovery recommendation per day"). This must be read from
 * and written back to durable storage (DB row / app state) by the caller —
 * sequence() is a pure function and cannot enforce a daily cap on its own.
 */
export interface AgingRecommendationState {
  lastRecommendationAt: number | null; // epoch ms
  lastRecommendedGoalId: string | null;
}

export interface SequenceResult {
  items: SequencedItem[];
  /**
   * Updated aging-recommendation state. If an aging_recovery item was
   * assigned this call, the caller MUST persist this back (e.g. write to
   * the DB) before the next call to sequence(), or the cap will not hold.
   */
  agingState: AgingRecommendationState;
}

// ─── Tier 1 — Protected Deep Work (spec §8.1) ────────────────────────────────

function isProtectedDeepWork(g: SequencableGoal): boolean {
  return g.goalClass === "deep_work";
}

// ─── Tier 2 — Deadline Criticality (spec §8.1) ───────────────────────────────

const CRITICAL_DEADLINE_HOURS  = 48;
const CRITICAL_MILESTONE_HOURS = 24;

function isDeadlineCritical(g: SequencableGoal, now: number): boolean {
  const hoursUntil = (iso: string | null) =>
    iso == null ? Infinity : (new Date(iso).getTime() - now) / (1000 * 60 * 60);

  return (
    g.goalClass === "deadline_driven" &&
    (hoursUntil(g.deadlineISO) <= CRITICAL_DEADLINE_HOURS ||
     hoursUntil(g.milestoneDeadlineISO) <= CRITICAL_MILESTONE_HOURS)
  );
}

// ─── Tier 4 — Aging Recovery (spec §8.1, §9) ─────────────────────────────────
// Sequencing-only. MUST NOT be read by the Preemption Gate — see spec §9.

const STARVATION_THRESHOLD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function isStarved(g: SequencableGoal, now: number): boolean {
  if (g.lastProgressAt == null) return false; // no signal — not "neglected", just unstarted
  const daysSince = (now - g.lastProgressAt) / DAY_MS;
  return daysSince >= STARVATION_THRESHOLD_DAYS;
}

/**
 * True if the daily aging-recovery cap has already been used, based on
 * persisted state rather than a call-scoped counter. "Today" is defined
 * as within the last 24h of `now` — simpler and timezone-safe compared to
 * calendar-day boundaries, and matches the spec's "per day" intent closely
 * enough for v1.
 */
function agingCapAlreadyUsed(state: AgingRecommendationState, now: number): boolean {
  if (state.lastRecommendationAt == null) return false;
  return now - state.lastRecommendationAt < DAY_MS;
}

// ─── Tier 5 — Maintenance Rotation (spec §8.1) ───────────────────────────────

function isMaintenance(g: SequencableGoal): boolean {
  return g.goalClass === "maintenance";
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────
//
// Applies tiers in strict order. A goal is assigned to the first tier it
// qualifies for; General Priority (Tier 3) is the fallback for everything
// else.
//
// TIER 3 ORDERING (spec §8.1: "ordered using the Priority Engine"):
// goals falling into general_priority are sorted by PriorityResult.score,
// descending, among themselves. This was previously a known gap — Tier 3
// items just preserved input-array order, tagged but not ranked. That
// silently broke quick_task and finish_this: neither goal class has a
// dedicated Sequencer tier (see priorityEngine.ts's efficiencyWeightFor
// comment), so their entire differentiated behavior is meant to come from
// how Priority ranks them within Tier 3. Without this fix, both classes
// were functionally indistinguishable from flexible.
//
// Implementation: only the general_priority slots in the output array are
// reordered (by their goalId, matched back via a score lookup) — Tiers
// 1/2/4/5 keep their original relative positions exactly as before. This
// is a plain descending sort (highest score first), matching the
// convention already used in rankByPriority (priorityEngine.ts).
//
// Calendar placement (turning a SequencedItem into an actual CalendarEvent)
// is still deliberately not implemented here — see data model doc §9.
// `_existingEvents` is reserved for that Phase 3 work.
//
// AGING CAP: unlike a naive implementation, the daily cap is enforced using
// `agingState`, which the caller must persist (e.g. to a `scheduler_state`
// table or similar) and pass back in on the next call. Without that
// persistence, the cap has no effect across separate invocations.

export function sequence(
  goals: SequencableGoal[],
  _existingEvents: CalendarEvent[],
  agingState: AgingRecommendationState,
  now = Date.now()
): SequenceResult {
  const result: SequencedItem[] = [];
  let nextAgingState = agingState;
  let capUsedThisCall = agingCapAlreadyUsed(agingState, now);

  // Positions in `result` that ended up in Tier 3, filled in after the main
  // pass once we know the full general_priority set for this call.
  const generalPriorityIndices: number[] = [];

  for (const g of goals) {
    if (isProtectedDeepWork(g)) {
      result.push({ goalId: g.goalId, tier: "protected_deep_work" });
    } else if (isDeadlineCritical(g, now)) {
      result.push({ goalId: g.goalId, tier: "deadline_critical" });
    } else if (isStarved(g, now) && !capUsedThisCall) {
      result.push({ goalId: g.goalId, tier: "aging_recovery" });
      capUsedThisCall = true;
      nextAgingState = { lastRecommendationAt: now, lastRecommendedGoalId: g.goalId };
    } else if (isMaintenance(g)) {
      result.push({ goalId: g.goalId, tier: "maintenance_rotation" });
    } else {
      generalPriorityIndices.push(result.length);
      result.push({ goalId: g.goalId, tier: "general_priority" });
    }
  }

  if (generalPriorityIndices.length > 1) {
    const scoreByGoalId = new Map(goals.map((g) => [g.goalId, g.priority.score]));
    const sortedGoalIds = generalPriorityIndices
      .map((i) => result[i].goalId)
      .sort((a, b) => (scoreByGoalId.get(b) ?? 0) - (scoreByGoalId.get(a) ?? 0));

    generalPriorityIndices.forEach((idx, i) => {
      result[idx] = { goalId: sortedGoalIds[i], tier: "general_priority" };
    });
  }

  return { items: result, agingState: nextAgingState };
}