// src/features/editor/components/Editor/editorUtils.ts
import type { Editor } from "@tiptap/react";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey } from "prosemirror-state";

// ── Extract all [[note link]] IDs from the doc ────────────────────────────────
export function extractNoteLinkIds(editor: Editor | null): string[] {
  if (!editor) return [];
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "noteLink" && node.attrs.id) {
      ids.push(node.attrs.id as string);
    }
  });
  return [...new Set(ids)];
}

// ── Walk up the DOM to find the nearest scrollable ancestor ──────────────────
export function getScrollContainer(editor: Editor | null): HTMLElement | null {
  if (!editor) return null;
  let el: HTMLElement | null = editor.view.dom as HTMLElement;
  while (el) {
    const overflow = window.getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// ── Scroll to a heading by its text content ───────────────────────────────────
export function scrollToHeadingText(editor: Editor | null, headingText: string): boolean {
  if (!editor) return false;
  let targetPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (targetPos !== null) return false;
    if (node.type.name === "heading" && node.textContent.trim() === headingText.trim()) {
      targetPos = pos;
    }
  });
  if (targetPos === null) return false;

  editor.commands.setTextSelection(targetPos + 1);
  const domNode = editor.view.nodeDOM(targetPos);
  const el = domNode instanceof HTMLElement ? domNode : (domNode as Node)?.parentElement;
  if (!el) return false;

  const scrollContainer = getScrollContainer(editor);
  if (!scrollContainer) return false;

  const containerRect = scrollContainer.getBoundingClientRect();
  const elRect        = el.getBoundingClientRect();
  scrollContainer.scrollTo({
    top: scrollContainer.scrollTop + (elRect.top - containerRect.top) - 80,
    behavior: "smooth",
  });
  return true;
}

// ── Search highlight decoration ───────────────────────────────────────────────

export const searchHighlightKey = new PluginKey("searchHighlight");

export function buildSearchHighlightPlugin(): Plugin {
  return new Plugin({
    key: searchHighlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(searchHighlightKey);
        if (next !== undefined) return next as DecorationSet;
        return set.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return searchHighlightKey.getState(state) as DecorationSet;
      },
    },
  });
}

// ── Map a char offset from editor.getText() to a ProseMirror doc position ────
// Uses countdown (remaining) — only subtracts from text nodes, exactly
// mirroring how textBetween() traverses. Non-text inline nodes (noteLink,
// image, attachment) are skipped for char counting, matching getText() exactly.
function charOffsetToDocPos(editor: Editor, charOffset: number): number | null {
  if (charOffset < 0) return null;

  let remaining = charOffset;
  let foundPos: number | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (foundPos !== null) return false; // already found, stop
    if (!node.isText) return true;       // descend into containers, skip non-text leaves
    const textLen = node.text!.length;
    if (remaining < textLen) {
      foundPos = pos + remaining;        // match starts inside this text node
      return false;
    }
    remaining -= textLen;
    return false;                        // text nodes have no children
  });

  return foundPos;
}

// ── Scroll to query string and temporarily highlight it ───────────────────────
export function scrollToQuery(
  editor: Editor,
  query: string,
  scrollContainer: HTMLElement | null
): void {
  if (!query.trim()) return;

  const liveText   = editor.getText();
  const needle     = query.trim().toLowerCase();
  const charOffset = liveText.toLowerCase().indexOf(needle);
  if (charOffset < 0) return;

  const from = charOffsetToDocPos(editor, charOffset);
  if (from === null) return;

  const to = Math.min(from + needle.length, editor.state.doc.content.size);

  // Place caret at match start
  editor.commands.setTextSelection(from);

  // Scroll into view
  const domAtPos = editor.view.domAtPos(from);
  const node     = domAtPos.node instanceof HTMLElement
    ? domAtPos.node
    : domAtPos.node.parentElement;

  if (node && scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const nodeRect      = node.getBoundingClientRect();
    scrollContainer.scrollTo({
      top: scrollContainer.scrollTop + (nodeRect.top - containerRect.top) - 120,
      behavior: "smooth",
    });
  }

  // Apply highlight decoration
  const decoration    = Decoration.inline(from, to, { class: "search-match-highlight" });
  const decorationSet = DecorationSet.create(editor.state.doc, [decoration]);
  editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, decorationSet));

  // Remove highlight after 2 s
  setTimeout(() => {
    if (!editor.isDestroyed) {
      editor.view.dispatch(
        editor.state.tr.setMeta(searchHighlightKey, DecorationSet.empty)
      );
    }
  }, 2000);
}