// src/features/sync/lib/noteLock.test.ts
import { describe, it, expect } from "vitest";
import { tryLockNote, noteLockHolder } from "./noteLock";

describe("noteLock", () => {
  it("grants the lock once per note and reports the holder", () => {
    const release = tryLockNote("a", "push");
    expect(release).not.toBeNull();
    expect(noteLockHolder("a")).toBe("push");
    expect(tryLockNote("a", "pull")).toBeNull();
    release!();
    expect(noteLockHolder("a")).toBeNull();
  });

  it("locks are per note", () => {
    const a = tryLockNote("a2", "push");
    const b = tryLockNote("b2", "pull");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    a!();
    b!();
  });

  it("release is idempotent and never frees a newer hold", () => {
    const first = tryLockNote("c", "push")!;
    first();
    const second = tryLockNote("c", "pull")!;
    first(); // stale release must not free the second hold
    expect(noteLockHolder("c")).toBe("pull");
    expect(tryLockNote("c", "push")).toBeNull();
    second();
    expect(noteLockHolder("c")).toBeNull();
  });
});