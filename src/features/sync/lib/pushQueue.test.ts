// src/features/sync/lib/pushQueue.test.ts
import { describe, it, expect, vi } from "vitest";

// pushQueue imports the Tauri-backed DB client; the pure logic under test
// never touches it.
vi.mock("@/features/notes/db/client", () => ({ getDb: vi.fn() }));

import { computeBackoffMs, nextStateAfterFailure, MAX_ATTEMPTS } from "./pushQueue";

describe("computeBackoffMs", () => {
  it("follows 5s, 30s, 2m, 10m, 1h and caps at 1h", () => {
    expect([1, 2, 3, 4, 5].map(computeBackoffMs)).toEqual([
      5_000, 30_000, 120_000, 600_000, 3_600_000,
    ]);
    expect(computeBackoffMs(6)).toBe(3_600_000);
    expect(computeBackoffMs(50)).toBe(3_600_000);
  });

  it("treats attempts below 1 as the first attempt", () => {
    expect(computeBackoffMs(0)).toBe(5_000);
  });
});

describe("nextStateAfterFailure", () => {
  const now = 1_000_000;

  it("first failure of a note → pending, attempt 1, retry in 5s", () => {
    expect(nextStateAfterFailure(null, false, now)).toEqual({
      state: "pending",
      attempts: 1,
      nextRetryAt: now + 5_000,
    });
  });

  it("a failed retry increments attempts and backs off further", () => {
    expect(nextStateAfterFailure({ state: "pending", attempts: 2 }, true, now)).toEqual({
      state: "pending",
      attempts: 3,
      nextRetryAt: now + 120_000,
    });
  });

  it("parks once attempts reach MAX_ATTEMPTS, with no next retry", () => {
    const r = nextStateAfterFailure(
      { state: "pending", attempts: MAX_ATTEMPTS - 1 },
      true,
      now
    );
    expect(r).toEqual({ state: "parked_max_attempts", attempts: MAX_ATTEMPTS, nextRetryAt: null });
  });

  it("a fresh save failure restarts the count (also un-parks)", () => {
    expect(
      nextStateAfterFailure({ state: "parked_max_attempts", attempts: MAX_ATTEMPTS }, false, now)
    ).toEqual({ state: "pending", attempts: 1, nextRetryAt: now + 5_000 });
  });

  it("an existing remote_ahead row is sticky — failures leave it alone", () => {
    expect(nextStateAfterFailure({ state: "remote_ahead", attempts: 0 }, true, now)).toBeNull();
    expect(nextStateAfterFailure({ state: "remote_ahead", attempts: 0 }, false, now)).toBeNull();
  });
});
