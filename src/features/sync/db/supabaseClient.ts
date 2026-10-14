// src/features/sync/db/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * False when env vars didn't reach Vite. Idemora must stay fully usable
 * offline/unauthenticated, so a missing config disables sync instead of
 * crashing the app at import time (createClient throws on an empty URL).
 */
export const isSyncConfigured = Boolean(envUrl && envKey);

if (!isSyncConfigured) {
  console.warn(
    "[sync] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — sync disabled. " +
      "VITE_ keys Vite actually saw:",
    Object.keys(import.meta.env).filter((k) => k.startsWith("VITE_"))
  );
}

// A dead network can leave fetch hanging forever, which would wedge the push
// path (inFlight / draining never clear). Fail fast so it lands in the queue.
const FETCH_TIMEOUT_MS = 15_000;
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  init?.signal?.addEventListener("abort", () => controller.abort());
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
};

// Placeholders only exist so createClient() doesn't throw when unconfigured.
// Nothing calls the network while isSyncConfigured is false (see useSyncStore).
export const supabase = createClient(
  envUrl || "https://placeholder.invalid",
  envKey || "placeholder-key",
  {
    global: { fetch: fetchWithTimeout },
    auth: {
      persistSession: isSyncConfigured,
      autoRefreshToken: isSyncConfigured,
      // Tauri's webview supports localStorage. If session restoration turns
      // out flaky in the packaged app (not just `tauri dev`), look here first.
      storage: window.localStorage,
    },
  }
);