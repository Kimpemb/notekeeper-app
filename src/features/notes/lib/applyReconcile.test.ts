// src/features/notes/lib/applyReconcile.test.ts
//
// End to end through the real diff: documents -> BlockMaps (same walk as
// computeBlockSnapshots) -> diffNoteRevisions -> itemsFromDiff -> applyReconcile.
// "Hashes" are the content strings themselves, as in threeWayDiff.test.ts.

import { describe, it, expect } from "vitest";
import { diffNoteRevisions, type BlockMap, type BlockSnapshot } from "./threeWayDiff";
import { applyReconcile, itemsFromDiff, type ApplyItem } from "./applyReconcile";
import { blockIdOf, collectBlockIds, type DocNode } from "./reconcileGate";
import type { ReconcileAction } from "./reconcileSession";

// ─── Helpers ──────────────────────────────────────────────────────────────

const t = (text: string): DocNode => ({ type: "text", text });
const para = (id: string, text: string): DocNode => ({ type: "paragraph", attrs: { blockId: id }, content: [t(text)] });
const doc = (...c: DocNode[]): DocNode => ({ type: "doc", content: c });
const hr = (): DocNode => ({ type: "horizontalRule" });
const toggle = (id: string, summary: string, ...body: DocNode[]): DocNode => ({
  type: "toggle",
  attrs: { blockId: id },
  content: [
    { type: "toggleSummary", content: [t(summary)] },
    { type: "toggleBody", content: body },
  ],
});

function snap(n: DocNode): BlockSnapshot {
  const content = JSON.stringify(n);
  return { blockId: blockIdOf(n) as string, content, hash: content };
}

/** Same walk as computeBlockSnapshots: one entry per node that has a blockId. */
function mapFromDoc(d: DocNode): BlockMap {
  const map: BlockMap = new Map();
  const walk = (n: DocNode): void => {
    if (blockIdOf(n)) map.set(blockIdOf(n) as string, snap(n));
    for (const c of n.content ?? []) walk(c);
  };
  walk(d);
  return map;
}

function run(
  base: DocNode | null,
  theirs: DocNode,
  mine: DocNode,
  choices: Record<string, ReconcileAction> = {}
) {
  const results = diffNoteRevisions(base ? mapFromDoc(base) : null, mapFromDoc(theirs), mapFromDoc(mine));
  const items = itemsFromDiff(results, choices);
  return { results, items, applied: applyReconcile(mine, theirs, items) };
}

const topIds = (d: DocNode): string[] => (d.content ?? []).map((c) => blockIdOf(c) ?? (c.type as string));
const json = (d: DocNode): string => JSON.stringify(d);

// ─── Automatic cases ──────────────────────────────────────────────────────

describe("applyReconcile — automatic merges", () => {
  it("toggle worked example: both edits survive and nothing needs a decision", () => {
    const base = doc(toggle("T1", "Meeting notes", para("P1", "Discussed roadmap"), para("P2", "Action items pending")));
    const theirs = doc(toggle("T1", "Meeting notes", para("P1", "Discussed roadmap and Q3 budget"), para("P2", "Action items pending")));
    const mine = doc(toggle("T1", "Meeting notes", para("P1", "Discussed roadmap"), para("P2", "Action items: assigned to Jay")));

    const { items, applied } = run(base, theirs, mine);
    expect(items.every((i) => i.status === "auto")).toBe(true);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(json(applied.doc)).toContain("Discussed roadmap and Q3 budget");
      expect(json(applied.doc)).toContain("Action items: assigned to Jay");
      expect(applied.counts).toEqual({ replaced: 1, inserted: 0, removed: 0 });
    }
  });

  it("does not modify its inputs", () => {
    const base = doc(para("A", "a"), para("B", "b"));
    const theirs = doc(para("A", "a2"), para("B", "b"), para("N", "new"));
    const mine = doc(para("A", "a"), para("B", "b2"));
    const mineCopy = JSON.parse(JSON.stringify(mine));
    const theirsCopy = JSON.parse(JSON.stringify(theirs));
    run(base, theirs, mine);
    expect(mine).toEqual(mineCopy);
    expect(theirs).toEqual(theirsCopy);
  });

  it("mine deleted a block theirs never touched: stays deleted and is not reported missing", () => {
    const base = doc(para("A", "a"), para("B", "b"));
    const { applied } = run(base, doc(para("A", "a"), para("B", "b")), doc(para("A", "a")));
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(topIds(applied.doc)).toEqual(["A"]);
  });
});

// ─── Insert position ──────────────────────────────────────────────────────

describe("applyReconcile — where added blocks go", () => {
  it("goes after its previous sibling in theirs", () => {
    const base = doc(para("A", "a"), para("C", "c"));
    const { applied } = run(base, doc(para("A", "a"), para("N", "new"), para("C", "c")), base);
    expect(applied.ok && topIds(applied.doc)).toEqual(["A", "N", "C"]);
  });

  it("keeps the order of consecutive new blocks", () => {
    const base = doc(para("A", "a"), para("C", "c"));
    const theirs = doc(para("A", "a"), para("N1", "one"), para("N2", "two"), para("C", "c"));
    const { applied } = run(base, theirs, base);
    expect(applied.ok && topIds(applied.doc)).toEqual(["A", "N1", "N2", "C"]);
  });

  it("skips untracked siblings when looking for an anchor", () => {
    const base = doc(para("A", "a"));
    const theirs = doc(para("A", "a"), hr(), para("N", "new"));
    const { applied } = run(base, theirs, base);
    expect(applied.ok && topIds(applied.doc)).toEqual(["A", "N"]);
  });

  it("uses the next sibling when the previous one is gone from mine", () => {
    const base = doc(para("A", "a"), para("C", "c"));
    const theirs = doc(para("A", "a"), para("N", "new"), para("C", "c"));
    const mine = doc(para("C", "c")); // mine deleted A
    const { applied } = run(base, theirs, mine);
    expect(applied.ok && topIds(applied.doc)).toEqual(["N", "C"]);
  });

  it("goes to the start of the document when it was first under the root and nothing anchors it", () => {
    const base = doc(para("A", "a"));
    const theirs = doc(para("A", "a"), para("N", "new"));
    const mine = doc(); // mine deleted A
    const { applied } = run(base, theirs, mine);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(topIds(applied.doc)).toEqual(["N"]);
      expect(applied.notes).toEqual([]);
    }
  });

  it("stays inside the same container (a toggle body), not the root", () => {
    const base = doc(toggle("T1", "s", para("P1", "1"), para("P2", "2")));
    const theirs = doc(toggle("T1", "s", para("P1", "1"), para("P2", "2"), para("P3", "3")));
    const { applied } = run(base, theirs, base);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(topIds(applied.doc)).toEqual(["T1"]);
      expect(collectBlockIds(applied.doc)).toEqual(["T1", "P1", "P2", "P3"]);
    }
  });

  it("an added subtree is inserted once, with its children", () => {
    const base = doc(para("A", "a"));
    const theirs = doc(para("A", "a"), toggle("T2", "s", para("P5", "5"), para("P6", "6")));
    const { results, applied } = run(base, theirs, base);
    expect(results).toHaveLength(1);
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(collectBlockIds(applied.doc)).toEqual(["A", "T2", "P5", "P6"]);
  });

  it("falls back to the end of the note, with a note, when the container cannot be found", () => {
    const theirs = doc(toggle("T1", "s", para("NEW", "x")));
    const mine = doc(toggle("T1", "s"));
    const items: ApplyItem[] = [{ blockId: "NEW", classification: "added", status: "auto", theirs: snap(para("NEW", "x")) }];
    const applied = applyReconcile(mine, theirs, items);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(topIds(applied.doc)).toEqual(["T1", "NEW"]);
      expect(applied.notes).toHaveLength(1);
      expect(applied.notes[0]).toContain("NEW");
    }
  });
});

// ─── Decisions ────────────────────────────────────────────────────────────

describe("applyReconcile — conflicts", () => {
  const base = doc(para("P1", "a"));
  const theirs = doc(para("P1", "b"));
  const mine = doc(para("P1", "c"));

  it("keep_mine leaves mine's text", () => {
    const { applied } = run(base, theirs, mine, { P1: "keep_mine" });
    expect(applied.ok && json(applied.doc)).toContain('"text":"c"');
  });

  it("take_theirs uses theirs' text", () => {
    const { applied } = run(base, theirs, mine, { P1: "take_theirs" });
    expect(applied.ok && json(applied.doc)).toContain('"text":"b"');
  });

  it("an undecided conflict is refused", () => {
    const { applied } = run(base, theirs, mine);
    expect(applied).toEqual({ ok: false, reason: "unresolved_item", detail: ["P1"] });
  });

  it("merge_ai is not offered in 4d.3 and is refused", () => {
    const { applied } = run(base, theirs, mine, { P1: "merge_ai" });
    expect(applied.ok).toBe(false);
  });
});

describe("applyReconcile — delete versus edit", () => {
  it("source_deleted defaults to keeping the block", () => {
    const base = doc(para("A", "a"), para("B", "b"));
    const { items, applied } = run(base, doc(para("A", "a")), base);
    expect(items.find((i) => i.blockId === "B")?.chosenAction).toBe("keep_local");
    expect(applied.ok && topIds(applied.doc)).toEqual(["A", "B"]);
  });

  it("source_deleted + remove_here_too removes it and is not reported missing", () => {
    const base = doc(para("A", "a"), para("B", "b"));
    const { applied } = run(base, doc(para("A", "a")), base, { B: "remove_here_too" });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(topIds(applied.doc)).toEqual(["A"]);
      expect(applied.counts.removed).toBe(1);
    }
  });

  it("mine deleted a block theirs edited: stays deleted by default", () => {
    const base = doc(para("A", "a"), para("B", "b"), para("C", "c"));
    const theirs = doc(para("A", "a"), para("B", "b edited"), para("C", "c"));
    const mine = doc(para("A", "a"), para("C", "c"));
    const { items, applied } = run(base, theirs, mine);
    expect(items.find((i) => i.blockId === "B")?.chosenAction).toBe("keep_local");
    expect(applied.ok && topIds(applied.doc)).toEqual(["A", "C"]);
  });

  it("restore_theirs brings the edited block back in its place", () => {
    const base = doc(para("A", "a"), para("B", "b"), para("C", "c"));
    const theirs = doc(para("A", "a"), para("B", "b edited"), para("C", "c"));
    const mine = doc(para("A", "a"), para("C", "c"));
    const { applied } = run(base, theirs, mine, { B: "restore_theirs" });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(topIds(applied.doc)).toEqual(["A", "B", "C"]);
      expect(json(applied.doc)).toContain("b edited");
    }
  });
});

// ─── No base ──────────────────────────────────────────────────────────────

describe("applyReconcile — no common ancestor", () => {
  it("identical blocks need nothing; a block only in theirs is added", () => {
    const theirs = doc(para("A", "a"), para("N", "new"));
    const mine = doc(para("A", "a"));
    const { applied } = run(null, theirs, mine);
    expect(applied.ok && topIds(applied.doc)).toEqual(["A", "N"]);
  });

  it("a differing block is a conflict and honours the choice", () => {
    const theirs = doc(para("A", "theirs text"));
    const mine = doc(para("A", "mine text"));
    expect(run(null, theirs, mine).applied.ok).toBe(false);
    const chosen = run(null, theirs, mine, { A: "take_theirs" }).applied;
    expect(chosen.ok && json(chosen.doc)).toContain("theirs text");
  });
});

// ─── Safety checks ────────────────────────────────────────────────────────

describe("applyReconcile — refuses unsafe input", () => {
  it("duplicate ids on either side", () => {
    const mine = doc(para("X", "one"), para("X", "two"));
    const applied = applyReconcile(mine, doc(para("X", "one")), []);
    expect(applied).toEqual({ ok: false, reason: "duplicate_block_ids", detail: ["X"] });
  });

  it("a block from theirs that no item accounts for is reported missing", () => {
    const applied = applyReconcile(doc(para("A", "a")), doc(para("A", "a"), para("N", "new")), []);
    expect(applied).toEqual({ ok: false, reason: "missing_blocks", detail: ["N"] });
  });

  it("an item that points at a block mine does not have", () => {
    const items: ApplyItem[] = [{ blockId: "ZZ", classification: "pulled_theirs", status: "auto", theirs: snap(para("ZZ", "x")) }];
    const applied = applyReconcile(doc(para("A", "a")), doc(para("A", "a")), items);
    expect(applied).toEqual({ ok: false, reason: "item_not_found", detail: ["ZZ"] });
  });
});
