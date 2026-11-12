// src/features/sync/lib/classifyError.ts
//
// Stage 4d.3, step 14b (network resilience), batch 1 - PURE error classifier. Turns a
// thrown error into one plain sentence, a "try again" hint, and a short details line
// (the raw text, cleaned and capped) for bug reports. No DB, no network, no React, no
// supabaseClient import, so it runs in the node test environment.
//
// Kinds:
//   timeout  the request was cut off (the 15 s abort in supabaseClient.ts) or timed out.
//            A dead connection usually looks like this too, because fetch hangs until
//            the abort, so the sentence names both possibilities.
//   offline  the request failed at once (no route, DNS, refused).
//   server   the server answered with a 5xx or asked us to slow down.
//   auth     signed out, expired session, or a permission refusal.
//   unknown  anything else.
//
// Order matters: server, then timeout, then offline, then auth. A 504 "gateway
// time-out" is a server problem even though it contains "time-out".

export type ErrorKind = "timeout" | "offline" | "server" | "auth" | "unknown";

/** "load": nothing was written. "apply": a write may have started, so say to check the note. */
export type FailureContext = "load" | "apply" | "other";

export interface ClassifiedError {
  kind: ErrorKind;
  /** One plain sentence plus what to do next. Safe to show as is. */
  text: string;
  /** Raw message, whitespace collapsed, capped at 200 characters. For a "details" line. */
  details: string;
  /** true when trying again is reasonable (a Retry button makes sense). */
  retryable: boolean;
}

const SERVER =
  /(?:status|http|code)\D{0,3}(?:5\d\d|429)|\(5\d\d\)|internal server error|bad gateway|service unavailable|gateway time-?out|too many requests|rate limit/i;
const TIMEOUT = /abort|timed?[ -]?out|timeout|signal is aborted/i;
const OFFLINE =
  /failed to fetch|networkerror|network request failed|network error|load failed|err_internet|err_network|err_name_not_resolved|\boffline\b|no internet|fetch failed \(\)|getaddrinfo|enotfound|econnrefused|econnreset/i;
const AUTH =
  /(?:status|http|code)\D{0,3}40[13]|\(40[13]\)|\bjwt\b|not authenticated|invalid (?:token|login|refresh)|session (?:expired|missing)|signed out|permission denied|row-level security/i;

const WHAT: Record<ErrorKind, string> = {
  timeout: "The server did not answer in time.",
  offline: "No internet connection.",
  server: "The server had a problem.",
  auth: "You are signed out, or your session expired.",
  unknown: "Something unexpected went wrong.",
};

const HINT: Record<ErrorKind, string> = {
  timeout: "Check your connection and try again.",
  offline: "Check your connection and try again.",
  server: "Try again in a moment.",
  auth: "Sign in again, then try again.",
  unknown: "Try again.",
};

const RETRYABLE: Record<ErrorKind, boolean> = {
  timeout: true,
  offline: true,
  server: true,
  auth: false,
  unknown: true,
};

export function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return String(err);
  } catch {
    return "Error";
  }
}

export function classifyKind(raw: string): ErrorKind {
  if (SERVER.test(raw)) return "server";
  if (TIMEOUT.test(raw)) return "timeout";
  if (OFFLINE.test(raw)) return "offline";
  if (AUTH.test(raw)) return "auth";
  return "unknown";
}

export function classifyError(err: unknown, context: FailureContext = "other"): ClassifiedError {
  const raw = rawMessage(err);
  const kind = classifyKind(raw);
  const details = raw.replace(/\s+/g, " ").trim().slice(0, 200) || "n/a";
  // A write may have started when an apply threw, so the user must be told to look.
  const applyHint =
    kind === "auth"
      ? "Sign in again, then check the note before trying again."
      : "Check the note before trying again.";
  const hint = context === "apply" ? applyHint : HINT[kind];
  return { kind, text: `${WHAT[kind]} ${hint}`, details, retryable: RETRYABLE[kind] };
}
