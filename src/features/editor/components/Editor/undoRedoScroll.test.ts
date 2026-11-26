// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { UndoRedoScrollExtension, HISTORY_RUN_META } from "./undoRedoScroll";

const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
let editors: Editor[] = [];
afterEach(() => { editors.forEach((e) => e.destroy()); editors = []; document.body.innerHTML = ""; });

function mount(withExt = true) {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  const el = document.createElement("div");
  scroller.appendChild(el);
  document.body.appendChild(scroller);
  const editor = new Editor({
    element: el,
    extensions: withExt ? [StarterKit, UndoRedoScrollExtension] : [StarterKit],
    content: { type: "doc", content: Array.from({ length: 30 }, (_, i) => para("line " + i)) },
  });
  editors.push(editor);
  return { editor, scroller };
}
const key = (editor: Editor, k: string, extra: KeyboardEventInit = {}) =>
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));

describe("UndoRedoScrollExtension", () => {
  it("Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z undo and redo through this extension", () => {
    const { editor } = mount();
    const runs: number[] = [];
    editor.on("transaction", ({ transaction }) => { if (transaction.getMeta(HISTORY_RUN_META)) runs.push(1); });
    editor.commands.setTextSelection(40);
    editor.commands.insertContent("hello");
    const typed = editor.state.doc.textContent;

    key(editor, "z");
    expect(editor.state.doc.textContent).not.toBe(typed);
    expect(editor.state.selection.from).toBeLessThan(50);       // back where it was, not the end
    key(editor, "y");
    expect(editor.state.doc.textContent).toBe(typed);
    key(editor, "z");
    key(editor, "Z", { shiftKey: true, keyCode: 90 });  // browsers send keyCode; the keymap uses it for shifted letters
    expect(editor.state.doc.textContent).toBe(typed);
    expect(runs.length).toBe(4);
  });

  it("leaves the scroll position alone when the caret is still visible", () => {
    const { editor, scroller } = mount();
    editor.commands.setTextSelection(40);
    editor.commands.insertContent("hello");
    scroller.scrollTop = 120;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 600, height: 600 } as DOMRect);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 300, bottom: 320 } as any);
    key(editor, "z");
    expect(scroller.scrollTop).toBe(120);
  });

  it("centres the caret when undo lands it off-screen", () => {
    const { editor, scroller } = mount();
    editor.commands.setTextSelection(40);
    editor.commands.insertContent("hello");
    scroller.scrollTop = 120;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 600, height: 600 } as DOMRect);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 900, bottom: 920 } as any); // below the fold
    key(editor, "z");
    expect(scroller.scrollTop).toBe(120 + (910 - 300));        // caret middle -> container middle
  });

  it("with nothing to undo it does nothing and still swallows the key", () => {
    const { editor } = mount();
    const before = editor.state.doc.textContent;
    const ev = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(ev);
    expect(editor.state.doc.textContent).toBe(before);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("programmatic content swaps and undo history", () => {
  it("a setContent flagged addToHistory:false cannot be undone", () => {
    const { editor } = mount();
    editor.chain().setMeta("addToHistory", false).setContent({ type: "doc", content: [para("loaded")] }).run();
    editor.commands.setTextSelection(3);
    editor.commands.insertContent("X");
    key(editor, "z");
    key(editor, "z");
    key(editor, "z");
    expect(editor.state.doc.textContent).toBe("loaded");      // never reverted to the old document
  });

  it("a plain setContent IS undoable (the behaviour we are avoiding)", () => {
    const { editor } = mount();
    const original = editor.state.doc.textContent;
    editor.commands.setContent({ type: "doc", content: [para("loaded")] });
    key(editor, "z");
    expect(editor.state.doc.textContent).toBe(original);
  });
});
