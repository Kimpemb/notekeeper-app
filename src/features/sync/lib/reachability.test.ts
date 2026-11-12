// src/features/sync/lib/reachability.test.ts
import { describe, it, expect } from "vitest";
import { interpretProbe, isFresh, OFFLINE_TEXT, PROBE_CACHE_MS, PROBE_TIMEOUT_MS, type ProbeOutcome } from "./reachability";
import { classifyError } from "./classifyError";

describe("interpretProbe", () => {
  it("treats a 200 as online", () => {
    expect(interpretProbe({ kind: "response", status: 200 }, 10)).toEqual({
      state: "online", reason: "response", httpStatus: 200, checkedAt: 10,
    });
  });
  it("treats 401 and 503 as online (the server answered)", () => {
    expect(interpretProbe({ kind: "response", status: 401 }, 1).state).toBe("online");
    expect(interpretProbe({ kind: "response", status: 503 }, 1).state).toBe("online");
  });
  it("treats a timeout as offline", () => {
    const r = interpretProbe({ kind: "timeout" }, 5);
    expect(r.state).toBe("offline");
    expect(r.reason).toBe("timeout");
    expect(r.httpStatus).toBeUndefined();
  });
  it("treats a failed fetch as offline", () => {
    const r = interpretProbe({ kind: "error" }, 5);
    expect(r.state).toBe("offline");
    expect(r.reason).toBe("network_error");
  });
});

describe("isFresh", () => {
  const online: ProbeOutcome = { state: "online", reason: "response", httpStatus: 200, checkedAt: 1000 };
  const offline: ProbeOutcome = { state: "offline", reason: "timeout", checkedAt: 1000 };
  it("reuses an online result inside the window", () => {
    expect(isFresh(online, 1000 + PROBE_CACHE_MS - 1)).toBe(true);
  });
  it("does not reuse an online result at or past the window", () => {
    expect(isFresh(online, 1000 + PROBE_CACHE_MS)).toBe(false);
  });
  it("never reuses an offline result", () => {
    expect(isFresh(offline, 1001)).toBe(false);
  });
  it("is not fresh with no previous result", () => {
    expect(isFresh(null, 1000)).toBe(false);
  });
  it("is not fresh if the clock went backwards", () => {
    expect(isFresh(online, 999)).toBe(false);
  });
});

describe("constants", () => {
  it("offline text matches the classifier's offline sentence", () => {
    expect(OFFLINE_TEXT).toBe(classifyError(new TypeError("Failed to fetch"), "load").text);
  });
  it("probe timeout is shorter than the 15 s fetch abort", () => {
    expect(PROBE_TIMEOUT_MS).toBeLessThan(15_000);
  });
});
