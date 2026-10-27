// src/features/sync/lib/commitReview.test.ts
//
// commitReview takes every effect as an argument, so each failure row is
// provoked with fakes and the exact calls made (and not made) are asserted.
// Node environment; no database, no Supabase.

import { describe, it, expect } from "vitest";
import { diffNoteRevisions, type BlockMap, type BlockSnapshot } from "@/features/notes/lib/threeWayDiff";
import { itemsFromDiff } from "@/features/notes/lib/applyReconcile";
import { blockIdOf, type DocNode } from "@/features/notes/lib/reconcileGate";
import { planCommit, type CommitReviewInput, type LocalFields, type MetaSide, type ServerFields } from "@/features/sync/lib/commitPlan";
import type { ReviewMode } from "@/features/sync/lib/reviewAssemble";
import type { BackupInput } from "@/features/sync/lib/reconcileStore";
import {
  commitReview,
  hostedMatchesPlan,
  type CommitDeps,
  type CommitRequest,
  type HostedRow,
  type RecordArgs,
  type Stamp,
} from "@/features/sync/lib/commitReview";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const t = (text: string): DocNode => ({ type: "text", text });
const para = (id: string, text: string): DocNode => ({ type: "paragraph", attrs: { blockId: id }, content: [t(text)] });
const doc = (...c: DocNode[]): DocNode => ({ type: "doc", content: c });

function snap(n: DocNode): BlockSnapshot {
  const content = JSON.stringify(n);
  return { blockId: blockIdOf(n) as string, content, hash: content };
}
function mapFromDoc(d: DocNode): BlockMap {
  const map: BlockMap = new Map();
  const walk = (n: DocNode): void => {
    const id = blockIdOf(n);
    if (id) map.set(id, snap(n));
    for (const c of n.content ?? []) walk(c);
  };
  walk(d);
  return map;
}
const itemsOf = (base: DocNode, theirs: DocNode, mine: DocNode) =>
  itemsFromDiff(diffNoteRevisions(mapFromDoc(base), mapFromDoc(theirs), mapFromDoc(mine)));

const baseMeta: MetaSide = {
  title: "Title",
  parentId: null,
  sortOrder: 1,
  tags: null,
  frontmatter: null,
  deletedAt: null,
  plaintext: "plain",
};

function mkReview(mine: DocNode, theirs: DocNode, mode: ReviewMode): CommitReviewInput {
  return {
    mode,
    mineContent: JSON.stringify(mine),
    theirsContent: JSON.stringify(theirs),
    theirsServerRevision: 5,
    mineStamp: { revision: 3, metaRev: 1, updatedAt: 1000 },
    syncedMetaRev: 1,
    mine: { ...baseMeta, plaintext: "mine text" },
    remote: { ...baseMeta, plaintext: "theirs text" },
  };
}

// A real block merge: theirs edited A, mine added N.
const baseDoc = doc(para("A", "a"), para("C", "c"));
const theirsDoc = doc(para("A", "a2"), para("C", "c"));
const mineDoc = doc(para("A", "a"), para("C", "c"), para("N", "new"));

const blockReview = (): CommitReviewInput => mkReview(mineDoc, theirsDoc, "block");
const blockItems = () => itemsOf(baseDoc, theirsDoc, mineDoc);

function request(over: Partial<CommitRequest> = {}): CommitRequest {
  return { noteId: "n1", variant: "block_merge", review: blockReview(), items: blockItems(), metaChoices: {}, ...over };
}

const hostedRow = (over: Partial<HostedRow> = {}): HostedRow => ({
  kind: "row",
  revision: 5,
  title: "Title",
  content: JSON.stringify(theirsDoc),
  plaintext: "theirs text",
  tags: null,
  parent_id: null,
  sort_order: 1,
  frontmatter: null,
  deleted_at: null,
  ...over,
});

/** What the hosted row looks like if our own write already landed. */
function hostedAfterOurWrite(): HostedRow {
  const planned = planCommit({
    review: blockReview(),
    variant: "block_merge",
    items: blockItems(),
    metaChoices: {},
    parentExistsLocally: true,
    storedMatchedGeneratedBefore: false,
    now: 2000,
  });
  if (!planned.ok || !planned.plan.serverFields) throw new Error("fixture plan failed");
  const f = planned.plan.serverFields;
  return hostedRow({ revision: 6, content: f.content as string, plaintext: f.plaintext as string });
}

// ─── Harness ──────────────────────────────────────────────────────────────

interface HarnessOptions {
  calls?: string[];
  fresh?: CommitReviewInput;
  deps?: Partial<CommitDeps>;
}

function harness(opts: HarnessOptions = {}) {
  const calls = opts.calls ?? [];
  const log = {
    backups: [] as BackupInput[],
    pushes: [] as Array<{ fields: ServerFields; expected: number }>,
    locals: [] as Array<{ fields: LocalFields; stamp: Stamp; after: Stamp }>,
    records: [] as RecordArgs[],
  };
  let locks = 0;
  let releases = 0;
  const fresh = opts.fresh ?? blockReview();

  const deps: CommitDeps = {
    noteIsOpen: () => false,
    lock: () => {
      locks++;
      calls.push("lock");
      return () => {
        releases++;
        calls.push("release");
      };
    },
    rebuild: async () => {
      calls.push("rebuild");
      return { ok: true, review: fresh };
    },
    planContext: async () => {
      calls.push("planContext");
      return { parentExistsLocally: true, storedMatchedGeneratedBefore: false };
    },
    writeBackup: async (b) => {
      calls.push("backup");
      log.backups.push(b);
    },
    pushMerged: async (_id, fields, expected) => {
      calls.push("push");
      log.pushes.push({ fields, expected });
      return { kind: "won" };
    },
    fetchHosted: async () => {
      calls.push("fetch");
      return hostedRow();
    },
    writeLocal: async (_id, fields, stamp, after) => {
      calls.push("local");
      log.locals.push({ fields, stamp, after });
      return { kind: "ok" };
    },
    record: async (a) => {
      calls.push("record");
      log.records.push(a);
    },
    now: () => 2000,
    ...opts.deps,
  };
  return { deps, calls, log, balanced: () => locks === releases };
}

const HEAD = ["lock", "rebuild", "planContext"];

// ─── Happy path ───────────────────────────────────────────────────────────

describe("commitReview — happy path", () => {
  it("backup, then server, then local, then record, in that order; the lock is released", async () => {
    const h = harness();
    const out = await commitReview(h.deps, request());

    expect(out).toMatchObject({ status: "committed", variant: "block_merge", newServerRevision: 6, serverWritten: true, localWritten: true });
    expect(h.calls).toEqual([...HEAD, "backup", "push", "local", "record", "release"]);
    expect(h.balanced()).toBe(true);
  });

  it("passes the right arguments to every step", async () => {
    const h = harness();
    await commitReview(h.deps, request());

    expect(h.log.backups[0]).toEqual({
      noteId: "n1",
      kind: "merge",
      hostedRevision: 5,
      mineTitle: "Title",
      mineContent: JSON.stringify(mineDoc),
      theirsTitle: "Title",
      theirsContent: JSON.stringify(theirsDoc),
    });
    expect(h.log.pushes[0].expected).toBe(5);
    expect(h.log.pushes[0].fields.content).toContain("a2");
    expect(h.log.pushes[0].fields.content).toContain("new");
    expect(h.log.locals[0].stamp).toEqual({ revision: 3, metaRev: 1, updatedAt: 1000 });
    expect(h.log.locals[0].after).toEqual({ revision: 4, metaRev: 1, updatedAt: 2000 });
    expect(h.log.records[0].newServerRevision).toBe(6);
    expect(h.log.records[0].plan.variant).toBe("block_merge");
  });

  it("uses the search-text generator the context supplies", async () => {
    const h = harness({
      deps: {
        planContext: async () => ({
          parentExistsLocally: true,
          storedMatchedGeneratedBefore: true,
          generatePlaintext: () => "generated text",
        }),
      },
    });
    await commitReview(h.deps, request());
    expect(h.log.pushes[0].fields.plaintext).toBe("generated text");
    expect(h.log.locals[0].fields.plaintext).toBe("generated text");
  });
});

// ─── Refused before anything is written ───────────────────────────────────

describe("commitReview — refused before any write", () => {
  it("a note open in a tab is refused, and no lock is taken", async () => {
    const h = harness({ deps: { noteIsOpen: () => true } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "refused", reason: "note_open", detail: [] });
    expect(h.calls).toEqual([]);
    expect(h.balanced()).toBe(true);
  });

  it("a busy note is refused and nothing else is called", async () => {
    const h = harness({ deps: { lock: () => null } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "refused", reason: "busy", detail: [] });
    expect(h.calls).toEqual([]);
  });

  it("a failed rebuild (for example the note was purged) is refused with its reason", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { rebuild: async () => ({ ok: false, reason: "remote_purged" }) } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "refused", reason: "rebuild_failed", detail: ["remote_purged"] });
    expect(calls).toEqual(["lock", "release"]);
    expect(h.balanced()).toBe(true);
  });

  it("a rebuild that throws is refused, not thrown", async () => {
    const h = harness({
      deps: {
        rebuild: async () => {
          throw new Error("offline");
        },
      },
    });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "refused", reason: "rebuild_failed", detail: ["offline"] });
    expect(h.balanced()).toBe(true);
  });

  it("a hosted revision that moved since the review is stale, and nothing is written", async () => {
    const h = harness({ fresh: { ...blockReview(), theirsServerRevision: 6 } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "stale", reason: "hosted_moved" });
    expect(h.calls).toEqual(["lock", "rebuild", "release"]);
  });

  it("a local note that changed since the review is stale, and nothing is written", async () => {
    const h = harness({ fresh: { ...blockReview(), mineStamp: { revision: 4, metaRev: 1, updatedAt: 1000 } } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "stale", reason: "local_changed" });
    expect(h.calls).toEqual(["lock", "rebuild", "release"]);
  });

  it("an undecided conflict is refused at the plan, before any backup or push", async () => {
    const cBase = doc(para("A", "a"));
    const cTheirs = doc(para("A", "b"));
    const cMine = doc(para("A", "c"));
    const review = mkReview(cMine, cTheirs, "block");
    const h = harness({ fresh: review });
    const out = await commitReview(h.deps, request({ review, items: itemsOf(cBase, cTheirs, cMine) }));
    expect(out).toEqual({ status: "refused", reason: "plan_failed", detail: ["unresolved_item", "A"] });
    expect(h.calls).toEqual([...HEAD, "release"]);
  });

  it("a context lookup that throws is refused", async () => {
    const h = harness({
      deps: {
        planContext: async () => {
          throw new Error("boom");
        },
      },
    });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "refused", reason: "plan_failed", detail: ["context_failed", "boom"] });
    expect(h.balanced()).toBe(true);
  });

  it("a failed backup means no write at all", async () => {
    const calls: string[] = [];
    const h = harness({
      calls,
      deps: {
        writeBackup: async () => {
          calls.push("backup");
          throw new Error("disk full");
        },
      },
    });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "refused", reason: "backup_failed", detail: ["disk full"] });
    expect(calls).toEqual([...HEAD, "backup", "release"]);
  });
});

// ─── The push did not win ─────────────────────────────────────────────────

describe("commitReview — zero rows updated", () => {
  const zeroRows = (calls: string[]): Partial<CommitDeps> => ({
    pushMerged: async () => {
      calls.push("push");
      return { kind: "zero_rows" };
    },
  });
  const fetchReturns = (calls: string[], snap: Awaited<ReturnType<CommitDeps["fetchHosted"]>>): Partial<CommitDeps> => ({
    fetchHosted: async () => {
      calls.push("fetch");
      return snap;
    },
  });
  const LOST = [...HEAD, "backup", "push", "fetch", "release"];

  it("someone else moved it: push_lost 'moved', no local write, backup kept", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...zeroRows(calls), ...fetchReturns(calls, hostedRow({ revision: 7 })) } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "push_lost", hosted: "moved" });
    expect(calls).toEqual(LOST);
    expect(h.log.backups).toHaveLength(1);
    expect(h.balanced()).toBe(true);
  });

  it("the note was purged: push_lost 'purged'", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...zeroRows(calls), ...fetchReturns(calls, { kind: "purged" }) } });
    expect(await commitReview(h.deps, request())).toEqual({ status: "push_lost", hosted: "purged" });
    expect(calls).toEqual(LOST);
  });

  it("the row is gone: push_lost 'missing'", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...zeroRows(calls), ...fetchReturns(calls, { kind: "missing" }) } });
    expect(await commitReview(h.deps, request())).toEqual({ status: "push_lost", hosted: "missing" });
  });

  it("zero rows but the revision is unchanged (for example access denied): push_lost 'unchanged'", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...zeroRows(calls), ...fetchReturns(calls, hostedRow()) } });
    expect(await commitReview(h.deps, request())).toEqual({ status: "push_lost", hosted: "unchanged" });
    expect(calls).not.toContain("local");
  });

  it("zero rows because our own earlier attempt already landed: carries on and commits", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...zeroRows(calls), ...fetchReturns(calls, hostedAfterOurWrite()) } });
    const out = await commitReview(h.deps, request());
    expect(out).toMatchObject({ status: "committed", newServerRevision: 6, serverWritten: true });
    expect(calls).toEqual([...HEAD, "backup", "push", "fetch", "local", "record", "release"]);
  });
});

describe("commitReview — the push throws", () => {
  const throwing = (calls: string[]): Partial<CommitDeps> => ({
    pushMerged: async () => {
      calls.push("push");
      throw new Error("offline");
    },
  });
  const fetchReturns = (calls: string[], snap: Awaited<ReturnType<CommitDeps["fetchHosted"]>>): Partial<CommitDeps> => ({
    fetchHosted: async () => {
      calls.push("fetch");
      return snap;
    },
  });

  it("the request never arrived (hosted unchanged): network_error, maybeApplied false, no local write", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...throwing(calls), ...fetchReturns(calls, hostedRow()) } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "network_error", maybeApplied: false });
    expect(calls).toEqual([...HEAD, "backup", "push", "fetch", "release"]);
    expect(h.balanced()).toBe(true);
  });

  it("the request arrived but the answer was lost (hosted holds our write): treated as won", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...throwing(calls), ...fetchReturns(calls, hostedAfterOurWrite()) } });
    const out = await commitReview(h.deps, request());
    expect(out).toMatchObject({ status: "committed", newServerRevision: 6, serverWritten: true, localWritten: true });
    expect(calls).toEqual([...HEAD, "backup", "push", "fetch", "local", "record", "release"]);
  });

  it("hosted moved on to something else: push_lost 'moved'", async () => {
    const calls: string[] = [];
    const h = harness({ calls, deps: { ...throwing(calls), ...fetchReturns(calls, hostedRow({ revision: 6 })) } });
    expect(await commitReview(h.deps, request())).toEqual({ status: "push_lost", hosted: "moved" });
    expect(calls).not.toContain("local");
  });

  it("the check itself fails too: network_error, maybeApplied true", async () => {
    const calls: string[] = [];
    const h = harness({
      calls,
      deps: {
        ...throwing(calls),
        fetchHosted: async () => {
          calls.push("fetch");
          throw new Error("still offline");
        },
      },
    });
    expect(await commitReview(h.deps, request())).toEqual({ status: "network_error", maybeApplied: true });
    expect(calls).not.toContain("local");
    expect(h.balanced()).toBe(true);
  });
});

// ─── The server won, then something failed ────────────────────────────────

describe("commitReview — after the server won", () => {
  it.each([
    ["raced", async () => ({ kind: "raced" as const }), "raced"],
    ["unverified", async () => ({ kind: "unverified" as const }), "unverified"],
    [
      "threw",
      async (): Promise<never> => {
        throw new Error("db locked");
      },
      "db locked",
    ],
  ])("a local write that %s: server_won_local_failed, and nothing is recorded", async (_name, writeLocal, detail) => {
    const h = harness({ deps: { writeLocal } });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "server_won_local_failed", newServerRevision: 6, detail });
    expect(h.calls).not.toContain("record");
    expect(h.balanced()).toBe(true);
  });

  it("recording failing after both writes: committed_unrecorded", async () => {
    const h = harness({
      deps: {
        record: async () => {
          h.calls.push("record");
          throw new Error("sync state write failed");
        },
      },
    });
    const out = await commitReview(h.deps, request());
    expect(out).toEqual({ status: "committed_unrecorded", newServerRevision: 6 });
    expect(h.calls).toEqual([...HEAD, "backup", "push", "local", "record", "release"]);
    expect(h.balanced()).toBe(true);
  });
});

// ─── Variants ─────────────────────────────────────────────────────────────

describe("commitReview — variants", () => {
  const same = doc(para("A", "a"));

  it("identical: no backup, no push, no local write; only the agreement is recorded", async () => {
    const review = mkReview(same, same, "identical");
    const h = harness({ fresh: review });
    const out = await commitReview(h.deps, request({ variant: "identical", review, items: [] }));
    expect(out).toMatchObject({ status: "committed", newServerRevision: 5, serverWritten: false, localWritten: false });
    expect(h.calls).toEqual([...HEAD, "record", "release"]);
  });

  it("whole note, take theirs: backup, local write and record; the server is not written", async () => {
    const review = mkReview(mineDoc, theirsDoc, "whole_note");
    const h = harness({ fresh: review });
    const out = await commitReview(h.deps, request({ variant: "whole_take_theirs", review, items: [] }));
    expect(out).toMatchObject({ status: "committed", newServerRevision: 5, serverWritten: false, localWritten: true });
    expect(h.calls).toEqual([...HEAD, "backup", "local", "record", "release"]);
    expect(h.log.backups[0].kind).toBe("whole_note");
    expect(h.log.locals[0].fields.content).toBe(JSON.stringify(theirsDoc));
  });

  it("whole note, take theirs, local write fails: local_failed (nothing was pushed), nothing recorded", async () => {
    const review = mkReview(mineDoc, theirsDoc, "whole_note");
    const h = harness({ fresh: review, deps: { writeLocal: async () => ({ kind: "raced" }) } });
    const out = await commitReview(h.deps, request({ variant: "whole_take_theirs", review, items: [] }));
    expect(out).toEqual({ status: "local_failed", detail: "raced" });
    expect(h.calls).not.toContain("push");
    expect(h.calls).not.toContain("record");
  });

  it("whole note, keep mine: backup, push and record; this device is not written", async () => {
    const review = mkReview(mineDoc, theirsDoc, "whole_note");
    const h = harness({ fresh: review });
    const out = await commitReview(h.deps, request({ variant: "whole_keep_mine", review, items: [] }));
    expect(out).toMatchObject({ status: "committed", newServerRevision: 6, serverWritten: true, localWritten: false });
    expect(h.calls).toEqual([...HEAD, "backup", "push", "record", "release"]);
    expect(h.log.pushes[0].fields.content).toBe(JSON.stringify(mineDoc));
  });

  it("a variant that does not match the review's mode is refused at the plan", async () => {
    const h = harness();
    const out = await commitReview(h.deps, request({ variant: "whole_take_theirs" }));
    expect(out).toMatchObject({ status: "refused", reason: "plan_failed" });
    expect(h.calls).toEqual([...HEAD, "release"]);
  });
});

// ─── hostedMatchesPlan ────────────────────────────────────────────────────

describe("hostedMatchesPlan", () => {
  it("matches when every field in the plan is what the row holds", () => {
    expect(hostedMatchesPlan(hostedRow({ content: "x", plaintext: "p" }), { content: "x", plaintext: "p" })).toBe(true);
  });

  it("does not match when the content differs", () => {
    expect(hostedMatchesPlan(hostedRow({ content: "y" }), { content: "x" })).toBe(false);
  });

  it("compares a field that is explicitly null", () => {
    expect(hostedMatchesPlan(hostedRow({ tags: null }), { tags: null })).toBe(true);
    expect(hostedMatchesPlan(hostedRow({ tags: "[]" }), { tags: null })).toBe(false);
  });

  it("compares trash state by whether it is set, not by when", () => {
    expect(hostedMatchesPlan(hostedRow({ deleted_at: "2026-10-26T00:00:00.000Z" }), { deleted_at: "2026-10-27T00:00:00.000Z" })).toBe(true);
    expect(hostedMatchesPlan(hostedRow({ deleted_at: null }), { deleted_at: "2026-10-27T00:00:00.000Z" })).toBe(false);
  });

  it("ignores fields the plan does not mention, including updated_at", () => {
    expect(hostedMatchesPlan(hostedRow({ title: "Other" }), { updated_at: "2026-10-26T00:00:00.000Z" })).toBe(true);
  });
});
