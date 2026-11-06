// src/features/sync/lib/reviewList.test.ts

import { describe, it, expect } from "vitest";
import {
  BULK_OPTIONS,
  DEFAULT_QUERY,
  bulkConfirmText,
  bulkOptionsFor,
  bulkSummaryText,
  filterAndSort,
  kindLabel,
  nextBulkStep,
  planBulk,
  skipReasonLabel,
  summarizeBulk,
  type ListQuery,
  type ReviewMode,
} from "@/features/sync/lib/reviewList";
import type { CandidateKind, ReviewCandidate } from "@/features/sync/lib/reviewCandidates";

const c = (over: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  noteId: "n1",
  kind: "content_conflict",
  title: "Alpha",
  reason: null,
  localRevision: 1,
  hostedRevision: 2,
  detectedAt: 1000,
  ...over,
});

const q = (over: Partial<ListQuery> = {}): ListQuery => ({ ...DEFAULT_QUERY, ...over });
const ids = (rows: ReviewCandidate[]) => rows.map((r) => r.noteId);

// ─── Filter and sort ──────────────────────────────────────────────────────

describe("filterAndSort — filtering", () => {
  const rows = [
    c({ noteId: "a", title: "Project plan" }),
    c({ noteId: "b", title: "Shopping list" }),
    c({ noteId: "c", title: null, kind: "unchecked" }),
  ];

  it("an empty query keeps every row", () => {
    expect(ids(filterAndSort(rows, q()))).toHaveLength(3);
  });

  it("matches the title case-insensitively", () => {
    expect(ids(filterAndSort(rows, q({ text: "PLAN" })))).toEqual(["a"]);
  });

  it("all words must match", () => {
    expect(ids(filterAndSort(rows, q({ text: "project plan" })))).toEqual(["a"]);
    expect(ids(filterAndSort(rows, q({ text: "project list" })))).toEqual([]);
  });

  it("also matches the note id, so an untitled row can be found", () => {
    expect(ids(filterAndSort(rows, q({ text: "c" })))).toContain("c");
  });

  it("whitespace-only text is no filter", () => {
    expect(filterAndSort(rows, q({ text: "   " }))).toHaveLength(3);
  });

  it("filters by kind", () => {
    const kinds = new Set<CandidateKind>(["unchecked"]);
    expect(ids(filterAndSort(rows, q({ kinds })))).toEqual(["c"]);
  });

  it("an empty kind set shows nothing; null shows everything", () => {
    expect(filterAndSort(rows, q({ kinds: new Set() }))).toEqual([]);
    expect(filterAndSort(rows, q({ kinds: null }))).toHaveLength(3);
  });
});

describe("filterAndSort — sorting", () => {
  const rows = [
    c({ noteId: "b", title: "beta", detectedAt: 200 }),
    c({ noteId: "a", title: "alpha", detectedAt: 200 }),
    c({ noteId: "z", title: null, detectedAt: 300 }),
    c({ noteId: "m", title: "Mu", detectedAt: 100 }),
  ];

  it("newest first, ties by id", () => {
    expect(ids(filterAndSort(rows, q({ sort: "newest" })))).toEqual(["z", "a", "b", "m"]);
  });

  it("oldest first, ties by id", () => {
    expect(ids(filterAndSort(rows, q({ sort: "oldest" })))).toEqual(["m", "a", "b", "z"]);
  });

  it("by title, untitled last", () => {
    expect(ids(filterAndSort(rows, q({ sort: "title" })))).toEqual(["a", "b", "m", "z"]);
  });

  it("does not change its input", () => {
    const before = JSON.stringify(rows);
    filterAndSort(rows, q({ sort: "title", text: "a" }));
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("kindLabel", () => {
  it("has a label for every kind", () => {
    const kinds: CandidateKind[] = ["content_conflict", "purged_elsewhere", "deleted_here", "hosted_missing", "unchecked"];
    for (const k of kinds) expect(kindLabel(k).length).toBeGreaterThan(5);
  });
});

// ─── Bulk options ─────────────────────────────────────────────────────────

describe("bulkOptionsFor", () => {
  it("nothing selected", () => {
    const r = bulkOptionsFor([]);
    expect(r.options).toEqual([]);
    expect(r.blockedReason).toBeTruthy();
  });

  it("mixed kinds are blocked", () => {
    const r = bulkOptionsFor([c(), c({ noteId: "n2", kind: "deleted_here" })]);
    expect(r.options).toEqual([]);
    expect(r.blockedReason).toMatch(/one kind/);
  });

  it("content conflicts offer keep mine and take theirs", () => {
    const r = bulkOptionsFor([c(), c({ noteId: "n2" })]);
    expect(r.options.map((o) => o.id)).toEqual(["whole_keep_mine", "whole_take_theirs"]);
    expect(r.blockedReason).toBeNull();
  });

  it("deleted here offers restore only", () => {
    expect(bulkOptionsFor([c({ kind: "deleted_here" })]).options.map((o) => o.id)).toEqual(["d1_keep_it"]);
  });

  it("purged elsewhere offers keep mine only", () => {
    expect(bulkOptionsFor([c({ kind: "purged_elsewhere" })]).options.map((o) => o.id)).toEqual(["d2_keep_mine"]);
  });

  it("missing and unchecked rows have no bulk action", () => {
    expect(bulkOptionsFor([c({ kind: "hosted_missing" })]).options).toEqual([]);
    expect(bulkOptionsFor([c({ kind: "unchecked" })]).options).toEqual([]);
  });

  it("no destructive-delete option exists", () => {
    // "Delete anyway" and "let the delete go" are per-note decisions, never bulk.
    expect(BULK_OPTIONS.map((o) => o.id).sort()).toEqual(["d1_keep_it", "d2_keep_mine", "whole_keep_mine", "whole_take_theirs"]);
  });
});

// ─── Planning a run ───────────────────────────────────────────────────────

describe("planBulk", () => {
  const keepMine = BULK_OPTIONS.find((o) => o.id === "whole_keep_mine")!;
  const d2 = BULK_OPTIONS.find((o) => o.id === "d2_keep_mine")!;
  const d1 = BULK_OPTIONS.find((o) => o.id === "d1_keep_it")!;
  const rows = [c({ noteId: "a" }), c({ noteId: "b" }), c({ noteId: "x" }), c({ noteId: "o" })];
  const modes = new Map<string, ReviewMode | null>([
    ["a", "whole_note"],
    ["b", "block"],
    ["o", "whole_note"],
  ]);

  it("splits eligible and skipped with reasons", () => {
    const r = planBulk(keepMine, rows, modes, new Set(["o"]));
    expect(ids(r.eligible)).toEqual(["a"]);
    expect(r.skipped).toEqual([
      { noteId: "b", reason: "needs_item_review" },
      { noteId: "x", reason: "mode_unknown" },
      { noteId: "o", reason: "note_open" },
    ]);
  });

  it("a block-mode note is never bulk-applied", () => {
    const r = planBulk(keepMine, [c({ noteId: "b" })], modes, new Set());
    expect(r.eligible).toEqual([]);
  });

  it("a note whose two sides already match is skipped, not bulk-applied", () => {
    const withIdentical = new Map<string, ReviewMode | null>([["i", "identical"]]);
    const r = planBulk(keepMine, [c({ noteId: "i" })], withIdentical, new Set());
    expect(r.eligible).toEqual([]);
    expect(r.skipped).toEqual([{ noteId: "i", reason: "already_identical" }]);
  });

  it("take theirs skips a note whose own side has images or attachments", () => {
    const takeTheirs = BULK_OPTIONS.find((o) => o.id === "whole_take_theirs")!;
    const wholeNote = new Map<string, ReviewMode | null>([["a", "whole_note"], ["m", "whole_note"]]);
    const r = planBulk(takeTheirs, [c({ noteId: "a" }), c({ noteId: "m" })], wholeNote, new Set(), new Set(["m"]));
    expect(ids(r.eligible)).toEqual(["a"]);
    expect(r.skipped).toEqual([{ noteId: "m", reason: "has_media" }]);
  });

  it("keep mine does not skip notes with media", () => {
    const wholeNote = new Map<string, ReviewMode | null>([["m", "whole_note"]]);
    const r = planBulk(keepMine, [c({ noteId: "m" })], wholeNote, new Set(), new Set(["m"]));
    expect(ids(r.eligible)).toEqual(["m"]);
  });

  it("D2 rows need no mode, but an open note is skipped", () => {
    const d2rows = [c({ noteId: "a", kind: "purged_elsewhere" }), c({ noteId: "o", kind: "purged_elsewhere" })];
    const r = planBulk(d2, d2rows, new Map(), new Set(["o"]));
    expect(ids(r.eligible)).toEqual(["a"]);
    expect(r.skipped).toEqual([{ noteId: "o", reason: "note_open" }]);
  });

  it("D1 rows are never skipped as open (there is no local note)", () => {
    const d1rows = [c({ noteId: "a", kind: "deleted_here" })];
    const r = planBulk(d1, d1rows, new Map(), new Set(["a"]));
    expect(ids(r.eligible)).toEqual(["a"]);
  });

  it("ignores rows of another kind", () => {
    const r = planBulk(d2, [c({ noteId: "a" })], new Map(), new Set());
    expect(r.eligible).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
});

// ─── Stopping ─────────────────────────────────────────────────────────────

describe("nextBulkStep", () => {
  it("continues on an empty or healthy run", () => {
    expect(nextBulkStep([])).toBe("continue");
    expect(nextBulkStep([{ status: "committed" }, { status: "stale" }])).toBe("continue");
  });

  it("stops at once when signed out", () => {
    expect(nextBulkStep([{ status: "committed" }, { status: "refused", reason: "signed_out" }])).toBe("stop_signed_out");
  });

  it("a refusal for another reason does not stop the run", () => {
    expect(nextBulkStep([{ status: "refused", reason: "busy" }])).toBe("continue");
  });

  it("stops after two network errors in a row, not one", () => {
    expect(nextBulkStep([{ status: "network_error" }])).toBe("continue");
    expect(nextBulkStep([{ status: "network_error" }, { status: "network_error" }])).toBe("stop_network");
  });

  it("two network errors with a success between them do not stop it", () => {
    expect(nextBulkStep([{ status: "network_error" }, { status: "committed" }, { status: "network_error" }])).toBe("continue");
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────

describe("summarizeBulk and bulkSummaryText", () => {
  it("counts each outcome", () => {
    const s = summarizeBulk(
      [
        { status: "committed" },
        { status: "committed" },
        { status: "stale" },
        { status: "push_lost" },
        { status: "refused", reason: "busy" },
        { status: "network_error" },
        { status: "server_won_local_failed" },
        { status: "committed_unrecorded" },
      ],
      2,
      8
    );
    expect(s).toEqual({ total: 10, committed: 2, unrecorded: 1, changedAgain: 2, refused: 1, failed: 2, skipped: 2, notRun: 0 });
  });

  it("counts notes not attempted when the run stopped early", () => {
    const s = summarizeBulk([{ status: "committed" }], 0, 5);
    expect(s.notRun).toBe(4);
  });

  it("never reports a negative not-run count", () => {
    expect(summarizeBulk([{ status: "committed" }, { status: "committed" }], 0, 1).notRun).toBe(0);
  });

  it("an unknown status counts as failed, not as success", () => {
    expect(summarizeBulk([{ status: "something_new" }], 0, 1).failed).toBe(1);
  });

  it("says what happened, and only what happened", () => {
    const text = bulkSummaryText({ total: 5, committed: 3, unrecorded: 0, changedAgain: 1, refused: 0, failed: 0, skipped: 1, notRun: 0 });
    expect(text).toBe("Done: 3 of 5 notes. 1 note changed again and was left alone. 1 skipped.");
  });

  it("a clean run is one short sentence", () => {
    const text = bulkSummaryText({ total: 1, committed: 1, unrecorded: 0, changedAgain: 0, refused: 0, failed: 0, skipped: 0, notRun: 0 });
    expect(text).toBe("Done: 1 of 1 note.");
  });

  it("flags notes that need a check and notes not attempted", () => {
    const text = bulkSummaryText({ total: 4, committed: 1, unrecorded: 1, changedAgain: 0, refused: 0, failed: 1, skipped: 0, notRun: 1 });
    expect(text).toContain("1 need a check");
    expect(text).toContain("1 not attempted");
    expect(text).toContain("1 failed");
  });
});

describe("wording", () => {
  it("every skip reason has text", () => {
    for (const r of ["note_open", "needs_item_review", "already_identical", "has_media", "mode_unknown"] as const) {
      expect(skipReasonLabel(r).length).toBeGreaterThan(10);
    }
  });

  it("every confirmation states the count, and every one that writes mentions a backup", () => {
    for (const o of BULK_OPTIONS) {
      const t = bulkConfirmText(o, 3);
      expect(t.title).toContain("3 notes");
      if (o.id !== "d1_keep_it") expect(t.body).toMatch(/backup/i);
    }
  });

  it("restore says nothing on the server changes", () => {
    const o = BULK_OPTIONS.find((x) => x.id === "d1_keep_it")!;
    expect(bulkConfirmText(o, 1).body).toMatch(/Nothing on the server changes/);
    expect(bulkConfirmText(o, 1).title).toBe("Restore 1 note?");
  });
});
