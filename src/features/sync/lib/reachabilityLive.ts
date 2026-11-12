// src/features/sync/lib/reachabilityLive.ts
// Live half: one real request, with a short timeout. Never throws.
import { isSyncConfigured } from "@/features/sync/db/supabaseClient";
import {
  PROBE_TIMEOUT_MS,
  interpretProbe,
  isFresh,
  type ProbeOutcome,
  type RawProbe,
} from "@/features/sync/lib/reachability";

let last: ProbeOutcome | null = null;
let inflight: Promise<ProbeOutcome> | null = null;

async function rawProbe(): Promise<RawProbe> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return { kind: "error" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      signal: controller.signal,
    });
    return { kind: "response", status: res.status };
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    return aborted ? { kind: "timeout" } : { kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is the server reachable right now? Plain fetch, not the Supabase client, so it
 * does not go through the client's auth layer. An online answer is reused for a few
 * seconds; an offline answer never is. Calls made while one is running share it.
 * Pass force to skip the cached online answer (for example before an Apply).
 */
export async function checkReachable(opts?: { force?: boolean }): Promise<ProbeOutcome> {
  if (!isSyncConfigured) return { state: "offline", reason: "network_error", checkedAt: Date.now() };
  if (!opts?.force && isFresh(last, Date.now())) return last as ProbeOutcome;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const outcome = interpretProbe(await rawProbe(), Date.now());
      last = outcome;
      return outcome;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
