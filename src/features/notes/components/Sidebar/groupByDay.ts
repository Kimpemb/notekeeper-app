// src/features/notes/components/Sidebar/groupByDay.ts

export interface DayGroup<T> {
  label: string;
  items: T[];
}

// updatedAt may be in seconds or milliseconds; values below 1e11 are seconds.
function toMs(t: number): number {
  return t < 1e11 ? t * 1000 : t;
}

/** Short stamp for a row: a time for Today/Yesterday, otherwise a short date. */
export function formatActivity(updatedAt: number, groupLabel: string): string {
  const date = new Date(toMs(updatedAt));
  if (groupLabel === "Today" || groupLabel === "Yesterday") {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Groups items by calendar day of last activity (local time), newest first.
 *  Today, Yesterday, Previous 7 days, Previous 30 days, then one group per month
 *  of the current year, then one group per earlier year. Empty groups are not returned. */
export function groupByDay<T extends { updatedAt: number }>(
  items: T[],
  now: Date = new Date(),
): DayGroup<T>[] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const todayStart     = new Date(y, m, d).getTime();
  const yesterdayStart = new Date(y, m, d - 1).getTime();
  const sevenStart     = new Date(y, m, d - 7).getTime();
  const thirtyStart    = new Date(y, m, d - 30).getTime();

  const labelFor = (ms: number): string => {
    if (ms >= todayStart)     return "Today"; // also covers timestamps slightly in the future
    if (ms >= yesterdayStart) return "Yesterday";
    if (ms >= sevenStart)     return "Previous 7 days";
    if (ms >= thirtyStart)    return "Previous 30 days";
    const date = new Date(ms);
    if (date.getFullYear() === y) {
      return date.toLocaleString("en-US", { month: "long", year: "numeric" });
    }
    return String(date.getFullYear());
  };

  const sorted = [...items].sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt));
  const groups: DayGroup<T>[] = [];
  for (const item of sorted) {
    const label = labelFor(toMs(item.updatedAt));
    const last  = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}