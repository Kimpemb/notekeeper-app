// src/features/sync/lib/downloadPlan.test.ts
import { describe, it, expect } from "vitest";
import {
  planDownload,
  checkDownloadPreconditions,
  nextBatchSize,
  takeBatch,
  isInterruptedDownload,
  INITIAL_BATCH,
  MIN_BATCH,
  type RemoteTreeRow,
  type PreconditionInput,
} from "./downloadPlan";

const T = 1_700_000_000_000;
const row = (id: string, parentId: string | null = null, deletedAt: number | null = null): RemoteTreeRow => ({
  id,
  parentId,
  revision: 3,
  updatedAt: T,
  deletedAt,
});
const ids = (p: ReturnType<typeof planDownload>) => p.notes.map((n) => n.id);

describe("planDownload — ordering", () => {
  it("puts parents before children regardless of input order", () => {
    const plan = planDownload([row("c", "b"), row("b", "a"), row("a")], new Set());
    expect(ids(plan)).toEqual(["a", "b", "c"]);
    expect(plan.notes.map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it("breaks depth ties by id so the order is deterministic", () => {
    const plan = planDownload([row("z"), row("m"), row("a")], new Set());
    expect(ids(plan)).toEqual(["a", "m", "z"]);
  });

  it("keeps hosted parent_id when the parent is in the same download", () => {
    const plan = planDownload([row("a"), row("b", "a")], new Set());
    const b = plan.notes.find((n) => n.id === "b")!;
    expect(b.parentId).toBe("a");
    expect(b.reparented).toBe(false);
  });

  it("keeps parent_id when the parent is already local", () => {
    const plan = planDownload([row("b", "a")], new Set(["a"]));
    expect(plan.notes[0]).toMatchObject({ id: "b", parentId: "a", reparented: false, depth: 0 });
  });

  it("handles a wide tree with mixed depths", () => {
    const plan = planDownload(
      [row("d", "c"), row("c", "a"), row("b", "a"), row("a"), row("e")],
      new Set()
    );
    const depth = new Map(plan.notes.map((n) => [n.id, n.depth]));
    expect(depth.get("a")).toBe(0);
    expect(depth.get("e")).toBe(0);
    expect(depth.get("b")).toBe(1);
    expect(depth.get("c")).toBe(1);
    expect(depth.get("d")).toBe(2);
    // every note appears after its parent
    const pos = new Map(ids(plan).map((id, i) => [id, i]));
    for (const n of plan.notes) if (n.parentId) expect(pos.get(n.parentId)!).toBeLessThan(pos.get(n.id)!);
  });
});

describe("planDownload — skips and reparenting", () => {
  it("skips hosted rows with deleted_at set and counts them", () => {
    const plan = planDownload([row("a"), row("gone", null, T)], new Set());
    expect(ids(plan)).toEqual(["a"]);
    expect(plan.skippedDeleted).toBe(1);
  });

  it("skips ids that already exist locally (rerun after an interruption)", () => {
    const plan = planDownload([row("a"), row("b")], new Set(["a"]));
    expect(ids(plan)).toEqual(["b"]);
    expect(plan.alreadyLocal).toBe(1);
  });

  it("reparents to root when the hosted parent is missing", () => {
    const plan = planDownload([row("b", "ghost")], new Set());
    expect(plan.notes[0]).toMatchObject({ parentId: null, reparented: true, depth: 0 });
  });

  it("reparents to root when the hosted parent is deleted on hosted", () => {
    const plan = planDownload([row("p", null, T), row("b", "p")], new Set());
    expect(plan.notes[0]).toMatchObject({ id: "b", parentId: null, reparented: true });
  });

  it("treats a self-parent as root", () => {
    const plan = planDownload([row("a", "a")], new Set());
    expect(plan.notes[0]).toMatchObject({ parentId: null, reparented: true });
  });

  it("breaks a two-note cycle so one note is a root and the other its child", () => {
    const plan = planDownload([row("a", "b"), row("b", "a")], new Set());
    expect(plan.notes).toHaveLength(2);
    const roots = plan.notes.filter((n) => n.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0].reparented).toBe(true);
    // the child still comes after its parent
    expect(plan.notes[0].parentId).toBeNull();
    expect(plan.notes[1].parentId).toBe(plan.notes[0].id);
  });

  it("returns every note exactly once", () => {
    const rows = [row("a"), row("b", "a"), row("c", "b"), row("d", "c"), row("x", "y"), row("y", "x")];
    const plan = planDownload(rows, new Set());
    expect(ids(plan).sort()).toEqual(["a", "b", "c", "d", "x", "y"]);
  });
});

const base: PreconditionInput = {
  syncConfigured: true,
  signedIn: true,
  syncStateCount: 0,
  localNotes: [],
  starterTitles: ["Welcome", "Linking", "Tips"],
  openTabCount: 0,
  resuming: false,
};
const note = (id: string, title: string, revision = 0, isCanvas = false) => ({ id, title, revision, isCanvas });

describe("checkDownloadPreconditions", () => {
  it("allows an empty vault", () => {
    expect(checkDownloadPreconditions(base)).toEqual({ ok: true, starterIdsToRemove: [] });
  });

  it("allows a vault holding only untouched starter notes and lists their ids for removal", () => {
    const r = checkDownloadPreconditions({
      ...base,
      localNotes: [note("n1", "Welcome"), note("n2", "Tips")],
    });
    expect(r).toEqual({ ok: true, starterIdsToRemove: ["n1", "n2"] });
  });

  it("when resuming, skips the fresh-vault checks (sync state and downloaded notes are expected)", () => {
    const r = checkDownloadPreconditions({
      ...base,
      resuming: true,
      syncStateCount: 700,
      localNotes: [note("n1", "Shopping", 1), note("n2", "Ideas", 1)],
    });
    expect(r).toEqual({ ok: true, starterIdsToRemove: [] });
  });

  it("when resuming, still refuses while notes are open or when signed out", () => {
    expect(checkDownloadPreconditions({ ...base, resuming: true, openTabCount: 1 }).ok).toBe(false);
    expect(checkDownloadPreconditions({ ...base, resuming: true, signedIn: false }).ok).toBe(false);
  });

  it("refuses when sync isn't configured", () => {
    expect(checkDownloadPreconditions({ ...base, syncConfigured: false }).ok).toBe(false);
  });

  it("refuses when signed out", () => {
    const r = checkDownloadPreconditions({ ...base, signedIn: false });
    expect(r).toEqual({ ok: false, reason: "Sign in first." });
  });

  it("refuses a device that has synced before", () => {
    const r = checkDownloadPreconditions({ ...base, syncStateCount: 1 });
    expect(r.ok).toBe(false);
  });

  it("refuses when notes are open", () => {
    const r = checkDownloadPreconditions({ ...base, openTabCount: 2 });
    expect(r.ok).toBe(false);
  });

  it("refuses a starter note that has been edited (revision > 0)", () => {
    const r = checkDownloadPreconditions({
      ...base,
      localNotes: [note("n1", "Welcome", 1)],
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a renamed starter note (title no longer matches)", () => {
    const r = checkDownloadPreconditions({
      ...base,
      localNotes: [note("n1", "My notes")],
    });
    expect(r.ok).toBe(false);
  });

  it("refuses any note of the user's own, even next to starter notes", () => {
    const r = checkDownloadPreconditions({
      ...base,
      localNotes: [note("n1", "Welcome"), note("n2", "Shopping", 4)],
    });
    expect(r.ok).toBe(false);
  });

  it("refuses a local canvas", () => {
    const r = checkDownloadPreconditions({
      ...base,
      localNotes: [note("n1", "Welcome", 0, true)],
    });
    expect(r.ok).toBe(false);
  });
});

describe("batch sizing", () => {
  it("keeps the size after a successful batch", () => {
    expect(nextBatchSize(INITIAL_BATCH, false)).toBe(INITIAL_BATCH);
  });

  it("halves after a failure", () => {
    expect(nextBatchSize(50, true)).toBe(25);
    expect(nextBatchSize(25, true)).toBe(12);
  });

  it("never goes below the minimum", () => {
    expect(nextBatchSize(MIN_BATCH, true)).toBe(MIN_BATCH);
    expect(nextBatchSize(6, true)).toBe(MIN_BATCH);
  });

  it("takeBatch slices consecutively and never returns an empty size", () => {
    const items = [1, 2, 3, 4, 5];
    expect(takeBatch(items, 0, 2)).toEqual([1, 2]);
    expect(takeBatch(items, 4, 2)).toEqual([5]);
    expect(takeBatch(items, 0, 0)).toEqual([1]);
    expect(takeBatch(items, 9, 2)).toEqual([]);
  });
});

describe("isInterruptedDownload", () => {
  const f = {
    hasSyncState: false,
    localUpdatedAt: T,
    localContent: '{"type":"doc"}',
    remoteUpdatedAt: T,
    remoteContent: '{"type":"doc"}',
  };

  it("adopts a stateless note identical to hosted", () => {
    expect(isInterruptedDownload(f)).toBe(true);
  });

  it("never touches a note that already has sync state", () => {
    expect(isInterruptedDownload({ ...f, hasSyncState: true })).toBe(false);
  });

  it("rejects when updated_at differs", () => {
    expect(isInterruptedDownload({ ...f, remoteUpdatedAt: T + 1 })).toBe(false);
  });

  it("rejects when content differs by even one character", () => {
    expect(isInterruptedDownload({ ...f, remoteContent: '{"type":"doc" }' })).toBe(false);
  });
});
