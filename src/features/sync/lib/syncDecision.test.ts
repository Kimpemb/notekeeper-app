// src/features/sync/lib/syncDecision.test.ts
import { describe, it, expect } from "vitest";
import { decideSyncAction, describeDecision } from "./syncDecision";

const T = 1_700_000_000_000;
const local = (revision: number, updatedAt = T, metaRev = 0) => ({ revision, updatedAt, metaRev });
const remote = (revision: number, updatedAt = T) => ({ revision, updatedAt });
const state = (
  localRevision: number,
  serverRevision: number,
  localUpdatedAt = T,
  metaRev = 0
) => ({
  localRevision,
  localUpdatedAt,
  serverRevision,
  metaRev,
});

describe("decideSyncAction — not on the server", () => {
  it("inserts when there is no remote row (with or without state)", () => {
    expect(decideSyncAction(local(3), null, null)).toEqual({ action: "insert" });
    expect(decideSyncAction(local(3), state(2, 1), null)).toEqual({ action: "insert" });
  });
});

describe("decideSyncAction — with sync state", () => {
  it("in sync when nothing moved on either side", () => {
    expect(decideSyncAction(local(5), state(5, 3), remote(3))).toEqual({ action: "in_sync" });
  });

  it("pushes (compare-and-swap on the synced server revision) when only local changed", () => {
    expect(decideSyncAction(local(7), state(5, 3), remote(3))).toEqual({
      action: "push",
      expectedServerRevision: 3,
    });
  });

  it("detects a metadata-only change via updated_at (revision unchanged)", () => {
    expect(decideSyncAction(local(5, T + 1000), state(5, 3), remote(3))).toEqual({
      action: "push",
      expectedServerRevision: 3,
    });
  });

  it("behind when only the server moved", () => {
    expect(decideSyncAction(local(5), state(5, 3), remote(4))).toEqual({ action: "behind" });
  });

  it("diverged (both_changed) when both moved", () => {
    expect(decideSyncAction(local(6), state(5, 3), remote(4))).toEqual({
      action: "diverged",
      reason: "both_changed",
    });
    // metadata-only local change counts as a local change too
    expect(decideSyncAction(local(5, T + 5), state(5, 3), remote(4))).toEqual({
      action: "diverged",
      reason: "both_changed",
    });
  });

  it("two devices at the same local revision number are still told apart", () => {
    // Device B's local revision happens to equal the server's; only the state decides.
    expect(decideSyncAction(local(6), state(5, 5), remote(6))).toEqual({
      action: "diverged",
      reason: "both_changed",
    });
  });

  it("local revision below the synced one → local_regressed (never push)", () => {
    expect(decideSyncAction(local(3), state(5, 3), remote(3))).toEqual({
      action: "diverged",
      reason: "local_regressed",
    });
  });

  it("server revision below the synced one → server_regressed", () => {
    expect(decideSyncAction(local(5), state(5, 3), remote(2))).toEqual({
      action: "diverged",
      reason: "server_regressed",
    });
  });
});

describe("decideSyncAction — unseeded note that exists on the server", () => {
  it("adopts when revision and updated_at both match", () => {
    expect(decideSyncAction(local(4), null, remote(4))).toEqual({ action: "adopt" });
  });

  it("pushes when local revision is ahead of the server's (legacy local-only change)", () => {
    expect(decideSyncAction(local(6), null, remote(4))).toEqual({
      action: "push",
      expectedServerRevision: 4,
    });
  });

  it("pushes when revisions match but local updated_at is newer (metadata edit)", () => {
    expect(decideSyncAction(local(4, T + 10), null, remote(4, T))).toEqual({
      action: "push",
      expectedServerRevision: 4,
    });
  });

  it("diverged no_base when the server looks ahead or newer", () => {
    expect(decideSyncAction(local(3), null, remote(4))).toEqual({
      action: "diverged",
      reason: "no_base",
    });
    expect(decideSyncAction(local(4, T), null, remote(4, T + 10))).toEqual({
      action: "diverged",
      reason: "no_base",
    });
  });
});

describe("describeDecision", () => {
  it("gives a readable reason for the non-pushing outcomes", () => {
    expect(describeDecision({ action: "behind" })).toMatch(/newer changes/);
    expect(describeDecision({ action: "diverged", reason: "both_changed" })).toMatch(/both/);
    expect(describeDecision({ action: "diverged", reason: "no_base" })).toMatch(/no sync base/);
  });
});

describe("decideSyncAction — metadata edits (meta_rev)", () => {
  it("pushes on a meta_rev change alone (revision and updated_at unchanged)", () => {
    expect(decideSyncAction(local(5, T, 2), state(5, 3, T, 1), remote(3))).toEqual({
      action: "push",
      expectedServerRevision: 3,
    });
  });

  it("diverged when meta_rev changed locally and the server moved", () => {
    expect(decideSyncAction(local(5, T, 2), state(5, 3, T, 1), remote(4))).toEqual({
      action: "diverged",
      reason: "both_changed",
    });
  });

  it("still behind (safe to pull) when meta_rev matches and only the server moved", () => {
    expect(decideSyncAction(local(5, T, 1), state(5, 3, T, 1), remote(4))).toEqual({
      action: "behind",
    });
  });

  it("ignores meta_rev for an unseeded note (legacy rules)", () => {
    expect(decideSyncAction(local(4, T, 9), null, remote(4))).toEqual({ action: "adopt" });
  });
});
