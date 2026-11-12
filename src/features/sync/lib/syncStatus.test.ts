// src/features/sync/lib/syncStatus.test.ts
import { describe, it, expect } from "vitest";
import { syncStatus } from "./syncStatus";

const q = (pending = 0, parked = 0, remoteAhead = 0) => ({ pending, parked, remoteAhead });
const r = (count: number, unchecked = false) => ({ count, unchecked });

describe("syncStatus", () => {
  it("says it is checking before anything has loaded", () => {
    expect(syncStatus({ queue: null, review: null })).toEqual({ tone: "info", text: "Checking sync status…" });
  });

  it("is ok when nothing is waiting", () => {
    expect(syncStatus({ queue: q(), review: r(0) })).toEqual({ tone: "ok", text: "Everything is up to date." });
  });

  it("counts waiting changes (plural)", () => {
    expect(syncStatus({ queue: q(3), review: null })).toEqual({
      tone: "info",
      text: "3 changes are waiting to send. Retrying automatically.",
    });
  });

  it("counts waiting changes (singular)", () => {
    expect(syncStatus({ queue: q(1), review: null }).text).toBe(
      "1 change is waiting to send. Retrying automatically."
    );
  });

  it("reports one stuck change", () => {
    expect(syncStatus({ queue: q(0, 1), review: null })).toEqual({
      tone: "warn",
      text: "1 change could not be sent after several tries.",
    });
  });

  it("reports several stuck changes", () => {
    expect(syncStatus({ queue: q(0, 4), review: null }).text).toBe(
      "4 changes could not be sent after several tries."
    );
  });

  it("reports one note to review", () => {
    expect(syncStatus({ queue: q(), review: r(1) })).toEqual({ tone: "warn", text: "1 note needs your review." });
  });

  it("reports several notes to review", () => {
    expect(syncStatus({ queue: q(), review: r(5) }).text).toBe("5 notes need your review.");
  });

  it("says so when the review count could not be checked", () => {
    expect(syncStatus({ queue: q(), review: r(2, true) }).text).toBe(
      "2 notes may need review. The server cannot be reached."
    );
  });

  it("stuck changes come before review", () => {
    expect(syncStatus({ queue: q(0, 2), review: r(3) }).text).toBe(
      "2 changes could not be sent after several tries."
    );
  });

  it("review comes before waiting changes", () => {
    expect(syncStatus({ queue: q(2), review: r(1) }).text).toBe("1 note needs your review.");
  });

  it("shows the review count even before the queue has loaded", () => {
    expect(syncStatus({ queue: null, review: r(1) }).text).toBe("1 note needs your review.");
  });
});
