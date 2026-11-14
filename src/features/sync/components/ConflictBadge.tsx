// src/features/sync/components/ConflictBadge.tsx
//
// A small amber "refresh" ring in the title bar (left of the window controls) with the number of
// notes that need review inside it. Visible only when signed in and the count is above zero; it disappears the
// moment the last note is resolved. Clicking it opens Settings > Sync > Needs review.
// The ring is the two sync arrows themselves (no separate border). It pulses (twice) each time the
// count goes UP, then stays still. No toast.
//
// The count is local (reviewBadgeLive.ts), refreshed every few seconds and straight after a
// review is applied (ReviewListView calls refreshReviewBadge).

import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { useReviewBadgeStore } from "@/features/sync/store/useReviewBadgeStore";
import { refreshReviewBadge } from "@/features/sync/lib/reviewBadgeLive";
import { badgeCountText, badgeTooltip, badgeVisible, shouldPulse } from "@/features/sync/lib/reviewBadge";

const POLL_MS = 5_000;

// Scoped keyframes (no Tailwind config needed). A round halo grows a little and fades; it stays
// inside the 44 px title bar. Reduced-motion users get no animation.
const PULSE_CSS = `
@keyframes idemora-badge-pulse {
  0%   { transform: scale(1); opacity: 0.8; }
  100% { transform: scale(1.3); opacity: 0; }
}
.idemora-badge-pulse { animation: idemora-badge-pulse 1s ease-out 2; }
@media (prefers-reduced-motion: reduce) { .idemora-badge-pulse { animation: none; } }
`;

export function ConflictBadge() {
  const signedIn = useSyncStore((s) => s.session !== null);
  const count = useReviewBadgeStore((s) => s.count);
  const openSettings = useUIStore((s) => s.openSettings);
  const prevRef = useRef<number | null>(null);
  const [pulseKey, setPulseKey] = useState(0);

  // Keep the count fresh while signed in; clear it when signed out.
  useEffect(() => {
    if (!signedIn) {
      useReviewBadgeStore.getState().setCount(0);
      return;
    }
    void refreshReviewBadge();
    const t = setInterval(() => void refreshReviewBadge(), POLL_MS);
    return () => clearInterval(t);
  }, [signedIn]);

  // Pulse only when the count goes up.
  useEffect(() => {
    if (signedIn && shouldPulse(prevRef.current, count)) setPulseKey((k) => k + 1);
    prevRef.current = count;
  }, [count, signedIn]);

  if (!badgeVisible(signedIn, count)) return null;

  const tip = badgeTooltip(count);
  const label = badgeCountText(count);
  return (
    <>
      <style>{PULSE_CSS}</style>
      <button
        type="button"
        onClick={() => openSettings({ section: "sync", view: "review" })}
        title={tip}
        aria-label={tip}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-amber-600 transition-colors duration-150 hover:bg-amber-500/15 dark:text-amber-400"
      >
        {pulseKey > 0 && (
          <span
            key={pulseKey}
            aria-hidden
            className="idemora-badge-pulse pointer-events-none absolute inset-0 rounded-full ring-2 ring-amber-400"
          />
        )}
        {/* The two sync arrows form the ring; the count sits in the middle. */}
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x="12"
            y="12.4"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={label.length > 1 ? 7.5 : 10}
            fontWeight="700"
            fill="currentColor"
          >
            {label}
          </text>
        </svg>
      </button>
    </>
  );
}
