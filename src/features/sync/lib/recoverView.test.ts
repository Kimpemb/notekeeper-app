// src/features/sync/lib/recoverView.test.ts
import { describe, it, expect } from "vitest";
import {
  PREVIEW_MAX_CHARS,
  backupKindLabel,
  describeBackup,
  describeRecoverOutcome,
  groupBackups,
  previewText,
} from "./recoverView";
import type { BackupRow } from "./reconcileStore";

const para = (blockId: string, text: string) => ({
  type: "paragraph",
  attrs: { blockId },
  content: [{ type: "text", text }],
});
const docJson = (...kids: unknown[]) => JSON.stringify({ type: "doc", content: kids });

const MINE = docJson(para("A", "mine text"), para("B", "second line"));
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
  mine_tags: null,
  mine_frontmatter: null,
  theirs_has_meta: 0,
  theirs_parent_id: null,
  theirs_sort_order: null,
  theirs_tags: null,
  theirs_frontmatter: null,
  ...over,
});

describe("previewText", () => {
  it("joins the lines into one short line", () => {
    expect(previewText(MINE)).toBe("mine text second line");
  });

  it("cuts a long text and ends it with an ellipsis", () => {
    const long = docJson(para("A", "x".repeat(500)));
    const out = previewText(long);
    expect(out.length).toBeLessThanOrEqual(PREVIEW_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("says (empty) for a document with no text", () => {
    expect(previewText(docJson())).toBe("(empty)");
  });
});

describe("backupKindLabel", () => {
  it("has plain wording for every kind and a fallback", () => {
    expect(backupKindLabel("merge")).toBe("Before a merge");
    expect(backupKindLabel("whole_note")).toBe("Before a whole-note choice");
    expect(backupKindLabel("purge")).toBe("Before a deletion");
    expect(backupKindLabel("recover")).toBe("Before a restore");
    expect(backupKindLabel("something_new")).toBe("Backup");
  });
});

describe("describeBackup", () => {
  it("lists mine first, then theirs, with titles and previews", () => {
    const v = describeBackup(row());
    expect(v.sides.map((s) => s.side)).toEqual(["mine", "theirs"]);
    expect(v.sides[0]).toMatchObject({ title: "Mine title", preview: "mine text second line" });
    expect(v.sides[1]).toMatchObject({ title: "Theirs title", preview: "theirs text" });
    expect(v.kindLabel).toBe("Before a whole-note choice");
  });

  it("marks which sides kept metadata", () => {
    const v = describeBackup(row());
    expect(v.sides[0].keptMetadata).toBe(true);
    expect(v.sides[1].keptMetadata).toBe(false);
  });

  it("offers only the side that has content (a purge backup has no mine)", () => {
    const v = describeBackup(row({ kind: "purge", mine_title: null, mine_content: null }));
    expect(v.sides.map((s) => s.side)).toEqual(["theirs"]);
  });

  it("shows Untitled for a blank title", () => {
    const v = describeBackup(row({ mine_title: "  " }));
    expect(v.sides[0].title).toBe("Untitled");
  });

  it("counts images and attachments", () => {
    const withImage = docJson(para("A", "x"), { type: "image", attrs: { src: "C:\\a.png" } });
    const v = describeBackup(row({ mine_content: withImage }));
    expect(v.sides[0].mediaCount).toBe(1);
    expect(v.sides[1].mediaCount).toBe(0);
  });
});

describe("groupBackups", () => {
  it("groups by note, newest backup first, notes newest first", () => {
    const groups = groupBackups([
      row({ id: "a", note_id: "n1", created_at: 100 }),
      row({ id: "b", note_id: "n2", created_at: 500 }),
      row({ id: "c", note_id: "n1", created_at: 300 }),
    ]);
    expect(groups.map((g) => g.noteId)).toEqual(["n2", "n1"]);
    expect(groups[1].backups.map((b) => b.id)).toEqual(["c", "a"]);
    expect(groups[1].latest).toBe(300);
  });

  it("drops a backup with nothing to restore, and a note left with none", () => {
    const empty = row({ id: "e", note_id: "n3", mine_content: null, theirs_content: null });
    expect(groupBackups([empty])).toEqual([]);
  });
});

describe("describeRecoverOutcome", () => {
  it("success for both choices, marked as changed", () => {
    const a = describeRecoverOutcome({ status: "committed", choice: "as_new", notes: ["careful"] });
    expect(a).toMatchObject({ tone: "success", changed: true, notes: ["careful"] });
    expect(a.text).toMatch(/new note/);
    const b = describeRecoverOutcome({ status: "committed", choice: "replace" });
    expect(b.tone).toBe("success");
    expect(b.text).toMatch(/replaced/);
    expect(b.text).toMatch(/backup of the previous version/);
  });

  it("stale warns and changes nothing", () => {
    const o = describeRecoverOutcome({ status: "stale", reason: "local_changed" });
    expect(o).toMatchObject({ tone: "warning", changed: false });
  });

  it("every refusal says nothing was changed", () => {
    for (const reason of ["note_open", "busy", "read_failed", "backup_failed"]) {
      const o = describeRecoverOutcome({ status: "refused", reason });
      expect(o.text).toMatch(/nothing was changed/i);
      expect(o.changed).toBe(false);
    }
  });

  it("only an open-note refusal offers to close the note", () => {
    expect(describeRecoverOutcome({ status: "refused", reason: "note_open" }).closeNote).toBe(true);
    for (const reason of ["busy", "read_failed", "backup_failed"]) {
      expect(describeRecoverOutcome({ status: "refused", reason }).closeNote).toBeUndefined();
    }
    expect(describeRecoverOutcome({ status: "committed", choice: "replace" }).closeNote).toBeUndefined();
    expect(describeRecoverOutcome({ status: "stale" }).closeNote).toBeUndefined();
  });

  it("each plan failure has its own sentence and changes nothing", () => {
    const texts = ["side_empty", "bad_content", "note_missing", "nothing_to_change"].map((reason) => {
      const o = describeRecoverOutcome({ status: "plan_failed", reason });
      expect(o.changed).toBe(false);
      return o.text;
    });
    expect(new Set(texts).size).toBe(4);
  });

  it("a local failure is an error and counts as possibly changed", () => {
    const o = describeRecoverOutcome({ status: "local_failed" });
    expect(o).toMatchObject({ tone: "error", changed: true });
  });

  it("an unknown status never claims that nothing happened", () => {
    const o = describeRecoverOutcome({ status: "mystery" });
    expect(o.tone).toBe("error");
    expect(o.changed).toBe(true);
  });
});
