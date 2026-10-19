// src/features/sync/lib/formatDownloadSummary.ts
//
// Stage 4d.5 UI — turns a DownloadSummary into display text. Pure, so it is
// unit-tested without React or Tauri.

import type { DownloadSummary } from "@/features/sync/lib/downloadVault";

export interface FormattedDownload {
  headline: string;
  details: string[];
  /** The run finished cleanly: marker is "done", nothing left to do. */
  ok: boolean;
  /** The run left the marker at in_progress; the user should be offered Resume. */
  needsResume: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cancelled, stopped on repeated failures, or finished with failed notes. */
export function downloadNeedsResume(s: DownloadSummary): boolean {
  if (s.stopped === "blocked") return false;
  if (s.stopped === "cancelled" || s.stopped === "too_many_failures") return true;
  return s.failed > 0;
}

export function formatDownloadSummary(s: DownloadSummary): FormattedDownload {
  const needsResume = downloadNeedsResume(s);
  const ok = s.stopped === null && s.failed === 0;

  let headline: string;
  if (s.stopped === "blocked") {
    headline = `Couldn't start the download: ${s.blockedReason ?? "it isn't available right now."}`;
  } else if (s.stopped === "cancelled") {
    headline = `Download cancelled. ${plural(s.inserted, "note", "notes")} downloaded so far.`;
  } else if (s.stopped === "too_many_failures") {
    headline = "Download stopped after repeated failures.";
  } else if (s.failed > 0) {
    headline = `Download finished with ${s.failed} failed.`;
  } else if (s.inserted === 0) {
    headline = "Nothing new to download.";
  } else {
    headline = `Downloaded ${plural(s.inserted, "note", "notes")}.`;
  }

  const details: string[] = [];
  if (s.alreadyLocal > 0) details.push(`${s.alreadyLocal} already on this device`);
  if (s.recovered > 0) details.push(`${s.recovered} finished from an interrupted run`);
  if (s.skippedDeleted > 0) details.push(`${s.skippedDeleted} in the server trash (skipped)`);
  if (s.reparented > 0) {
    details.push(`${s.reparented} placed at the top level (their parent wasn't available)`);
  }
  if (s.starterRemoved > 0) {
    details.push(`${plural(s.starterRemoved, "starter note", "starter notes")} removed`);
  }
  // The headline already states the failure count when the run otherwise finished.
  if (s.failed > 0 && s.stopped !== null) details.push(`${s.failed} failed`);
  if (needsResume) details.push("Resume to download the rest.");
  if (ok && s.inserted > 0) {
    details.push("Search indexing continues in the background, so smart search may take a while to catch up.");
  }

  return { headline, details, ok, needsResume };
}
