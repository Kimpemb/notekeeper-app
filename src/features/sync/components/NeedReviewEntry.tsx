// src/features/sync/components/NeedReviewEntry.tsx
//
// Stage 4d.3, step 11 — the "N need review" entry in the Sync panel. Shows nothing
// when nothing needs a decision. With onOpen it is a button (step 12 wires it to
// the review list); without it, plain text.
//
// Step 5 (UI/UX refactor), slice 1: variant "row" renders a whole-row button with a count
// badge and chevron (the Sync screen). The default "link" variant is the old underlined
// line. onCount reports the count to the parent so the status card can use it.
//
// The count comes from listReviewCandidates(), which asks the server, so it is
// polled slowly and re-checked when refreshKey changes (the panel passes the
// queue's "newer on server" count). It never throws; when the server cannot be
// asked the count is shown as "may need review" instead of a wrong label.

import { useEffect, useRef, useState } from "react";
import { listReviewCandidates } from "@/features/sync/lib/reviewCandidatesLive";
import { countByKind } from "@/features/sync/lib/reviewCandidates";
import { CountBadge, SyncIcons, SyncRow } from "@/features/sync/components/SyncRow";

const REFRESH_MS = 30_000;

interface Entry {
  count: number;
  unchecked: boolean;
  purged: number;
}

export interface ReviewCount {
  count: number;
  unchecked: boolean;
}

interface Props {
  onOpen?: () => void;
  /** Changes whenever the panel's queue counts change, to trigger a re-check. */
  refreshKey?: number;
  variant?: "link" | "row";
  /** Called after every successful check (including a count of 0). */
  onCount?: (c: ReviewCount) => void;
}

export function NeedReviewEntry({ onOpen, refreshKey, variant = "link", onCount }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listReviewCandidates()
        .then(({ candidates, hostedChecked }) => {
          if (cancelled) return;
          setEntry({
            count: candidates.length,
            unchecked: !hostedChecked,
            purged: countByKind(candidates).purged_elsewhere,
          });
          onCountRef.current?.({ count: candidates.length, unchecked: !hostedChecked });
        })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshKey]);

  if (!entry || entry.count === 0) return null;

  if (variant === "row") {
    const description = entry.unchecked
      ? "The server cannot be reached, so this count may be out of date."
      : entry.purged > 0
        ? `${entry.purged} deleted on another device but changed here.`
        : "Open the list to decide what to keep.";
    return (
      <div className="mt-3">
        <SyncRow
          icon={SyncIcons.review}
          title={entry.unchecked ? "May need your review" : "Needs your review"}
          description={description}
          badge={<CountBadge count={entry.count} />}
          chevron
          onClick={onOpen}
        />
      </div>
    );
  }

  const label = entry.unchecked
    ? `${entry.count} may need review (cannot reach the server)`
    : `${entry.count} need review`;
  const hint =
    entry.purged > 0 && !entry.unchecked
      ? `${entry.purged} deleted on another device but changed here`
      : undefined;

  return (
    <p className="mt-2 text-xs max-w-64" title={hint}>
      {onOpen ? (
        <button onClick={onOpen} className="underline text-idemora-text-normal">
          {label}
        </button>
      ) : (
        <span className="text-idemora-text-normal">{label}</span>
      )}
    </p>
  );
}
