// src/features/sync/lib/diagnosticsLive.ts
//
// Stage 4d.3, step 14, Phase B2.3 - the live half of "Copy diagnostics". Reads the
// numbers (local row, sync state, queue row, hosted revision), hands them to the pure
// buildDiagnostics (diagnostics.ts), and copies the text. READ-ONLY: it writes nothing
// to the database or to the server. It never throws: a failed read becomes a line in
// the "collect_errors" section.
//
// Never import this file from a test: it reaches supabaseClient.

import { getVersion } from "@tauri-apps/api/app";
import { getDb } from "@/features/notes/db/client";
import { ALL_MIGRATIONS } from "@/features/notes/db/schema";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { getSyncState } from "@/features/sync/lib/noteSyncState";
import { getQueueCounts } from "@/features/sync/lib/pushQueue";
import {
  buildDiagnostics,
  type DiagnosticsOutcomeInput,
  type DiagnosticsReviewInput,
  type DiagnosticsSyncInput,
} from "@/features/sync/lib/diagnostics";

/** Loose shape of a review (SyncReviewData fits it); only these fields are read. */
export interface ReviewLike {
  mode: string;
  baseKind: string;
  counts: DiagnosticsReviewInput["counts"];
  mapSizes: DiagnosticsReviewInput["mapSizes"];
  gate: { ok: true } | { ok: false; reasons: Array<{ code: string }> };
}

/** Loose shape of a commit outcome (OutcomeLike fits it). */
export interface OutcomeShape {
  status: string;
  reason?: string;
  variant?: string;
  choice?: string;
  maybeApplied?: boolean;
  hosted?: string;
}

export interface CollectOptions {
  noteId?: string | null;
  review?: ReviewLike | null;
  outcome?: OutcomeShape | null;
}

interface LocalRow {
  revision: number;
  meta_rev: number;
}

interface QueueRow {
  state: string;
  reason: string | null;
  local_revision: number | null;
  remote_revision: number | null;
}

function reviewInput(r: ReviewLike): DiagnosticsReviewInput {
  return {
    mode: r.mode,
    baseKind: r.baseKind,
    counts: r.counts,
    mapSizes: r.mapSizes,
    gateReasons: r.gate.ok ? [] : r.gate.reasons.map((x) => x.code),
  };
}

function outcomeInput(o: OutcomeShape): DiagnosticsOutcomeInput {
  return {
    status: o.status,
    reason: o.reason,
    variant: o.variant,
    choice: o.choice,
    maybeApplied: o.maybeApplied,
    hosted: o.hosted,
  };
}

export async function collectDiagnostics(opts: CollectOptions = {}): Promise<string> {
  const errors: string[] = [];

  let version: string | null = null;
  try {
    version = await getVersion();
  } catch {
    errors.push("app version unavailable");
  }

  let queueCounts = null;
  try {
    queueCounts = await getQueueCounts();
  } catch {
    errors.push("queue counts read failed");
  }

  let sync: DiagnosticsSyncInput | null = null;
  const noteId = opts.noteId ?? null;
  if (noteId) {
    sync = {
      localRevision: null,
      localMetaRev: null,
      syncedLocalRevision: null,
      syncedServerRevision: null,
      syncedMetaRev: null,
      hostedRevision: null,
      hostedPurged: null,
      queueState: null,
      queueReason: null,
      queueLocalRevision: null,
      queueRemoteRevision: null,
    };
    try {
      const db = await getDb();
      const local = await db.select<LocalRow[]>(`SELECT revision, meta_rev FROM notes WHERE id = $1`, [noteId]);
      if (local[0]) {
        sync.localRevision = local[0].revision;
        sync.localMetaRev = local[0].meta_rev;
      } else {
        errors.push("note not found on this device");
      }
      const state = await getSyncState(noteId);
      if (state) {
        sync.syncedLocalRevision = state.localRevision;
        sync.syncedServerRevision = state.serverRevision;
        sync.syncedMetaRev = state.metaRev;
      } else {
        errors.push("no sync state for this note");
      }
      const q = await db.select<QueueRow[]>(
        `SELECT state, reason, local_revision, remote_revision FROM sync_push_queue WHERE note_id = $1`,
        [noteId]
      );
      if (q[0]) {
        sync.queueState = q[0].state;
        sync.queueReason = q[0].reason;
        sync.queueLocalRevision = q[0].local_revision;
        sync.queueRemoteRevision = q[0].remote_revision;
      }
    } catch {
      errors.push("local read failed");
    }

    if (useSyncStore.getState().session) {
      try {
        const { data, error } = await supabase
          .from("notes")
          .select("revision, purged_at")
          .eq("id", noteId)
          .maybeSingle();
        if (error) {
          errors.push("hosted read failed");
        } else if (data) {
          const row = data as { revision: number; purged_at: string | null };
          sync.hostedRevision = row.revision;
          sync.hostedPurged = row.purged_at != null;
        } else {
          errors.push("note not found on the server");
        }
      } catch {
        errors.push("hosted read failed");
      }
    } else {
      errors.push("signed out, hosted revision skipped");
    }
  }

  return buildDiagnostics({
    generatedAt: Date.now(),
    app: { version, migrationCount: ALL_MIGRATIONS.length },
    noteId: opts.noteId === undefined ? undefined : noteId,
    review: opts.review ? reviewInput(opts.review) : null,
    sync,
    outcome: opts.outcome ? outcomeInput(opts.outcome) : null,
    queueCounts,
    collectErrors: errors,
  });
}

/** Copies the text. Returns false when the clipboard is not available (the caller then shows the text). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
