// src/features/notes/lib/threeWayDiff.test.ts
//
// Covers design doc §7 item 4's checklist: simple leaf conflict, the
// toggle/table containment case, both new delete-row cases, pruned-base
// fallback, and an added block on each side — plus a few cases that fell
// out of writing the containment test honestly.
//
// Test "hashes" are just the content string itself. diffNoteRevisions
// never computes a hash — it only compares hash equality — so real
// SHA-256 (as hashBlockContent produces in production) adds nothing here
// and would only obscure what's actually being compared.

import { describe, it, expect } from "vitest";
import { diffNoteRevisions, type BlockMap, type BlockSnapshot } from "./threeWayDiff";

// ─── Test helpers ─────────────────────────────────────────────────────────

interface Node {
  type: string;
  attrs: { blockId: string; [k: string]: unknown };
  content?: Node[];
  [k: string]: unknown;
}

function node(type: string, blockId: string, extra: Record<string, unknown> = {}, children: Node[] = []): Node {
  const n: Node = { type, attrs: { blockId, ...extra } };
  if (children.length > 0) n.content = children;
  return n;
}

/** Mirrors computeBlockSnapshots: content = JSON.stringify(node), including
 *  the full subtree — so an ancestor's content always contains every
 *  descendant's "blockId":"<id>" string, exactly as in production. */
function snap(n: Node): BlockSnapshot {
  const content = JSON.stringify(n);
  return { blockId: n.attrs.blockId, content, hash: content };
}

function map(...snaps: BlockSnapshot[]): BlockMap {
  return new Map(snaps.map((s) => [s.blockId, s]));
}

// Variant of a node/snapshot with different leaf text, for producing a
// genuinely different hash without hand-writing every JSON string twice.
function edited(n: Node, text: string): Node {
  return JSON.parse(JSON.stringify(n).replace(/"text":"[^"]*"/, `"text":"${text}"`));
}

function leaf(blockId: string, text: string): Node {
  return node("paragraph", blockId, {}, [{ type: "text", attrs: { blockId: "" }, text } as unknown as Node]);
}

// ─── Simple leaf cases ────────────────────────────────────────────────────

describe("diffNoteRevisions — simple leaf cases", () => {
  it("unchanged everywhere → not reported", () => {
    const p1 = leaf("P1", "hello");
    const result = diffNoteRevisions(map(snap(p1)), map(snap(p1)), map(snap(p1)));
    expect(result).toEqual([]);
  });

  it("changed only in theirs → pulled_theirs, auto-apply", () => {
    const base = leaf("P1", "hello");
    const theirs = edited(base, "hello world");
    const result = diffNoteRevisions(map(snap(base)), map(snap(theirs)), map(snap(base)));
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P1", classification: "pulled_theirs" }),
    ]);
  });

  it("changed only in mine → kept_mine, auto-apply", () => {
    const base = leaf("P1", "hello");
    const mine = edited(base, "hello there");
    const result = diffNoteRevisions(map(snap(base)), map(snap(base)), map(snap(mine)));
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P1", classification: "kept_mine" }),
    ]);
  });

  it("changed differently on both sides → real conflict", () => {
    const base = leaf("P1", "hello");
    const theirs = edited(base, "hello world");
    const mine = edited(base, "hello friend");
    const result = diffNoteRevisions(map(snap(base)), map(snap(theirs)), map(snap(mine)));
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P1", classification: "conflict" }),
    ]);
  });

  it("changed to the SAME value on both sides → converged, not a conflict", () => {
    const base = leaf("P1", "hello");
    const edit = edited(base, "hello world");
    const result = diffNoteRevisions(map(snap(base)), map(snap(edit)), map(snap(edit)));
    expect(result).toEqual([]);
  });

  it("both sides deleted it → nothing to do", () => {
    const base = leaf("P1", "hello");
    const result = diffNoteRevisions(map(snap(base)), map(), map());
    expect(result).toEqual([]);
  });
});

// ─── New block cases (added on each side) ────────────────────────────────

describe("diffNoteRevisions — added blocks", () => {
  it("new block present only in theirs → added", () => {
    const p2 = leaf("P2", "new from source");
    const result = diffNoteRevisions(map(), map(snap(p2)), map());
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P2", classification: "added", theirs: snap(p2) }),
    ]);
  });

  it("new block present only in mine → added", () => {
    const p2 = leaf("P2", "new locally");
    const result = diffNoteRevisions(map(), map(), map(snap(p2)));
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P2", classification: "added", mine: snap(p2) }),
    ]);
  });
});

// ─── The two "missing row" delete cases (design doc §4.2) ────────────────

describe("diffNoteRevisions — delete-vs-edit cases", () => {
  it("source_deleted: in base+mine, missing from theirs → defaults to keep_local", () => {
    const p1 = leaf("P1", "hello");
    const result = diffNoteRevisions(map(snap(p1)), map(), map(snap(p1)));
    expect(result).toEqual([
      expect.objectContaining({
        blockId: "P1",
        classification: "source_deleted",
        defaultAction: "keep_local",
      }),
    ]);
  });

  it("mine deleted a block theirs left untouched → mechanical delete, kept_mine", () => {
    const p1 = leaf("P1", "hello");
    const result = diffNoteRevisions(map(snap(p1)), map(snap(p1)), map());
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P1", classification: "kept_mine" }),
    ]);
  });

  it("mine deleted a block theirs EDITED → mine_deleted_theirs_edited, defaults to keep_local", () => {
    const base = leaf("P1", "hello");
    const theirsEdit = edited(base, "hello, updated upstream");
    const result = diffNoteRevisions(map(snap(base)), map(snap(theirsEdit)), map());
    expect(result).toEqual([
      expect.objectContaining({
        blockId: "P1",
        classification: "mine_deleted_theirs_edited",
        defaultAction: "keep_local",
      }),
    ]);
  });
});

// ─── Containment / pruning (design doc §4.1, §5 worked example) ──────────

describe("diffNoteRevisions — nested container pruning", () => {
  it("toggle worked example: edits to different children never surface as a parent conflict", () => {
    // toggle(T1) > toggleBody(no blockId) > [paragraph(P1), paragraph(P2)]
    // theirs edits P1 only; mine edits P2 only. T1's own hash diverges on
    // BOTH sides (subtree changed either way) but must not be reported.
    const p1 = leaf("P1", "Discussed roadmap");
    const p2 = leaf("P2", "Action items pending");
    const body = node("toggleBody", "", {}, [p1, p2]);
    const summary = node("toggleSummary", "", {}, []);
    const t1Base = node("toggle", "T1", {}, [summary, body]);

    const p1Theirs = edited(p1, "Discussed roadmap and Q3 budget");
    const bodyTheirs = node("toggleBody", "", {}, [p1Theirs, p2]);
    const t1Theirs = node("toggle", "T1", {}, [summary, bodyTheirs]);

    const p2Mine = edited(p2, "Action items: assigned to Jay");
    const bodyMine = node("toggleBody", "", {}, [p1, p2Mine]);
    const t1Mine = node("toggle", "T1", {}, [summary, bodyMine]);

    const result = diffNoteRevisions(
      map(snap(t1Base), snap(p1), snap(p2)),
      map(snap(t1Theirs), snap(p1Theirs), snap(p2)),
      map(snap(t1Mine), snap(p1), snap(p2Mine))
    );

    // T1 itself: never reported.
    expect(result.find((r) => r.blockId === "T1")).toBeUndefined();
    // Only the two actual leaves are reported, correctly classified.
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockId: "P1", classification: "pulled_theirs" }),
        expect.objectContaining({ blockId: "P2", classification: "kept_mine" }),
      ])
    );
  });

  it("table cell edit does not falsely conflict a sibling cell edit", () => {
    // table(TB1) > tableRow(no id) > [tableCell>paragraph(C1), tableCell>paragraph(C2)]
    const c1 = leaf("C1", "Q1 revenue");
    const c2 = leaf("C2", "Q2 revenue");
    const cell1 = node("tableCell", "", {}, [c1]);
    const cell2 = node("tableCell", "", {}, [c2]);
    const row = node("tableRow", "", {}, [cell1, cell2]);
    const tableBase = node("table", "TB1", {}, [row]);

    const c1Theirs = edited(c1, "Q1 revenue: $50k");
    const rowTheirs = node("tableRow", "", {}, [node("tableCell", "", {}, [c1Theirs]), cell2]);
    const tableTheirs = node("table", "TB1", {}, [rowTheirs]);

    const result = diffNoteRevisions(
      map(snap(tableBase), snap(c1), snap(c2)),
      map(snap(tableTheirs), snap(c1Theirs), snap(c2)),
      map(snap(tableBase), snap(c1), snap(c2))
    );

    expect(result.find((r) => r.blockId === "TB1")).toBeUndefined();
    expect(result).toEqual([
      expect.objectContaining({ blockId: "C1", classification: "pulled_theirs" }),
    ]);
  });

  it("whole subtree added on one side → parent reported once, children NOT separately reported", () => {
    const p1 = leaf("P1", "child text");
    const toggle = node("toggle", "T1", {}, [node("toggleBody", "", {}, [p1])]);

    const result = diffNoteRevisions(map(), map(snap(toggle), snap(p1)), map());

    expect(result).toEqual([
      expect.objectContaining({ blockId: "T1", classification: "added" }),
    ]);
    expect(result.find((r) => r.blockId === "P1")).toBeUndefined();
  });

  it("whole subtree deleted on one side → parent reported once, children NOT separately reported", () => {
    const p1 = leaf("P1", "child text");
    const toggle = node("toggle", "T1", {}, [node("toggleBody", "", {}, [p1])]);

    const result = diffNoteRevisions(map(snap(toggle), snap(p1)), map(), map(snap(toggle), snap(p1)));

    expect(result).toEqual([
      expect.objectContaining({ blockId: "T1", classification: "source_deleted" }),
    ]);
    expect(result.find((r) => r.blockId === "P1")).toBeUndefined();
  });

  it("multiple independent top-level blocks are each diffed on their own", () => {
    const p1 = leaf("P1", "first");
    const p2 = leaf("P2", "second");
    const p1Edited = edited(p1, "first, changed");

    const result = diffNoteRevisions(
      map(snap(p1), snap(p2)),
      map(snap(p1Edited), snap(p2)),
      map(snap(p1), snap(p2))
    );

    expect(result).toEqual([
      expect.objectContaining({ blockId: "P1", classification: "pulled_theirs" }),
    ]);
  });
});

// ─── Pruned-base fallback (design doc §4.3) ───────────────────────────────

describe("diffNoteRevisions — pruned base (base === null)", () => {
  it("identical content on both sides → not reported, even without a base", () => {
    const p1 = leaf("P1", "same on both sides");
    const result = diffNoteRevisions(null, map(snap(p1)), map(snap(p1)));
    expect(result).toEqual([]);
  });

  it("genuinely divergent content, no base → conflict (never silently resolved)", () => {
    const base = leaf("P1", "original");
    const theirs = edited(base, "their version");
    const mine = edited(base, "my version");
    const result = diffNoteRevisions(null, map(snap(theirs)), map(snap(mine)));
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P1", classification: "conflict" }),
    ]);
  });

  it("present on only one side, no base → treated as added (can't tell delete from new)", () => {
    const p1 = leaf("P1", "only on their side");
    const result = diffNoteRevisions(null, map(snap(p1)), map());
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P1", classification: "added" }),
    ]);
  });

  it("nested containment still prunes correctly without a base", () => {
    const p1 = leaf("P1", "unchanged leaf");
    const p2 = leaf("P2", "will diverge");
 

    const p2Theirs = edited(p2, "their edit");
    const toggleTheirs = node("toggle", "T1", {}, [node("toggleBody", "", {}, [p1, p2Theirs])]);

    const p2Mine = edited(p2, "my edit");
    const toggleMine = node("toggle", "T1", {}, [node("toggleBody", "", {}, [p1, p2Mine])]);

    const result = diffNoteRevisions(
      null,
      map(snap(toggleTheirs), snap(p1), snap(p2Theirs)),
      map(snap(toggleMine), snap(p1), snap(p2Mine))
    );

    expect(result.find((r) => r.blockId === "T1")).toBeUndefined();
    expect(result.find((r) => r.blockId === "P1")).toBeUndefined(); // p1 identical both sides
    expect(result).toEqual([
      expect.objectContaining({ blockId: "P2", classification: "conflict" }),
    ]);
  });
});