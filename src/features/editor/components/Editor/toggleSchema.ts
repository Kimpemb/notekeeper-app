// src/features/editor/components/Editor/toggleSchema.ts
//
// Single source of truth for the toggle node trio, shared by both the live
// editor (extensions.ts) and the AI write-tool parsing schema (parseMarkdown.ts).
//
// Structure: toggle > toggleSummary (inline*) + toggleBody? (block+)
// This is the ORIGINAL three-node structure. A newer two-node structure
// ("toggle > inline* + toggleBody?") was attempted here previously but is
// invalid — ProseMirror rejects mixing inline and block content in a single
// node's content expression — and the live editor never adopted it anyway.
// This file now matches what extensions.ts has always actually run.
//
// Deliberately has NO import from parseMarkdown.ts or extensions.ts, so it
// can be safely imported by both without creating a circular dependency.

import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  ToggleNodeView,
  ToggleSummaryNodeView,
  ToggleBodyNodeView,
} from "./ToggleNodeView";

export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  isolating: false,
  parseHTML() { return [{ tag: "div[data-toggle-summary]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-toggle-summary": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleSummaryNodeView);
  },
});

export const ToggleBody = Node.create({
  name: "toggleBody",
  content: "block+",
  defining: true,
  isolating: false,
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
  content: "toggleSummary toggleBody?",
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