// src/features/sync/lib/deleteDecision.test.ts
import { describe, it, expect } from "vitest";
import {
  decideDeleteAction,
  describeDeleteDecision,
  type DeleteInputs,
  type HostedRowInfo,
  type TombstoneInfo,
} from "./deleteDecision";

const hosted = (state: HostedRowInfo["state"], revision = 3): HostedRowInfo => ({ state, revision });
const tomb = (state: TombstoneInfo["state"] = "pending", serverRevision = 3): TombstoneInfo => ({
  state,
  serverRevision,
});

// Local note absent unless a test says otherwise.
const gone = (over: Partial<DeleteInputs> = {}): DeleteInputs => ({
  localPresent: false,
  tombstone: null,
  hasSyncState: false,
  localChanged: false,
  hosted: null,
  ...over,
});
// Local note present, with sync state and unchanged, unless a test says otherwise.
const here = (over: Partial<DeleteInputs> = {}): DeleteInputs => ({
  localPresent: true,
  tombstone: null,
  hasSyncState: true,
  localChanged: false,
  hosted: null,
  ...over,
});

describe("decideDeleteAction — local note absent, no tombstone (new here, rows A and B)", () => {
  it("A: inserts a note that is live on the server", () => {
    expect(decideDeleteAction(gone({ hosted: hosted("live") }))).toEqual({ action: "insert_new", asTrashed: false });
  });

  it("A: inserts a note that is trashed on the server as trashed", () => {
    expect(decideDeleteAction(gone({ hosted: hosted("trashed") }))).toEqual({ action: "insert_new", asTrashed: true });
  });

  it("B: does nothing for a purged hosted row", () => {
    expect(decideDeleteAction(gone({ hosted: hosted("purged") }))).toEqual({ action: "noop", reason: "nothing_to_do" });
  });

  it("does nothing when there is no hosted row either", () => {
    expect(decideDeleteAction(gone())).toEqual({ action: "noop", reason: "nothing_to_do" });
  });

  it("ignores local-only inputs when the local note is absent", () => {
    expect(decideDeleteAction(gone({ hosted: hosted("live"), hasSyncState: true, localChanged: true }))).toEqual({
      action: "insert_new",
      asTrashed: false,
    });
  });
});

describe("decideDeleteAction — deleted here, tombstone present (rows C, D, E, I, J)", () => {
  it("C: pushes the purge when the hosted revision is still the one recorded at delete time", () => {
    expect(decideDeleteAction(gone({ tombstone: tomb("pending", 3), hosted: hosted("live", 3) }))).toEqual({
      action: "push_purge",
      expectedServerRevision: 3,
    });
    expect(decideDeleteAction(gone({ tombstone: tomb("pending", 3), hosted: hosted("trashed", 3) }))).toEqual({
      action: "push_purge",
      expectedServerRevision: 3,
    });
  });

  it("D: parks a conflict when the hosted note moved on after the delete", () => {
    expect(decideDeleteAction(gone({ tombstone: tomb("pending", 3), hosted: hosted("live", 4) }))).toEqual({
      action: "park_conflict",
      reason: "edited_elsewhere",
    });
    expect(decideDeleteAction(gone({ tombstone: tomb("pending", 3), hosted: hosted("trashed", 9) }))).toEqual({
      action: "park_conflict",
      reason: "edited_elsewhere",
    });
  });

  it("parks a conflict when the hosted revision is below the tombstone's (server reset?)", () => {
    expect(decideDeleteAction(gone({ tombstone: tomb("pending", 5), hosted: hosted("live", 2) }))).toEqual({
      action: "park_conflict",
      reason: "server_regressed",
    });
  });

  it("E: clears the tombstone when the hosted row is already purged, whatever its state or revision", () => {
    expect(decideDeleteAction(gone({ tombstone: tomb("pending", 3), hosted: hosted("purged", 4) }))).toEqual({
      action: "clear_tombstone",
      reason: "already_purged",
    });
    expect(decideDeleteAction(gone({ tombstone: tomb("conflict", 3), hosted: hosted("purged", 9) }))).toEqual({
      action: "clear_tombstone",
      reason: "already_purged",
    });
  });

  it("I: leaves a parked (conflict) tombstone alone while the hosted note is live or trashed", () => {
    expect(decideDeleteAction(gone({ tombstone: tomb("conflict", 3), hosted: hosted("live", 3) }))).toEqual({
      action: "noop",
      reason: "already_parked",
    });
    expect(decideDeleteAction(gone({ tombstone: tomb("conflict", 3), hosted: hosted("trashed", 8) }))).toEqual({
      action: "noop",
      reason: "already_parked",
    });
  });

  it("J: clears the tombstone when the hosted row is gone", () => {
    expect(decideDeleteAction(gone({ tombstone: tomb("pending"), hosted: null }))).toEqual({
      action: "clear_tombstone",
      reason: "hosted_missing",
    });
    expect(decideDeleteAction(gone({ tombstone: tomb("conflict"), hosted: null }))).toEqual({
      action: "clear_tombstone",
      reason: "hosted_missing",
    });
  });
});

describe("decideDeleteAction — purged on the server, local note present (rows F and G)", () => {
  it("F: applies the purge locally when the note is unchanged since the last agreement", () => {
    expect(decideDeleteAction(here({ hosted: hosted("purged", 5) }))).toEqual({ action: "apply_purge_local" });
  });

  it("G: parks a conflict when the note changed here after the last agreement", () => {
    expect(decideDeleteAction(here({ hosted: hosted("purged", 5), localChanged: true }))).toEqual({
      action: "park_conflict",
      reason: "edited_here",
    });
  });

  it("parks with no_base, and never deletes, when there is no sync state to judge against", () => {
    expect(decideDeleteAction(here({ hosted: hosted("purged"), hasSyncState: false }))).toEqual({
      action: "park_conflict",
      reason: "no_base",
    });
    expect(decideDeleteAction(here({ hosted: hosted("purged"), hasSyncState: false, localChanged: true }))).toEqual({
      action: "park_conflict",
      reason: "no_base",
    });
  });
});

describe("decideDeleteAction — local note present, not a delete case", () => {
  it("defers a live, trashed or missing hosted row to decideSyncAction", () => {
    for (const h of [hosted("live"), hosted("trashed"), null]) {
      expect(decideDeleteAction(here({ hosted: h }))).toEqual({ action: "defer_to_sync_decision" });
      expect(decideDeleteAction(here({ hosted: h, localChanged: true }))).toEqual({ action: "defer_to_sync_decision" });
    }
  });

  it("clears a stale tombstone when the note exists locally again, whatever the hosted row is", () => {
    for (const h of [hosted("live"), hosted("trashed"), hosted("purged"), null]) {
      expect(decideDeleteAction(here({ tombstone: tomb("pending"), hosted: h }))).toEqual({
        action: "clear_tombstone",
        reason: "local_note_exists",
      });
      expect(decideDeleteAction(here({ tombstone: tomb("conflict"), hosted: h }))).toEqual({
        action: "clear_tombstone",
        reason: "local_note_exists",
      });
    }
  });
});

// Safety properties over every combination of inputs. These are the guarantees
// the delete path must never break, independent of the individual rows above.
describe("decideDeleteAction — safety invariants over all input combinations", () => {
  const hostedOptions: (HostedRowInfo | null)[] = [
    null,
    hosted("live", 2),
    hosted("live", 3),
    hosted("live", 4),
    hosted("trashed", 3),
    hosted("trashed", 4),
    hosted("purged", 3),
  ];
  const tombstoneOptions: (TombstoneInfo | null)[] = [null, tomb("pending", 3), tomb("conflict", 3)];

  const all: DeleteInputs[] = [];
  for (const localPresent of [true, false])
    for (const tombstone of tombstoneOptions)
      for (const hasSyncState of [true, false])
        for (const localChanged of [true, false])
          for (const h of hostedOptions) all.push({ localPresent, tombstone, hasSyncState, localChanged, hosted: h });

  it("covers every combination without throwing", () => {
    expect(all.length).toBe(2 * 3 * 2 * 2 * 7);
    for (const input of all) expect(() => decideDeleteAction(input)).not.toThrow();
  });

  it("never pushes a purge for a note that exists locally, is parked, or has moved on", () => {
    for (const input of all) {
      const d = decideDeleteAction(input);
      if (d.action !== "push_purge") continue;
      expect(input.localPresent).toBe(false);
      expect(input.tombstone?.state).toBe("pending");
      expect(input.hosted && input.hosted.state !== "purged").toBe(true);
      expect(input.hosted?.revision).toBe(input.tombstone?.serverRevision);
      expect(d.expectedServerRevision).toBe(input.tombstone?.serverRevision);
    }
  });

  it("only deletes locally when hosted is purged, a sync base exists, nothing changed here, and no tombstone", () => {
    for (const input of all) {
      const d = decideDeleteAction(input);
      if (d.action !== "apply_purge_local") continue;
      expect(input.localPresent).toBe(true);
      expect(input.tombstone).toBeNull();
      expect(input.hosted?.state).toBe("purged");
      expect(input.hasSyncState).toBe(true);
      expect(input.localChanged).toBe(false);
    }
  });

  it("never re-creates a note that this device deleted or that the server purged", () => {
    for (const input of all) {
      const d = decideDeleteAction(input);
      if (d.action !== "insert_new") continue;
      expect(input.localPresent).toBe(false);
      expect(input.tombstone).toBeNull();
      expect(input.hosted && input.hosted.state !== "purged").toBe(true);
    }
  });

  it("only defers to decideSyncAction when the local note exists and is not purged elsewhere", () => {
    for (const input of all) {
      const d = decideDeleteAction(input);
      if (d.action !== "defer_to_sync_decision") continue;
      expect(input.localPresent).toBe(true);
      expect(input.tombstone).toBeNull();
      expect(!input.hosted || input.hosted.state !== "purged").toBe(true);
    }
  });

  it("never writes to hosted or touches local notes while a conflict is parked", () => {
    for (const input of all) {
      if (input.localPresent || input.tombstone?.state !== "conflict") continue;
      const d = decideDeleteAction(input);
      expect(["noop", "clear_tombstone"]).toContain(d.action);
    }
  });
});

describe("describeDeleteDecision", () => {
  it("returns a non-empty description for every action and reason", () => {
    const decisions = [
      decideDeleteAction(gone({ hosted: hosted("live") })),
      decideDeleteAction(gone({ hosted: hosted("trashed") })),
      decideDeleteAction(gone()),
      decideDeleteAction(gone({ tombstone: tomb("conflict"), hosted: hosted("live") })),
      decideDeleteAction(gone({ tombstone: tomb("pending", 3), hosted: hosted("live", 3) })),
      decideDeleteAction(gone({ tombstone: tomb("pending", 3), hosted: hosted("live", 4) })),
      decideDeleteAction(gone({ tombstone: tomb("pending", 5), hosted: hosted("live", 2) })),
      decideDeleteAction(here({ hosted: hosted("purged"), localChanged: true })),
      decideDeleteAction(here({ hosted: hosted("purged"), hasSyncState: false })),
      decideDeleteAction(gone({ tombstone: tomb(), hosted: hosted("purged") })),
      decideDeleteAction(gone({ tombstone: tomb(), hosted: null })),
      decideDeleteAction(here({ tombstone: tomb(), hosted: hosted("live") })),
      decideDeleteAction(here({ hosted: hosted("purged") })),
      decideDeleteAction(here({ hosted: hosted("live") })),
    ];
    for (const d of decisions) expect(describeDeleteDecision(d).length).toBeGreaterThan(0);
  });
});