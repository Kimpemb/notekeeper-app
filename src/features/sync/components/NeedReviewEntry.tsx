// src/features/sync/components/NeedReviewEntry.tsx
//
// Stage 4d.3, step 11 — the "N need review" line in the Sync panel. Shows nothing
// when nothing needs a decision. With onOpen it is a button (step 12 wires it to
// the review list); without it, plain text.
//
// The count comes from listReviewCandidates(), which asks the server, so it is
// polled slowly and re-checked when refreshKey changes (the panel passes the
// queue's "newer on server" count). It never throws; when the server cannot be
// asked the count is shown as "may need review" instead of a wrong label.

import { useEffect, useState } from "react";
import { listReviewCandidates } from "@/features/sync/lib/reviewCandidatesLive";
import { countByKind } from "@/features/sync/lib/reviewCandidates";

const REFRESH_MS = 30_000;

interface Entry {
  count: number;
  unchecked: boolean;
  purged: number;
}

interface Props {
  onOpen?: () => void;
  /** Changes whenever the panel's queue counts change, to trigger a re-check. */
  refreshKey?: number;
}

export function NeedReviewEntry({ onOpen, refreshKey }: Props) {
  const [entry, setEntry] = useState<Entry | null>(null);

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
