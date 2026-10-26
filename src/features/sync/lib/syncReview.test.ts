// src/features/sync/lib/syncReview.test.ts
//
// assembleReview is pure, so these tests build documents and BlockMaps the same
// way applyReconcile.test.ts does. "Hashes" are the content strings themselves.
// buildSyncReview (the DB and network wrapper, in syncReview.ts) is checked by
// hand against the fixtures, not here, because importing it pulls in the
// Supabase client.

import { describe, it, expect } from "vitest";
import type { BlockMap } from "@/features/notes/lib/threeWayDiff";
import { blockIdOf, type DocNode } from "@/features/notes/lib/reconcileGate";
import { assembleReview, type ReviewCore } from "./reviewAssemble";

const t = (text: string): DocNode => ({ type: "text", text });
const para = (id: string, text: string): DocNode => ({ type: "paragraph", attrs: { blockId: id }, content: [t(text)] });
const doc = (...c: DocNode[]): DocNode => ({ type: "doc", content: c });
const hr = (): DocNode => ({ type: "horizontalRule" });

function mapFromDoc(d: DocNode): BlockMap {
  const map: BlockMap = new Map();
  const walk = (n: DocNode): void => {
    const id = blockIdOf(n);
    if (id) {
      const content = JSON.stringify(n);
      map.set(id, { blockId: id, content, hash: content });
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(d);
  return map;
}

function review(base: DocNode | null, theirs: DocNode, mine: DocNode, choices = {}, gate = {}): ReviewCore {
  const r = assembleReview({
    theirsContent: JSON.stringify(theirs),
    mineContent: JSON.stringify(mine),
    base: base ? mapFromDoc(base) : null,
    theirsMap: mapFromDoc(theirs),
    mineMap: mapFromDoc(mine),
    choices,
    gate,
  });
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("assembleReview", () => {
  it("both sides identical: mode identical, nothing to do", () => {
    const d = doc(para("A", "a"), para("B", "b"));
    const r = review(d, d, d);
    expect(r.mode).toBe("identical");
    expect(r.counts).toMatchObject({ auto: 0, pending: 0, conflicts: 0 });
  });

  it("non-overlapping edits merge on their own (the Test C&D shape)", () => {
    const base = doc(para("A", "a"), para("B", "b"));
    const theirs = doc(para("A", "a edited"), para("B", "b"), para("N", "new"));
    const mine = doc(para("A", "a"), para("B", "b"), para("L", "local"));
    const r = review(base, theirs, mine);
    expect(r.mode).toBe("block");
    expect(r.counts.pending).toBe(0);
    expect(r.counts.auto).toBe(3); // one pulled, two added
    expect(r.baseKind).toBe("snapshot");
  });

  it("the same block edited on both sides is a conflict with no default", () => {
    const base = doc(para("P", "a"));
    const r = review(base, doc(para("P", "b")), doc(para("P", "c")));
    expect(r.mode).toBe("block");
    expect(r.counts).toMatchObject({ pending: 1, conflicts: 1 });
    const item = r.items.find((i) => i.blockId === "P");
    expect(item?.status).toBe("pending");
    expect(item?.chosenAction).toBeUndefined();
  });

  it("a saved choice resolves the conflict", () => {
    const base = doc(para("P", "a"));
    const r = review(base, doc(para("P", "b")), doc(para("P", "c")), { P: "take_theirs" });
    expect(r.counts).toMatchObject({ pending: 0, resolved: 1, conflicts: 1 });
    expect(r.items.find((i) => i.blockId === "P")?.chosenAction).toBe("take_theirs");
  });

  it("delete-versus-edit items arrive with their default (keep local)", () => {
    const base = doc(para("A", "a"), para("B", "b"));
    const r = review(base, doc(para("A", "a")), base); // theirs deleted B, mine untouched
    const b = r.items.find((i) => i.blockId === "B");
    expect(b?.classification).toBe("source_deleted");
    expect(b?.status).toBe("resolved");
    expect(b?.chosenAction).toBe("keep_local");
  });

  it("no base: direct comparison, and a differing block is a conflict", () => {
    const r = review(null, doc(para("A", "theirs")), doc(para("A", "mine")));
    expect(r.baseKind).toBe("none");
    expect(r.mapSizes.base).toBeNull();
    expect(r.counts.conflicts).toBe(1);
  });

  it("the gate sends the note to the whole-note review when untracked content differs", () => {
    const base = doc(para("A", "a"));
    const r = review(base, doc(para("A", "a"), hr()), doc(para("A", "a")));
    expect(r.mode).toBe("whole_note");
    expect(r.gate.ok).toBe(false);
  });

  it("the size guard sends a large note to the whole-note review", () => {
    const d = doc(para("A", "a"), para("B", "b"), para("C", "c"));
    const r = review(d, d, d, {}, { maxBlocks: 2 });
    expect(r.mode).toBe("whole_note");
  });

  it("reports the map sizes", () => {
    const base = doc(para("A", "a"));
    const r = review(base, doc(para("A", "a"), para("B", "b")), doc(para("A", "a")));
    expect(r.mapSizes).toEqual({ base: 1, theirs: 2, mine: 1 });
  });

  it("unparseable content is reported, not thrown", () => {
    const r = assembleReview({
      theirsContent: "not json",
      mineContent: "{}",
      base: null,
      theirsMap: new Map(),
      mineMap: new Map(),
    });
    expect(r).toEqual({ error: "unparseable" });
  });
});
