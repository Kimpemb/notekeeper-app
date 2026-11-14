// src/features/sync/lib/reviewBadge.ts
//
// Pure rules for the conflict badge in the title bar. No database, no network, no React:
// the component (ConflictBadge.tsx) and the live count (reviewBadgeLive.ts) call these.
//
// Never import supabaseClient from here: it fails in the node test environment.

/** Show the badge only for a signed-in person with at least one note to review. */
export function badgeVisible(signedIn: boolean, count: number): boolean {
  return signedIn && count > 0;
}

/** Pulse when the count goes UP, including the first appearance (null counts as 0). Never on a decrease. */
export function shouldPulse(prev: number | null, next: number): boolean {
  return next > (prev ?? 0);
}

/** Keeps the pill narrow: 1 to 9 as is, anything above shows as "9+". */
export function badgeCountText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export function badgeTooltip(count: number): string {
  const what = count === 1 ? "1 note needs review" : `${count} notes need review`;
  return `${what} (changed on both this device and the server). Click to review.`;
}
