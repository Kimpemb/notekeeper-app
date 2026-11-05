// src/features/sync/lib/reviewCandidates.ts
//
// Stage 4d.3, step 11 — PURE classifier behind the "N need review" entry. No DB,
// no network, no store, no import that reaches supabaseClient. The live half
// (reviewCandidatesLive.ts) gathers the inputs and calls this.
//
// Sources of "needs a decision":
//   * queue rows in state 'remote_ahead'   (hosted moved and this device changed too)
//       hosted live      -> content_conflict   (block merge / whole-note / metadata)
//       hosted purged    -> purged_elsewhere   (D2)
//       hosted missing   -> hosted_missing     (nothing reviewable; shown, never hidden)
//   * tombstones in state 'conflict'       (deleted here, hosted moved on)
//       hosted live and past the tombstone -> deleted_here (D1)
//       otherwise                          -> not a candidate: the drain heals it
//                                             (already purged, row missing, or unchanged)
//   * hostedChecked false (offline, signed out, query failed): the rows still appear,
//     as 'unchecked', because a wrong label is worse than an honest one.
// 'pending' and 'parked_max_attempts' queue rows are retry state, not reviews.

export type QueueState = "pending" | "parked_max_attempts" | "remote_ahead";

export interface QueueRowInput {
  noteId: string;
  state: QueueState;
  reason: string | null;
  localRevision: number | null;
  remoteRevision: number | null;
  updatedAt: number;
  localTitle: string | null;
}

export interface TombstoneInput {
  noteId: string;
  state: "pending" | "conflict";
  syncedServerRevision: number;
  deletedAt: number;
}

export interface HostedStatus {
  revision: number;
  purged: boolean;
  title: string;
}

export interface CandidateInput {
  queue: readonly QueueRowInput[];
  tombstones: readonly TombstoneInput[];
  /** Hosted status by note id. With hostedChecked true, an id absent from the map means the hosted row is missing. */
  hosted: ReadonlyMap<string, HostedStatus>;
  hostedChecked: boolean;
}

export type CandidateKind =
  | "content_conflict"
  | "purged_elsewhere"
  | "deleted_here"
  | "hosted_missing"
  | "unchecked";

export interface ReviewCandidate {
  noteId: string;
  kind: CandidateKind;
  /** Local title, or the hosted title for a note deleted here; null when unknown. */
  title: string | null;
  reason: string | null;
  localRevision: number | null;
  hostedRevision: number | null;
  /** ms: when the queue row was last updated, or when the note was deleted here. */
  detectedAt: number;
}

export function classifyCandidates(input: CandidateInput): ReviewCandidate[] {
  const out: ReviewCandidate[] = [];

  for (const q of input.queue) {
    if (q.state !== "remote_ahead") continue;
    const base = {
      noteId: q.noteId,
      title: q.localTitle,
      reason: q.reason,
      localRevision: q.localRevision,
      detectedAt: q.updatedAt,
    };
    if (!input.hostedChecked) {
      out.push({ ...base, kind: "unchecked", hostedRevision: q.remoteRevision });
      continue;
    }
    const h = input.hosted.get(q.noteId);
    if (!h) out.push({ ...base, kind: "hosted_missing", hostedRevision: null });
    else if (h.purged) out.push({ ...base, kind: "purged_elsewhere", hostedRevision: h.revision });
    else out.push({ ...base, kind: "content_conflict", hostedRevision: h.revision });
  }

  for (const t of input.tombstones) {
    if (t.state !== "conflict") continue;
    const base = {
      noteId: t.noteId,
      reason: null,
      localRevision: null,
      detectedAt: t.deletedAt,
    };
    if (!input.hostedChecked) {
      out.push({ ...base, kind: "unchecked", title: null, hostedRevision: null });
      continue;
    }
    const h = input.hosted.get(t.noteId);
    // Mirrors planD1: only a live hosted row that moved past the tombstone is a review.
    if (!h || h.purged || h.revision <= t.syncedServerRevision) continue;
    out.push({ ...base, kind: "deleted_here", title: h.title, hostedRevision: h.revision });
  }

  // Newest first; the note id breaks ties so the order is stable.
  return out.sort((a, b) => b.detectedAt - a.detectedAt || (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0));
}

export function countByKind(candidates: readonly ReviewCandidate[]): Record<CandidateKind, number> {
  const counts: Record<CandidateKind, number> = {
    content_conflict: 0,
    purged_elsewhere: 0,
    deleted_here: 0,
    hosted_missing: 0,
    unchecked: 0,
  };
  for (const c of candidates) counts[c.kind]++;
  return counts;
}
