// src/features/sync/lib/commitPlan.test.ts
//
// planCommit is pure, so these run in the node environment with no database.
// Block merges go through the real diff and applyReconcile (documents ->
// BlockMaps -> diffNoteRevisions -> itemsFromDiff -> planCommit).

import { describe, it, expect } from "vitest";
import { diffNoteRevisions, type BlockMap, type BlockSnapshot } from "@/features/notes/lib/threeWayDiff";
import { itemsFromDiff, type ApplyItem } from "@/features/notes/lib/applyReconcile";
import { blockIdOf, type DocNode } from "@/features/notes/lib/reconcileGate";
import type { ReconcileAction } from "@/features/notes/lib/reconcileSession";
import {
  planCommit,
  type CommitPlan,
  type CommitReviewInput,
  type MetaSide,
  type PlanInput,
} from "@/features/sync/lib/commitPlan";

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function itemsFor(base: DocNode, theirs: DocNode, mine: DocNode, choices: Record<string, ReconcileAction> = {}): ApplyItem[] {
  return itemsFromDiff(diffNoteRevisions(mapFromDoc(base), mapFromDoc(theirs), mapFromDoc(mine)), choices);
}

const baseMeta: MetaSide = {
  title: "Title",
  parentId: null,
  sortOrder: 1,
  tags: null,
  frontmatter: null,
  deletedAt: null,
  plaintext: "plain",
};

function review(mineDoc: DocNode, theirsDoc: DocNode, over: Partial<CommitReviewInput> = {}): CommitReviewInput {
  return {
    mode: "block",
    mineContent: JSON.stringify(mineDoc),
    theirsContent: JSON.stringify(theirsDoc),
    theirsServerRevision: 5,
    mineStamp: { revision: 3, metaRev: 1, updatedAt: 1000 },
    syncedMetaRev: 1, // unchanged here by default
    mine: { ...baseMeta, plaintext: "mine text" },
    remote: { ...baseMeta, plaintext: "theirs text" },
    ...over,
  };
}

function input(r: CommitReviewInput, items: ApplyItem[], over: Partial<PlanInput> = {}): PlanInput {
  return {
    review: r,
    variant: "block_merge",
    items,
    metaChoices: {},
    parentExistsLocally: true,
    storedMatchedGeneratedBefore: false,
    now: 2000,
    ...over,
  };
}

function ok(result: ReturnType<typeof planCommit>): CommitPlan {
  if (!result.ok) throw new Error(`plan failed: ${result.reason} ${result.detail.join(",")}`);
  return result.plan;
}

const iso = (ms: number): string => new Date(ms).toISOString();

// ─── Block merge ──────────────────────────────────────────────────────────

describe("planCommit — block merge", () => {
  const base = doc(para("A", "a"), para("C", "c"));
  const theirs = doc(para("A", "a2"), para("C", "c"));
  const mine = doc(para("A", "a"), para("C", "c"), para("N", "new"));

  it("merges both sides, writes both, and bumps the server revision", () => {
    const plan = ok(planCommit(input(review(mine, theirs), itemsFor(base, theirs, mine))));
    expect(plan.mergedContent).toContain("a2");
    expect(plan.mergedContent).toContain("new");
    expect(plan.serverFields?.content).toBe(plan.mergedContent);
    expect(plan.localFields?.content).toBe(plan.mergedContent);
    expect(plan.expectedServerRevision).toBe(5);
    expect(plan.serverRevisionAfter).toBe(6);
    expect(plan.expectedLocalAfter).toEqual({ revision: 4, metaRev: 1, updatedAt: 2000 });
    expect(plan.backupKind).toBe("merge");
    expect(plan.reindex).toBe(true);
  });

  it("sends the server only the fields it owns (never created_at, publish or fork fields)", () => {
    const plan = ok(planCommit(input(review(mine, theirs), itemsFor(base, theirs, mine))));
    const allowed = ["title", "content", "plaintext", "tags", "parent_id", "sort_order", "frontmatter", "updated_at", "deleted_at"];
    expect(Object.keys(plan.serverFields ?? {}).every((k) => allowed.includes(k))).toBe(true);
    expect(plan.serverFields).not.toHaveProperty("created_at");
    expect(plan.serverFields).not.toHaveProperty("is_published");
  });

  it("uses the same updated_at on both sides", () => {
    const plan = ok(planCommit(input(review(mine, theirs), itemsFor(base, theirs, mine))));
    expect(plan.localFields?.updated_at).toBe(2000);
    expect(plan.serverFields?.updated_at).toBe(iso(2000));
  });

  it("never lets updated_at go backwards or stay equal to the old one", () => {
    const r = review(mine, theirs, { mineStamp: { revision: 3, metaRev: 1, updatedAt: 5000 } });
    const plan = ok(planCommit(input(r, itemsFor(base, theirs, mine), { now: 2000 })));
    expect(plan.newUpdatedAt).toBe(5001);
    expect(plan.localFields?.updated_at).toBe(5001);
  });

  it("when the result equals theirs, the server is not written and the revision does not move", () => {
    const b = doc(para("A", "a"));
    const th = doc(para("A", "b"));
    const mi = doc(para("A", "a"));
    const plan = ok(planCommit(input(review(mi, th), itemsFor(b, th, mi))));
    expect(plan.serverFields).toBeNull();
    expect(plan.serverRevisionAfter).toBe(5);
    expect(plan.localFields?.content).toBe(JSON.stringify(th));
    expect(plan.localFields?.plaintext).toBe("theirs text"); // exact: the result is theirs' content
  });

  it("when the result equals mine, this device is not written but the server is", () => {
    const b = doc(para("A", "a"));
    const th = doc(para("A", "b"));
    const mi = doc(para("A", "c"));
    const items = itemsFor(b, th, mi, { A: "keep_mine" });
    const plan = ok(planCommit(input(review(mi, th), items)));
    expect(plan.localFields).toBeNull();
    expect(plan.serverFields?.content).toBe(JSON.stringify(mi));
    expect(plan.serverFields?.plaintext).toBe("mine text");
    expect(plan.serverFields?.updated_at).toBe(iso(2000)); // the server always gets the new time
    expect(plan.newUpdatedAt).toBe(2000);
    expect(plan.expectedLocalAfter).toEqual({ revision: 3, metaRev: 1, updatedAt: 1000 });
    expect(plan.serverRevisionAfter).toBe(6);
  });

  it("refuses an undecided conflict", () => {
    const b = doc(para("A", "a"));
    const th = doc(para("A", "b"));
    const mi = doc(para("A", "c"));
    const result = planCommit(input(review(mi, th), itemsFor(b, th, mi)));
    expect(result).toEqual({ ok: false, reason: "unresolved_item", detail: ["A"] });
  });

  it("refuses when a block would be lost", () => {
    const b = doc(para("A", "a"));
    const th = doc(para("A", "a"), para("N", "new"));
    const mi = doc(para("A", "a"));
    const result = planCommit(input(review(mi, th), []));
    expect(result).toEqual({ ok: false, reason: "missing_blocks", detail: ["N"] });
    expect(b).toBeDefined();
  });
});

// ─── Search text ──────────────────────────────────────────────────────────

describe("planCommit — search text", () => {
  const base = doc(para("A", "a"), para("C", "c"));
  const theirs = doc(para("A", "a2"), para("C", "c"));
  const mine = doc(para("A", "a"), para("C", "c"), para("N", "new"));
  const items = itemsFor(base, theirs, mine);

  it("regenerates when the stored text already matched generateText before the merge", () => {
    const generate = (c: string): string => `gen:${c.length}`;
    const plan = ok(planCommit(input(review(mine, theirs), items, { storedMatchedGeneratedBefore: true, generatePlaintext: generate })));
    expect(plan.localFields?.plaintext).toBe(`gen:${plan.mergedContent.length}`);
    expect(plan.serverFields?.plaintext).toBe(`gen:${plan.mergedContent.length}`);
  });

  it("keeps mine's text, and says so, when the stored text did not match", () => {
    const generate = (): string => "should not be used";
    const plan = ok(planCommit(input(review(mine, theirs), items, { storedMatchedGeneratedBefore: false, generatePlaintext: generate })));
    expect(plan.localFields?.plaintext).toBe("mine text");
    expect(plan.notes.some((n) => n.includes("Search text"))).toBe(true);
    expect(plan.reindex).toBe(true);
  });

  it("falls back to mine's text when the generator is unavailable or returns nothing", () => {
    const a = ok(planCommit(input(review(mine, theirs), items, { storedMatchedGeneratedBefore: true })));
    expect(a.localFields?.plaintext).toBe("mine text");
    const b = ok(planCommit(input(review(mine, theirs), items, { storedMatchedGeneratedBefore: true, generatePlaintext: () => null })));
    expect(b.localFields?.plaintext).toBe("mine text");
  });
});

// ─── Metadata ─────────────────────────────────────────────────────────────

describe("planCommit — metadata (identical content, so only metadata moves)", () => {
  const same = doc(para("A", "a"));
  const idReview = (over: Partial<CommitReviewInput> = {}): CommitReviewInput =>
    review(same, same, { mode: "identical", ...over });
  const idInput = (r: CommitReviewInput, over: Partial<PlanInput> = {}): PlanInput =>
    input(r, [], { variant: "identical", ...over });

  it("nothing differs: records the agreement and writes nothing", () => {
    const plan = ok(planCommit(idInput(idReview())));
    expect(plan.serverFields).toBeNull();
    expect(plan.localFields).toBeNull();
    expect(plan.backupKind).toBeNull();
    expect(plan.serverRevisionAfter).toBe(5);
    expect(plan.expectedLocalAfter).toEqual({ revision: 3, metaRev: 1, updatedAt: 1000 });
    expect(plan.mergedContent).toBe(JSON.stringify(same));
  });

  it("this device changed no metadata: the server's title is taken without a row", () => {
    const r = idReview({ mine: { ...baseMeta, title: "Old" }, remote: { ...baseMeta, title: "New" } });
    const plan = ok(planCommit(idInput(r)));
    expect(plan.autoTaken).toEqual(["title"]);
    expect(plan.metaRows).toEqual([]);
    expect(plan.localFields?.title).toBe("New");
    expect(plan.serverFields).toBeNull();
    expect(plan.titleChanged).toBe(true);
    expect(plan.expectedLocalAfter.metaRev).toBe(2);
    expect(plan.expectedLocalAfter.revision).toBe(3); // no content change
    expect(plan.backupKind).toBe("merge");
  });

  it("this device changed metadata: a visible row, default keep mine, and the server gets mine", () => {
    const r = idReview({
      mineStamp: { revision: 3, metaRev: 2, updatedAt: 1000 },
      mine: { ...baseMeta, title: "Old" },
      remote: { ...baseMeta, title: "New" },
    });
    const plan = ok(planCommit(idInput(r)));
    expect(plan.metaRows).toEqual([
      { field: "title", mine: "Old", theirs: "New", choice: "mine", default: "mine", canTakeTheirs: true },
    ]);
    expect(plan.serverFields?.title).toBe("Old");
    expect(plan.localFields).toBeNull();
    expect(plan.titleChanged).toBe(false);
  });

  it("the user can take theirs for a row", () => {
    const r = idReview({
      mineStamp: { revision: 3, metaRev: 2, updatedAt: 1000 },
      mine: { ...baseMeta, title: "Old" },
      remote: { ...baseMeta, title: "New" },
    });
    const plan = ok(planCommit(idInput(r, { metaChoices: { title: "theirs" } })));
    expect(plan.localFields?.title).toBe("New");
    expect(plan.serverFields).toBeNull();
    expect(plan.metaRows[0].choice).toBe("theirs");
  });

  it("no sync state means nothing is auto-taken: every difference gets a row", () => {
    const r = idReview({ syncedMetaRev: null, mine: { ...baseMeta, title: "Old" }, remote: { ...baseMeta, title: "New" } });
    const plan = ok(planCommit(idInput(r)));
    expect(plan.autoTaken).toEqual([]);
    expect(plan.metaRows).toHaveLength(1);
  });

  it("a hosted parent this device does not have is never taken", () => {
    const r = idReview({ remote: { ...baseMeta, parentId: "P" } });
    const plan = ok(planCommit(idInput(r, { parentExistsLocally: false, metaChoices: { parentId: "theirs" } })));
    expect(plan.metaRows).toEqual([
      { field: "parentId", mine: null, theirs: "P", choice: "mine", default: "mine", canTakeTheirs: false },
    ]);
    expect(plan.localFields).toBeNull();
    expect(plan.serverFields?.parent_id).toBeNull();
    expect(plan.notes.some((n) => n.includes("parent"))).toBe(true);
  });

  it("trash state is always a visible row, even when this device changed nothing", () => {
    const r = idReview({ remote: { ...baseMeta, deletedAt: 1700000000000 } });
    const plan = ok(planCommit(idInput(r)));
    expect(plan.autoTaken).toEqual([]);
    expect(plan.metaRows).toHaveLength(1);
    expect(plan.metaRows[0].field).toBe("deletedAt");
    expect(plan.metaRows[0].choice).toBe("mine");
    expect(plan.serverFields?.deleted_at).toBeNull(); // keep mine: the server is restored
    expect(plan.trashChange).toBeNull();
  });

  it("taking the server's trash state trashes the note here and reports it", () => {
    const r = idReview({ remote: { ...baseMeta, deletedAt: 1700000000000 } });
    const plan = ok(planCommit(idInput(r, { metaChoices: { deletedAt: "theirs" } })));
    expect(plan.localFields?.deleted_at).toBe(1700000000000);
    expect(plan.trashChange).toBe("trashed");
    expect(plan.serverFields).toBeNull();
  });

  it("both sides trashed at different times is not a difference", () => {
    const r = idReview({ mine: { ...baseMeta, deletedAt: 1 }, remote: { ...baseMeta, deletedAt: 2 } });
    const plan = ok(planCommit(idInput(r)));
    expect(plan.metaRows).toEqual([]);
    expect(plan.serverFields).toBeNull();
    expect(plan.localFields).toBeNull();
  });
});

// ─── Whole-note variants ──────────────────────────────────────────────────

describe("planCommit — whole note", () => {
  const mineDoc = doc(para("A", "mine"));
  const theirsDoc = doc(para("A", "theirs"));
  const wholeReview = (over: Partial<CommitReviewInput> = {}): CommitReviewInput =>
    review(mineDoc, theirsDoc, { mode: "whole_note", ...over });

  it("keep mine: the server gets mine's content and text, this device is not written", () => {
    const r = wholeReview({
      mineStamp: { revision: 3, metaRev: 2, updatedAt: 1000 }, // this device changed metadata
      mine: { ...baseMeta, title: "Mine", plaintext: "mine text" },
    });
    const plan = ok(planCommit(input(r, [], { variant: "whole_keep_mine" })));
    expect(plan.serverFields?.content).toBe(JSON.stringify(mineDoc));
    expect(plan.serverFields?.plaintext).toBe("mine text");
    expect(plan.serverFields?.title).toBe("Mine");
    expect(plan.serverFields?.updated_at).toBe(iso(2000));
    expect(plan.metaRows.map((row) => row.field)).toEqual(["title"]);
    expect(plan.localFields).toBeNull();
    expect(plan.backupKind).toBe("whole_note");
    expect(plan.serverRevisionAfter).toBe(6);
  });

  it("keep mine still takes the server's title when this device changed no metadata", () => {
    const r = wholeReview({
      mine: { ...baseMeta, title: "Old", plaintext: "mine text" },
      remote: { ...baseMeta, title: "New", plaintext: "theirs text" },
    });
    const plan = ok(planCommit(input(r, [], { variant: "whole_keep_mine" })));
    expect(plan.autoTaken).toEqual(["title"]);
    expect(plan.serverFields).not.toHaveProperty("title"); // the server already has it
    expect(plan.localFields?.title).toBe("New");
    expect(plan.serverFields?.content).toBe(JSON.stringify(mineDoc));
  });

  it("take theirs: this device gets theirs' content, text and metadata, the server is not written", () => {
    const r = wholeReview({ remote: { ...baseMeta, title: "Theirs", plaintext: "theirs text" } });
    const plan = ok(planCommit(input(r, [], { variant: "whole_take_theirs" })));
    expect(plan.serverFields).toBeNull();
    expect(plan.serverRevisionAfter).toBe(5);
    expect(plan.localFields?.content).toBe(JSON.stringify(theirsDoc));
    expect(plan.localFields?.plaintext).toBe("theirs text");
    expect(plan.localFields?.title).toBe("Theirs");
    expect(plan.localFields?.updated_at).toBe(2000);
    expect(plan.expectedLocalAfter).toEqual({ revision: 4, metaRev: 2, updatedAt: 2000 });
    expect(plan.backupKind).toBe("whole_note");
  });

  it("take theirs keeps this device's own rename (a visible row, default mine)", () => {
    const r = wholeReview({
      mineStamp: { revision: 3, metaRev: 2, updatedAt: 1000 },
      mine: { ...baseMeta, title: "Mine", plaintext: "mine text" },
      remote: { ...baseMeta, title: "Theirs", plaintext: "theirs text" },
    });
    const plan = ok(planCommit(input(r, [], { variant: "whole_take_theirs" })));
    expect(plan.metaRows.map((row) => row.field)).toEqual(["title"]);
    expect(plan.localFields?.content).toBe(JSON.stringify(theirsDoc));
    expect(plan.localFields).not.toHaveProperty("title");
    expect(plan.serverFields?.title).toBe("Mine"); // this device's rename goes to the server
    expect(plan.serverFields).not.toHaveProperty("content"); // content already is theirs'
  });

  it("take theirs keeps this device's parent when the hosted parent is missing here", () => {
    const r = wholeReview({ remote: { ...baseMeta, parentId: "P", plaintext: "theirs text" } });
    const plan = ok(planCommit(input(r, [], { variant: "whole_take_theirs", parentExistsLocally: false })));
    expect(plan.localFields).not.toHaveProperty("parent_id");
    expect(plan.notes.some((n) => n.includes("parent"))).toBe(true);
  });
});

// ─── Variant guards ───────────────────────────────────────────────────────

describe("planCommit — variant guards", () => {
  const d = doc(para("A", "a"));

  it("a block merge needs a block review", () => {
    const r = review(d, d, { mode: "whole_note" });
    expect(planCommit(input(r, [])).ok).toBe(false);
  });

  it("identical needs an identical review", () => {
    const r = review(d, d, { mode: "block" });
    const result = planCommit(input(r, [], { variant: "identical" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("variant_not_allowed");
  });

  it("whole-note variants need a whole-note review", () => {
    const r = review(d, d, { mode: "block" });
    expect(planCommit(input(r, [], { variant: "whole_keep_mine" })).ok).toBe(false);
    expect(planCommit(input(r, [], { variant: "whole_take_theirs" })).ok).toBe(false);
  });

  it("keep both needs a whole-note review", () => {
    const r = review(d, d, { mode: "block" });
    const result = planCommit(input(r, [], { variant: "whole_keep_both", newId: idGen() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("variant_not_allowed");
  });

  it("does not change the review it was given", () => {
    const base = doc(para("A", "a"));
    const th = doc(para("A", "b"));
    const mi = doc(para("A", "a"));
    const r = review(mi, th);
    const copy = JSON.parse(JSON.stringify(r)) as CommitReviewInput;
    planCommit(input(r, itemsFor(base, th, mi)));
    expect(r).toEqual(copy);
  });
});

// ─── Keep both ────────────────────────────────────────────────────────────

const idGen = () => {
  let n = 0;
  return () => `n-${++n}`;
};

describe("planCommit — whole_keep_both", () => {
  const mineDoc = doc(para("A", "mine"));
  const theirsDoc = doc(para("A", "theirs"));
  const r = () => review(mineDoc, theirsDoc, { mode: "whole_note" });
  const run = (over: Partial<PlanInput> = {}) =>
    planCommit(input(r(), [], { variant: "whole_keep_both", newId: idGen(), ...over }));

  it("writes mine to the server, nothing to this device, and plans the copy", () => {
    const plan = ok(run());
    expect(plan.serverFields?.content).toBe(JSON.stringify(mineDoc));
    expect(plan.localFields).toBeNull();
    expect(plan.serverRevisionAfter).toBe(6);
    expect(plan.expectedLocalAfter).toEqual({ revision: 3, metaRev: 1, updatedAt: 1000 });
    expect(plan.backupKind).toBe("whole_note");
    expect(plan.reindex).toBe(false);
    expect(plan.copy).not.toBeNull();
  });

  it("builds the copy from theirs with fresh ids and a conflict title", () => {
    const copy = ok(run()).copy;
    expect(copy?.noteId).toBe("n-1");
    expect(copy?.title).toBe("Title (conflict copy)");
    expect(copy?.parentId).toBeNull();
    expect(copy?.plaintext).toBe("theirs text");
    expect(copy?.createdAt).toBe(2000);
    const parsed = JSON.parse(copy?.content as string);
    expect(parsed.content[0].attrs.blockId).toBe("n-2");
    expect(parsed.content[0].content[0].text).toBe("theirs");
  });

  it("fails without an id generator", () => {
    const result = planCommit(input(r(), [], { variant: "whole_keep_both" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("copy_failed");
  });

  it("fails when theirs' content is not valid JSON", () => {
    const bad = review(mineDoc, theirsDoc, { mode: "whole_note", theirsContent: "{nope" });
    const result = planCommit(input(bad, [], { variant: "whole_keep_both", newId: idGen() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("copy_failed");
  });

  it("other variants plan no copy", () => {
    const keep = planCommit(input(r(), [], { variant: "whole_keep_mine" }));
    expect(ok(keep).copy).toBeNull();
  });
});