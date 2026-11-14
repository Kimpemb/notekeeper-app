// src/features/sync/lib/reviewBadge.test.ts
import { describe, expect, it } from "vitest";
import { badgeCountText, badgeTooltip, badgeVisible, shouldPulse } from "@/features/sync/lib/reviewBadge";

describe("badgeVisible", () => {
  it("shows only when signed in and the count is above zero", () => {
    expect(badgeVisible(true, 1)).toBe(true);
    expect(badgeVisible(true, 12)).toBe(true);
    expect(badgeVisible(true, 0)).toBe(false);
    expect(badgeVisible(false, 3)).toBe(false);
    expect(badgeVisible(false, 0)).toBe(false);
  });
});

describe("shouldPulse", () => {
  it("pulses when the count goes up", () => {
    expect(shouldPulse(0, 1)).toBe(true);
    expect(shouldPulse(1, 2)).toBe(true);
    expect(shouldPulse(3, 9)).toBe(true);
  });
  it("pulses on first appearance (no previous value)", () => {
    expect(shouldPulse(null, 2)).toBe(true);
  });
  it("does not pulse when nothing is there or the count is unchanged", () => {
    expect(shouldPulse(null, 0)).toBe(false);
    expect(shouldPulse(0, 0)).toBe(false);
    expect(shouldPulse(2, 2)).toBe(false);
  });
  it("never pulses on a decrease", () => {
    expect(shouldPulse(3, 2)).toBe(false);
    expect(shouldPulse(1, 0)).toBe(false);
  });
});

describe("badgeCountText", () => {
  it("caps the label at 9+", () => {
    expect(badgeCountText(1)).toBe("1");
    expect(badgeCountText(9)).toBe("9");
    expect(badgeCountText(10)).toBe("9+");
    expect(badgeCountText(250)).toBe("9+");
  });
});

describe("badgeTooltip", () => {
  it("uses singular and plural", () => {
    expect(badgeTooltip(1)).toContain("1 note needs review");
    expect(badgeTooltip(3)).toContain("3 notes need review");
  });
  it("tells the person what a click does", () => {
    expect(badgeTooltip(2)).toContain("Click to review");
  });
});
