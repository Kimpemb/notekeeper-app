// src/features/sync/lib/recoverPlan.test.ts
import { describe, it, expect } from "vitest";
import {
  RESTORED_SUFFIX,
  availableSides,
  countMediaNodes,
  planRecoverAsNew,
  planRecoverReplace,
  restoredTitle,
  sideOf,
  type RecoverLocalNote,
} from "./recoverPlan";
import type { BackupRow } from "./reconcileStore";

const para = (blockId: string, text: string) => ({
  type: "paragraph",
  attrs: { blockId },
  content: [{ type: "text", text }],
});
const docJson = (...kids: unknown[]) => JSON.stringify({ type: "doc", content: kids });

const MINE = docJson(para("A", "mine text"), para("B", "more"));
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

const counter = () => {
  let i = 0;
  return () => `id${++i}`;
};

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

describe("sideOf and availableSides", () => {
  it("returns null for a side with no content (null or empty)", () => {
    expect(sideOf(row({ mine_content: null }), "mine")).toBeNull();
    expect(sideOf(row({ theirs_content: "" }), "theirs")).toBeNull();
  });

  it("maps a side with metadata", () => {
    const s = sideOf(row(), "mine");
    expect(s?.title).toBe("Mine title");
    expect(s?.meta).toEqual({ parentId: "P1", sortOrder: 3, tags: '["a"]', frontmatter: "fm" });
  });

  it("has_meta 0 gives meta null even if stray values are present", () => {
    const s = sideOf(row({ theirs_has_meta: 0, theirs_parent_id: "X" }), "theirs");
    expect(s?.meta).toBeNull();
  });

  it("lists mine first, and only sides that have content", () => {
    expect(availableSides(row())).toEqual(["mine", "theirs"]);
    expect(availableSides(row({ mine_content: null, kind: "purge" }))).toEqual(["theirs"]);
    expect(availableSides(row({ mine_content: null, theirs_content: null }))).toEqual([]);
  });
});

describe("restoredTitle", () => {
  it("adds the suffix, and names an empty title Untitled", () => {
    expect(restoredTitle("Plan")).toBe("Plan" + RESTORED_SUFFIX);
    expect(restoredTitle("   ")).toBe("Untitled (restored)");
  });
});

describe("planRecoverAsNew", () => {
  const base = () => ({ row: row(), side: "mine" as const, now: 9000, newId: counter(), parentExistsLocally: true });

  it("builds a new note: first id is the note id, block ids are fresh, never the originals", () => {
    const r = planRecoverAsNew(base());
    if (!r.ok) throw new Error(r.reason);
    const c = r.plan.copy;
    expect(c.noteId).toBe("id1");
    expect(c.noteId).not.toBe("n1");
    expect(c.content).not.toContain('"blockId":"A"');
    expect(c.content).not.toContain('"blockId":"B"');
    expect(c.content).toContain('"blockId":"id2"');
    expect(c.content).toContain("mine text");
    expect(c.title).toBe("Mine title (restored)");
    expect(c.createdAt).toBe(9000);
    expect(c.updatedAt).toBe(9000);
  });

  it("restores parent, sort order, tags and frontmatter when the backup kept them", () => {
    const r = planRecoverAsNew(base());
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.copy.parentId).toBe("P1");
    expect(r.plan.copy.sortOrder).toBe(3);
    expect(r.plan.copy.tags).toBe('["a"]');
    expect(r.plan.copy.frontmatter).toBe("fm");
  });

  it("puts the note at the top level, with a note, when the saved parent is gone", () => {
    const r = planRecoverAsNew({ ...base(), parentExistsLocally: false });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.copy.parentId).toBeNull();
    expect(r.plan.copy.sortOrder).toBe(3); // other metadata still comes back
    expect(r.plan.notes.join(" ")).toContain("top level");
  });

  it("uses defaults, with a note, when the backup has no metadata", () => {
    const r = planRecoverAsNew({ ...base(), side: "theirs" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.copy.parentId).toBeNull();
    expect(r.plan.copy.sortOrder).toBe(0);
    expect(r.plan.copy.tags).toBeNull();
    expect(r.plan.copy.frontmatter).toBeNull();
    expect(r.plan.notes.join(" ")).toContain("did not keep");
  });

  it("a real root note (has_meta 1, null parent) restores without any parent note", () => {
    const r = planRecoverAsNew({
      ...base(),
      row: row({ mine_parent_id: null }),
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.copy.parentId).toBeNull();
    expect(r.plan.notes.join(" ")).not.toContain("top level");
    expect(r.plan.notes.join(" ")).not.toContain("did not keep");
  });

  it("takes search text from the generator, on the remapped content", () => {
    let seen = "";
    const r = planRecoverAsNew({
      ...base(),
      generatePlaintext: (c) => {
        seen = c;
        return "generated";
      },
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.copy.plaintext).toBe("generated");
    expect(seen).toBe(r.plan.copy.content);
  });

  it("leaves search text empty, with a note, when the generator is missing or returns null", () => {
    const none = planRecoverAsNew(base());
    const nul = planRecoverAsNew({ ...base(), generatePlaintext: () => null });
    for (const r of [none, nul]) {
      if (!r.ok) throw new Error(r.reason);
      expect(r.plan.copy.plaintext).toBe("");
      expect(r.plan.notes.join(" ")).toContain("re-indexed");
    }
  });

  it("warns about images and attachments, naming whose files they are", () => {
    const withMedia = docJson(para("A", "x"), { type: "image", attrs: { src: "C:\\a.png" } });
    const mine = planRecoverAsNew({ ...base(), row: row({ mine_content: withMedia }) });
    const theirs = planRecoverAsNew({ ...base(), side: "theirs", row: row({ theirs_content: withMedia }) });
    if (!mine.ok || !theirs.ok) throw new Error("plan failed");
    expect(mine.plan.notes.join(" ")).toContain("this device's");
    expect(theirs.plan.notes.join(" ")).toContain("other device's");
  });

  it("refuses an empty side and invalid content, writing nothing", () => {
    const empty = planRecoverAsNew({ ...base(), row: row({ mine_content: null }) });
    expect(empty).toMatchObject({ ok: false, reason: "side_empty" });
    for (const bad of ["not json", "[1,2]", "null", "42"]) {
      const r = planRecoverAsNew({ ...base(), row: row({ mine_content: bad }) });
      expect(r).toMatchObject({ ok: false, reason: "bad_content" });
    }
  });

  it("is deterministic for the same ids", () => {
    const a = planRecoverAsNew(base());
    const b = planRecoverAsNew(base());
    expect(a).toEqual(b);
  });

  it("never reuses the backup's note id", () => {
    const r = planRecoverAsNew({ ...base(), newId: () => "n1x" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.copy.noteId).not.toBe("n1");
  });
});

describe("planRecoverReplace", () => {
  const base = () => ({ row: row(), side: "theirs" as const, local: local(), now: 9000 });

  it("needs a live local note", () => {
    expect(planRecoverReplace({ ...base(), local: null })).toMatchObject({ ok: false, reason: "note_missing" });
  });

  it("refuses an empty side and invalid content", () => {
    expect(planRecoverReplace({ ...base(), row: row({ theirs_content: null }) })).toMatchObject({
      ok: false,
      reason: "side_empty",
    });
    expect(planRecoverReplace({ ...base(), row: row({ theirs_content: "oops" }) })).toMatchObject({
      ok: false,
      reason: "bad_content",
    });
  });

  it("refuses when it would write what the note already holds", () => {
    const l = local({ title: "Theirs title", content: THEIRS });
    expect(planRecoverReplace({ ...base(), local: l })).toMatchObject({ ok: false, reason: "nothing_to_change" });
  });

  it("writes only title and content from the chosen side", () => {
    const r = planRecoverReplace(base());
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.noteId).toBe("n1");
    expect(r.plan.title).toBe("Theirs title");
    expect(r.plan.content).toBe(THEIRS); // not remapped: it is the same note
    expect(Object.keys(r.plan).sort()).toEqual(
      ["backup", "content", "expectedLocalStamp", "noteId", "notes", "plaintext", "plaintextGenerated", "title"].sort()
    );
  });

  it("backs up the CURRENT note first, as kind recover, with its metadata", () => {
    const r = planRecoverReplace(base());
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.backup).toEqual({
      noteId: "n1",
      kind: "recover",
      hostedRevision: null,
      mineTitle: "Current",
      mineContent: local().content,
      theirsTitle: null,
      theirsContent: null,
      mineMeta: { parentId: "P9", sortOrder: 7, tags: "t", frontmatter: null },
    });
  });

  it("carries the local stamp the committer must find unchanged", () => {
    const r = planRecoverReplace(base());
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.expectedLocalStamp).toEqual({ revision: 12, metaRev: 2, updatedAt: 5000 });
  });

  it("names an empty backed-up title Untitled", () => {
    const r = planRecoverReplace({ ...base(), row: row({ theirs_title: "" }) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.title).toBe("Untitled");
  });

  it("search text: generated when possible, otherwise empty and flagged", () => {
    const g = planRecoverReplace({ ...base(), generatePlaintext: () => "gen" });
    const n = planRecoverReplace(base());
    if (!g.ok || !n.ok) throw new Error("plan failed");
    expect(g.plan.plaintext).toBe("gen");
    expect(g.plan.plaintextGenerated).toBe(true);
    expect(n.plan.plaintext).toBe("");
    expect(n.plan.plaintextGenerated).toBe(false);
    expect(n.plan.notes.join(" ")).toContain("re-indexed");
  });

  it("always says only title and text are replaced, and warns about media", () => {
    const withMedia = docJson(para("A", "x"), { type: "attachment", attrs: { src: "C:\\f.pdf" } });
    const r = planRecoverReplace({ ...base(), row: row({ theirs_content: withMedia }) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.plan.notes[0]).toContain("Only the title and text");
    expect(r.plan.notes.join(" ")).toContain("other device's");
  });
});

describe("countMediaNodes", () => {
  it("counts nested images and attachments, and tolerates bad input", () => {
    const nested = docJson({
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "image", attrs: { src: "a" } }] }],
    });
    expect(countMediaNodes(nested)).toBe(1);
    expect(countMediaNodes(docJson(para("A", "x")))).toBe(0);
    expect(countMediaNodes("not json")).toBe(0);
  });
});
