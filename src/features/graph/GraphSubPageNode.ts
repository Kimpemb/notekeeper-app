// src/features/graph/GraphSubPageNode.ts
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { GraphSubPageNodeView } from "./GraphSubPageNodeView";

/**
 * Drop-in replacement for SubPageNode inside the graph editor.
 * Uses the same schema (name, attrs) so existing note content is
 * parsed identically — only the nodeView is different.
 *
 * Key fix: switched from a plain DOM nodeView to ReactNodeViewRenderer.
 * The plain DOM approach created the DOM element once on insert and never
 * re-rendered when attrs changed (e.g. noteId going from null → real UUID
 * after the user typed a title and pressed Enter). ReactNodeViewRenderer
 * gives us a proper React component that re-renders on every attr change,
 * so the click handler is always attached with the current noteId.
 *
 * The callbacks (onOpenInEditor, onNavigateToNode) are stored in editor
 * storage so GraphSubPageNodeView can read them without needing them passed
 * as props (which ReactNodeViewRenderer doesn't support directly).
 */
export function createGraphSubPageNode(
  onOpenInEditor:   (noteId: string) => void,
  onNavigateToNode: (noteId: string) => void,
) {
  return Node.create({
    name:  "subPage",   // must match exactly — same ProseMirror node type
    group: "block",
    atom:  true,

    // Store callbacks in editor storage so the NodeView component can reach them.
    // This is the standard pattern for passing non-serialisable values into a
    // ReactNodeViewRenderer without prop-drilling through TipTap internals.
    addStorage() {
      return {
        onOpenInEditor,
        onNavigateToNode,
        // These two are also written by GraphNodeEditor before subPage inserts:
        parentNoteId: "",
        paneId: 1 as 1 | 2,
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
  });
}