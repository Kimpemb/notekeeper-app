// src/features/editor/components/Editor/DataviewNode.ts

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DataviewNodeView } from "./DataviewNodeView";

export const DataviewNode = Node.create({
  name: "dataview",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      query: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="dataview"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "dataview" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataviewNodeView);
  },
});