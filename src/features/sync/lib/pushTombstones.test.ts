// src/features/sync/lib/pushTombstones.test.ts
import { describe, it, expect } from "vitest";
import { planTombstoneWork, type TombstoneRow } from "./tombstonePlan";
import type { HostedRowInfo } from "./deleteDecision";

const t = (noteId: string, serverRevision: number, state: TombstoneRow["state"] = "pending"): TombstoneRow => ({
  noteId,
  serverRevision,
  state,
});
const h = (state: HostedRowInfo["state"], revision: number): HostedRowInfo => ({ state, revision });

describe("planTombstoneWork", () => {
  it("returns one decision per tombstone, in order", () => {
    const plan = planTombstoneWork(
      [t("a", 3), t("b", 3), t("c", 3), t("d", 3), t("e", 3, "conflict")],
      new Set(),
      new Map([
        ["a", h("live", 3)], // unchanged since delete -> purge
        ["b", h("live", 4)], // edited elsewhere -> park
        ["c", h("purged", 4)], // already purged -> clear
        // d: no hosted row -> clear
        ["e", h("live", 3)], // already parked -> noop
      ])
    );
    expect(plan.map((p) => [p.noteId, p.decision.action])).toEqual([
      ["a", "push_purge"],
      ["b", "park_conflict"],
      ["c", "clear_tombstone"],
      ["d", "clear_tombstone"],
      ["e", "noop"],
    ]);
  });

  it("passes the recorded revision to the purge", () => {
    const [p] = planTombstoneWork([t("a", 7)], new Set(), new Map([["a", h("trashed", 7)]]));
    expect(p.decision).toEqual({ action: "push_purge", expectedServerRevision: 7 });
  });

  it("clears the tombstone, and never purges, when the note exists locally again", () => {
    const [p] = planTombstoneWork([t("a", 3)], new Set(["a"]), new Map([["a", h("live", 3)]]));
    expect(p.decision).toEqual({ action: "clear_tombstone", reason: "local_note_exists" });
  });

  it("returns an empty plan for no tombstones", () => {
    expect(planTombstoneWork([], new Set(), new Map())).toEqual([]);
  });
});
