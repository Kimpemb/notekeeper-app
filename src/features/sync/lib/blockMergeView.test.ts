// src/features/sync/lib/blockMergeView.test.ts

import { describe, it, expect } from "vitest";
import {
  allowedActions,
  buildBlockMergeView,
  effectiveChoice,
  itemsForCommit,
  type BlockMergeViewInput,
} from "@/features/sync/lib/blockMergeView";
import type { ApplyItem } from "@/features/notes/lib/applyReconcile";
import type { BlockSnapshot, DiffClassification } from "@/features/notes/lib/threeWayDiff";
import type { ReconcileAction } from "@/features/notes/lib/reconcileSession";

// ─── Fixtures ─────────────────────────────────────────────────────────────

function snap(id: string, text: string): BlockSnapshot {
  const node = {
    type: "paragraph",
    attrs: { blockId: id },
    content: text === "" ? undefined : [{ type: "text", text }],
  };
  return { blockId: id, content: JSON.stringify(node), hash: `h:${text}` };
}

function item(
  id: string,
  classification: DiffClassification,
  sides: { base?: string; mine?: string; theirs?: string },
  extra: Partial<ApplyItem> = {}
): ApplyItem {
  const auto = ["unchanged", "pulled_theirs", "kept_mine", "added"].includes(classification);
  return {
    blockId: id,
    classification,
    status: auto ? "auto" : "pending",
    base: sides.base === undefined ? undefined : snap(id, sides.base),
    mine: sides.mine === undefined ? undefined : snap(id, sides.mine),
    theirs: sides.theirs === undefined ? undefined : snap(id, sides.theirs),
    ...extra,
  };
}

const conflict = (id = "c1") => item(id, "conflict", { base: "base", mine: "mine text", theirs: "theirs text" });
const removedThere = (id = "d1") =>
  item(id, "source_deleted", { base: "gone", mine: "gone" }, { status: "resolved", chosenAction: "keep_local" });
const removedHere = (id = "m1") =>
  item(id, "mine_deleted_theirs_edited", { base: "old", theirs: "edited" }, { status: "resolved", chosenAction: "keep_local" });

function input(items: ApplyItem[], over: Partial<BlockMergeViewInput> = {}): BlockMergeViewInput {
  return {
    mode: "block",
    items,
    mineContent: "{}",
    theirsContent: "{}",
    metaRows: [],
    ...over,
  };
}

// ─── allowedActions / effectiveChoice ─────────────────────────────────────

describe("allowedActions", () => {
  it("offers exactly the 4d.3 choices per kind and never merge_ai", () => {
    expect(allowedActions("conflict")).toEqual(["keep_mine", "take_theirs"]);
    expect(allowedActions("source_deleted")).toEqual(["keep_local", "remove_here_too"]);
    expect(allowedActions("mine_deleted_theirs_edited")).toEqual(["keep_local", "restore_theirs"]);
  });
  it("offers nothing for automatic classes", () => {
    for (const c of ["unchanged", "pulled_theirs", "kept_mine", "added"] as const) {
      expect(allowedActions(c)).toEqual([]);
    }
  });
});

describe("effectiveChoice", () => {
  it("a conflict has no choice until the user picks", () => {
    expect(effectiveChoice(conflict())).toBeNull();
    expect(effectiveChoice(conflict(), { c1: "take_theirs" })).toBe("take_theirs");
  });
  it("a delete case falls back to its resolved safe default", () => {
    expect(effectiveChoice(removedThere())).toBe("keep_local");
    expect(effectiveChoice(removedHere())).toBe("keep_local");
  });
  it("the user's pick wins over the default", () => {
    expect(effectiveChoice(removedThere(), { d1: "remove_here_too" })).toBe("remove_here_too");
    expect(effectiveChoice(removedHere(), { m1: "restore_theirs" })).toBe("restore_theirs");
  });
  it("ignores a pick that is not allowed for that kind", () => {
    expect(effectiveChoice(conflict(), { c1: "remove_here_too" })).toBeNull();
    expect(effectiveChoice(conflict(), { c1: "merge_ai" })).toBeNull();
    expect(effectiveChoice(removedThere(), { d1: "take_theirs" })).toBe("keep_local");
  });
  it("uses a saved choice already resolved on a conflict item", () => {
    const saved = item("c1", "conflict", { base: "b", mine: "m", theirs: "t" }, { status: "resolved", chosenAction: "keep_mine" });
    expect(effectiveChoice(saved)).toBe("keep_mine");
  });
  it("is null for automatic items", () => {
    expect(effectiveChoice(item("a", "pulled_theirs", { base: "x", theirs: "y", mine: "x" }), { a: "keep_mine" })).toBeNull();
  });
});

// ─── itemsForCommit ───────────────────────────────────────────────────────

describe("itemsForCommit", () => {
  it("leaves an undecided conflict pending so the commit refuses it", () => {
    const out = itemsForCommit([conflict()]);
    expect(out[0].status).toBe("pending");
    expect(out[0].chosenAction).toBeUndefined();
  });
  it("resolves a conflict to the user's pick", () => {
    const out = itemsForCommit([conflict()], { c1: "keep_mine" });
    expect(out[0]).toMatchObject({ status: "resolved", chosenAction: "keep_mine" });
  });
  it("keeps the safe default for the delete cases", () => {
    const out = itemsForCommit([removedThere(), removedHere()]);
    expect(out.map((o) => o.chosenAction)).toEqual(["keep_local", "keep_local"]);
  });
  it("passes automatic and unchanged items through untouched", () => {
    const a = item("a", "added", { theirs: "new" });
    const u = item("u", "unchanged", { base: "s", mine: "s", theirs: "s" });
    const out = itemsForCommit([a, u], { a: "keep_mine", u: "take_theirs" });
    expect(out).toEqual([a, u]);
  });
  it("does not change the input items", () => {
    const items = [conflict()];
    itemsForCommit(items, { c1: "take_theirs" });
    expect(items[0].status).toBe("pending");
  });
  it("drops a stale chosenAction when the pick is not allowed", () => {
    const stale = item("c1", "conflict", { base: "b", mine: "m", theirs: "t" }, { status: "resolved", chosenAction: "restore_theirs" });
    expect(itemsForCommit([stale])[0].status).toBe("pending");
  });
});

// ─── buildBlockMergeView ──────────────────────────────────────────────────

describe("buildBlockMergeView — decision cards", () => {
  it("a conflict card shows base, mine and theirs as text and has no selection", () => {
    const v = buildBlockMergeView(input([conflict()]));
    expect(v.state).toBe("decide");
    expect(v.cards).toHaveLength(1);
    const c = v.cards[0];
    expect(c.kind).toBe("conflict");
    expect(c.badge).toBe("CONFLICT");
    expect(c.base).toEqual(["base"]);
    expect(c.mine).toEqual(["mine text"]);
    expect(c.theirs).toEqual(["theirs text"]);
    expect(c.selected).toBeNull();
    expect(c.options.map((o) => o.action)).toEqual(["keep_mine", "take_theirs"]);
    expect(c.options.some((o) => o.isDefault)).toBe(false);
  });

  it("a card has no base when no common ancestor exists", () => {
    const noBase = item("c1", "conflict", { mine: "m", theirs: "t" });
    expect(buildBlockMergeView(input([noBase])).cards[0].base).toBeNull();
  });

  it("removed-elsewhere shows only mine and defaults to keeping it", () => {
    const c = buildBlockMergeView(input([removedThere()])).cards[0];
    expect(c.kind).toBe("removed_there");
    expect(c.mine).toEqual(["gone"]);
    expect(c.theirs).toBeNull();
    expect(c.selected).toBe("keep_local");
    expect(c.options.find((o) => o.isDefault)?.action).toBe("keep_local");
  });

  it("you-removed shows only theirs and defaults to staying removed", () => {
    const c = buildBlockMergeView(input([removedHere()])).cards[0];
    expect(c.kind).toBe("removed_here");
    expect(c.mine).toBeNull();
    expect(c.theirs).toEqual(["edited"]);
    expect(c.selected).toBe("keep_local");
    expect(c.options.map((o) => o.label)).toEqual(["Keep it removed", "Bring it back"]);
  });

  it("orders conflicts first, then you-removed, then removed-elsewhere, keeping diff order within a kind", () => {
    const v = buildBlockMergeView(
      input([removedThere("d1"), conflict("c2"), removedHere("m1"), conflict("c1"), removedThere("d2")])
    );
    expect(v.cards.map((c) => c.blockId)).toEqual(["c2", "c1", "m1", "d1", "d2"]);
  });

  it("shows an empty block as a readable placeholder", () => {
    const empty = item("c1", "conflict", { base: "x", mine: "", theirs: "t" });
    expect(buildBlockMergeView(input([empty])).cards[0].mine).toEqual(["(empty block)"]);
  });

  it("reads a nested list block down to its text lines", () => {
    const list = {
      type: "bulletList",
      attrs: { blockId: "L" },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
      ],
    };
    const s: BlockSnapshot = { blockId: "L", content: JSON.stringify(list), hash: "L" };
    const it1: ApplyItem = { blockId: "L", classification: "conflict", status: "pending", mine: s, theirs: s };
    expect(buildBlockMergeView(input([it1])).cards[0].mine).toEqual(["one", "two"]);
  });

  it("marks unreadable snapshot content instead of throwing", () => {
    const bad: ApplyItem = {
      blockId: "x",
      classification: "conflict",
      status: "pending",
      mine: { blockId: "x", content: "not json", hash: "x" },
      theirs: snap("x", "t"),
    };
    expect(buildBlockMergeView(input([bad])).cards[0].mine).toEqual(["(this version could not be read)"]);
  });
});

describe("buildBlockMergeView — progress and state", () => {
  it("counts pending decisions and blocks Apply until all are decided", () => {
    const items = [conflict("c1"), conflict("c2"), removedThere()];
    const v = buildBlockMergeView(input(items, { choices: { c1: "keep_mine" } }));
    expect(v.counts).toMatchObject({ decisions: 3, decided: 2, pending: 1 });
    expect(v.canApply).toBe(false);
    expect(v.summary).toMatch(/3 blocks need your decision \(2 of 3 decided\)/);
  });

  it("allows Apply once every conflict is decided", () => {
    const v = buildBlockMergeView(input([conflict("c1"), conflict("c2")], { choices: { c1: "keep_mine", c2: "take_theirs" } }));
    expect(v.canApply).toBe(true);
    expect(v.counts.pending).toBe(0);
    expect(v.summary).toMatch(/All 2 decisions are made/);
    expect(v.applyLabel).toBe("Apply merge");
  });

  it("a note with only automatic changes is apply_only and can be applied at once (Test C&D)", () => {
    const items = [
      item("a", "pulled_theirs", { base: "x", mine: "x", theirs: "y" }),
      item("b", "added", { theirs: "new one" }),
      item("c", "added", { mine: "mine new" }),
      item("d", "unchanged", { base: "s", mine: "s", theirs: "s" }),
    ];
    const v = buildBlockMergeView(input(items));
    expect(v.state).toBe("apply_only");
    expect(v.cards).toHaveLength(0);
    expect(v.canApply).toBe(true);
    expect(v.counts).toMatchObject({ decisions: 0, auto: 3, unchanged: 1 });
    expect(v.summary).toMatch(/Nothing needs your decision\. 3 changes merge by itself/);
  });

  it("identical mode finishes with its own label and sentence", () => {
    const v = buildBlockMergeView(input([item("u", "unchanged", { base: "s", mine: "s", theirs: "s" })], { mode: "identical" }));
    expect(v.state).toBe("identical");
    expect(v.canApply).toBe(true);
    expect(v.applyLabel).toBe("Finish");
    expect(v.summary).toMatch(/already match/);
  });

  it("uses singular wording for one change", () => {
    const v = buildBlockMergeView(input([item("b", "added", { theirs: "new" })]));
    expect(v.summary).toMatch(/1 change merges by itself/);
  });
});

describe("buildBlockMergeView — automatic lines", () => {
  const lineFor = (it1: ApplyItem) => buildBlockMergeView(input([it1])).autoLines[0];

  it("describes each automatic class in plain words with an excerpt", () => {
    expect(lineFor(item("a", "pulled_theirs", { base: "x", mine: "x", theirs: "their edit" }))).toMatchObject({
      label: expect.stringMatching(/their change is taken/),
      excerpt: "their edit",
    });
    expect(lineFor(item("b", "kept_mine", { base: "x", mine: "my edit", theirs: "x" }))).toMatchObject({
      label: expect.stringMatching(/your change is kept/),
      excerpt: "my edit",
    });
    expect(lineFor(item("c", "added", { theirs: "from them" }))).toMatchObject({
      label: expect.stringMatching(/Added on the other device/),
      excerpt: "from them",
    });
    expect(lineFor(item("d", "added", { mine: "from me" }))).toMatchObject({
      label: expect.stringMatching(/Added here/),
      excerpt: "from me",
    });
  });

  it("says what really happens when theirs removed a block you did not change", () => {
    const l = lineFor(item("e", "pulled_theirs", { base: "x", mine: "x" }));
    expect(l.label).toMatch(/kept here because you did not change it/);
    expect(l.excerpt).toBe("x");
  });

  it("says a block you removed stays removed", () => {
    const l = lineFor(item("f", "kept_mine", { base: "old", theirs: "old" }));
    expect(l.label).toMatch(/stays removed/);
    expect(l.excerpt).toBe("old");
  });

  it("shortens long text and marks multi-line blocks", () => {
    const long = "x".repeat(200);
    const l = lineFor(item("g", "added", { theirs: long }));
    expect(l.excerpt.length).toBeLessThan(90);
    expect(l.excerpt.endsWith("…")).toBe(true);
  });

  it("never lists unchanged blocks", () => {
    const v = buildBlockMergeView(input([item("u", "unchanged", { base: "s", mine: "s", theirs: "s" }), conflict()]));
    expect(v.autoLines).toHaveLength(0);
    expect(v.counts.unchanged).toBe(1);
  });
});

describe("buildBlockMergeView — media and metadata", () => {
  const imageDoc = JSON.stringify({ type: "doc", content: [{ type: "image", attrs: { src: "C:\\p\\a.png" } }] });

  it("has no media notice when neither side has images or attachments", () => {
    expect(buildBlockMergeView(input([conflict()])).mediaNotice).toBeNull();
  });

  it("shows the media notice when either side has an image", () => {
    const v = buildBlockMergeView(input([conflict()], { mineContent: imageDoc }));
    expect(v.mediaNotice).toMatch(/not synced/);
    expect(v.mediaNotice).toMatch(/1 image/);
  });

  it("passes metadata rows through with plain labels and the preselected choice", () => {
    const v = buildBlockMergeView(
      input([conflict()], {
        metaRows: [{ field: "title", mine: "New name", theirs: "Old name", choice: "mine", canTakeTheirs: true }],
      })
    );
    expect(v.metaRows).toEqual([
      { field: "title", label: "Title", mineLabel: "New name", theirsLabel: "Old name", preselected: "mine", canTakeTheirs: true },
    ]);
  });
});

describe("buildBlockMergeView — invariants", () => {
  it("every decision block appears as exactly one card and every other changed block as one auto line", () => {
    const items = [
      conflict("c1"),
      removedThere("d1"),
      removedHere("m1"),
      item("a", "pulled_theirs", { base: "x", mine: "x", theirs: "y" }),
      item("b", "kept_mine", { base: "x", mine: "z", theirs: "x" }),
      item("c", "added", { theirs: "n" }),
      item("u", "unchanged", { base: "s", mine: "s", theirs: "s" }),
    ];
    const v = buildBlockMergeView(input(items));
    expect(v.cards.map((c) => c.blockId).sort()).toEqual(["c1", "d1", "m1"]);
    expect(v.autoLines.map((l) => l.blockId).sort()).toEqual(["a", "b", "c"]);
  });

  it("never offers merge_ai on any card", () => {
    const v = buildBlockMergeView(input([conflict(), removedThere(), removedHere()]));
    const actions: ReconcileAction[] = v.cards.flatMap((c) => c.options.map((o) => o.action));
    expect(actions).not.toContain("merge_ai");
  });

  it("canApply agrees with what itemsForCommit leaves pending", () => {
    const items = [conflict("c1"), removedThere("d1")];
    const cases: Array<Record<string, ReconcileAction>> = [{}, { c1: "keep_mine" }];
    for (const choices of cases) {
      const v = buildBlockMergeView(input(items, { choices }));
      const pending = itemsForCommit(items, choices).filter((i) => i.status === "pending").length;
      expect(v.canApply).toBe(pending === 0);
    }
  });
});
