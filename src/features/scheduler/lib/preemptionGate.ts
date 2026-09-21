// src/features/scheduler/lib/preemptionGate.ts
//
// Layer 3 — Preemption. Answers "should I interrupt what the user is
// doing right now?" Deliberately the hardest-to-satisfy layer — a task
// becoming "next" (Sequencer) never on its own justifies this. See
// Design v5 §2, §10, §11.

export interface RunningTask {
  goalId:                    string;
  remainingDurationMinutes:  number;
  priority:                  number;      // Priority Engine score
  isProtectedDeepWork:       boolean;     // spec §11 — non-preemptive
}

export interface IncomingTask {
  goalId:                   string;
  estimatedDurationMinutes: number;
  priority:                 number;
}

export interface PreemptionDecision {
  preempt: boolean;
  reason:
    | "protected_deep_work"      // gate never opens
    | "srtf_condition_failed"    // incoming not shorter than remaining
    | "cost_gate_failed"         // priority delta doesn't clear COST_FACTOR
    | "gate_passed";
}

// Default per spec §10.3. Explicitly NOT validated — see spec §10.3, §21.
export const DEFAULT_COST_FACTOR = 1.5;

// ─── §10.1 — Baseline SRTF condition ─────────────────────────────────────────
//
// "Incoming Estimated Duration < Current Remaining Duration". Strictly
// less-than per spec §10.1 — an incoming task of equal or longer duration
// never clears this on its own.

function passesSRTF(incoming: IncomingTask, running: RunningTask): boolean {
  return incoming.estimatedDurationMinutes < running.remainingDurationMinutes;
}

// ─── §10.3 — Cost gate ───────────────────────────────────────────────────────
//
// "Incoming Priority > COST_FACTOR × Current Remaining Priority". Strictly
// greater-than: a tie at exactly incoming == costFactor × running fails the
// gate (queue silently, per §10.3), it does not pass it.

function passesCostGate(
  incoming: IncomingTask,
  running: RunningTask,
  costFactor: number
): boolean {
  return incoming.priority > costFactor * running.priority;
}

// ─── Combined gate (§10.3) ────────────────────────────────────────────────────
//
// All three conditions are evaluated independently and logged in the
// decision reason, so a failed gate is always explainable (spec §14.1
// "explainable" requirement extends to this layer too, not just override
// learning).
//
// Order matters and is spec-mandated (§11): Deep Work protection is checked
// first and unconditionally — it is not merely "SRTF or cost would have
// failed anyway". A protected running task can never be preempted even by
// an incoming task that would otherwise trivially clear both other gates.

export function evaluatePreemption(
  incoming: IncomingTask,
  running:  RunningTask,
  costFactor = DEFAULT_COST_FACTOR
): PreemptionDecision {
  if (running.isProtectedDeepWork) {
    return { preempt: false, reason: "protected_deep_work" };
  }
  if (!passesSRTF(incoming, running)) {
    return { preempt: false, reason: "srtf_condition_failed" };
  }
  if (!passesCostGate(incoming, running, costFactor)) {
    return { preempt: false, reason: "cost_gate_failed" };
  }
  return { preempt: true, reason: "gate_passed" };
}