// src/features/editor/hooks/useBlockDetection.ts
//
// All block geometry and cursor-to-block resolution logic.
//
// No side effects, no DOM mutations, no refs written here.
// Every function takes what it needs and returns a value — pure geometry.
//
// getBlocks() is the one exception: it reads and writes dragState.cachedBlocks
// as a performance cache so getBoundingClientRect isn't called on every
// mousemove frame during a drag.

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PmNode } from "@tiptap/pm/model";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BlockRect = {
  rect:  DOMRect;
  pos:   number;
  size:  number;
  dom:   HTMLElement;
};

export type ResolvedBlock = {
  dragDom:       HTMLElement;
  nodePos:       number;
  isListItem:    boolean;
  listParentPos: number;
};

export type DragStateRef = React.RefObject<{
  isListItem:    boolean;
  escapedList:   boolean;
  listParentPos: number;
  cachedBlocks:  BlockRect[] | null;
} | null>;

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseBlockDetectionOptions {
  editorRef:    React.RefObject<Editor | null>;
  dragStateRef: DragStateRef;
}

interface UseBlockDetectionResult {
  resolveBlockFromPoint:  (clientX: number, clientY: number) => ResolvedBlock | null;
  getTopLevelBlockRects:  () => BlockRect[];
  getListItemRects:       (listParentPos: number) => BlockRect[];
  getListBounds:          (listParentPos: number) => { top: number; bottom: number } | null;
  getBlocks:              () => BlockRect[];
}

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
const LIST_TYPES      = new Set(["bulletList", "orderedList", "taskList"]);

export function useBlockDetection({
  editorRef,
  dragStateRef,
}: UseBlockDetectionOptions): UseBlockDetectionResult {

  // ── getTopLevelDom ────────────────────────────────────────────────────────
  // Walks up from any element inside the editor until it finds the direct
  // child of the editor root — that's the top-level block DOM node.

  const getTopLevelDom = useCallback((node: HTMLElement): HTMLElement | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    const root = ed.view.dom;
    let current: HTMLElement | null = node;
    while (current && current.parentElement !== root) current = current.parentElement;
    return current && current.parentElement === root ? current : null;
  }, [editorRef]);

  // ── getTopLevelBlockRects ─────────────────────────────────────────────────
  // Returns rects for every top-level node in the document.
  // Zero-height nodes (e.g. hidden) are excluded.

  const getTopLevelBlockRects = useCallback((): BlockRect[] => {
    const ed = editorRef.current;
    if (!ed) return [];
    const { doc } = ed.view.state;
    const results: BlockRect[] = [];
    doc.forEach((node: PmNode, pos: number) => {
      const dom = ed.view.nodeDOM(pos) as HTMLElement | null;
      if (!dom) return;
      const rect = dom.getBoundingClientRect();
      if (rect.height === 0) return;
      results.push({ rect, pos, size: node.nodeSize, dom });
    });
    return results;
  }, [editorRef]);

  // ── getListItemRects ──────────────────────────────────────────────────────
  // Returns rects for every child of a given list node.

  const getListItemRects = useCallback((listParentPos: number): BlockRect[] => {
    const ed = editorRef.current;
    if (!ed) return [];
    const { doc } = ed.view.state;
    const listNode = doc.nodeAt(listParentPos);
    if (!listNode) return [];
    const results: BlockRect[] = [];
    listNode.forEach((child: PmNode, childOffset: number) => {
      const childPos = listParentPos + 1 + childOffset;
      const dom = ed.view.nodeDOM(childPos) as HTMLElement | null;
      if (!dom) return;
      const rect = dom.getBoundingClientRect();
      if (rect.height === 0) return;
      results.push({ rect, pos: childPos, size: child.nodeSize, dom });
    });
    return results;
  }, [editorRef]);

  // ── getListBounds ─────────────────────────────────────────────────────────
  // Returns the top/bottom viewport bounds of a list node as a whole.
  // Used during drag to detect when a list item has escaped its parent list.

  const getListBounds = useCallback((listParentPos: number): { top: number; bottom: number } | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    const listDom = ed.view.nodeDOM(listParentPos) as HTMLElement | null;
    if (!listDom) return null;
    const rect = listDom.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }, [editorRef]);

  // ── getBlocks ─────────────────────────────────────────────────────────────
  // Returns the correct block set for the current drag context.
  // Caches the result in dragState.cachedBlocks and reuses it across frames —
  // cache is invalidated by the scroll listener and on drag start.

  const getBlocks = useCallback((): BlockRect[] => {
    const ds = dragStateRef.current;
    if (!ds) return [];
    if (ds.cachedBlocks) return ds.cachedBlocks;
    const blocks = (ds.isListItem && !ds.escapedList)
      ? getListItemRects(ds.listParentPos)
      : getTopLevelBlockRects();
    ds.cachedBlocks = blocks;
    return blocks;
  }, [dragStateRef, getListItemRects, getTopLevelBlockRects]);

  // ── resolveBlockFromPoint ─────────────────────────────────────────────────
  // Given a cursor position, finds the ProseMirror block underneath.
  //
  // Uses fixed xProbes inside the editor column rather than clientX so that
  // hovering in the gutter (left of the editor) still resolves a block.
  //
  // Probe strategy:
  //   1. Try multiple x positions across the editor width
  //   2. Try clientY and clientY+4 to handle gaps between blocks
  //   3. Walk up the hit element to find the nearest list item or top-level node

  const resolveBlockFromPoint = useCallback((
    _clientX: number,
    clientY: number,
  ): ResolvedBlock | null => {
    const ed = editorRef.current;
    if (!ed) return null;

    const editorDom  = ed.view.dom;
    const editorRect = editorDom.getBoundingClientRect();

    const xProbes = [
      editorRect.left + 60,
      editorRect.left + editorRect.width * 0.3,
      editorRect.left + editorRect.width * 0.5,
    ];
    const yProbes = [clientY, clientY + 4];

    let targetEl: HTMLElement | null = null;

    outer: for (const sampleY of yProbes) {
      for (const sampleX of xProbes) {
        const elements = document.elementsFromPoint(sampleX, sampleY);
        for (const el of elements) {
          if (editorDom.contains(el) && el !== editorDom) {
            targetEl = el as HTMLElement;
            break outer;
          }
        }
      }
    }

    if (!targetEl) return null;

    let pos: number;
    try { pos = ed.view.posAtDOM(targetEl, 0); }
    catch { return null; }

    const { doc } = ed.view.state;
    const $pos = doc.resolve(Math.max(0, pos));

    // Walk up depth levels to find a list item first
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (LIST_ITEM_TYPES.has(node.type.name)) {
        const itemPos = $pos.before(depth);
        const itemDom = ed.view.nodeDOM(itemPos) as HTMLElement | null;
        if (!itemDom) return null;
        for (let pd = depth - 1; pd >= 0; pd--) {
          const parent = $pos.node(pd);
          if (LIST_TYPES.has(parent.type.name)) {
            const listPos = pd === 0 ? 0 : $pos.before(pd);
            return {
              dragDom:       itemDom,
              nodePos:       itemPos,
              isListItem:    true,
              listParentPos: listPos,
            };
          }
        }
      }
    }

    // Fall back to top-level block
    const topDom = getTopLevelDom(targetEl);
    if (!topDom) return null;

    let topPos: number;
    try { topPos = ed.view.posAtDOM(topDom, 0); }
    catch { return null; }

    const $topPos = doc.resolve(Math.max(0, topPos));
    const nodePos = $topPos.depth > 0 ? $topPos.before(1) : topPos;

    return {
      dragDom:       topDom,
      nodePos,
      isListItem:    false,
      listParentPos: -1,
    };
  }, [editorRef, getTopLevelDom]);

  return {
    resolveBlockFromPoint,
    getTopLevelBlockRects,
    getListItemRects,
    getListBounds,
    getBlocks,
  };
}