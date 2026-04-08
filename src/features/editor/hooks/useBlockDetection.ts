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

// ── Constants ─────────────────────────────────────────────────────────────────

const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
const LIST_TYPES      = new Set(["bulletList", "orderedList", "taskList"]);
const INLINE_NODE_TYPES = new Set(["text", "hardBreak", "mention", "emoji"]);

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

export function useBlockDetection({
  editorRef,
  dragStateRef,
}: UseBlockDetectionOptions): UseBlockDetectionResult {

  // ── getTopLevelDom ────────────────────────────────────────────────────────

  const getTopLevelDom = useCallback((node: HTMLElement): HTMLElement | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    const root = ed.view.dom;
    let current: HTMLElement | null = node;
    while (current && current.parentElement !== root) current = current.parentElement;
    return current && current.parentElement === root ? current : null;
  }, [editorRef]);

  // ── getTopLevelBlockRects ─────────────────────────────────────────────────

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

  const getListBounds = useCallback((listParentPos: number): { top: number; bottom: number } | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    const listDom = ed.view.nodeDOM(listParentPos) as HTMLElement | null;
    if (!listDom) return null;
    const rect = listDom.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }, [editorRef]);

  // ── getBlocks ─────────────────────────────────────────────────────────────

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

  // ── resolveTopLevelByGeometry ─────────────────────────────────────────────
  // Fallback for block atoms (dataview, subpage, embed) whose React-rendered
  // interiors cause posAtDOM to fail or resolve to depth 0. Instead of asking
  // ProseMirror where we are, we walk every top-level doc node, measure its
  // DOM bounding rect, and return the one whose rect contains clientY.
  // Pure geometry — cannot fail.

  const resolveTopLevelByGeometry = useCallback((
    clientY: number,
  ): ResolvedBlock | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    const { doc } = ed.view.state;

    let best: ResolvedBlock | null = null;
    let bestDist = Infinity;

    doc.forEach((node: PmNode, pos: number) => {
      const pmWrapper = ed.view.nodeDOM(pos) as HTMLElement | null;
      if (!pmWrapper) return;

      // For atom NodeViews the PM wrapper has height:0 — use firstElementChild
      const dom = (
        node.isAtom
          ? (pmWrapper.firstElementChild as HTMLElement | null) ?? pmWrapper
          : pmWrapper
      );

      const rect = dom.getBoundingClientRect();
      if (rect.height === 0) return;

      // Exact hit
      if (clientY >= rect.top && clientY <= rect.bottom) {
        best = {
          dragDom:       dom,
          nodePos:       pos,
          isListItem:    false,
          listParentPos: -1,
        };
        bestDist = 0;
        return;
      }

      // Nearest block above/below as fallback
      const dist = Math.min(
        Math.abs(clientY - rect.top),
        Math.abs(clientY - rect.bottom),
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          dragDom:       dom,
          nodePos:       pos,
          isListItem:    false,
          listParentPos: -1,
        };
      }
    });

    return best;
  }, [editorRef]);

  // ── resolveBlockFromPoint ─────────────────────────────────────────────────
  //
  // Resolution order:
  //   1. Try posAtDOM climbing loop — works for paragraphs, headings,
  //      code blocks, toggles, list items.
  //   2. If that yields nothing (atom NodeView interior) — fall back to
  //      pure geometry via resolveTopLevelByGeometry.
  //
  // Within a successful posAtDOM resolution:
  //   a. Suppress inline atoms (mention, emoji, inline image)
  //   b. Block atoms at depth 1 — return directly
  //   c. List items — return list item
  //   d. Top-level block — return via getTopLevelDom

  const resolveBlockFromPoint = useCallback((
    _clientX: number,
    clientY: number,
  ): ResolvedBlock | null => {
    const ed = editorRef.current;
    if (!ed) return null;

    const editorDom  = ed.view.dom;
    const editorRect = editorDom.getBoundingClientRect();
    const { doc }    = ed.view.state;

   // Single X probe is sufficient for block hit-testing. The extra two probes
  // (0.3×, 0.5× width) were defensive but each elementsFromPoint forces a
  // style recalc. One probe at left+60 covers paragraphs, headings, lists.
  // A second Y probe (+4px) is only attempted if the first misses entirely.
  const sampleX = editorRect.left + 60;

  // ── posAtDOM climbing loop ────────────────────────────────────────────
  let targetEl: HTMLElement | null = null;
  let pos = -1;

  outer: for (const sampleY of [clientY, clientY + 4]) {
    const elements = document.elementsFromPoint(sampleX, sampleY);
    for (const el of elements) {
      if (editorDom.contains(el) && el !== editorDom) {
        let current: HTMLElement | null = el as HTMLElement;
        while (current && current !== editorDom) {
          try {
            const testPos = ed.view.posAtDOM(current, 0);
            const $test   = doc.resolve(testPos);
            if ($test.depth > 0) {
              targetEl = current;
              pos      = testPos;
              break outer;
            }
          } catch { /* keep climbing */ }
          current = current.parentElement;
        }
      }
    }
  }

    // ── Geometry fallback for atom NodeViews ──────────────────────────────
    // posAtDOM never resolves depth > 0 inside a React NodeView's interior.
    // Skip all ProseMirror position logic and find the block by rect hit-test.
    if (!targetEl || pos === -1) {
      return resolveTopLevelByGeometry(clientY);
    }

    const $pos = doc.resolve(Math.max(0, pos));
    if ($pos.depth === 0) return null;

    // ── a. Inline atoms → suppress ────────────────────────────────────────
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (node.isInline && node.isAtom) return null;
      if (INLINE_NODE_TYPES.has(node.type.name)) return null;
    }

    // ── b. Block atoms at depth 1 ─────────────────────────────────────────
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (node.isAtom && !node.isInline) {
        const atomPos   = $pos.before(depth);
        const pmWrapper = ed.view.nodeDOM(atomPos) as HTMLElement | null;
        if (!pmWrapper) break;
        const atomDom = (pmWrapper.firstElementChild as HTMLElement | null) ?? pmWrapper;
        if (depth === 1) {
          return {
            dragDom:       atomDom,
            nodePos:       atomPos,
            isListItem:    false,
            listParentPos: -1,
          };
        }
        break;
      }
    }

    // ── c. List items ─────────────────────────────────────────────────────
    for (let depth = $pos.depth; depth > 0; depth--) {
      const node = $pos.node(depth);
      if (LIST_ITEM_TYPES.has(node.type.name)) {
        const itemPos = $pos.before(depth);
        const itemDom = ed.view.nodeDOM(itemPos) as HTMLElement | null;
        if (!itemDom) return null;
        for (let pd = depth - 1; pd >= 0; pd--) {
          const parent = $pos.node(pd);
          if (LIST_TYPES.has(parent.type.name)) {
            const listPos = $pos.before(pd);
            return {
              dragDom:       itemDom,
              nodePos:       itemPos,
              isListItem:    true,
              listParentPos: listPos,
            };
          }
        }
        return {
          dragDom:       itemDom,
          nodePos:       itemPos,
          isListItem:    true,
          listParentPos: -1,
        };
      }
    }

    // ── d. Top-level block fallback ───────────────────────────────────────
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
  }, [editorRef, getTopLevelDom, resolveTopLevelByGeometry]);

  return {
    resolveBlockFromPoint,
    getTopLevelBlockRects,
    getListItemRects,
    getListBounds,
    getBlocks,
  };
}