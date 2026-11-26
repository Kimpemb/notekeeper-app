import { describe, it, expect } from "vitest";
import { buildInitialContent, type NoteLike } from "./subPageSync";

const note = (id: string, parent: string | null, extra: Partial<NoteLike> = {}): NoteLike => ({
  id, title: id, parent_id: parent, deleted_at: null, sort_order: 0, ...extra,
});
const sub = (id: string) => ({ type: "subPage", attrs: { noteId: id, title: id, mode: "display" } });
const para = (t?: string) => (t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" });
const docOf = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const types = (d: { content?: { type?: string; attrs?: { noteId?: string } }[] }) =>
  (d.content ?? []).map((n) => (n.attrs?.noteId ? `${n.type}:${n.attrs.noteId}` : n.type));

describe("buildInitialContent", () => {
  const notes = [note("p", null), note("a", "p", { sort_order: 1 }), note("b", "p", { sort_order: 2 })];

  it("appends children missing from saved content at the bottom", () => {
    const out = buildInitialContent(docOf(para("hi")), "p", notes, true);
    expect(types(out)).toEqual(["paragraph", "subPage:a", "subPage:b"]);
  });

  it("keeps the saved position of blocks that already exist", () => {
    const out = buildInitialContent(docOf(para("x"), sub("b"), para("y")), "p", notes, true);
    expect(types(out)).toEqual(["paragraph", "subPage:b", "paragraph", "subPage:a"]);
  });

  it("puts new blocks before a trailing empty paragraph", () => {
    const out = buildInitialContent(docOf(para("x"), para()), "p", notes, true);
    expect(types(out)).toEqual(["paragraph", "subPage:a", "subPage:b", "paragraph"]);
  });

  it("finds blocks nested in containers instead of duplicating them", () => {
    const toggle = { type: "toggle", content: [{ type: "toggleBody", content: [sub("a")] }] };
    const out = buildInitialContent(docOf(toggle), "p", notes, true);
    expect(types(out)).toEqual(["toggle", "subPage:b"]);
  });

  it("drops blocks for notes that were trashed or moved", () => {
    const n = [note("p", null), note("a", "p", { deleted_at: 1 }), note("b", "other")];
    const out = buildInitialContent(docOf(sub("a"), sub("b"), para("x")), "p", n, true);
    expect(types(out)).toEqual(["paragraph"]);
  });

  it("keeps blocks for unknown notes until the store has settled", () => {
    const out = buildInitialContent(docOf(sub("ghost")), "p", [note("p", null)], false);
    expect(types(out)).toEqual(["subPage:ghost"]);
    const settled = buildInitialContent(docOf(sub("ghost")), "p", [note("p", null)], true);
    expect(types(settled)).toEqual([]);
  });

  it("copes with empty, null and malformed content", () => {
    for (const bad of [undefined, null, "", "null", "{", "{}", '{"type":"doc"}']) {
      const out = buildInitialContent(bad as string | undefined, "p", notes, true);
      expect(types(out)).toEqual(["subPage:a", "subPage:b"]);
    }
  });

  it("does not leave an emptied container invalid", () => {
    const callout = { type: "callout", content: [sub("zzz")] };
    const out = buildInitialContent(docOf(callout), "p", [note("p", null)], true);
    expect((out.content as any)[0].content).toEqual([{ type: "paragraph" }]);
  });
});
