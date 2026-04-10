// src/features/graph/GraphSubPageNode.ts
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { GraphSubPageNodeView } from "./GraphSubPageNodeView";

export function createGraphSubPageNode(
  onOpenInEditor:   (noteId: string) => void,
  onNavigateToNode: (noteId: string) => void,
) {
  return Node.create({
    name:  "subPage",
    group: "block",
    atom:  true,

    addStorage() {
      return {
        parentNoteId:    "",
        paneId:          1 as 1 | 2,
        setCreating:     (_v: boolean) => {},
        onOpenInEditor,
        onNavigateToNode,
      };
    },

    addAttributes() {
      return {
        noteId: { default: null },
        title:  { default: "Untitled" },
        mode:   { default: "display" },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="sub-page"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": "sub-page" })];
    },

    addNodeView() {
      return ReactNodeViewRenderer(GraphSubPageNodeView);
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
              if (selectedNode?.type.name === "subPage") return true;
              return false;
            },
          },
        }),
      ];
    },
  });
}