// src/features/sync/lib/diagnostics.ts
//
// Stage 4d.3, step 14, Phase B2.3 - PURE builder for the "Copy diagnostics" text.
// No DB, no network, no React, no store imports (so it never reaches supabaseClient
// and runs in the node test environment). The live half is diagnosticsLive.ts.
//
// Privacy rule: the output holds numbers, short status words and the first 8
// characters of a note id. NEVER note text, titles, tags or parent names. The
// builder only reads the fields listed below, so a caller that passes more
// (by mistake) still leaks nothing. Every free-text value goes through token().

export interface DiagnosticsReviewInput {
  mode: string;
  baseKind: string;
  counts: { auto: number; pending: number; resolved: number; conflicts: number; unchanged: number };
  mapSizes: { base: number | null; theirs: number; mine: number };
  /** Gate reason codes only (for example "container_differs"); empty when the gate passed. */
  gateReasons: string[];
}

export interface DiagnosticsSyncInput {
  localRevision: number | null;
  localMetaRev: number | null;
  syncedLocalRevision: number | null;
  syncedServerRevision: number | null;
  syncedMetaRev: number | null;
  hostedRevision: number | null;
  hostedPurged: boolean | null;
  queueState: string | null;
  queueReason: string | null;
  queueLocalRevision: number | null;
  queueRemoteRevision: number | null;
}

export interface DiagnosticsOutcomeInput {
  status: string;
  reason?: string;
  variant?: string;
  choice?: string;
  maybeApplied?: boolean;
  hosted?: string;
}

export interface DiagnosticsQueueCounts {
  pending: number;
  parked: number;
  remoteAhead: number;
}

export interface DiagnosticsInput {
  generatedAt: number;
  app: { version: string | null; migrationCount: number | null };
  noteId?: string | null;
  review?: DiagnosticsReviewInput | null;
  sync?: DiagnosticsSyncInput | null;
  outcome?: DiagnosticsOutcomeInput | null;
  queueCounts?: DiagnosticsQueueCounts | null;
  /** Short labels for reads that failed while collecting (for example "hosted read failed"). */
  collectErrors?: string[];
}

const NA = "n/a";

/** Keeps a short, plain token: letters, digits and a few separators, at most 80 characters. */
export function token(value: unknown): string {
  if (value === null || value === undefined) return NA;
  const s = String(value)
    .replace(/[^A-Za-z0-9 _.:,\-()/>=<]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return s === "" ? NA : s;
}

function num(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : NA;
}

function yesNo(value: boolean | null | undefined): string {
  return value === true ? "yes" : value === false ? "no" : NA;
}

function diff(a: number | null, b: number | null): string {
  return typeof a === "number" && typeof b === "number" ? String(a - b) : NA;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || NA : NA;
}

export function buildDiagnostics(input: DiagnosticsInput): string {
  const lines: string[] = [];
  const add = (k: string, v: string) => lines.push(`${k}: ${v}`);
  const section = (name: string) => {
    if (lines.length > 0) lines.push("");
    lines.push(`[${name}]`);
  };

  section("app");
  add("generated_at_utc", Number.isFinite(input.generatedAt) ? new Date(input.generatedAt).toISOString() : NA);
  add("app_version", token(input.app.version));
  add("schema_statements", num(input.app.migrationCount));

  if (input.noteId !== undefined) {
    section("note");
    add("note_id8", shortId(input.noteId));
  }

  if (input.sync) {
    const s = input.sync;
    section("sync_state");
    add("local_revision", num(s.localRevision));
    add("local_meta_rev", num(s.localMetaRev));
    add("synced_local_revision", num(s.syncedLocalRevision));
    add("synced_server_revision", num(s.syncedServerRevision));
    add("synced_meta_rev", num(s.syncedMetaRev));
    add("hosted_revision", num(s.hostedRevision));
    add("hosted_purged", yesNo(s.hostedPurged));
    add("local_minus_synced_local", diff(s.localRevision, s.syncedLocalRevision));
    add("hosted_minus_synced_server", diff(s.hostedRevision, s.syncedServerRevision));
    add("meta_rev_minus_synced", diff(s.localMetaRev, s.syncedMetaRev));
    add("queue_state", token(s.queueState));
    add("queue_reason", token(s.queueReason));
    add("queue_local_revision", num(s.queueLocalRevision));
    add("queue_remote_revision", num(s.queueRemoteRevision));
  }

  if (input.review) {
    const r = input.review;
    section("review");
    add("mode", token(r.mode));
    add("base_kind", token(r.baseKind));
    add("gate", r.gateReasons.length === 0 ? "passed" : `tripped (${r.gateReasons.map(token).join(", ")})`);
    add("blocks_automatic", num(r.counts.auto));
    add("blocks_pending", num(r.counts.pending));
    add("blocks_resolved", num(r.counts.resolved));
    add("blocks_conflicts", num(r.counts.conflicts));
    add("blocks_unchanged", num(r.counts.unchanged));
    add("map_size_base", num(r.mapSizes.base));
    add("map_size_theirs", num(r.mapSizes.theirs));
    add("map_size_mine", num(r.mapSizes.mine));
  }

  if (input.outcome) {
    const o = input.outcome;
    section("last_outcome");
    add("status", token(o.status));
    add("reason", token(o.reason));
    add("variant", token(o.variant));
    add("choice", token(o.choice));
    add("hosted", token(o.hosted));
    add("maybe_applied", yesNo(o.maybeApplied ?? null));
  }

  if (input.queueCounts) {
    const q = input.queueCounts;
    section("queue");
    add("retrying", num(q.pending));
    add("parked", num(q.parked));
    add("newer_on_server", num(q.remoteAhead));
  }

  if (input.collectErrors && input.collectErrors.length > 0) {
    section("collect_errors");
    for (const e of input.collectErrors) lines.push(`- ${token(e)}`);
  }

  return lines.join("\n");
}
