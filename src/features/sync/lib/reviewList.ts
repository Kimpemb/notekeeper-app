// src/features/sync/lib/reviewList.ts
//
// Stage 4d.3, step 12 — PURE logic behind the review list screen: filter, sort,
// plain-language labels, which bulk actions are allowed, which rows a bulk run
// may touch, when a bulk run must stop, and the summary text. No DB, no network,
// no store, no React, no import that reaches supabaseClient.
//
// Bulk rules (design, O8): bulk actions only cover what is safe to apply the same
// way everywhere. Block merges have per-item decisions, so they never get one.
// Every bulk commit writes its own backup (that happens in the commit step, one
// note at a time); a bulk run never writes anything itself.

import type { CandidateKind, ReviewCandidate } from "@/features/sync/lib/reviewCandidates";
import type { ReviewMode } from "@/features/sync/lib/reviewAssemble";

// ─── Filter and sort ──────────────────────────────────────────────────────

export type SortKey = "newest" | "oldest" | "title";

export interface ListQuery {
  /** Words that must all appear in the title or the note id (case-insensitive). Empty = no filter. */
  text: string;
  /** Kinds to show; null shows every kind. */
  kinds: ReadonlySet<CandidateKind> | null;
  sort: SortKey;
}

export const DEFAULT_QUERY: ListQuery = { text: "", kinds: null, sort: "newest" };

const byId = (a: ReviewCandidate, b: ReviewCandidate): number => (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0);

export function filterAndSort(candidates: readonly ReviewCandidate[], query: ListQuery): ReviewCandidate[] {
  const words = query.text.toLowerCase().split(/\s+/).filter((w) => w !== "");
  const rows = candidates.filter((c) => {
    if (query.kinds !== null && !query.kinds.has(c.kind)) return false;
    if (words.length === 0) return true;
    const hay = `${c.title ?? ""} ${c.noteId}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });

  return rows.sort((a, b) => {
    switch (query.sort) {
      case "oldest":
        return a.detectedAt - b.detectedAt || byId(a, b);
      case "title": {
        // Untitled rows go last.
        if (a.title === null && b.title !== null) return 1;
        if (a.title !== null && b.title === null) return -1;
        return (a.title ?? "").localeCompare(b.title ?? "") || byId(a, b);
      }
      case "newest":
      default:
        return b.detectedAt - a.detectedAt || byId(a, b);
    }
  });
}

// ─── Labels ───────────────────────────────────────────────────────────────

export function kindLabel(kind: CandidateKind): string {
  switch (kind) {
    case "content_conflict":
      return "Changed on both this device and the server";
    case "purged_elsewhere":
      return "Deleted on another device, but changed here";
    case "deleted_here":
      return "Deleted here, but changed on another device";
    case "hosted_missing":
      return "Missing on the server";
    case "unchecked":
      return "Could not check the server";
  }
}

// ─── Bulk actions ─────────────────────────────────────────────────────────

export type BulkActionId = "d1_keep_it" | "d2_keep_mine" | "whole_keep_mine" | "whole_take_theirs";

export interface BulkOption {
  id: BulkActionId;
  label: string;
  /** Row kind this action applies to. */
  kind: CandidateKind;
  /** Content conflicts only: the row's review must be whole-note mode, checked when the run starts. */
  needsWholeNote: boolean;
}

export const BULK_OPTIONS: readonly BulkOption[] = [
  { id: "d1_keep_it", label: "Restore all (keep the other device's version)", kind: "deleted_here", needsWholeNote: false },
  { id: "d2_keep_mine", label: "Keep mine for all (restore the notes deleted elsewhere)", kind: "purged_elsewhere", needsWholeNote: false },
  { id: "whole_keep_mine", label: "Keep mine for all", kind: "content_conflict", needsWholeNote: true },
  { id: "whole_take_theirs", label: "Take theirs for all", kind: "content_conflict", needsWholeNote: true },
];

export interface BulkAvailability {
  options: BulkOption[];
  /** Why there are no options, in plain language; null when there are some. */
  blockedReason: string | null;
}

export function bulkOptionsFor(selected: readonly ReviewCandidate[]): BulkAvailability {
  if (selected.length === 0) return { options: [], blockedReason: "Select at least one note." };
  const kinds = new Set(selected.map((c) => c.kind));
  if (kinds.size > 1) {
    return { options: [], blockedReason: "Bulk actions need notes of one kind. Filter the list by kind first." };
  }
  const kind = selected[0].kind;
  const options = BULK_OPTIONS.filter((o) => o.kind === kind);
  if (options.length === 0) {
    return { options: [], blockedReason: `${kindLabel(kind)}: there is no bulk action for this kind.` };
  }
  return { options: [...options], blockedReason: null };
}

export type { ReviewMode };

export type SkipReason = "needs_item_review" | "already_identical" | "mode_unknown" | "note_open";

export interface BulkPlan {
  eligible: ReviewCandidate[];
  skipped: Array<{ noteId: string; reason: SkipReason }>;
}

/**
 * Decides which selected rows a bulk run may touch.
 * @param modes   review mode per note id (content conflicts only); null/absent = could not be determined
 * @param openIds notes open in a tab; the commit refuses these, so the run skips them up front
 */
export function planBulk(
  option: BulkOption,
  rows: readonly ReviewCandidate[],
  modes: ReadonlyMap<string, ReviewMode | null>,
  openIds: ReadonlySet<string>
): BulkPlan {
  const eligible: ReviewCandidate[] = [];
  const skipped: BulkPlan["skipped"] = [];
  for (const row of rows) {
    if (row.kind !== option.kind) continue; // defensive: bulkOptionsFor already guarantees one kind
    // A note deleted here has no local note to be open.
    if (option.kind !== "deleted_here" && openIds.has(row.noteId)) {
      skipped.push({ noteId: row.noteId, reason: "note_open" });
      continue;
    }
    if (option.needsWholeNote) {
      const mode = modes.get(row.noteId) ?? null;
      if (mode === null) {
        skipped.push({ noteId: row.noteId, reason: "mode_unknown" });
        continue;
      }
      if (mode === "block") {
        skipped.push({ noteId: row.noteId, reason: "needs_item_review" });
        continue;
      }
      if (mode === "identical") {
        skipped.push({ noteId: row.noteId, reason: "already_identical" });
        continue;
      }
    }
    eligible.push(row);
  }
  return { eligible, skipped };
}

// ─── Stopping a run ───────────────────────────────────────────────────────

export interface BulkOutcomeLike {
  status: string;
  reason?: string;
}

export type BulkStep = "continue" | "stop_signed_out" | "stop_network";

/**
 * Called after each commit with the outcomes so far. A run stops when the session is
 * gone, or after two network errors in a row (the server is not reachable), instead
 * of grinding through the rest and reporting the same failure for every note.
 */
export function nextBulkStep(sofar: readonly BulkOutcomeLike[]): BulkStep {
  const last = sofar[sofar.length - 1];
  if (!last) return "continue";
  if (last.status === "refused" && last.reason === "signed_out") return "stop_signed_out";
  const prev = sofar[sofar.length - 2];
  if (last.status === "network_error" && prev?.status === "network_error") return "stop_network";
  return "continue";
}

// ─── Summary ──────────────────────────────────────────────────────────────

export interface BulkSummary {
  total: number;
  committed: number;
  /** committed on the server but this device could not record it; check these. */
  unrecorded: number;
  /** changed again while the run was going (stale or lost compare-and-swap). */
  changedAgain: number;
  refused: number;
  failed: number;
  skipped: number;
  /** not attempted because the run stopped early. */
  notRun: number;
}

export function summarizeBulk(
  outcomes: readonly BulkOutcomeLike[],
  skippedCount: number,
  plannedCount: number
): BulkSummary {
  const s: BulkSummary = {
    total: plannedCount + skippedCount,
    committed: 0,
    unrecorded: 0,
    changedAgain: 0,
    refused: 0,
    failed: 0,
    skipped: skippedCount,
    notRun: Math.max(0, plannedCount - outcomes.length),
  };
  for (const o of outcomes) {
    switch (o.status) {
      case "committed":
        s.committed++;
        break;
      case "committed_unrecorded":
        s.unrecorded++;
        break;
      case "stale":
      case "push_lost":
        s.changedAgain++;
        break;
      case "refused":
        s.refused++;
        break;
      default:
        // network_error, local_failed, server_won_local_failed, anything new
        s.failed++;
    }
  }
  return s;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function bulkSummaryText(s: BulkSummary): string {
  const parts = [`Done: ${s.committed} of ${plural(s.total, "note", "notes")}.`];
  if (s.changedAgain) parts.push(`${plural(s.changedAgain, "note", "notes")} changed again and ${s.changedAgain === 1 ? "was" : "were"} left alone.`);
  if (s.skipped) parts.push(`${s.skipped} skipped.`);
  if (s.refused) parts.push(`${s.refused} could not start.`);
  if (s.failed) parts.push(`${s.failed} failed.`);
  if (s.unrecorded) parts.push(`${s.unrecorded} need a check: the server took them but this device could not record it.`);
  if (s.notRun) parts.push(`${s.notRun} not attempted because the run stopped early.`);
  return parts.join(" ");
}

export function skipReasonLabel(reason: SkipReason): string {
  switch (reason) {
    case "note_open":
      return "Open in a tab. Close it and try again.";
    case "needs_item_review":
      return "Has items that need your decision. Open it to review.";
    case "already_identical":
      return "Both versions already match. Open it to finish.";
    case "mode_unknown":
      return "Could not be checked. Try again when the server is reachable.";
  }
}

// ─── Confirmation wording ─────────────────────────────────────────────────

export interface ConfirmText {
  title: string;
  body: string;
}

export function bulkConfirmText(option: BulkOption, count: number): ConfirmText {
  const notes = plural(count, "note", "notes");
  switch (option.id) {
    case "d1_keep_it":
      return {
        title: `Restore ${notes}?`,
        body: `${count === 1 ? "It was" : "They were"} deleted on this device but changed on another. ${count === 1 ? "It comes" : "They come"} back here with the other device's version. Nothing on the server changes.`,
      };
    case "d2_keep_mine":
      return {
        title: `Keep your version of ${notes}?`,
        body: `${count === 1 ? "It was" : "They were"} deleted on another device, but you changed ${count === 1 ? "it" : "them"} here. Your version is restored on the server. A backup is saved for each note first.`,
      };
    case "whole_keep_mine":
      return {
        title: `Keep your version of ${notes}?`,
        body: `Your version replaces the other device's version on the server. A backup of both is saved for each note first.`,
      };
    case "whole_take_theirs":
      return {
        title: `Take the other device's version of ${notes}?`,
        body: `The other device's version replaces yours on this device. A backup of both is saved for each note first.`,
      };
  }
}
