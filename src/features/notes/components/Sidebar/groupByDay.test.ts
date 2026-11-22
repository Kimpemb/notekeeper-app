// src/features/notes/components/Sidebar/groupByDay.test.ts
import { describe, expect, it } from "vitest";
import { groupByDay } from "./groupByDay";

const now = new Date(2026, 10, 22, 15, 0); // 22 Nov 2026, 15:00 local
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const labels = (updatedAts: number[]) => groupByDay(updatedAts.map((updatedAt) => ({ updatedAt })), now).map((g) => g.label);

describe("groupByDay", () => {
  it("splits at midnight: Today vs Yesterday", () => {
    expect(labels([at(2026, 10, 22, 0, 30), at(2026, 10, 21, 23, 59)])).toEqual(["Today", "Yesterday"]);
  });

  it("uses calendar-day cutoffs for 7 and 30 days", () => {
    expect(labels([at(2026, 10, 15, 0, 0), at(2026, 10, 14, 23, 59)])).toEqual(["Previous 7 days", "Previous 30 days"]);
    expect(labels([at(2026, 9, 23, 0, 0), at(2026, 9, 22, 23, 59)])).toEqual(["Previous 30 days", "October 2026"]);
  });

  it("names months this year and years before", () => {
    expect(labels([at(2026, 8, 5), at(2025, 11, 20)])).toEqual(["September 2026", "2025"]);
  });

  it("accepts timestamps in seconds", () => {
    expect(labels([Math.floor(at(2026, 10, 22, 9) / 1000)])).toEqual(["Today"]);
  });

  it("puts newest first inside a group and hides empty groups", () => {
    const groups = groupByDay(
      [{ updatedAt: at(2026, 10, 22, 8) }, { updatedAt: at(2026, 10, 22, 14) }],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.updatedAt)).toEqual([at(2026, 10, 22, 14), at(2026, 10, 22, 8)]);
    expect(groupByDay([], now)).toEqual([]);
  });
});