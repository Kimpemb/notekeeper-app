// src/features/editor/components/Editor/toggleSchema.ts
//
// Toggle schema — simplified structure.
//
// Old: toggle > toggleSummary (inline*) + toggleBody? (block+)
// New: toggle > inline* + toggleBody?
//
// The toggleSummary wrapper node has been removed. Toggle now holds its title
// content (inline*) directly, followed by an optional toggleBody. This makes
// position math straightforward:
//
//   togglePos + 0  = toggle open token        (not a content position)
//   togglePos + 1  = first editable position inside toggle title  ← cursor
//   togglePos + N  = toggleBody open token (when body exists)
//
// toggleBody (content: block+) allows any block node including nested toggles,
// so arbitrary nesting depth works without any schema changes.
//
// Body show/hide is pure CSS driven by .toggle-open / .toggle-closed on the
// parent NodeViewWrapper. The body is always present in the ProseMirror DOM
// (never display:none) to prevent content corruption.

import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ToggleNodeView, ToggleBodyNodeView } from "./ToggleNodeView";

export const ToggleBody = Node.create({
  name: "toggleBody",
  content: "block+",
  defining: true,
  isolating: false,

  // No open attr — visibility is CSS-driven from parent .toggle-closed class
  parseHTML() { return [{ tag: "div[data-toggle-body]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-toggle-body": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleBodyNodeView);
  },
});

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  // inline* = the title text, toggleBody? = the collapsible body
  content: "inline* toggleBody?",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-open") === "true",
        renderHTML: (attrs) => ({ "data-open": attrs.open ? "true" : "false" }),
      },
    };
  },

  parseHTML() { return [{ tag: "div[data-toggle]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-toggle": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView);
  },
});