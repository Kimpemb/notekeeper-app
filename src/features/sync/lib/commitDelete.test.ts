// src/features/sync/lib/commitDelete.test.ts
//
// Failure matrix for the delete-review commit. All collaborators are fakes, so
// every row asserts what was and was not called. Node environment, no database.

import { describe, it, expect } from "vitest";
import { commitDelete, type DeleteDeps, type DeleteRequest } from "@/features/sync/lib/commitDelete";
import type { D1Input, D2Input, HostedLiveRow } from "@/features/sync/lib/deleteReviewPlan";

const T0 = Date.parse("2026-10-27T10:00:00.000Z");
const T1 = Date.parse("2026-10-27T11:00:00.000Z");

const hostedRow = (over: Partial<HostedLiveRow> = {}): HostedLiveRow => ({
  kind: "row",
  revision: 5,
  title: "Theirs title",
  content: '{"type":"doc"}',
  plaintext: "theirs text",
  tags: null,
  parent_id: null,
  sort_order: 2,
  frontmatter: null,
  created_at: new Date(T0).toISOString(),
  updated_at: new Date(T1).toISOString(),
  deleted_at: null,
  ...over,
});

const d1Base = (over: Partial<Omit<D1Input, "choice">> = {}): Omit<D1Input, "choice"> => ({
  tombstone: { state: "conflict", serverRevision: 3 },
  localPresent: false,
  hosted: hostedRow(),
  parentExistsLocally: true,
  ...over,
});

const d2Base = (over: Partial<Omit<D2Input, "choice" | "now">> = {}): Omit<D2Input, "choice" | "now"> => ({
  local: {
    title: "Mine title",
    content: '{"type":"doc","mine":true}',
    plaintext: "mine text",
    tags: null,
    parent_id: "P",
    sort_order: 4,
    frontmatter: null,
    deleted_at: null,
    updated_at: T0,
    revision: 11,
    meta_rev: 2,
  },
  hosted: { kind: "purged", revision: 7 },
  ...over,
});

const D1_KEEP: DeleteRequest = { case: "d1", noteId: "n1", choice: "keep_it", reviewedHostedRevision: 5 };
const D1_DEL: DeleteRequest = { case: "d1", noteId: "n1", choice: "delete_anyway", reviewedHostedRevision: 5 };
const STAMP = { revision: 11, metaRev: 2, updatedAt: T0 };
const D2_KEEP: DeleteRequest = { case: "d2", noteId: "n1", choice: "keep_mine", reviewedHostedRevision: 7, reviewedLocalStamp: STAMP };
const D2_GO: DeleteRequest = { case: "d2", noteId: "n1", choice: "let_go", reviewedHostedRevision: 7, reviewedLocalStamp: STAMP };

function harness(
  over: (calls: string[], args: Record<string, unknown[]>) => Partial<DeleteDeps> = () => ({}),
  d1: Omit<D1Input, "choice"> = d1Base(),
  d2: Omit<D2Input, "choice" | "now"> = d2Base()
) {
  const calls: string[] = [];
  const args: Record<string, unknown[]> = {};
  let locks = 0;
  let releases = 0;
  const rec = (name: string, ...a: unknown[]) => {
    calls.push(name);
    args[name] = a;
  };
  const base: DeleteDeps = {
    signedIn: () => true,
    noteIsOpen: () => false,
    lock: () => {
      calls.push("lock");
      locks++;
      return () => {
        releases++;
        calls.push("release");
      };
    },
    readD1: async () => {
      calls.push("readD1");
      return { ok: true, input: d1 };
    },
    readD2: async () => {
      calls.push("readD2");
      return { ok: true, input: d2 };
    },
    writeBackup: async (b) => rec("backup", b),
    insertLocal: async (i) => rec("insertLocal", i),
    removeInserted: async (id) => rec("removeInserted", id),
    recordD1: async (id) => rec("recordD1", id),
    clearTombstone: async (id) => rec("clearTombstone", id),
    purgeHosted: async (id, rev) => {
      rec("purge", id, rev);
      return "won";
    },
    ensureAncestors: async (id, p) => rec("ensureAncestors", id, p),
    unpurgeHosted: async (id, f, rev) => {
      rec("unpurge", id, f, rev);
      return "won";
    },
    fetchHostedState: async () => {
      calls.push("fetchHosted");
      return { kind: "purged", revision: 7 };
    },
    recordD2KeepMine: async (id) => rec("recordD2", id),
    deleteLocal: async (id, s) => {
      rec("deleteLocal", id, s);
      return "deleted";
    },
    now: () => T1,
  };
  const deps = { ...base, ...over(calls, args) };
  return { deps, calls, args, balanced: () => locks === releases };
}

const throws = (m: string) => async () => {
  throw new Error(m);
};

// ─── Shared preconditions ─────────────────────────────────────────────────

describe("commitDelete — preconditions", () => {
  it("refuses when signed out, touching nothing", async () => {
    const h = harness(() => ({ signedIn: () => false }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toEqual({ status: "refused", reason: "signed_out", detail: [] });
    expect(h.calls).toEqual([]);
  });

  it("refuses a busy note without reading", async () => {
    const h = harness(() => ({ lock: () => null }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toEqual({ status: "refused", reason: "busy", detail: [] });
    expect(h.calls).toEqual([]);
  });

  it("D2 refuses an open note before locking", async () => {
    const h = harness(() => ({ noteIsOpen: () => true }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "refused", reason: "note_open", detail: [] });
    expect(h.calls).toEqual([]);
  });

  it("a failed read is refused and the lock is released", async () => {
    const h = harness(() => ({ readD1: async () => ({ ok: false, reason: "offline" }) }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toEqual({ status: "refused", reason: "read_failed", detail: ["offline"] });
    expect(h.balanced()).toBe(true);
  });
});

// ─── D1 keep it ───────────────────────────────────────────────────────────

describe("commitDelete — D1 keep it", () => {
  it("insert, record sync state, clear tombstone; no backup, no hosted write", async () => {
    const h = harness();
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toMatchObject({ status: "committed", case: "d1", choice: "keep_it" });
    expect(h.calls).toEqual(["lock", "readD1", "insertLocal", "recordD1", "clearTombstone", "release"]);
    expect(h.balanced()).toBe(true);
  });

  it("a hosted revision other than the reviewed one is stale; nothing written", async () => {
    const h = harness(undefined, d1Base({ hosted: hostedRow({ revision: 6 }) }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toEqual({ status: "stale", reason: "hosted_moved" });
    expect(h.calls).toEqual(["lock", "readD1", "release"]);
  });

  it("a plan refusal (hosted already purged) writes nothing and says why", async () => {
    const h = harness(undefined, d1Base({ hosted: { kind: "purged", revision: 6 } }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toEqual({ status: "refused", reason: "plan_failed", detail: ["hosted_purged"] });
    expect(h.calls).not.toContain("insertLocal");
  });

  it("a failed insert is cleaned up and nothing is recorded", async () => {
    const h = harness((_c) => ({
      insertLocal: async () => {
        _c.push("insertLocal");
        throw new Error("disk full");
      },
      removeInserted: async () => {
        _c.push("removeInserted");
      },
    }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toEqual({ status: "local_failed", detail: "disk full" });
    expect(h.calls).toContain("removeInserted");
    expect(h.calls).not.toContain("recordD1");
    expect(h.calls).not.toContain("clearTombstone");
    expect(h.balanced()).toBe(true);
  });

  it("sync state that cannot be recorded is reported; the tombstone is left for the drain", async () => {
    const h = harness(() => ({ recordD1: throws("db locked") }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out).toEqual({ status: "committed_unrecorded", case: "d1", choice: "keep_it", detail: "db locked" });
    expect(h.calls).not.toContain("clearTombstone");
  });

  it("a tombstone that cannot be cleared does not fail the commit", async () => {
    const h = harness(() => ({ clearTombstone: throws("db locked") }));
    const out = await commitDelete(h.deps, D1_KEEP);
    expect(out.status).toBe("committed");
  });
});

// ─── D1 delete anyway ─────────────────────────────────────────────────────

describe("commitDelete — D1 delete anyway", () => {
  it("backup first, then purge at the current hosted revision, then clear the tombstone", async () => {
    const h = harness();
    const out = await commitDelete(h.deps, D1_DEL);
    expect(out).toMatchObject({ status: "committed", case: "d1", choice: "delete_anyway" });
    expect(h.calls).toEqual(["lock", "readD1", "backup", "purge", "clearTombstone", "release"]);
    expect(h.args.purge).toEqual(["n1", 5]); // not the tombstone's 3
    expect((h.args.backup[0] as { theirsContent: string }).theirsContent).toBe('{"type":"doc"}');
    expect(h.balanced()).toBe(true);
  });

  it("no purge when the backup fails", async () => {
    const h = harness(() => ({ writeBackup: throws("disk full") }));
    const out = await commitDelete(h.deps, D1_DEL);
    expect(out).toEqual({ status: "refused", reason: "backup_failed", detail: ["disk full"] });
    expect(h.calls).not.toContain("purge");
  });

  it("a lost compare-and-swap is stale; the tombstone is kept and the backup stays", async () => {
    const h = harness(() => ({ purgeHosted: async () => "zero_rows" }));
    const out = await commitDelete(h.deps, D1_DEL);
    expect(out).toEqual({ status: "stale", reason: "hosted_moved" });
    expect(h.calls).not.toContain("clearTombstone");
  });

  it("a network error is reported as maybe applied; the tombstone is kept", async () => {
    const h = harness(() => ({ purgeHosted: throws("offline") }));
    const out = await commitDelete(h.deps, D1_DEL);
    expect(out).toEqual({ status: "network_error", maybeApplied: true });
    expect(h.calls).not.toContain("clearTombstone");
    expect(h.balanced()).toBe(true);
  });
});

// ─── D2 keep mine ─────────────────────────────────────────────────────────

describe("commitDelete — D2 keep mine", () => {
  it("backup, ancestors, un-purge on the purged revision, record", async () => {
    const h = harness();
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toMatchObject({ status: "committed", case: "d2", choice: "keep_mine" });
    expect(h.calls).toEqual(["lock", "readD2", "backup", "ensureAncestors", "unpurge", "recordD2", "release"]);
    expect(h.args.ensureAncestors).toEqual(["n1", "P"]);
    expect(h.args.unpurge[2]).toBe(7);
    expect((h.args.unpurge[1] as { purged_at: null }).purged_at).toBeNull();
    expect(h.balanced()).toBe(true);
  });

  it("skips the ancestor check for a top-level note", async () => {
    const base = d2Base();
    const h = harness(undefined, undefined, { ...base, local: { ...base.local, parent_id: null } });
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out.status).toBe("committed");
    expect(h.calls).not.toContain("ensureAncestors");
  });

  it("a hosted revision other than the reviewed one is stale", async () => {
    const h = harness(undefined, undefined, d2Base({ hosted: { kind: "purged", revision: 8 } }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "stale", reason: "hosted_moved" });
    expect(h.calls).toEqual(["lock", "readD2", "release"]);
  });

  it("a local stamp that moved is stale", async () => {
    const base = d2Base();
    const h = harness(undefined, undefined, { ...base, local: { ...base.local, revision: 12 } });
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "stale", reason: "local_changed" });
    expect(h.calls).not.toContain("backup");
  });

  it("a live hosted row is not a delete review", async () => {
    const h = harness(undefined, undefined, d2Base({ hosted: { kind: "row", revision: 7 } }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "refused", reason: "plan_failed", detail: ["hosted_not_purged"] });
    expect(h.calls).not.toContain("backup");
  });

  it("no hosted write when the backup fails", async () => {
    const h = harness(() => ({ writeBackup: throws("disk full") }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "refused", reason: "backup_failed", detail: ["disk full"] });
    expect(h.calls).not.toContain("ensureAncestors");
    expect(h.calls).not.toContain("unpurge");
  });

  it("no un-purge when the ancestors cannot be ensured", async () => {
    const h = harness(() => ({ ensureAncestors: throws("fk") }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "refused", reason: "ancestors_failed", detail: ["fk"] });
    expect(h.calls).not.toContain("unpurge");
  });

  it("a lost compare-and-swap is stale and records nothing", async () => {
    const h = harness(() => ({ unpurgeHosted: async () => "zero_rows" }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "stale", reason: "hosted_moved" });
    expect(h.calls).not.toContain("recordD2");
  });

  it("a lost answer, but hosted shows our revision: it applied, so record", async () => {
    const h = harness((c) => ({
      unpurgeHosted: throws("timeout"),
      fetchHostedState: async () => {
        c.push("fetchHosted");
        return { kind: "row", revision: 8 };
      },
    }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out.status).toBe("committed");
    expect(h.calls).toContain("recordD2");
  });

  it("a lost answer, hosted still purged at the same revision: it did not apply", async () => {
    const h = harness(() => ({ unpurgeHosted: throws("timeout") }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "network_error", maybeApplied: false });
    expect(h.calls).not.toContain("recordD2");
  });

  it("a lost answer, hosted moved on to another revision: stale", async () => {
    const h = harness((c) => ({
      unpurgeHosted: throws("timeout"),
      fetchHostedState: async () => {
        c.push("fetchHosted");
        return { kind: "row", revision: 9 };
      },
    }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "stale", reason: "hosted_moved" });
    expect(h.calls).not.toContain("recordD2");
  });

  it("a lost answer and the check fails too: maybe applied", async () => {
    const h = harness(() => ({ unpurgeHosted: throws("timeout"), fetchHostedState: throws("offline") }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "network_error", maybeApplied: true });
    expect(h.balanced()).toBe(true);
  });

  it("sync state that cannot be recorded after a won write is reported", async () => {
    const h = harness(() => ({ recordD2KeepMine: throws("db locked") }));
    const out = await commitDelete(h.deps, D2_KEEP);
    expect(out).toEqual({ status: "committed_unrecorded", case: "d2", choice: "keep_mine", detail: "db locked" });
  });
});

// ─── D2 let go ────────────────────────────────────────────────────────────

describe("commitDelete — D2 let the delete go", () => {
  it("backup, then delete locally on the reviewed stamp; no hosted write", async () => {
    const h = harness();
    const out = await commitDelete(h.deps, D2_GO);
    expect(out).toMatchObject({ status: "committed", case: "d2", choice: "let_go" });
    expect(h.calls).toEqual(["lock", "readD2", "backup", "deleteLocal", "release"]);
    expect(h.args.deleteLocal).toEqual(["n1", STAMP]);
    expect((h.args.backup[0] as { mineContent: string }).mineContent).toBe('{"type":"doc","mine":true}');
  });

  it("never deletes without the backup", async () => {
    const h = harness(() => ({ writeBackup: throws("disk full") }));
    const out = await commitDelete(h.deps, D2_GO);
    expect(out.status).toBe("refused");
    expect(h.calls).not.toContain("deleteLocal");
  });

  it("a raced local note is stale and stays", async () => {
    const h = harness(() => ({ deleteLocal: async () => "raced" }));
    const out = await commitDelete(h.deps, D2_GO);
    expect(out).toEqual({ status: "stale", reason: "local_changed" });
  });

  it("a failed delete is reported", async () => {
    const h = harness(() => ({ deleteLocal: throws("locked") }));
    const out = await commitDelete(h.deps, D2_GO);
    expect(out).toEqual({ status: "local_failed", detail: "locked" });
    expect(h.balanced()).toBe(true);
  });
});
