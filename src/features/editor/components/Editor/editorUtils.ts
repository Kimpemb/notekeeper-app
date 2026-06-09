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

export function clearSearchHighlight(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(searchHighlightKey, DecorationSet.empty)
  );
}

// ── Map a char offset from editor.getText() to a ProseMirror doc position ────
// Uses countdown (remaining) — only subtracts from text nodes, exactly
// mirroring how textBetween() traverses. Non-text inline nodes (noteLink,
// image, attachment) are skipped for char counting, matching getText() exactly.


// ── Scroll to query string and temporarily highlight it ───────────────────────
export function countMatches(editor: Editor, query: string): number {
  if (!query.trim()) return 0;
  const needle  = query.trim().toLowerCase();
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex   = new RegExp(escaped, "gi");
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (!node.isText || !node.text) return true;
    const matches = node.text.match(regex);
    if (matches) count += matches.length;
  });
  return count;
}

// ── Count matches in raw note content JSON (no live editor needed) ────────────
// Memoized by a simple module-level cache keyed on noteId + query
const _matchCache = new Map<string, number>();

export function countMatchesInContent(noteId: string, content: string | null | undefined, query: string): number {
  if (!query.trim() || !content) return 0;
  const cacheKey = `${noteId}::${query}`;
  if (_matchCache.has(cacheKey)) return _matchCache.get(cacheKey)!;

  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex   = new RegExp(escaped, "gi");
  let count = 0;

  try {
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (typeof n.text === "string") {
        const matches = n.text.match(regex);
        if (matches) count += matches.length;
      }
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(JSON.parse(content));
  } catch { /* malformed JSON */ }

  _matchCache.set(cacheKey, count);
  // Evict cache if it grows large
  if (_matchCache.size > 500) {
    const firstKey = _matchCache.keys().next().value;
    if (firstKey !== undefined) _matchCache.delete(firstKey);
  }
  return count;
}

export function scrollToQuery(
  editor: Editor,
  query: string,
  scrollContainer: HTMLElement | null,
  matchIndex: number = 0,
): void {
  if (!query.trim()) return;

  const needle  = query.trim().toLowerCase();
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex   = new RegExp(escaped, "i");

  // Collect all matches across text nodes
  const allMatches: { from: number; to: number }[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    let match: RegExpExecArray | null;
    const localRegex = new RegExp(escaped, "gi");
    while ((match = localRegex.exec(node.text)) !== null) {
      allMatches.push({ from: pos + match.index, to: pos + match.index + match[0].length });
    }
  });

  if (allMatches.length === 0) return;

  // Clamp index and pick target match
  const target = allMatches[Math.min(matchIndex, allMatches.length - 1)];
  const { from, to } = target;

  // Place caret at match start
  editor.commands.setTextSelection(from);

  // Scroll into view
  const domAtPos = editor.view.domAtPos(from);
  const node = domAtPos.node instanceof HTMLElement
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
}