// src/features/sync/lib/reachability.ts
// PURE: decides what a reachability probe result means. No network, no DB, no
// supabaseClient import (it fails in node). The live probe is reachabilityLive.ts.

/** Probe timeout. Measured online: the health endpoint answered in 0.2 to 0.4 s. */
export const PROBE_TIMEOUT_MS = 4000;
/** How long an ONLINE result may be reused, so screens opening together probe once. */
export const PROBE_CACHE_MS = 5000;
/** Same sentence as classifyError's "offline" kind (a test keeps them equal). */
export const OFFLINE_TEXT = "No internet connection. Check your connection and try again.";

export type RawProbe =
  | { kind: "response"; status: number }
  | { kind: "timeout" }
  | { kind: "error" };

export interface ProbeOutcome {
  state: "online" | "offline";
  reason: "response" | "timeout" | "network_error";
  httpStatus?: number;
  checkedAt: number;
}

/** Any HTTP answer, even 401 or 5xx, proves the server was reached. Only a failed
 *  fetch or a timeout means offline. (A captive portal can still look online.) */
export function interpretProbe(raw: RawProbe, now: number): ProbeOutcome {
  if (raw.kind === "response") {
    return { state: "online", reason: "response", httpStatus: raw.status, checkedAt: now };
  }
  return {
    state: "offline",
    reason: raw.kind === "timeout" ? "timeout" : "network_error",
    checkedAt: now,
  };
}

/** Only an online result is reusable. An offline result is never reused, so
 *  "Try again" always does a real check. A clock that went backwards is not fresh. */
export function isFresh(last: ProbeOutcome | null, now: number, ttlMs: number = PROBE_CACHE_MS): boolean {
  if (!last || last.state !== "online") return false;
  const age = now - last.checkedAt;
  return age >= 0 && age < ttlMs;
}
