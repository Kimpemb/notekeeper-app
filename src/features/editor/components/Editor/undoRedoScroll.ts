// src/features/editor/components/Editor/undoRedoScroll.ts
//
// Where the view goes after undo / redo.
//
// ProseMirror scrolls to the restored SELECTION. After a large paste that is the wrong place:
//   - undo of "select all, paste" restores a selection that runs to the very end of the note;
//   - redo leaves the caret after the pasted text.
// Either way the screen is flung to the bottom. Here, after any history transaction, the view
// reveals where the change STARTS instead, and only moves if that spot is off-screen. If the caret
// is left stranded off-screen it is brought to that same spot, so what you see is where you type.
//
// This hooks the view's scroll step (handleScrollToSelection), so it applies however undo/redo was
// triggered (keyboard, menu, command) and does not depend on key bindings.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const KEY = new PluginKey<ChangeInfo>("undoRedoScroll");

const HISTORY_META = "history$";   // meta key prosemirror-history puts on its transactions
const EDGE_MARGIN = 24;            // px that must stay clear of the container's top/bottom edge
const REVEAL_AT = 0.3;             // an off-screen change start is brought to 30% down the container

interface ChangeInfo {
  /** The last transaction was an undo/redo, and `from` is where its change starts. */
  history: boolean;
  from: number;
}

const NONE: ChangeInfo = { history: false, from: 0 };

function findScroller(el: HTMLElement): HTMLElement | null {
  for (let cur: HTMLElement | null = el.parentElement; cur; cur = cur.parentElement) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
  }
  return null;
}

function inView(rect: { top: number; bottom: number }, box: DOMRect): boolean {
  return rect.top >= box.top + EDGE_MARGIN && rect.bottom <= box.bottom - EDGE_MARGIN;
}

function handleScroll(view: EditorView): boolean {
  const info = KEY.getState(view.state);
  if (!info?.history) return false; // not an undo/redo: leave ProseMirror's default scroll alone

  const scroller = findScroller(view.dom as HTMLElement);
  if (!scroller) return false;

  const size = view.state.doc.content.size;
  const from = Math.max(0, Math.min(info.from, size));

  try {
    const box = scroller.getBoundingClientRect();
    const start = view.coordsAtPos(from);
    if (!inView(start, box)) {
      scroller.scrollTop += start.top - (box.top + box.height * REVEAL_AT);
    }

    // Is the caret now stranded off-screen (e.g. at the far end of a big paste)? If so, move it to
    // the start of the change. Done after this update finishes: a view can't be dispatched into
    // while it is still updating.
    const head = view.coordsAtPos(view.state.selection.head);
    if (!inView(head, box)) {
      queueMicrotask(() => {
        if (view.isDestroyed) return;
        const doc = view.state.doc;
        const pos = Math.max(0, Math.min(from, doc.content.size));
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.near(doc.resolve(pos)))
            .setMeta("addToHistory", false)
        );
      });
    }
  } catch {
    return false; // positions not renderable: fall back to ProseMirror's own scroll
  }
  return true;
}

export const UndoRedoScrollExtension = Extension.create({
  name: "undoRedoScroll",

  addProseMirrorPlugins() {
    return [
      new Plugin<ChangeInfo>({
        key: KEY,
        state: {
          init: () => NONE,
          apply(tr): ChangeInfo {
            if (!tr.getMeta(HISTORY_META)) return NONE;

            // Earliest position touched, in the final document's coordinates.
            let from = Infinity;
            tr.mapping.maps.forEach((map, i) => {
              const rest = tr.mapping.slice(i + 1);
              map.forEach((_oldStart, _oldEnd, newStart) => {
                from = Math.min(from, rest.map(newStart, -1));
              });
            });
            if (from === Infinity) from = tr.selection.from;
            return { history: true, from };
          },
        },
        props: { handleScrollToSelection: handleScroll },
      }),
    ];
  },
});
