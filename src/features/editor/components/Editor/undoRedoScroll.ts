// src/features/editor/components/Editor/undoRedoScroll.ts
//
// Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z with predictable scrolling.
//
// ProseMirror's undo/redo always asks the view to scroll the restored selection into view, and its
// "minimum movement" rule leaves the caret hard against the bottom (or top) edge of the screen.
// Here the history runs as usual, then the scroll position is put back; only when the restored
// caret is outside the visible area is it scrolled, and then to the middle of the screen.

import { Extension, type Editor } from "@tiptap/core";
import { undo, redo } from "@tiptap/pm/history";

/** Transaction meta set on the transactions this extension dispatches (handy for tests). */
export const HISTORY_RUN_META = "idemoraHistoryRun";

const EDGE_MARGIN = 24; // px a caret must stay clear of the container's top/bottom to count as visible

function findScroller(el: HTMLElement): HTMLElement | null {
  for (let cur: HTMLElement | null = el.parentElement; cur; cur = cur.parentElement) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
  }
  return null;
}

function runHistory(editor: Editor, command: typeof undo): boolean {
  const { view } = editor;
  const scroller = findScroller(view.dom as HTMLElement);
  const savedTop = scroller?.scrollTop ?? 0;

  command(view.state, (tr) => view.dispatch(tr.setMeta(HISTORY_RUN_META, true)));

  if (scroller) {
    // ProseMirror has already scrolled (synchronously, inside dispatch). Undo that...
    scroller.scrollTop = savedTop;
    // ...then scroll only if the caret is no longer visible.
    try {
      const caret = view.coordsAtPos(view.state.selection.head);
      const box = scroller.getBoundingClientRect();
      const visible = caret.top >= box.top + EDGE_MARGIN && caret.bottom <= box.bottom - EDGE_MARGIN;
      if (!visible) {
        const caretMid = (caret.top + caret.bottom) / 2;
        scroller.scrollTop += caretMid - (box.top + box.height / 2);
      }
    } catch {
      /* selection position not renderable (yet): leave the scroll position alone */
    }
  }

  // Always swallow the key: with nothing left to undo, the browser's own contenteditable undo
  // must not run and fight ProseMirror's document.
  return true;
}

export const UndoRedoScrollExtension = Extension.create({
  name: "undoRedoScroll",
  priority: 1000, // ahead of the stock history shortcuts

  addKeyboardShortcuts() {
    return {
      "Mod-z":       ({ editor }) => runHistory(editor, undo),
      "Mod-y":       ({ editor }) => runHistory(editor, redo),
      "Shift-Mod-z": ({ editor }) => runHistory(editor, redo),
    };
  },
});
