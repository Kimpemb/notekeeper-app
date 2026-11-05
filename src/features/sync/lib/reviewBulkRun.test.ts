// src/features/sync/lib/reviewBulkRun.test.ts

import { describe, it, expect } from "vitest";
import { runBulk } from "@/features/sync/lib/reviewBulkRun";
import type { ReviewCandidate } from "@/features/sync/lib/reviewCandidates";
import type { BulkOutcomeLike } from "@/features/sync/lib/reviewList";

const row = (id: string): ReviewCandidate => ({
  noteId: id,
  kind: "content_conflict",
  title: id,
  reason: null,
  localRevision: 1,
  hostedRevision: 2,
  detectedAt: 1,
});
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`n${i + 1}`));
const ok: BulkOutcomeLike = { status: "committed" };

describe("runBulk", () => {
  it("runs every row in order and reports each outcome", async () => {
    const order: string[] = [];
    const r = await runBulk(rows(3), async (x) => {
      order.push(x.noteId);
      return ok;
    });
    expect(order).toEqual(["n1", "n2", "n3"]);
    expect(r.outcomes.map((o) => o.noteId)).toEqual(["n1", "n2", "n3"]);
    expect(r.stoppedBy).toBeNull();
  });

  it("runs strictly one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runBulk(rows(4), async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return ok;
    });
    expect(maxInFlight).toBe(1);
  });

  it("an empty list runs nothing", async () => {
    let calls = 0;
    const r = await runBulk([], async () => {
      calls++;
      return ok;
    });
    expect(calls).toBe(0);
    expect(r).toEqual({ outcomes: [], stoppedBy: null });
  });

  it("a throw becomes a failed outcome and the run carries on", async () => {
    const r = await runBulk(rows(3), async (x) => {
      if (x.noteId === "n2") throw new Error("disk full");
      return ok;
    });
    expect(r.outcomes.map((o) => o.outcome.status)).toEqual(["committed", "local_failed", "committed"]);
    expect(r.outcomes[1].outcome.reason).toBe("disk full");
    expect(r.stoppedBy).toBeNull();
  });

  it("reports progress after each note", async () => {
    const seen: Array<[number, number]> = [];
    await runBulk(rows(3), async () => ok, { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});

describe("runBulk — stopping", () => {
  it("stops at once when signed out", async () => {
    let calls = 0;
    const r = await runBulk(rows(5), async () => {
      calls++;
      return calls === 2 ? { status: "refused", reason: "signed_out" } : ok;
    });
    expect(calls).toBe(2);
    expect(r.stoppedBy).toBe("signed_out");
    expect(r.outcomes).toHaveLength(2);
  });

  it("a refusal for another reason does not stop the run", async () => {
    const r = await runBulk(rows(3), async (x) => (x.noteId === "n1" ? { status: "refused", reason: "busy" } : ok));
    expect(r.outcomes).toHaveLength(3);
    expect(r.stoppedBy).toBeNull();
  });

  it("stops after two network errors in a row", async () => {
    let calls = 0;
    const r = await runBulk(rows(6), async () => {
      calls++;
      return calls >= 3 ? { status: "network_error" } : ok;
    });
    expect(calls).toBe(4);
    expect(r.stoppedBy).toBe("network");
  });

  it("one network error between successes does not stop it", async () => {
    const statuses = ["network_error", "committed", "network_error", "committed"];
    let i = 0;
    const r = await runBulk(rows(4), async () => ({ status: statuses[i++] }));
    expect(r.outcomes).toHaveLength(4);
    expect(r.stoppedBy).toBeNull();
  });

  it("cancel stops between notes; the one in flight finishes", async () => {
    let cancelled = false;
    let calls = 0;
    const r = await runBulk(
      rows(5),
      async () => {
        calls++;
        if (calls === 2) cancelled = true; // cancel pressed while note 2 is committing
        return ok;
      },
      { isCancelled: () => cancelled }
    );
    expect(calls).toBe(2);
    expect(r.outcomes).toHaveLength(2);
    expect(r.stoppedBy).toBe("cancelled");
  });

  it("cancelled before the first note runs nothing", async () => {
    let calls = 0;
    const r = await runBulk(rows(3), async () => {
      calls++;
      return ok;
    }, { isCancelled: () => true });
    expect(calls).toBe(0);
    expect(r.stoppedBy).toBe("cancelled");
  });
});
