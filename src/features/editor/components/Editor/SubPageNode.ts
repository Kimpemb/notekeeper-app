// src/features/editor/components/Editor/SubPageNode.ts
//
// A block-level TipTap node that represents an inline sub-page link.
// Lifecycle:
//   1. Inserted by the slash command in "editing" mode with a placeholder title.
//   2. User types a title (or keeps the default) and hits Enter/blur → note created in DB.
//   3. Node switches to "display" mode: page icon + title, clicking navigates into the note.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SubPageNodeView } from "./SubPageNodeView";

export interface SubPageNodeAttrs {
  /** DB note id — null while the note hasn't been created yet (editing mode) */
  noteId: string | null;
  title: string;
  /** "editing" = title input active; "display" = clickable row */
  mode: "editing" | "display";
}

export const SubPageNode = Node.create<object, { parentNoteId: string; paneId: 1 | 2 }>({
  name: "subPage",
  group: "block",
  atom: true,

  addStorage() {
    return {
      parentNoteId: "",
      paneId: 1 as 1 | 2,
    };
  },

  addAttributes() {
    return {
      noteId: { default: null },
      title:  { default: "Untitled" },
      mode:   { default: "editing" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sub-page"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "sub-page" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubPageNodeView);
  },
});