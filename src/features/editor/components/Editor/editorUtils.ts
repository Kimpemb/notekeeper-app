// src/features/editor/components/Editor/editorUtils.ts
import type { Editor } from "@tiptap/react";

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
  const elRect = el.getBoundingClientRect();
  scrollContainer.scrollTo({
    top: scrollContainer.scrollTop + (elRect.top - containerRect.top) - 80,
    behavior: "smooth",
  });
  return true;
}