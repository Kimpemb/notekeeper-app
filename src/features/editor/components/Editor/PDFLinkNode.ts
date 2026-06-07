import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { PDFLinkNodeView } from "./PDFLinkNodeView";

export const PDFLinkNode = Node.create({
  name: "pdfLink",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      noteId: { default: null },
      title:  { default: "Document" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pdf-link"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "pdf-link" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PDFLinkNodeView);
  },
});