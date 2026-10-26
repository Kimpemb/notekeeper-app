// src/features/notes/lib/reconcileGate.test.ts

import { describe, it, expect } from "vitest";
import {
  collectBlockIds,
  countUnstampedTrackedBlocks,
  describeGateReason,
  differingPaths,
  evaluateGate,
  findDuplicateBlockIds,
  untrackedSequence,
  type DocNode,
  type GateReasonCode,
} from "./reconcileGate";

const t = (text: string): DocNode => ({ type: "text", text });
const para = (id: string, text: string): DocNode => ({ type: "paragraph", attrs: { blockId: id }, content: [t(text)] });
const doc = (...c: DocNode[]): DocNode => ({ type: "doc", content: c });
const hr = (): DocNode => ({ type: "horizontalRule" });
const image = (attrs: Record<string, unknown>): DocNode => ({ type: "image", attrs: attrs as DocNode["attrs"] });
const callout = (...c: DocNode[]): DocNode => ({ type: "callout", attrs: { kind: "info" }, content: c });

describe("block id helpers", () => {
  it("collects ids in document order, nested ones included", () => {
    const d = doc(para("A", "a"), { type: "toggle", attrs: { blockId: "T" }, content: [{ type: "toggleBody", content: [para("B", "b")] }] });
    expect(collectBlockIds(d)).toEqual(["A", "T", "B"]);
  });

  it("finds an id repeated anywhere in the tree", () => {
    const d = doc(para("A", "a"), { type: "toggle", attrs: { blockId: "T" }, content: [{ type: "toggleBody", content: [para("A", "again")] }] });
    expect(findDuplicateBlockIds(d)).toEqual(["A"]);
  });

  it("counts unstamped tracked blocks nested inside untracked wrappers", () => {
    const d = doc({
      type: "table",
      attrs: { blockId: "TB" },
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [t("x")] }] }] }],
    });
    expect(countUnstampedTrackedBlocks(d)).toBe(1);
  });

  it("counts an unstamped listItem too", () => {
    const d = doc({ type: "bulletList", attrs: { blockId: "L" }, content: [{ type: "listItem", content: [] }] });
    expect(countUnstampedTrackedBlocks(d)).toBe(1);
  });

  it("untracked node types with no id are not counted as unstamped", () => {
    expect(countUnstampedTrackedBlocks(doc(hr(), image({ src: "a" })))).toBe(0);
  });
});

describe("untrackedSequence", () => {
  it("skips tracked top-level nodes and keeps untracked ones in order", () => {
    const d = doc(para("A", "a"), hr(), para("B", "b"), image({ src: "x" }));
    expect(untrackedSequence(d)).toHaveLength(2);
  });

  it("ignores key order inside attrs", () => {
    const a = doc(image({ a: 1, b: 2 }));
    const b = doc(image({ b: 2, a: 1 }));
    expect(untrackedSequence(a)).toEqual(untrackedSequence(b));
  });

  it("replaces tracked descendants with a placeholder", () => {
    const a = doc(callout(para("C1", "before")));
    const b = doc(callout(para("C1", "after")));
    expect(untrackedSequence(a)).toEqual(untrackedSequence(b));
  });

  it("ignoreAttrs hides a volatile attribute", () => {
    const a = doc(image({ src: "a", ts: 1 }));
    const b = doc(image({ src: "a", ts: 2 }));
    expect(untrackedSequence(a)).not.toEqual(untrackedSequence(b));
    expect(untrackedSequence(a, ["ts"])).toEqual(untrackedSequence(b, ["ts"]));
  });
});

describe("evaluateGate", () => {
  it("an empty document passes", () => {
    expect(evaluateGate(doc(), doc())).toEqual({ ok: true });
  });

  it("identical untracked content and stamped blocks pass", () => {
    const d = doc(para("A", "a"), hr(), image({ src: "x" }));
    expect(evaluateGate(d, d)).toEqual({ ok: true });
  });

  it("a tracked edit inside an untracked wrapper does not trip the gate", () => {
    const theirs = doc(callout(para("C1", "theirs")));
    const mine = doc(callout(para("C1", "mine")));
    expect(evaluateGate(theirs, mine)).toEqual({ ok: true });
  });

  it("differing untracked content trips the gate", () => {
    const theirs = doc(para("A", "a"), hr());
    const mine = doc(para("A", "a"));
    const verdict = evaluateGate(theirs, mine);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reasons.map((r) => r.code)).toContain("untracked_differs");
  });

  it("a duplicate id on either side trips the gate and names the side", () => {
    const theirs = doc(para("A", "a"));
    const mine = doc(para("A", "a"), para("A", "copy"));
    const verdict = evaluateGate(theirs, mine);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      const r = verdict.reasons.find((x) => x.code === "duplicate_block_ids");
      expect(r?.side).toBe("mine");
    }
  });

  it("an unstamped tracked block trips the gate", () => {
    const theirs = doc({ type: "paragraph", content: [t("no id")] });
    const verdict = evaluateGate(theirs, doc());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reasons[0].code).toBe("unstamped_blocks");
  });

  it("the size guard trips on both sides", () => {
    const d = doc(para("A", "a"), para("B", "b"), para("C", "c"));
    const verdict = evaluateGate(d, d, { maxBlocks: 2 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reasons.filter((r) => r.code === "too_many_blocks")).toHaveLength(2);
  });
});

describe("describeGateReason", () => {
  it("uses plain words, never internal terms", () => {
    const codes: GateReasonCode[] = ["duplicate_block_ids", "unstamped_blocks", "too_many_blocks", "untracked_differs", "container_differs"];
    for (const code of codes) {
      const text = describeGateReason({ code, side: "both", detail: "x" });
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/blockId|hash|revision|CAS|id\b/i);
    }
  });
});

describe("differingPaths", () => {
  it("returns the paths where two values differ", () => {
    expect(differingPaths({ x: { y: 1, z: 1 } }, { x: { y: 2, z: 1 } })).toEqual(["x.y"]);
  });

  it("reports a key present on one side only", () => {
    expect(differingPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
  });

  it("returns nothing for equal values", () => {
    expect(differingPaths({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });
});

describe("container shells", () => {
  const tg = (summary: string, text: string): DocNode => ({
    type: "toggle",
    attrs: { blockId: "T" },
    content: [
      { type: "toggleSummary", content: [t(summary)] },
      { type: "toggleBody", content: [para("P", text)] },
    ],
  });

  it("an edit to a child inside a toggle does not trip the gate", () => {
    expect(evaluateGate(doc(tg("a", "x")), doc(tg("a", "y")))).toEqual({ ok: true });
  });

  it("a changed toggle title trips the gate", () => {
    const verdict = evaluateGate(doc(tg("a", "x")), doc(tg("b", "x")));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reasons.map((r) => r.code)).toContain("container_differs");
  });
});