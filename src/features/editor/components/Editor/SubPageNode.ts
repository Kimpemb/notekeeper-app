import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { SubPageNodeView } from "./SubPageNodeView";

export interface SubPageNodeAttrs {
  noteId: string | null;
  title: string;
  mode: "editing" | "display";
}

export const SubPageNode = Node.create<object, {
  parentNoteId: string;
  paneId: 1 | 2;
  setCreating: (v: boolean) => void;
}>({
  name: "subPage",
  group: "block",
  atom: true,

  addStorage() {
    return {
      parentNoteId: "",
      paneId: 1 as 1 | 2,
      setCreating: (_v: boolean) => {},
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

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("subPageDeleteGuard"),
        props: {
          handleKeyDown(_view, event) {
            if (event.key !== "Backspace" && event.key !== "Delete") return false;
            const { selection } = _view.state;
            const selectedNode = (selection as { node?: { type: { name: string } } }).node;
            if (selectedNode?.type.name === "subPage") {
              // Swallow — subpages can only be deleted via the context menu
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});