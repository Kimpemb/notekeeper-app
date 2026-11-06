// src/features/sync/lib/wholeNoteView.test.ts

import { describe, it, expect } from "vitest";
import {
  RULE_LINE,
  UNREADABLE_LINE,
  buildWholeNoteView,
  contentToLines,
  countMedia,
  describeMedia,
  type MetaRowInput,
  type WholeNoteViewInput,
} from "@/features/sync/lib/wholeNoteView";

const para = (text: string) => ({ type: "paragraph", attrs: { blockId: "p" }, content: text ? [{ type: "text", text }] : [] });
const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const image = (src = "C:\\Users\\J\\images\\logo_1.png", alt = "") => ({ type: "image", attrs: { src, alt, width: null, align: "left" } });
const attachment = (filename = "notes.pdf") => ({ type: "attachment", attrs: { src: "C:\\x\\a.pdf", filename, kind: "pdf", size: 10 } });

// ─── countMedia ───────────────────────────────────────────────────────────

describe("countMedia", () => {
  it("counts images and attachments", () => {
    const m = countMedia(doc(para("a"), image(), image(), attachment()));
    expect(m).toEqual({ images: 2, attachments: 1, total: 3 });
  });

  it("finds media nested inside other nodes", () => {
    const nested = doc({ type: "toggle", content: [{ type: "toggleBody", content: [image()] }] });
    expect(countMedia(nested).images).toBe(1);
  });

  it("a note with no media is all zeros", () => {
    expect(countMedia(doc(para("plain")))).toEqual({ images: 0, attachments: 0, total: 0 });
  });

  it("unreadable content counts as none", () => {
    expect(countMedia("{nope")).toEqual({ images: 0, attachments: 0, total: 0 });
  });
});

describe("describeMedia", () => {
  it("says what is there, with correct plurals", () => {
    expect(describeMedia({ images: 0, attachments: 0, total: 0 })).toBe("no images or attachments");
    expect(describeMedia({ images: 1, attachments: 0, total: 1 })).toBe("1 image");
    expect(describeMedia({ images: 2, attachments: 1, total: 3 })).toBe("2 images and 1 attachment");
    expect(describeMedia({ images: 0, attachments: 2, total: 2 })).toBe("2 attachments");
  });
});

// ─── contentToLines ───────────────────────────────────────────────────────

describe("contentToLines", () => {
  it("one line per paragraph, heading and code block, in order", () => {
    const d = doc(
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      para("first"),
      { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] }
    );
    expect(contentToLines(d)).toEqual(["Title", "first", "x = 1"]);
  });

  it("joins inline pieces and turns a hard break into a space", () => {
    const d = doc({ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] });
    expect(contentToLines(d)).toEqual(["a b"]);
  });

  it("shows a horizontal rule as a rule line", () => {
    expect(contentToLines(doc(para("mine text"), { type: "horizontalRule" }))).toEqual(["mine text", RULE_LINE]);
  });

  it("names images and attachments instead of dropping them", () => {
    const lines = contentToLines(doc(image("C:\\Users\\J\\images\\logo_1.png"), image("C:\\a\\b.png", "Team photo"), attachment("plan.pdf")));
    expect(lines).toEqual(["[image: logo_1.png]", "[image: Team photo]", "[attachment: plan.pdf]"]);
  });

  it("reads text inside lists and toggles", () => {
    const d = doc({ type: "bulletList", content: [{ type: "listItem", content: [para("one")] }, { type: "listItem", content: [para("two")] }] });
    expect(contentToLines(d)).toEqual(["one", "two"]);
  });

  it("keeps blank lines inside the note but trims trailing ones", () => {
    expect(contentToLines(doc(para("a"), para(""), para("b"), para(""), para("")))).toEqual(["a", "", "b"]);
  });

  it("unreadable content is reported, not hidden", () => {
    expect(contentToLines("{nope")).toEqual([UNREADABLE_LINE]);
  });
});

// ─── buildWholeNoteView ───────────────────────────────────────────────────

const base = (over: Partial<WholeNoteViewInput> = {}): WholeNoteViewInput => ({
  mineContent: doc(para("mine text"), { type: "horizontalRule" }),
  theirsContent: doc(para("theirs text")),
  mineTitle: "Plan",
  metaRows: [],
  ...over,
});

describe("buildWholeNoteView — content", () => {
  it("shows both versions as lines", () => {
    const v = buildWholeNoteView(base());
    expect(v.mine.lines).toEqual(["mine text", RULE_LINE]);
    expect(v.theirs.lines).toEqual(["theirs text"]);
    expect(v.sameText).toBe(false);
  });

  it("flags text that is the same even when something else differs", () => {
    const v = buildWholeNoteView(base({ mineContent: doc(para("same"), { type: "horizontalRule" }), theirsContent: doc(para("same"), { type: "horizontalRule" }) }));
    expect(v.sameText).toBe(true);
  });
});

describe("buildWholeNoteView — choices", () => {
  it("offers keep mine, take theirs, keep both, in that order, with keep mine highlighted", () => {
    const v = buildWholeNoteView(base());
    expect(v.choices.map((c) => c.id)).toEqual(["keep_mine", "take_theirs", "keep_both"]);
    expect(v.choices.map((c) => c.variant)).toEqual(["whole_keep_mine", "whole_take_theirs", "whole_keep_both"]);
    expect(v.choices.filter((c) => c.isDefault).map((c) => c.id)).toEqual(["keep_mine"]);
  });

  it("every choice says a backup is saved first", () => {
    for (const c of buildWholeNoteView(base()).choices) expect(c.description).toMatch(/backup/i);
  });

  it("keep both names the copy", () => {
    const keepBoth = buildWholeNoteView(base()).choices[2];
    expect(keepBoth.description).toContain('"Plan (conflict copy)"');
  });

  it("an untitled note gets an Untitled copy name", () => {
    expect(buildWholeNoteView(base({ mineTitle: "" })).choices[2].description).toContain("Untitled (conflict copy)");
  });
});

describe("buildWholeNoteView — images and attachments", () => {
  it("no notice and no warnings without media", () => {
    const v = buildWholeNoteView(base());
    expect(v.mediaNotice).toBeNull();
    expect(v.choices.map((c) => c.warning)).toEqual([null, null, null]);
  });

  it("the notice says what each version has", () => {
    const v = buildWholeNoteView(base({ mineContent: doc(para("a"), image(), image()), theirsContent: doc(para("b"), attachment()) }));
    expect(v.mediaNotice).toContain("not synced");
    expect(v.mediaNotice).toContain("Your version has 2 images");
    expect(v.mediaNotice).toContain("the other version has 1 attachment");
  });

  it("take theirs warns that mine's images stop showing, and that the files and backup keep them safe", () => {
    const v = buildWholeNoteView(base({ mineContent: doc(para("a"), image(), image()) }));
    const warn = v.choices[1].warning;
    expect(warn).toBe("Your version has 2 images; after this they stop showing in this note. The files stay on disk and your version is backed up.");
    expect(v.choices[0].warning).toMatch(/files on this device/);
    expect(v.choices[2].warning).toBeNull();
  });

  it("take theirs and keep both warn when theirs has media", () => {
    const v = buildWholeNoteView(base({ theirsContent: doc(para("b"), image()) }));
    expect(v.choices[1].warning).toBe("The other version has 1 image; those files are on the other device and may not show here.");
    expect(v.choices[2].warning).toMatch(/copy keeps/);
    expect(v.choices[0].warning).toBeNull();
  });

  it("take theirs joins both warnings when both sides have media", () => {
    const v = buildWholeNoteView(base({ mineContent: doc(image()), theirsContent: doc(attachment()) }));
    expect(v.choices[1].warning).toContain("Your version has 1 image");
    expect(v.choices[1].warning).toContain("The other version has 1 attachment");
  });
});

describe("buildWholeNoteView — metadata rows", () => {
  const rows: MetaRowInput[] = [
    { field: "title", mine: "meta-test-renamed-2", theirs: "meta-test-renamed", choice: "mine", canTakeTheirs: true },
    { field: "parentId", mine: null, theirs: "48c376b2-2ef5-4423-93f3-e49dd350c567", choice: "theirs", canTakeTheirs: true },
  ];

  it("labels the fields and preselects what the plan chose", () => {
    const v = buildWholeNoteView(base({ metaRows: rows }));
    expect(v.metaRows.map((r) => [r.label, r.preselected])).toEqual([["Title", "mine"], ["Parent note", "theirs"]]);
    expect(v.metaRows[0].mineLabel).toBe("meta-test-renamed-2");
    expect(v.metaRows[0].theirsLabel).toBe("meta-test-renamed");
  });

  it("shows a missing parent as the top level and a known parent by name", () => {
    const parentTitles = new Map([["48c376b2-2ef5-4423-93f3-e49dd350c567", "meta-parent"]]);
    const v = buildWholeNoteView(base({ metaRows: rows, parentTitles }));
    expect(v.metaRows[1].mineLabel).toBe("Top level");
    expect(v.metaRows[1].theirsLabel).toBe("meta-parent");
  });

  it("a parent this device does not know is shown without being named", () => {
    const v = buildWholeNoteView(base({ metaRows: rows }));
    expect(v.metaRows[1].theirsLabel).toBe("Another note (48c376b2)");
  });

  it("keeps canTakeTheirs so the screen can disable that option", () => {
    const v = buildWholeNoteView(base({ metaRows: [{ ...rows[1], canTakeTheirs: false }] }));
    expect(v.metaRows[0].canTakeTheirs).toBe(false);
  });

  it("an empty title shows as Untitled; the trash flag in words", () => {
    const v = buildWholeNoteView(
      base({
        metaRows: [
          { field: "title", mine: "", theirs: "x", choice: "mine", canTakeTheirs: true },
          { field: "deletedAt", mine: null, theirs: 123, choice: "mine", canTakeTheirs: true },
        ],
      })
    );
    expect(v.metaRows[0].mineLabel).toBe("Untitled");
    expect(v.metaRows[1].mineLabel).toBe("Not in the trash");
    expect(v.metaRows[1].theirsLabel).toBe("In the trash");
  });

  it("an unknown field keeps its own name as the label", () => {
    const v = buildWholeNoteView(base({ metaRows: [{ field: "mystery", mine: 1, theirs: 2, choice: "mine", canTakeTheirs: true }] }));
    expect(v.metaRows[0].label).toBe("mystery");
  });
});

describe("buildWholeNoteView — purity", () => {
  it("does not change its input", () => {
    const input = base({ metaRows: [{ field: "title", mine: "a", theirs: "b", choice: "mine", canTakeTheirs: true }] });
    const before = JSON.stringify(input);
    buildWholeNoteView(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
