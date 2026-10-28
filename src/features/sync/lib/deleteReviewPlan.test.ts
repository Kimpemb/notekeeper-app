// src/features/sync/lib/deleteReviewPlan.test.ts
//
// Pure planning for the two delete reviews. Node environment, no database.

import { describe, it, expect } from "vitest";
import {
  planD1,
  planD2,
  type D1Input,
  type D1Plan,
  type D2Input,
  type D2Plan,
  type HostedLiveRow,
} from "@/features/sync/lib/deleteReviewPlan";

const T0 = Date.parse("2026-10-27T10:00:00.000Z");
const T1 = Date.parse("2026-10-27T11:00:00.000Z");

// ─── D1 ───────────────────────────────────────────────────────────────────

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

const d1 = (over: Partial<D1Input> = {}): D1Input => ({
  choice: "keep_it",
  tombstone: { state: "conflict", serverRevision: 3 },
  localPresent: false,
  hosted: hostedRow(),
  parentExistsLocally: true,
  ...over,
});

function d1ok(noteId: string, input: D1Input): D1Plan {
  const r = planD1(noteId, input);
  if (!r.ok) throw new Error(`plan failed: ${r.reason} ${r.detail.join(",")}`);
  return r.plan;
}

describe("planD1 — keep it", () => {
  it("restores the hosted version locally with the pull's starting counters and writes nothing hosted", () => {
    const p = d1ok("n1", d1());
    expect(p.backup).toBeNull();
    expect(p.purgeExpectedRevision).toBeNull();
    expect(p.clearTombstone).toBe(true);
    expect(p.insert).toEqual({
      noteId: "n1",
      title: "Theirs title",
      content: '{"type":"doc"}',
      plaintext: "theirs text",
      tags: null,
      frontmatter: null,
      parentId: null,
      sortOrder: 2,
      createdAt: T0,
      updatedAt: T1,
      deletedAt: null,
    });
    expect(p.syncedAfter).toEqual({ localRevision: 1, metaRev: 0, localUpdatedAt: T1, serverRevision: 5 });
  });

  it("keeps the hosted parent when it exists here", () => {
    const p = d1ok("n1", d1({ hosted: hostedRow({ parent_id: "P" }) }));
    expect(p.insert?.parentId).toBe("P");
  });

  it("drops a hosted parent this device does not have, and says so", () => {
    const p = d1ok("n1", d1({ hosted: hostedRow({ parent_id: "P" }), parentExistsLocally: false }));
    expect(p.insert?.parentId).toBeNull();
    expect(p.notes).toHaveLength(1);
  });

  it("a hosted-trashed note comes back trashed", () => {
    const t = new Date(T1).toISOString();
    const p = d1ok("n1", d1({ hosted: hostedRow({ deleted_at: t }) }));
    expect(p.insert?.deletedAt).toBe(T1);
  });

  it("a null hosted sort order becomes 0", () => {
    const p = d1ok("n1", d1({ hosted: hostedRow({ sort_order: null }) }));
    expect(p.insert?.sortOrder).toBe(0);
  });
});

describe("planD1 — delete anyway", () => {
  it("backs up the hosted content and purges at the CURRENT hosted revision", () => {
    const p = d1ok("n1", d1({ choice: "delete_anyway" }));
    expect(p.backup).toEqual({
      noteId: "n1",
      kind: "purge",
      hostedRevision: 5,
      mineTitle: null,
      mineContent: null,
      theirsTitle: "Theirs title",
      theirsContent: '{"type":"doc"}',
    });
    expect(p.purgeExpectedRevision).toBe(5); // not the tombstone's 3
    expect(p.insert).toBeNull();
    expect(p.syncedAfter).toBeNull();
    expect(p.clearTombstone).toBe(true);
  });
});

describe("planD1 — refusals", () => {
  const reason = (over: Partial<D1Input>) => {
    const r = planD1("n1", d1(over));
    return r.ok ? "ok" : r.reason;
  };

  it("a local note with this id exists again: stale tombstone", () => {
    expect(reason({ localPresent: true })).toBe("local_note_exists");
  });
  it("a tombstone that is not in conflict state", () => {
    expect(reason({ tombstone: { state: "pending", serverRevision: 3 } })).toBe("not_parked");
  });
  it("hosted row missing", () => {
    expect(reason({ hosted: { kind: "missing" } })).toBe("hosted_missing");
  });
  it("hosted already purged", () => {
    expect(reason({ hosted: { kind: "purged", revision: 6 } })).toBe("hosted_purged");
  });
  it("hosted has not moved past the tombstone", () => {
    expect(reason({ hosted: hostedRow({ revision: 3 }) })).toBe("not_edited_elsewhere");
    expect(reason({ hosted: hostedRow({ revision: 2 }) })).toBe("not_edited_elsewhere");
  });
});

// ─── D2 ───────────────────────────────────────────────────────────────────

const d2 = (over: Partial<D2Input> = {}): D2Input => ({
  choice: "keep_mine",
  local: {
    title: "Mine title",
    content: '{"type":"doc","mine":true}',
    plaintext: "mine text",
    tags: "a,b",
    parent_id: "P",
    sort_order: 4,
    frontmatter: null,
    deleted_at: null,
    updated_at: T0,
    revision: 11,
    meta_rev: 2,
  },
  hosted: { kind: "purged", revision: 7 },
  now: T1,
  ...over,
});

function d2ok(noteId: string, input: D2Input): D2Plan {
  const r = planD2(noteId, input);
  if (!r.ok) throw new Error(`plan failed: ${r.reason} ${r.detail.join(",")}`);
  return r.plan;
}

describe("planD2 — keep mine", () => {
  it("un-purges with mine's fields, compare-and-swap on the purged revision", () => {
    const p = d2ok("n1", d2());
    expect(p.serverFields).toEqual({
      purged_at: null,
      title: "Mine title",
      content: '{"type":"doc","mine":true}',
      plaintext: "mine text",
      tags: "a,b",
      parent_id: "P",
      sort_order: 4,
      frontmatter: null,
      deleted_at: null,
      updated_at: new Date(T1).toISOString(),
    });
    expect(p.expectedPurgedRevision).toBe(7);
    expect(p.serverRevisionAfter).toBe(8);
    expect(p.newUpdatedAt).toBe(T1);
    expect(p.ensureAncestorsOf).toBe("P");
    expect(p.deleteLocal).toBe(false);
    expect(p.expectedLocalStamp).toEqual({ revision: 11, metaRev: 2, updatedAt: T0 });
  });

  it("never sends created_at, publish or fork fields", () => {
    const keys = Object.keys(d2ok("n1", d2()).serverFields as object);
    for (const banned of ["created_at", "is_published", "publish_visibility", "publish_token", "forked_from_note_id", "revision", "id", "owner_id"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("the server time never goes backwards, even if this device's clock is behind", () => {
    const p = d2ok("n1", d2({ now: T0 - 5000 }));
    expect(p.newUpdatedAt).toBe(T0 + 1);
  });

  it("a note in this device's trash stays in the hosted trash", () => {
    const base = d2().local;
    const p = d2ok("n1", d2({ local: { ...base, deleted_at: T0 } }));
    expect(p.serverFields?.deleted_at).toBe(new Date(T0).toISOString());
  });

  it("a note with no parent needs no ancestor check", () => {
    const base = d2().local;
    const p = d2ok("n1", d2({ local: { ...base, parent_id: null } }));
    expect(p.ensureAncestorsOf).toBeNull();
  });

  it("always backs up mine first, because mine is the only copy left", () => {
    const p = d2ok("n1", d2());
    expect(p.backup).toEqual({
      noteId: "n1",
      kind: "purge",
      hostedRevision: 7,
      mineTitle: "Mine title",
      mineContent: '{"type":"doc","mine":true}',
      theirsTitle: null,
      theirsContent: null,
    });
  });

  it("warns that publish and share state are not restored", () => {
    expect(d2ok("n1", d2()).notes).toHaveLength(1);
  });
});

describe("planD2 — let the delete go", () => {
  it("backs up mine and deletes locally; nothing is written hosted", () => {
    const p = d2ok("n1", d2({ choice: "let_go" }));
    expect(p.backup.mineContent).toBe('{"type":"doc","mine":true}');
    expect(p.deleteLocal).toBe(true);
    expect(p.serverFields).toBeNull();
    expect(p.serverRevisionAfter).toBeNull();
    expect(p.newUpdatedAt).toBeNull();
    expect(p.ensureAncestorsOf).toBeNull();
    expect(p.expectedLocalStamp).toEqual({ revision: 11, metaRev: 2, updatedAt: T0 });
  });
});

describe("planD2 — refusals", () => {
  it("hosted row missing", () => {
    const r = planD2("n1", d2({ hosted: { kind: "missing" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("hosted_missing");
  });
  it("a live hosted row is not a delete review", () => {
    const r = planD2("n1", d2({ hosted: { kind: "row", revision: 7 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("hosted_not_purged");
  });
});

describe("purity", () => {
  it("does not change the input it was given", () => {
    const input = d2();
    const before = JSON.stringify(input);
    planD2("n1", input);
    expect(JSON.stringify(input)).toBe(before);
    const in1 = d1();
    const before1 = JSON.stringify(in1);
    planD1("n1", in1);
    expect(JSON.stringify(in1)).toBe(before1);
  });
});
