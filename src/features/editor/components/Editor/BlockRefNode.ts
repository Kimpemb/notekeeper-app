// src/features/editor/components/Editor/BlockRefNode.ts
//
// A block-level TipTap node that embeds a live, read-only snapshot of another
// note's block (paragraph, heading, list item, etc.).
//
// Lifecycle:
//   1. User types "((" → BlockRefSuggest picker opens, searches block content.
//   2. User selects a block → node inserted with { sourceNoteId, blockId }.
//   3. NodeView fetches live content from SQLite on mount and on block-update events.
//   4. Click → source note opens in a new tab, scrolled to the block.
//   5. Hover → NoteLinkPreview-style popover (handled in NodeView).

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BlockRefNodeView } from "./BlockRefNodeView";

export interface BlockRefAttrs {
  /** UUID of the note that owns the referenced block */
  sourceNoteId: string;
  /** UUID assigned to the block node in that note's TipTap doc */
  blockId: string;
  /** Plaintext snapshot — used as a loading fallback and for offline display */
  snapshot: string;
}

export const BlockRefNode = Node.create({
  name: "blockRef",
  group: "block",
  atom: true,   // treat as a single unit — cursor skips over it

  addAttributes() {
    return {
      sourceNoteId: { default: "" },
      blockId:      { default: "" },
      snapshot:     { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-ref"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "block-ref" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockRefNodeView);
  },
});