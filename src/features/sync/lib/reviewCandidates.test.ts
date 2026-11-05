// src/features/sync/lib/reviewCandidates.test.ts

import { describe, it, expect } from "vitest";
import {
  classifyCandidates,
  countByKind,
  type CandidateInput,
  type HostedStatus,
  type QueueRowInput,
  type TombstoneInput,
} from "@/features/sync/lib/reviewCandidates";

const q = (over: Partial<QueueRowInput> = {}): QueueRowInput => ({
  noteId: "n1",
  state: "remote_ahead",
  reason: "changed on both this device and the server",
  localRevision: 5,
  remoteRevision: 2,
  updatedAt: 1000,
  localTitle: "Local title",
  ...over,
});

const t = (over: Partial<TombstoneInput> = {}): TombstoneInput => ({
  noteId: "t1",
  state: "conflict",
  syncedServerRevision: 3,
  deletedAt: 500,
  ...over,
});

const hosted = (entries: Array<[string, Partial<HostedStatus>]>): Map<string, HostedStatus> =>
  new Map(entries.map(([id, h]) => [id, { revision: 4, purged: false, title: "Hosted title", ...h }]));

const run = (over: Partial<CandidateInput> = {}) =>
  classifyCandidates({ queue: [], tombstones: [], hosted: new Map(), hostedChecked: true, ...over });

describe("classifyCandidates — queue rows", () => {
  it("a remote_ahead note with a live hosted row is a content conflict", () => {
    const r = run({ queue: [q()], hosted: hosted([["n1", { revision: 4 }]]) });
    expect(r).toEqual([
      {
        noteId: "n1",
        kind: "content_conflict",
        title: "Local title",
        reason: "changed on both this device and the server",
        localRevision: 5,
        hostedRevision: 4,
        detectedAt: 1000,
      },
    ]);
  });

  it("a remote_ahead note whose hosted row is purged is purged_elsewhere, keeping the local title", () => {
    const r = run({ queue: [q()], hosted: hosted([["n1", { revision: 5, purged: true, title: "Untitled" }]]) });
    expect(r[0]).toMatchObject({ kind: "purged_elsewhere", title: "Local title", hostedRevision: 5 });
  });

  it("a remote_ahead note with no hosted row is shown as hosted_missing, not hidden", () => {
    const r = run({ queue: [q()] });
    expect(r[0]).toMatchObject({ kind: "hosted_missing", hostedRevision: null });
  });

  it("retry state is not a review", () => {
    const r = run({ queue: [q({ state: "pending" }), q({ noteId: "n2", state: "parked_max_attempts" })] });
    expect(r).toEqual([]);
  });
});

describe("classifyCandidates — tombstones", () => {
  it("a conflict tombstone with a live hosted row past it is deleted_here, titled from hosted", () => {
    const r = run({ tombstones: [t()], hosted: hosted([["t1", { revision: 4, title: "trash-test3" }]]) });
    expect(r).toEqual([
      { noteId: "t1", kind: "deleted_here", title: "trash-test3", reason: null, localRevision: null, hostedRevision: 4, detectedAt: 500 },
    ]);
  });

  it("is not a review when hosted is already purged (the drain clears it)", () => {
    expect(run({ tombstones: [t()], hosted: hosted([["t1", { purged: true }]]) })).toEqual([]);
  });

  it("is not a review when the hosted row is missing", () => {
    expect(run({ tombstones: [t()] })).toEqual([]);
  });

  it("is not a review when hosted has not moved past the tombstone", () => {
    expect(run({ tombstones: [t()], hosted: hosted([["t1", { revision: 3 }]]) })).toEqual([]);
  });

  it("a pending tombstone is not a review", () => {
    expect(run({ tombstones: [t({ state: "pending" })], hosted: hosted([["t1", { revision: 9 }]]) })).toEqual([]);
  });
});

describe("classifyCandidates — hosted not checked", () => {
  it("queue rows and conflict tombstones appear as unchecked instead of being guessed", () => {
    const r = run({ queue: [q()], tombstones: [t()], hostedChecked: false });
    expect(r.map((c) => c.kind).sort()).toEqual(["unchecked", "unchecked"]);
    expect(r.find((c) => c.noteId === "t1")?.title).toBeNull();
  });

  it("retry state and pending tombstones still do not count", () => {
    const r = run({ queue: [q({ state: "pending" })], tombstones: [t({ state: "pending" })], hostedChecked: false });
    expect(r).toEqual([]);
  });
});

describe("classifyCandidates — ordering and purity", () => {
  it("lists the newest first, with the note id breaking ties", () => {
    const r = run({
      queue: [q({ noteId: "b", updatedAt: 100 }), q({ noteId: "a", updatedAt: 100 }), q({ noteId: "c", updatedAt: 300 })],
      hosted: hosted([["a", {}], ["b", {}], ["c", {}]]),
    });
    expect(r.map((c) => c.noteId)).toEqual(["c", "a", "b"]);
  });

  it("does not change its input", () => {
    const input: CandidateInput = { queue: [q()], tombstones: [t()], hosted: hosted([["n1", {}], ["t1", {}]]), hostedChecked: true };
    const before = JSON.stringify({ q: input.queue, t: input.tombstones, h: [...input.hosted] });
    classifyCandidates(input);
    expect(JSON.stringify({ q: input.queue, t: input.tombstones, h: [...input.hosted] })).toBe(before);
  });
});

describe("countByKind", () => {
  it("counts every kind, including zeros", () => {
    const r = run({
      queue: [q({ noteId: "a" }), q({ noteId: "b" }), q({ noteId: "c" })],
      tombstones: [t()],
      hosted: hosted([["a", {}], ["b", { purged: true }], ["t1", { revision: 4 }]]),
    });
    expect(countByKind(r)).toEqual({
      content_conflict: 1,
      purged_elsewhere: 1,
      deleted_here: 1,
      hosted_missing: 1,
      unchecked: 0,
    });
  });
});
