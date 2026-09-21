// src/features/scheduler/lib/priorityEngine.ts
//
// Layer 1 — Priority. Answers "what deserves attention?"
// Does NOT decide when something happens (Sequencer) or whether to
// interrupt (Preemption Gate). See Design v5 §2, §7.

export type GoalClass =
  | "deep_work" | "quick_task" | "deadline_driven"
  | "maintenance" | "finish_this" | "flexible";

export interface PriorityInput {
  goalId:                     string;
  goalClass:                  GoalClass;      // determines duration-weight profile, see §EFFICIENCY_WEIGHT below
  significance:               number;        // 1–10
  estimatedDurationMinutes:   number | null;  // null = excluded from duration term
  lastProgressAt:             number | null;  // epoch ms, null = never progressed
  agingSensitivityDays:       number;         // default 3, spec §5.1
}

export interface PriorityResult {
  goalId: string;
  score:  number;
  parts: {                      // exposed for debugging/Phase A synthetic testing
    significance:   number;
    timeEfficiency: number;
    agingBoost:     number;
  };
}

// ─── Duration transforms (spec §6) — named strategies, not inlined ───────────

export type DurationTransform = (durationMinutes: number) => number;

/** Known-bad baseline. Kept only for Phase D comparison testing. */
export const inverseDuration: DurationTransform = (mins) => 1 / mins;

/** Candidate A — spec §6 */
export const logDuration: DurationTransform = (mins) =>
  1 / (1 + Math.log(Math.max(mins, 1)));

/** Candidate B — spec §6. Caps duration's contribution. */
export function boundedDuration(maxContribution = 0.5): DurationTransform {
  return (mins) => Math.min(1 / mins, maxContribution);
}

// Active transform — swap during Phase D validation without touching callers.
const ACTIVE_DURATION_TRANSFORM: DurationTransform = logDuration;

// ─── Significance floor (spec §6, Option C — previously unimplemented) ──────
//
// Phase A finding: neither logDuration nor boundedDuration prevents a very
// short, low-significance task from outranking a very long, high-significance
// one (e.g. 1-min/sig-2 vs 8-hr/sig-9). Capping the *ceiling* of
// `significance * timeEfficiency` doesn't fix this — the problem isn't the
// ceiling, it's that multiplication itself lets a task's own duration
// discount its own significance with no floor tying score back to
// significance in absolute terms.
//
// FORMULA SHAPE CHANGE, flagged not hidden: this moves from the spec's
// literal (Significance × Time Efficiency) + Aging Boost (§5.1) to
// Significance + (bounded Time Efficiency) + (capped Aging Boost). Duration
// is now an additive tie-breaker, weighted so it can never move a task's
// score by more than one full significance point in either direction — so
// duration only decides ordering between tasks of equal or adjacent
// significance, never inverts a large significance gap. This is a bigger
// change than the "cap the ceiling" version implies, and is exactly the kind
// of thing the spec says isn't Claude's call to make unilaterally — it's
// implemented here as the significance-floor candidate for Phase A
// comparison against the original multiplicative model, not as a final
// decision. See Phase D (§18) for the intended place to make that call.

// Two weight profiles, not one global constant.
//
// Why: quick_task and finish_this have NO dedicated Sequencer tier (spec
// §8.1 — only Tiers 1/2/4/5 are goal-class-specific; both of these fall
// through to Tier 3, General Priority). Per the Goal Classes table (spec
// §4), their entire SJF-like / SRTF-like differentiation is meant to come
// from how Priority ranks them by duration. A single global ±1 tie-break
// cap would silently make both classes behave identically to `flexible` —
// not a tuning issue, a correctness gap, since nothing else in the system
// expresses "favor short/near-complete work" for them.
//
// deep_work, deadline_driven, and maintenance don't have this problem —
// their differentiated behavior already comes from their own Sequencer
// tier (Tier 1/2/5), so Priority only needs to break ties among them.
//
// DURATION_PRIMARY_WEIGHT is still bounded well below the pathology
// threshold: max additive swing is 3 significance points (at
// boundedEfficiency's ceiling of 1), so a quick_task/finish_this goal can
// out-rank another goal within ~3 significance points of it, but can
// never invert a large gap (e.g. the original 1-min/sig-2 vs. 8-hr/sig-9
// case: 2 + 3 = 5, still well under 9). "Favored when appropriate" (spec
// §4), not "dominates regardless of significance."

const TIE_BREAKER_WEIGHT      = 1; // deep_work, deadline_driven, maintenance, flexible
const DURATION_PRIMARY_WEIGHT = 3; // quick_task, finish_this — spec §4's designed differentiator

function efficiencyWeightFor(goalClass: GoalClass): number {
  switch (goalClass) {
    case "quick_task":
    case "finish_this":
      return DURATION_PRIMARY_WEIGHT;
    default:
      return TIE_BREAKER_WEIGHT;
  }
}

function boundedEfficiency(timeEfficiency: number): number {
  return Math.min(timeEfficiency, 1); // transforms are already ~(0,1], clamp defensively
}

// ─── Aging (spec §5.1, §9 — feeds Priority only, never Preemption) ───────────
//
// Phase A finding: aging boost was previously unbounded
// (floor(daysSince/sensitivity) with no ceiling), letting a long-neglected
// low-significance goal swamp a freshly-touched high-significance one
// (e.g. 60 days neglected, sig 2, scored higher than a fresh sig-9 goal).
// The Sequencer already caps aging *recommendations* at 1/day (Tier 4) —
// this applies the same "aging matters, but must not dominate" principle
// to the raw Priority score itself.

const MAX_AGING_BOOST = 5; // named constant so Phase D can tune/compare

function computeAgingBoost(
  lastProgressAt: number | null,
  sensitivityDays: number,
  now = Date.now()
): number {
  if (lastProgressAt == null) return 0; // no signal yet — do not assume neglect
  const daysSince = (now - lastProgressAt) / (1000 * 60 * 60 * 24);
  const raw = Math.floor(daysSince / sensitivityDays);
  return Math.min(raw, MAX_AGING_BOOST);
}

// ─── Priority score (spec §5.1) ──────────────────────────────────────────────

export function computePriority(input: PriorityInput, now = Date.now()): PriorityResult {
  const timeEfficiency = input.estimatedDurationMinutes != null
    ? ACTIVE_DURATION_TRANSFORM(input.estimatedDurationMinutes)
    : 0; // no duration estimate — contributes nothing rather than a guess

  const agingBoost = computeAgingBoost(
    input.lastProgressAt,
    input.agingSensitivityDays,
    now
  );

  const score =
    input.significance +
    efficiencyWeightFor(input.goalClass) * boundedEfficiency(timeEfficiency) +
    agingBoost;

  return {
    goalId: input.goalId,
    score,
    parts: { significance: input.significance, timeEfficiency, agingBoost },
  };
}

export function rankByPriority(inputs: PriorityInput[], now = Date.now()): PriorityResult[] {
  return inputs
    .map((i) => computePriority(i, now))
    .sort((a, b) => b.score - a.score);
}