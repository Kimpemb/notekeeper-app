// src/features/sync/lib/deleteReviewView.test.ts

import { describe, it, expect } from "vitest";
import { buildD1View, buildD2View } from "@/features/sync/lib/deleteReviewView";

const para = (text: string) => ({ type: "paragraph", attrs: { blockId: "p" }, content: [{ type: "text", text }] });
const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const image = () => ({ type: "image", attrs: { src: "C:\\Users\\J\\images\\a.png", alt: "" } });

describe("buildD1View", () => {
  const v = (over: Partial<Parameters<typeof buildD1View>[0]> = {}) =>
    buildD1View({ title: "trash-test3", hostedContent: doc(para("edited on B")), hostedInTrash: false, ...over });

  it("shows the other device's version as lines", () => {
    const r = v();
    expect(r.case).toBe("d1");
    expect(r.contentLabel).toBe("The other device's version");
    expect(r.lines).toEqual(["edited on B"]);
    expect(r.heading).toBe("trash-test3");
  });

  it("explains what happened in plain language", () => {
    expect(v().explanation).toMatch(/You deleted this note on this device/);
    expect(v().explanation).toMatch(/changed it afterwards/);
  });

  it("restore is the highlighted default and needs no confirmation", () => {
    const [keep, del] = v().choices;
    expect(keep).toMatchObject({ id: "keep_it", isDefault: true, requiresConfirm: false, confirmText: null });
    expect(del).toMatchObject({ id: "delete_anyway", isDefault: false, requiresConfirm: true });
  });

  it("only one choice is the default", () => {
    expect(v().choices.filter((c) => c.isDefault)).toHaveLength(1);
  });

  it("delete everywhere asks for confirmation, names the note and mentions the backup", () => {
    const del = v().choices[1];
    expect(del.confirmText).toContain('"trash-test3"');
    expect(del.confirmText).toMatch(/backup/);
    expect(del.description).toMatch(/lost there/);
  });

  it("restore says nothing on the server changes", () => {
    expect(v().choices[0].description).toMatch(/Nothing on the server changes/);
  });

  it("a note the other device has in its trash comes back in the trash, and says so", () => {
    expect(v({ hostedInTrash: true }).choices[0].description).toMatch(/comes back in the trash/);
    expect(v({ hostedInTrash: false }).choices[0].description).not.toMatch(/trash/);
  });

  it("images get a notice and a warning on restore", () => {
    const r = v({ hostedContent: doc(para("x"), image(), image()) });
    expect(r.mediaNotice).toContain("2 images");
    expect(r.mediaNotice).toContain("not synced");
    expect(r.choices[0].warning).toMatch(/may not show here/);
    expect(r.choices[1].warning).toBeNull();
  });

  it("no media means no notice and no warning", () => {
    const r = v();
    expect(r.mediaNotice).toBeNull();
    expect(r.choices[0].warning).toBeNull();
  });

  it("an empty title is shown as Untitled", () => {
    const r = v({ title: "  " });
    expect(r.heading).toBe("Untitled");
    expect(r.choices[1].confirmText).toContain('"Untitled"');
  });
});

describe("buildD2View", () => {
  const v = (over: Partial<Parameters<typeof buildD2View>[0]> = {}) =>
    buildD2View({ title: "purge-test", localContent: doc(para("mine text")), ...over });

  it("shows YOUR version, because the deleted one is wiped", () => {
    const r = v();
    expect(r.case).toBe("d2");
    expect(r.contentLabel).toBe("Your version");
    expect(r.lines).toEqual(["mine text"]);
    expect(r.explanation).toMatch(/only copy left/);
    expect(r.explanation).toMatch(/wipes it/);
  });

  it("keep mine is the highlighted default and needs no confirmation", () => {
    const [keep, go] = v().choices;
    expect(keep).toMatchObject({ id: "keep_mine", isDefault: true, requiresConfirm: false });
    expect(go).toMatchObject({ id: "let_go", isDefault: false, requiresConfirm: true });
  });

  it("keep mine mentions the backup and that sharing settings are not restored", () => {
    const d = v().choices[0].description;
    expect(d).toMatch(/backup/);
    expect(d).toMatch(/Sharing and publishing settings are not restored/);
  });

  it("let the deletion stand warns that the backup will be the only copy", () => {
    const go = v().choices[1];
    expect(go.confirmText).toContain('"purge-test"');
    expect(go.confirmText).toMatch(/only copy/);
  });

  it("images get a notice but keep mine has no extra warning", () => {
    const r = v({ localContent: doc(para("x"), image()) });
    expect(r.mediaNotice).toContain("1 image");
    expect(r.mediaNotice).toMatch(/other devices may not show them/);
    expect(r.choices.map((c) => c.warning)).toEqual([null, null]);
  });

  it("unreadable content is shown as such, not hidden", () => {
    expect(v({ localContent: "{nope" }).lines).toEqual(["(this version could not be read)"]);
  });
});
