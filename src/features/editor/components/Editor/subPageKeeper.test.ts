// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("./SubPageNodeView", () => ({ SubPageNodeView: () => null }));
vi.mock("@tiptap/react", async () => {
  const core = await vi.importActual<any>("@tiptap/core");
  return { ...core, ReactNodeViewRenderer: () => () => null };
});

import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { AllSelection, EditorState } from "@tiptap/pm/state";
import { SubPageNode } from "./SubPageNode";

const live = new Set(["a", "b"]);
const storage = { parentNoteId: "p", paneId: 1, setCreating() {}, isLiveChild: (id: string) => live.has(id) };

function setup(docJson: any) {
  const exts = [StarterKit, SubPageNode];
  const schema = getSchema(exts);
  const plugins = (SubPageNode.config as any).addProseMirrorPlugins.call({ storage });
  const doc = schema.nodeFromJSON(docJson);
  return { schema, state: EditorState.create({ doc, plugins }) };
}
const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const sub = (id: string) => ({ type: "subPage", attrs: { noteId: id, title: id, mode: "display" } });
const ids = (state: EditorState) => { const out: string[] = []; state.doc.forEach((n) => out.push(n.type.name === "subPage" ? "sub:" + n.attrs.noteId : n.type.name === "paragraph" ? "p:" + n.textContent : n.type.name)); return out; };

describe("subPageKeeper", () => {
  it("select-all + paste keeps trailing sub-notes", () => {
    const { state, schema } = setup({ type: "doc", content: [p("one"), p("two"), sub("a"), sub("b")] });
    let s = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    const tr = s.tr.replaceSelectionWith(schema.nodeFromJSON(p("pasted")));
    s = s.apply(tr);
    expect(ids(s)).toEqual(["p:pasted", "sub:a", "sub:b"]);
  });

  it("keeps order and lands after the replacement for interior sub-notes", () => {
    const { state, schema } = setup({ type: "doc", content: [p("x"), sub("a"), p("y"), sub("b"), p("z")] });
    let s = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    s = s.apply(s.tr.replaceSelectionWith(schema.nodeFromJSON(p("new"))));
    expect(ids(s)).toEqual(["p:new", "sub:a", "sub:b"]);
  });

  it("allows removal once the note is no longer a live child", () => {
    live.delete("a");
    const { state } = setup({ type: "doc", content: [p("x"), sub("a")] });
    let pos = -1; state.doc.forEach((n, o) => { if (n.type.name === "subPage") pos = o; });
    const s = state.apply(state.tr.delete(pos, pos + 1));
    expect(ids(s)).toEqual(["p:x"]);
    live.add("a");
  });

  it("does not interfere with moving a block (same id stays present)", () => {
    const { state } = setup({ type: "doc", content: [sub("a"), p("x")] });
    const node = state.doc.child(0);
    let tr = state.tr.delete(0, node.nodeSize);
    tr = tr.insert(tr.doc.content.size, node);
    const s = state.apply(tr);
    expect(ids(s)).toEqual(["p:x", "sub:a"]);
  });

  it("explicit bypass meta lets a transaction remove blocks", () => {
    const { state } = setup({ type: "doc", content: [p("x"), sub("a")] });
    let pos = -1; state.doc.forEach((n, o) => { if (n.type.name === "subPage") pos = o; });
    const s = state.apply(state.tr.delete(pos, pos + 1).setMeta("allowSubPageRemoval", true));
    expect(ids(s)).toEqual(["p:x"]);
  });
});
