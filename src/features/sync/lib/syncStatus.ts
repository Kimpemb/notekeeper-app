// src/features/sync/lib/syncStatus.ts
//
// Step 5 (sync UI/UX refactor), slice 1. PURE: turns the numbers the Sync screen already
// has (queue counts, review count) into ONE plain sentence and a tone. No imports, so it
// runs in node tests. Priority: stuck changes, then notes to review, then waiting changes,
// then "up to date". "Checking" only while nothing has loaded yet.

export interface StatusQueue {
  pending: number;
  parked: number;
  remoteAhead: number;
}

export interface StatusReview {
  count: number;
  /** true when the server could not be asked, so the count may be wrong */
  unchecked: boolean;
}

export type StatusTone = "ok" | "info" | "warn";

export interface SyncStatus {
  tone: StatusTone;
  text: string;
}

export function syncStatus(input: { queue: StatusQueue | null; review: StatusReview | null }): SyncStatus {
  const { queue, review } = input;

  const parked = queue?.parked ?? 0;
  if (parked > 0) {
    return {
      tone: "warn",
      text:
        parked === 1
          ? "1 change could not be sent after several tries."
          : `${parked} changes could not be sent after several tries.`,
    };
  }

  const reviewCount = review?.count ?? 0;
  if (reviewCount > 0) {
    const n = reviewCount;
    return {
      tone: "warn",
      text: review?.unchecked
        ? `${n} ${n === 1 ? "note" : "notes"} may need review. The server cannot be reached.`
        : `${n} ${n === 1 ? "note needs" : "notes need"} your review.`,
    };
  }

  if (!queue) return { tone: "info", text: "Checking sync status…" };

  if (queue.pending > 0) {
    const n = queue.pending;
    return {
      tone: "info",
      text: `${n} ${n === 1 ? "change is" : "changes are"} waiting to send. Retrying automatically.`,
    };
  }

  return { tone: "ok", text: "Everything is up to date." };
}
