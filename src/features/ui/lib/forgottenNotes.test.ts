// src/features/ui/lib/forgottenNotes.test.ts
import { describe, it, expect } from "vitest";
import { pickForgottenNote, daysSince, DAY_MS } from "./forgottenNotes";

const NOW = 1_000_000_000_000;
const notes = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("pickForgottenNote", () => {
  it("returns null when there are no candidates", () => {
    expect(pickForgottenNote([], {}, NOW)).toBeNull();
  });

  it("skips snoozed notes", () => {
    const snoozed = { a: NOW + DAY_MS, b: NOW + DAY_MS };
    expect(pickForgottenNote(notes, snoozed, NOW, () => 0)?.id).toBe("c");
  });

  it("allows a note again once its snooze has expired", () => {
    const snoozed = { a: NOW - 1 };
    expect(pickForgottenNote([{ id: "a" }], snoozed, NOW)?.id).toBe("a");
  });

  it("returns null when every candidate is snoozed", () => {
    const snoozed = { a: NOW + 1, b: NOW + 1, c: NOW + 1 };
    expect(pickForgottenNote(notes, snoozed, NOW)).toBeNull();
  });

  it("stays in range when random() returns just under 1", () => {
    expect(pickForgottenNote(notes, {}, NOW, () => 0.999999)?.id).toBe("c");
  });
});

describe("daysSince", () => {
  it("counts whole days", () => {
    expect(daysSince(NOW - 31.9 * DAY_MS, NOW)).toBe(31);
  });

  it("is never negative", () => {
    expect(daysSince(NOW + DAY_MS, NOW)).toBe(0);
  });
});
