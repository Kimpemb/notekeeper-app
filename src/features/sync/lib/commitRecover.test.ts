// src/features/sync/lib/commitRecover.test.ts
import { describe, it, expect, vi } from "vitest";
import { commitRecover, type RecoverDeps, type RecoverRequest } from "./commitRecover";
import type { BackupRow } from "./reconcileStore";
import type { RecoverLocalNote } from "./recoverPlan";

const para = (blockId: string, text: string) => ({
  type: "paragraph",
  attrs: { blockId },
  content: [{ type: "text", text }],
});
const docJson = (...kids: unknown[]) => JSON.stringify({ type: "doc", content: kids });

const MINE = docJson(para("A", "mine text"));
const THEIRS = docJson(para("A", "theirs text"));

const row = (over: Partial<BackupRow> = {}): BackupRow => ({
  id: "b1",
  note_id: "n1",
  kind: "whole_note",
  created_at: 1000,
  hosted_revision: 4,
  mine_title: "Mine title",
  mine_content: MINE,
  theirs_title: "Theirs title",
  theirs_content: THEIRS,
  mine_has_meta: 1,
  mine_parent_id: "P1",
  mine_sort_order: 3,
  mine_tags: '["a"]',
  mine_frontmatter: "fm",
  theirs_has_meta: 0,
  theirs_parent_id: null,
  theirs_sort_order: null,
  theirs_tags: null,
  theirs_frontmatter: null,
  ...over,
});

const local = (over: Partial<RecoverLocalNote> = {}): RecoverLocalNote => ({
  title: "Current",
  content: docJson(para("A", "current")),
  tags: "t",
  parent_id: "P9",
  sort_order: 7,
  frontmatter: null,
  revision: 12,
  meta_rev: 2,
  updated_at: 5000,
  ...over,
});

interface Harness {
  deps: RecoverDeps;
  calls: string[];
  release: ReturnType<typeof vi.fn>;
}

function harness(over: Partial<RecoverDeps> = {}, localNote: RecoverLocalNote | null = local()): Harness {
  const calls: string[] = [];
  const release = vi.fn(() => {
    calls.push("release");
  });
  let n = 0;
  const deps: RecoverDeps = {
    noteIsOpen: () => false,
    lock: () => release,
    readLocal: async () => localNote,
    parentExists: async () => true,
    writeBackup: vi.fn(async () => {
      calls.push("backup");
    }),
    writeLocal: vi.fn(async () => {
      calls.push("writeLocal");
      return "ok" as const;
    }),
    insertNew: vi.fn(async () => {
      calls.push("insertNew");
    }),
    finishReplace: vi.fn(async () => {
      calls.push("finishReplace");
    }),
    finishNew: vi.fn(async () => {
      calls.push("finishNew");
    }),
    generatePlaintext: () => "generated text",
    now: () => 9000,
    newId: () => `id${++n}`,
    ...over,
  };
  return { deps, calls, release };
}

const asNew = (over: Partial<RecoverRequest> = {}): RecoverRequest => ({
  row: row(),
  side: "mine",
  choice: "as_new",
  ...over,
});
const replace = (over: Partial<RecoverRequest> = {}): RecoverRequest => ({
  row: row(),
  side: "theirs",
  choice: "replace",
  reviewedLocalStamp: { revision: 12, metaRev: 2, updatedAt: 5000 },
  ...over,
});

describe("commitRecover: restore as a new note", () => {
  it("inserts a new note, finishes, writes no backup and takes no lock", async () => {
    const lock = vi.fn(() => null);
    const h = harness({ lock });
    const out = await commitRecover(h.deps, asNew());
    expect(out.status).toBe("committed");
    if (out.status !== "committed" || out.choice !== "as_new") throw new Error("unexpected");
    expect(out.newNoteId).toBe("id1");
    expect(h.calls).toEqual(["insertNew", "finishNew"]);
    expect(lock).not.toHaveBeenCalled();
  });

  it("inserts the restored title and the saved parent when it exists", async () => {
    const h = harness();
    await commitRecover(h.deps, asNew());
    const copy = (h.deps.insertNew as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(copy.title).toBe("Mine title (restored)");
    expect(copy.parentId).toBe("P1");
    expect(copy.sortOrder).toBe(3);
  });

  it("lands at the top level with a note when the saved parent is gone", async () => {
    const h = harness({ parentExists: async () => false });
    const out = await commitRecover(h.deps, asNew());
    const copy = (h.deps.insertNew as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(copy.parentId).toBeNull();
    expect(out.status === "committed" && out.notes.join(" ")).toMatch(/top level/);
  });

  it("does not look up a parent when the backup kept no metadata", async () => {
    const parentExists = vi.fn(async () => true);
    const h = harness({ parentExists });
    await commitRecover(h.deps, asNew({ side: "theirs" }));
    expect(parentExists).not.toHaveBeenCalled();
  });

  it("refuses when the parent lookup throws, and inserts nothing", async () => {
    const h = harness({
      parentExists: async () => {
        throw new Error("db down");
      },
    });
    const out = await commitRecover(h.deps, asNew());
    expect(out).toMatchObject({ status: "refused", reason: "read_failed" });
    expect(h.deps.insertNew).not.toHaveBeenCalled();
  });

  it("reports plan_failed for an empty side and inserts nothing", async () => {
    const h = harness();
    const out = await commitRecover(h.deps, asNew({ row: row({ mine_content: "" }) }));
    expect(out).toMatchObject({ status: "plan_failed", reason: "side_empty" });
    expect(h.deps.insertNew).not.toHaveBeenCalled();
  });

  it("reports local_failed when the insert throws, and does not finish", async () => {
    const h = harness({
      insertNew: async () => {
        throw new Error("id clash");
      },
    });
    const out = await commitRecover(h.deps, asNew());
    expect(out).toEqual({ status: "local_failed", detail: "id clash" });
    expect(h.deps.finishNew).not.toHaveBeenCalled();
  });

  it("still reports committed when the finish step throws", async () => {
    const h = harness({
      finishNew: async () => {
        throw new Error("index failed");
      },
    });
    const out = await commitRecover(h.deps, asNew());
    expect(out.status).toBe("committed");
  });
});

describe("commitRecover: replace this note's content", () => {
  it("backs up first, writes locally, then finishes, and always releases the lock", async () => {
    const h = harness();
    const out = await commitRecover(h.deps, replace());
    expect(out).toMatchObject({ status: "committed", choice: "replace", noteId: "n1" });
    expect(h.calls).toEqual(["backup", "writeLocal", "finishReplace", "release"]);
  });

  it("backs up the current note as kind recover", async () => {
    const h = harness();
    await commitRecover(h.deps, replace());
    const backup = (h.deps.writeBackup as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(backup.kind).toBe("recover");
    expect(backup.mineTitle).toBe("Current");
    expect(backup.mineMeta.parentId).toBe("P9");
  });

  it("writes only title, content, plaintext and updated_at, never metadata", async () => {
    const h = harness();
    await commitRecover(h.deps, replace());
    const [noteId, fields, expected, after] = (h.deps.writeLocal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(noteId).toBe("n1");
    expect(Object.keys(fields).sort()).toEqual(["content", "plaintext", "title", "updated_at"]);
    expect(fields.title).toBe("Theirs title");
    expect(expected).toEqual({ revision: 12, metaRev: 2, updatedAt: 5000 });
    // content changed (+1 revision) and title changed (+1 meta_rev)
    expect(after).toEqual({ revision: 13, metaRev: 3, updatedAt: 9000 });
  });

  it("leaves meta_rev alone when only the content differs", async () => {
    const h = harness({}, local({ title: "Theirs title" }));
    await commitRecover(h.deps, replace());
    const [, fields, , after] = (h.deps.writeLocal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fields.title).toBeUndefined();
    expect(after).toEqual({ revision: 13, metaRev: 2, updatedAt: 9000 });
  });

  it("leaves revision alone when only the title differs", async () => {
    const h = harness({}, local({ content: THEIRS }));
    await commitRecover(h.deps, replace());
    const [, fields, , after] = (h.deps.writeLocal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fields.content).toBeUndefined();
    expect(fields.plaintext).toBeUndefined();
    expect(after).toEqual({ revision: 12, metaRev: 3, updatedAt: 9000 });
  });

  it("keeps the stored search text when none could be generated", async () => {
    const h = harness({ generatePlaintext: () => null });
    await commitRecover(h.deps, replace());
    const fields = (h.deps.writeLocal as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(fields.plaintext).toBeUndefined();
    expect(fields.content).toBe(THEIRS);
  });

  it("refuses when the note is open, before taking the lock or reading", async () => {
    const lock = vi.fn(() => () => {});
    const readLocal = vi.fn(async () => local());
    const h = harness({ noteIsOpen: () => true, lock, readLocal });
    const out = await commitRecover(h.deps, replace());
    expect(out).toMatchObject({ status: "refused", reason: "note_open" });
    expect(lock).not.toHaveBeenCalled();
    expect(readLocal).not.toHaveBeenCalled();
  });

  it("refuses when the lock is busy and writes nothing", async () => {
    const h = harness({ lock: () => null });
    const out = await commitRecover(h.deps, replace());
    expect(out).toMatchObject({ status: "refused", reason: "busy" });
    expect(h.deps.writeBackup).not.toHaveBeenCalled();
  });

  it("refuses when the read throws, and releases the lock", async () => {
    const h = harness({
      readLocal: async () => {
        throw new Error("read broke");
      },
    });
    const out = await commitRecover(h.deps, replace());
    expect(out).toMatchObject({ status: "refused", reason: "read_failed" });
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("reports stale and writes nothing when the note changed since the screen", async () => {
    const h = harness({}, local({ revision: 13 }));
    const out = await commitRecover(h.deps, replace());
    expect(out).toEqual({ status: "stale", reason: "local_changed" });
    expect(h.deps.writeBackup).not.toHaveBeenCalled();
    expect(h.deps.writeLocal).not.toHaveBeenCalled();
  });

  it("reports note_missing when the note is gone", async () => {
    const h = harness({}, null);
    const out = await commitRecover(h.deps, replace());
    expect(out).toMatchObject({ status: "plan_failed", reason: "note_missing" });
    expect(h.deps.writeBackup).not.toHaveBeenCalled();
  });

  it("reports nothing_to_change when the backup equals the note", async () => {
    const h = harness({}, local({ title: "Theirs title", content: THEIRS }));
    const out = await commitRecover(h.deps, replace());
    expect(out).toMatchObject({ status: "plan_failed", reason: "nothing_to_change" });
    expect(h.deps.writeBackup).not.toHaveBeenCalled();
  });

  it("does not write when the backup could not be saved", async () => {
    const h = harness({
      writeBackup: async () => {
        throw new Error("disk full");
      },
    });
    const out = await commitRecover(h.deps, replace());
    expect(out).toMatchObject({ status: "refused", reason: "backup_failed" });
    expect(h.deps.writeLocal).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("reports stale when the compare-and-swap loses a race, and does not finish", async () => {
    const h = harness({ writeLocal: async () => "raced" });
    const out = await commitRecover(h.deps, replace());
    expect(out).toEqual({ status: "stale", reason: "local_changed" });
    expect(h.deps.finishReplace).not.toHaveBeenCalled();
  });

  it("reports local_failed when the write throws", async () => {
    const h = harness({
      writeLocal: async () => {
        throw new Error("sql error");
      },
    });
    const out = await commitRecover(h.deps, replace());
    expect(out).toEqual({ status: "local_failed", detail: "sql error" });
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("is still committed, with a note, when the read-back is unverified", async () => {
    const h = harness({ writeLocal: async () => "unverified" });
    const out = await commitRecover(h.deps, replace());
    expect(out.status).toBe("committed");
    expect(out.status === "committed" && out.notes.join(" ")).toMatch(/next sync/);
    expect(h.deps.finishReplace).toHaveBeenCalled();
  });

  it("is still committed when the finish step throws", async () => {
    const h = harness({
      finishReplace: async () => {
        throw new Error("store refresh failed");
      },
    });
    const out = await commitRecover(h.deps, replace());
    expect(out.status).toBe("committed");
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("skips the stale check when no reviewed stamp was given", async () => {
    const h = harness({}, local({ revision: 99 }));
    const out = await commitRecover(h.deps, replace({ reviewedLocalStamp: undefined }));
    expect(out.status).toBe("committed");
  });
});
