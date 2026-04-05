// src/features/editor/hooks/useDragReorder.ts
//
// Pure mousemove-based block reordering — no HTML5 drag API involved.
//
// Game-dev approach: DOM first, ProseMirror positions last.
//   mousedown  → read handle's pixel position → find DOM node underneath → get PM pos
//   mousemove  → find insertion point from visible block rects
//   mouseup    → convert to PM positions → dispatch targeted transaction

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";

interface UseDragReorderOptions {
  editor: Editor | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  editorWrapRef: React.RefObject<HTMLDivElement | null>;
}

interface UseDragReorderResult {
  isDraggingRef: React.RefObject<boolean>;
}

const DRAG_THRESHOLD = 6;

export function useDragReorder({
  editor,
  editorWrapRef,
}: UseDragReorderOptions): UseDragReorderResult {
  const indicatorRef  = useRef<HTMLDivElement | null>(null);
  const draggedDomRef = useRef<HTMLElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  const dragState = useRef<{
    active: boolean;
    // The actual DOM node being dragged
    dragDom: HTMLElement;
    // Its ProseMirror position
    nodePos: number;
    // Whether it's a list item (taskItem / listItem)
    isListItem: boolean;
    // If list item — the parent list's PM position
    listParentPos: number;
    startX: number;
    startY: number;
    thresholdMet: boolean;
    insertAfterIndex: number;
  } | null>(null);

  // ── Indicator ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const indicator = document.createElement("div");
    indicator.style.cssText = [
      "display: none",
      "position: fixed",
      "height: 2px",
      "background: rgba(59, 130, 246, 0.75)",
      "border-radius: 1px",
      "pointer-events: none",
      "z-index: 9999",
      "transform: translateY(-1px)",
    ].join(";");
    document.body.appendChild(indicator);
    indicatorRef.current = indicator;
    return () => {
      indicator.remove();
      indicatorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const ed = editor;

    // ── DOM helpers ───────────────────────────────────────────────────────────

    // Given a DOM node, walk up until we find a direct child of .ProseMirror
    function getTopLevelDom(node: HTMLElement): HTMLElement | null {
      const root = ed.view.dom;
      let current: HTMLElement | null = node;
      while (current && current.parentElement !== root) {
        current = current.parentElement;
      }
      return current && current.parentElement === root ? current : null;
    }

    // Get rects for all visible top-level blocks
    function getTopLevelBlockRects() {
      const { doc } = ed.view.state;
      const results: { rect: DOMRect; pos: number; size: number; dom: HTMLElement }[] = [];
      doc.forEach((node: PmNode, pos: number) => {
        const dom = ed.view.nodeDOM(pos) as HTMLElement | null;
        if (!dom) return;
        const rect = dom.getBoundingClientRect();
        if (rect.height === 0) return;
        results.push({ rect, pos, size: node.nodeSize, dom });
      });
      return results;
    }

    // Get rects for children of a list node
    function getListItemRects(listParentPos: number) {
      const { doc } = ed.view.state;
      const listNode = doc.nodeAt(listParentPos);
      if (!listNode) return [];
      const results: { rect: DOMRect; pos: number; size: number; dom: HTMLElement }[] = [];
      listNode.forEach((child: PmNode, childOffset: number) => {
        const childPos = listParentPos + 1 + childOffset;
        const dom = ed.view.nodeDOM(childPos) as HTMLElement | null;
        if (!dom) return;
        const rect = dom.getBoundingClientRect();
        if (rect.height === 0) return;
        results.push({ rect, pos: childPos, size: child.nodeSize, dom });
      });
      return results;
    }

    // ── Insertion math ────────────────────────────────────────────────────────

    function findInsertionIndex(
      clientY: number,
      blocks: { rect: DOMRect; pos: number; size: number }[],
      dragPos: number
    ): number {
      if (blocks.length === 0) return -1;
      const viewportHeight = window.innerHeight;
      const nonDragged = blocks
        .map((b, i) => ({ ...b, originalIndex: i }))
        .filter((b) => b.pos !== dragPos)
        .filter((b) => b.rect.bottom > 0 && b.rect.top < viewportHeight);
      if (nonDragged.length === 0) return -1;
      for (let i = 0; i < nonDragged.length; i++) {
        const midY = nonDragged[i].rect.top + nonDragged[i].rect.height / 2;
        if (clientY < midY) {
          return i === 0 ? -1 : nonDragged[i - 1].originalIndex;
        }
      }
      return nonDragged[nonDragged.length - 1].originalIndex;
    }

    function showIndicator(
      blocks: { rect: DOMRect }[],
      insertAfterIndex: number
    ) {
      const indicator = indicatorRef.current;
      if (!indicator || blocks.length === 0) return;
      let y: number;
      if (insertAfterIndex < 0) {
        y = blocks[0].rect.top;
      } else if (insertAfterIndex >= blocks.length - 1) {
        y = blocks[blocks.length - 1].rect.bottom;
      } else {
        const above = blocks[insertAfterIndex];
        const below = blocks[insertAfterIndex + 1];
        y = above.rect.bottom + (below.rect.top - above.rect.bottom) * 0.5;
      }
      const editorEl = editorWrapRef.current;
      if (!editorEl) return;
      const editorRect = editorEl.getBoundingClientRect();
      const inset = 8;
      indicator.style.display = "block";
      indicator.style.top = `${y}px`;
      indicator.style.left = `${editorRect.left + inset}px`;
      indicator.style.width = `${editorRect.width - inset * 2}px`;
    }

    function hideIndicator() {
      if (indicatorRef.current) indicatorRef.current.style.display = "none";
    }

    function dimDraggedBlock(dom: HTMLElement) {
      dom.style.opacity = "0.4";
      dom.style.transition = "opacity 120ms ease";
      draggedDomRef.current = dom;
    }

    function undimDraggedBlock() {
      if (draggedDomRef.current) {
        draggedDomRef.current.style.opacity = "";
        draggedDomRef.current.style.transition = "";
        draggedDomRef.current = null;
      }
    }

    function cancelDrag() {
      dragState.current = null;
      isDraggingRef.current = false;
      hideIndicator();
      undimDraggedBlock();
      editorWrapRef.current?.classList.remove("is-dragging-block");
    }

    // ── Core: resolve what the handle is sitting next to ─────────────────────
    //
    // The extension already did the hard work of scoring which node the handle
    // belongs to and positioned itself next to it. We read that back by:
    //   1. Getting the handle element's bounding rect
    //   2. Sampling a point just to the RIGHT of the handle (into the block)
    //   3. Walking up from that element to find the ProseMirror node
    //
    // This works for both top-level blocks and list items.

    function resolveHandleTarget(handleEl: HTMLElement): {
      dragDom: HTMLElement;
      nodePos: number;
      isListItem: boolean;
      listParentPos: number;
    } | null {
      const handleRect = handleEl.getBoundingClientRect();

      // Sample a point 20px to the right of the handle's right edge,
      // at the vertical centre of the handle — this lands inside the block
      const sampleX = handleRect.right + 20;
      const sampleY = handleRect.top + handleRect.height / 2;

      // Walk elements at that point, find the first one inside the editor
      const elements = document.elementsFromPoint(sampleX, sampleY);
      const editorDom = ed.view.dom;

      let targetEl: HTMLElement | null = null;
      for (const el of elements) {
        if (editorDom.contains(el) && el !== editorDom) {
          targetEl = el as HTMLElement;
          break;
        }
      }
      if (!targetEl) return null;

      // Try to get PM position from this element
      let pos: number;
      try {
        pos = ed.view.posAtDOM(targetEl, 0);
      } catch {
        return null;
      }

      // Resolve to find what node this position belongs to
      const { doc } = ed.view.state;
      const $pos = doc.resolve(Math.max(0, pos));

      const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
      const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

      // Check if we're inside a list item
      for (let depth = $pos.depth; depth > 0; depth--) {
        const node = $pos.node(depth);
        if (LIST_ITEM_TYPES.has(node.type.name)) {
          const itemPos = $pos.before(depth);
          const itemDom = ed.view.nodeDOM(itemPos) as HTMLElement | null;
          if (!itemDom) return null;

          // Find the parent list
          for (let pd = depth - 1; pd >= 0; pd--) {
            const parent = $pos.node(pd);
            if (LIST_TYPES.has(parent.type.name)) {
              const listPos = pd === 0 ? 0 : $pos.before(pd);
              return {
                dragDom: itemDom,
                nodePos: itemPos,
                isListItem: true,
                listParentPos: listPos,
              };
            }
          }
        }
      }

      // Not a list item — find the top-level block
      const topDom = getTopLevelDom(targetEl);
      if (!topDom) return null;

      let topPos: number;
      try {
        topPos = ed.view.posAtDOM(topDom, 0);
      } catch {
        return null;
      }

      // Resolve to the actual top-level node position
      const $topPos = doc.resolve(Math.max(0, topPos));
      const nodePos = $topPos.depth > 0 ? $topPos.before(1) : topPos;

      return {
        dragDom: topDom,
        nodePos,
        isListItem: false,
        listParentPos: -1,
      };
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    function onMouseDown(e: MouseEvent) {
      const handleEl = (e.target as HTMLElement).closest(".drag-handle") as HTMLElement | null;
      if (!handleEl || e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      const target = resolveHandleTarget(handleEl);
      if (!target) return;

      dragState.current = {
        active: false,
        dragDom: target.dragDom,
        nodePos: target.nodePos,
        isListItem: target.isListItem,
        listParentPos: target.listParentPos,
        startX: e.clientX,
        startY: e.clientY,
        thresholdMet: false,
        insertAfterIndex: -1,
      };
    }

    function onMouseMove(e: MouseEvent) {
      const ds = dragState.current;
      if (!ds) return;

      const dx = Math.abs(e.clientX - ds.startX);
      const dy = Math.abs(e.clientY - ds.startY);

      if (!ds.thresholdMet) {
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          ds.thresholdMet = true;
          ds.active = true;
          isDraggingRef.current = true;
          editorWrapRef.current?.classList.add("is-dragging-block");
          dimDraggedBlock(ds.dragDom);
        } else {
          return;
        }
      }

      if (!ds.active) return;

      const blocks = ds.isListItem
        ? getListItemRects(ds.listParentPos)
        : getTopLevelBlockRects();

      const insertAfterIndex = findInsertionIndex(e.clientY, blocks, ds.nodePos);
      ds.insertAfterIndex = insertAfterIndex;
      showIndicator(blocks, insertAfterIndex);
    }

    function onMouseUp(e: MouseEvent) {
      const ds = dragState.current;

      hideIndicator();
      undimDraggedBlock();
      editorWrapRef.current?.classList.remove("is-dragging-block");
      isDraggingRef.current = false;
      dragState.current = null;

      if (!ds || !ds.thresholdMet || !ds.active) return;

      const { view } = ed;
      const { state } = view;
      const { doc } = state;

      // ── List item reorder ────────────────────────────────────────────────
      if (ds.isListItem) {
        const listNode = doc.nodeAt(ds.listParentPos);
        if (!listNode) return;

        const items: { pos: number; node: PmNode }[] = [];
        listNode.forEach((child: PmNode, childOffset: number) => {
          items.push({ pos: ds.listParentPos + 1 + childOffset, node: child });
        });

        if (items.length < 2) return;

        const dragIndex = items.findIndex((item) => item.pos === ds.nodePos);
        if (dragIndex === -1) return;

        const reordered = [...items];
        const [dragged] = reordered.splice(dragIndex, 1);

        const insertAfter = ds.insertAfterIndex;
        if (insertAfter < 0) {
          reordered.splice(0, 0, dragged);
        } else {
          const ref = items[insertAfter];
          const newIdx = reordered.findIndex((n) => n.pos === ref.pos);
          if (newIdx === -1) reordered.push(dragged);
          else reordered.splice(newIdx + 1, 0, dragged);
        }

        const unchanged = reordered.every((n, i) => n.pos === items[i].pos);
        if (unchanged) return;

        const originalSize = items.reduce((acc, n) => acc + n.node.nodeSize, 0);
        const reorderedSize = reordered.reduce((acc, n) => acc + n.node.nodeSize, 0);
        if (originalSize !== reorderedSize) return;

        const listStart = ds.listParentPos + 1;
        const listEnd   = ds.listParentPos + listNode.nodeSize - 1;
        const tr = state.tr;
        tr.replaceWith(listStart, listEnd, reordered.map((n) => n.node));

        try {
          const finalIdx = reordered.findIndex((n) => n.node === dragged.node);
          const newPos = ds.listParentPos + 1 +
            reordered.slice(0, finalIdx).reduce((acc, n) => acc + n.node.nodeSize, 0);
          const $pos = tr.doc.resolve(Math.min(newPos + 1, tr.doc.content.size - 1));
          tr.setSelection(Selection.near($pos));
        } catch { /* best-effort */ }

        view.dispatch(tr);

        const editorEl = editorWrapRef.current;
        if (editorEl) {
          const rect = editorEl.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top  && e.clientY <= rect.bottom) {
            view.focus();
          }
        }
        return;
      }

      // ── Top-level block reorder ──────────────────────────────────────────
      const topLevelNodes: { pos: number; node: PmNode }[] = [];
      doc.forEach((node: PmNode, pos: number) => topLevelNodes.push({ pos, node }));
      if (topLevelNodes.length < 2) return;

      const dragIndex = topLevelNodes.findIndex((n) => n.pos === ds.nodePos);
      if (dragIndex === -1) return;

      const reordered = [...topLevelNodes];
      const [dragged] = reordered.splice(dragIndex, 1);

      const insertAfter = ds.insertAfterIndex;
      if (insertAfter < 0) {
        reordered.splice(0, 0, dragged);
      } else {
        const insertAfterNode = topLevelNodes[insertAfter];
        const newIdx = reordered.findIndex((n) => n.pos === insertAfterNode.pos);
        if (newIdx === -1) reordered.push(dragged);
        else reordered.splice(newIdx + 1, 0, dragged);
      }

      const unchanged = reordered.every((n, i) => n.pos === topLevelNodes[i].pos);
      if (unchanged) return;

      const originalSize = topLevelNodes.reduce((acc, n) => acc + n.node.nodeSize, 0);
      const reorderedSize = reordered.reduce((acc, n) => acc + n.node.nodeSize, 0);
      if (originalSize !== reorderedSize) return;

      const finalInsertAt = reordered.findIndex((n) => n.node === dragged.node);
      const tr = state.tr;
      tr.replaceWith(0, doc.content.size, reordered.map((n) => n.node));

      try {
        const newPos = reordered
          .slice(0, finalInsertAt)
          .reduce((acc, n) => acc + n.node.nodeSize, 0);
        const $pos = tr.doc.resolve(Math.min(newPos + 1, tr.doc.content.size - 1));
        tr.setSelection(Selection.near($pos));
      } catch { /* best-effort */ }

      view.dispatch(tr);

      const editorEl = editorWrapRef.current;
      if (editorEl) {
        const rect = editorEl.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top  && e.clientY <= rect.bottom) {
          view.focus();
        }
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dragState.current) cancelDrag();
    }

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
      cancelDrag();
    };
  }, [editor]);

  return { isDraggingRef };
}