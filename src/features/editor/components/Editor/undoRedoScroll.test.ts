// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Fragment } from "@tiptap/pm/model";
import { AllSelection, TextSelection } from "@tiptap/pm/state";
import { UndoRedoScrollExtension } from "./undoRedoScroll";

const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const PX_PER_POS = 3;      // fake layout: every document position is 3px tall
const BOX_H = 600;         // visible height of the scroll container
(window as any).scrollBy = () => {};   // jsdom: not implemented, ProseMirror's default scroll calls it
let editors: Editor[] = [];
afterEach(() => { editors.forEach((e) => e.destroy()); editors = []; document.body.innerHTML = ""; vi.restoreAllMocks(); });

/** An editor in a scroll container with a fake, scroll-aware layout (jsdom has none). */
function mount(paragraphs = 40) {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  const el = document.createElement("div");
  scroller.appendChild(el);
  document.body.appendChild(scroller);
  const editor = new Editor({
    element: el,
    extensions: [StarterKit, UndoRedoScrollExtension],
    content: { type: "doc", content: Array.from({ length: paragraphs }, (_, i) => para("line " + i)) },
  });
  editors.push(editor);
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: BOX_H, height: BOX_H } as DOMRect);
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => {
    const top = pos * PX_PER_POS - scroller.scrollTop;
    return { top, bottom: top + 20, left: 0, right: 0 } as any;
  });
  // ProseMirror only asks plugins where to scroll when the editor has a live DOM selection (it
  // does whenever the user is typing in it). jsdom has none, so provide one.
  vi.spyOn(editor.view as any, "domSelectionRange").mockReturnValue({ focusNode: editor.view.dom } as any);
  return { editor, scroller };
}

const topLevelOffset = (editor: Editor, index: number) => {
  let off = 0;
  editor.state.doc.forEach((_n, o, i) => { if (i === index) off = o; });
  return off;
};

/** "Large paste": replace paragraphs [a, b) with many new paragraphs, selection = the replaced range. */
function largePaste(editor: Editor, a: number, b: number) {
  const from = topLevelOffset(editor, a);
  const to = topLevelOffset(editor, b);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from + 1, to - 1)));
  const big = Fragment.fromArray(Array.from({ length: 60 }, (_, i) => editor.schema.nodeFromJSON(para("pasted " + i))));
  editor.view.dispatch(editor.state.tr.replaceWith(from, to, big).scrollIntoView());
  return from;
}

describe("undo/redo after a large paste", () => {
  it("undo scrolls to where the paste STARTED, not to the end of the restored selection", () => {
    const { editor, scroller } = mount();
    const from = largePaste(editor, 30, 33);
    scroller.scrollTop = 0;
    editor.commands.undo();
    // the change start is off-screen (below the fold), so it is brought to 30% down the container
    expect(scroller.scrollTop).toBeCloseTo(from * PX_PER_POS - BOX_H * 0.3, 0);
  });

  it("redo scrolls to the start of the pasted text, not to its end", () => {
    const { editor, scroller } = mount();
    const from = largePaste(editor, 30, 33);
    editor.commands.undo();
    scroller.scrollTop = 0;
    editor.commands.redo();
    expect(scroller.scrollTop).toBeCloseTo(from * PX_PER_POS - BOX_H * 0.3, 0);
    const end = editor.state.selection.head;
    expect(end).toBeGreaterThan(from + 200); // (the history's own selection is far below)
  });

  it("brings a stranded caret to the start of the change", async () => {
    const { editor, scroller } = mount();
    // select-all + paste: undo restores a selection whose end is far below the screen
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    const big = Fragment.fromArray(Array.from({ length: 60 }, (_, i) => editor.schema.nodeFromJSON(para("pasted " + i))));
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, big).scrollIntoView());
    scroller.scrollTop = 900;
    editor.commands.undo();
    await Promise.resolve();                       // the caret move is queued after the view update
    const sel = editor.state.selection;
    expect(sel.empty).toBe(true);                  // no longer a huge selection ending off-screen
    expect(sel.from).toBeLessThan(10);             // at the top of the note, where the view is
  });

  it("leaves the caret alone when it is still on screen", async () => {
    const { editor, scroller } = mount();
    const from = largePaste(editor, 30, 33);       // restored selection is just 3 lines, all visible after the scroll
    scroller.scrollTop = 0;
    editor.commands.undo();
    await Promise.resolve();
    const sel = editor.state.selection;
    expect(sel.empty).toBe(false);
    expect(sel.from).toBeGreaterThanOrEqual(from);
  });

  it("does not scroll when the start of the change is already visible", () => {
    const { editor, scroller } = mount();
    largePaste(editor, 12, 14);          // start ≈ pos 120 -> 360px: on screen
    scroller.scrollTop = 0;
    editor.commands.undo();
    expect(scroller.scrollTop).toBe(0);
  });

  it("select-all + paste, then undo, lands at the top of the note rather than the bottom", () => {
    const { editor, scroller } = mount();
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
    const big = Fragment.fromArray(Array.from({ length: 60 }, (_, i) => editor.schema.nodeFromJSON(para("pasted " + i))));
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, big).scrollIntoView());
    scroller.scrollTop = 900;            // user was looking at the bottom of the pasted text
    editor.commands.undo();
    expect(scroller.scrollTop).toBeLessThanOrEqual(10);   // brought back to the top of the note
  });
});

describe("everything else keeps ProseMirror's default scrolling", () => {
  it("does not interfere with normal typing", () => {
    const { editor, scroller } = mount();
    scroller.scrollTop = 777;
    editor.commands.setTextSelection(40);
    editor.commands.insertContent("hello");
    expect(scroller.scrollTop).toBe(777);
  });
});
