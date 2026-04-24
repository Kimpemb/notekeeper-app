// src/features/ai/lib/debugLog.ts
//
// Lightweight local debug log for AI call sites.
// Every call through client.ts writes one entry here.
// Readable from Advanced AI Settings for power users.
//
// Design constraints:
//   - In-memory only — no SQLite, no persistence across sessions
//   - Capped at MAX_ENTRIES; oldest entries are dropped automatically
//   - Zero dependencies — no store imports, no async
//   - Safe to call from any context (primary tick, processing tick, indexer)

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogSlot = "primary" | "processing" | "embedding";

export type LogOutcome = "ok" | "error";

export interface DebugLogEntry {
  id:           number;          // monotonically increasing, for stable list keys
  timestamp:    number;          // Date.now() at call start
  slot:         LogSlot;         // which slot fired
  provider:     string;          // e.g. "claude", "gemini"
  model:        string;          // exact model string used
  inputTokens:  number;          // 0 if not reported by provider or if embed
  outputTokens: number;          // 0 for embed calls
  latencyMs:    number;          // wall time from request start to response
  outcome:      LogOutcome;
  errorCode?:   string;          // set when outcome === "error"
  errorMessage?: string;         // human-readable, set when outcome === "error"
}

// ─── State ────────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 500;

let entries: DebugLogEntry[] = [];
let nextId  = 1;

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Append a successful call entry.
 * Called by client.ts after each resolved provider call.
 */
export function logCallOk(params: {
  slot:         LogSlot;
  provider:     string;
  model:        string;
  inputTokens:  number;
  outputTokens: number;
  latencyMs:    number;
}): void {
  push({
    ...params,
    outcome: "ok",
  });
}

/**
 * Append a failed call entry.
 * Called by client.ts inside catch blocks, after error normalisation.
 */
export function logCallError(params: {
  slot:         LogSlot;
  provider:     string;
  model:        string;
  latencyMs:    number;
  errorCode:    string;
  errorMessage: string;
}): void {
  push({
    slot:         params.slot,
    provider:     params.provider,
    model:        params.model,
    inputTokens:  0,
    outputTokens: 0,
    latencyMs:    params.latencyMs,
    outcome:      "error",
    errorCode:    params.errorCode,
    errorMessage: params.errorMessage,
  });
}

function push(fields: Omit<DebugLogEntry, "id" | "timestamp">): void {
  const entry: DebugLogEntry = {
    id:        nextId++,
    timestamp: Date.now(),
    ...fields,
  };

  entries.push(entry);

  // Drop oldest entries when cap is exceeded
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }

  notifyListeners(entry);
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Return all log entries, newest first.
 * Used by Advanced AI Settings to render the debug table.
 */
export function getLogs(): DebugLogEntry[] {
  return [...entries].reverse();
}

/**
 * Return only entries for a specific slot.
 */
export function getLogsBySlot(slot: LogSlot): DebugLogEntry[] {
  return entries.filter((e) => e.slot === slot).reverse();
}

/**
 * Return a simple summary — useful for the settings panel headline numbers.
 */
export function getLogSummary(): {
  totalCalls:   number;
  errorCount:   number;
  primaryCalls: number;
  processingCalls: number;
  embeddingCalls:  number;
  oldestEntry:  number | null;  // timestamp
} {
  return {
    totalCalls:      entries.length,
    errorCount:      entries.filter((e) => e.outcome === "error").length,
    primaryCalls:    entries.filter((e) => e.slot === "primary").length,
    processingCalls: entries.filter((e) => e.slot === "processing").length,
    embeddingCalls:  entries.filter((e) => e.slot === "embedding").length,
    oldestEntry:     entries[0]?.timestamp ?? null,
  };
}

/**
 * Clear all entries. Exposed in Advanced AI Settings.
 */
export function clearLogs(): void {
  entries = [];
  nextId  = 1;
  notifyListeners(null);
}

// ─── Subscriptions ────────────────────────────────────────────────────────────
// Lightweight pub/sub so the settings panel can react without polling.
// Passes the new entry on append, or null on clearLogs().

type LogListener = (entry: DebugLogEntry | null) => void;
const listeners = new Set<LogListener>();

export function subscribeToDebugLog(fn: LogListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners(entry: DebugLogEntry | null): void {
  for (const fn of listeners) fn(entry);
}