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

type BlockRect = { rect: DOMRect; pos: number; size: number; dom: HTMLElement };

export function useDragReorder({
  editor,
  scrollRef,
  editorWrapRef,
}: UseDragReorderOptions): UseDragReorderResult {
  const indicatorRef    = useRef<HTMLDivElement | null>(null);
  const draggedDomRef   = useRef<HTMLElement | null>(null);
  const isDraggingRef   = useRef<boolean>(false);
  const scrollAnimRef   = useRef<number | null>(null);  // rAF id for auto-scroll loop
  const scrollClientYRef = useRef<number>(0);           // latest clientY, read inside rAF

  const dragState = useRef<{
    active: boolean;
    dragDom: HTMLElement;
    nodePos: number;
    isListItem: boolean;
    listParentPos: number;
    startX: number;
    startY: number;
    thresholdMet: boolean;
    // pos value of the block the dragged node should land AFTER,
    // or null to mean "insert before everything"
    insertAfterPos: number | null;
    // Rects cached at drag-start; cleared on scroll so they rebuild next frame
    cachedBlocks: BlockRect[] | null;
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

    function getTopLevelDom(node: HTMLElement): HTMLElement | null {
      const root = ed.view.dom;
      let current: HTMLElement | null = node;
      while (current && current.parentElement !== root) {
        current = current.parentElement;
      }
      return current && current.parentElement === root ? current : null;
    }

    function getTopLevelBlockRects(): BlockRect[] {
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
    }

    function getListItemRects(listParentPos: number): BlockRect[] {
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
    }

    // Returns cached rects, building them on first call per drag.
    // Scroll clears the cache so the next mousemove reads fresh values.
    function getBlocks(): BlockRect[] {
      const ds = dragState.current;
      if (!ds) return [];
      if (ds.cachedBlocks) return ds.cachedBlocks;
      const blocks = ds.isListItem
        ? getListItemRects(ds.listParentPos)
        : getTopLevelBlockRects();
      ds.cachedBlocks = blocks;
      return blocks;
    }

    // ── Insertion math ────────────────────────────────────────────────────────
    //
    // Returns the `pos` value of the block that the dragged node should land
    // AFTER, or null to mean "insert before everything".

    function findInsertionPos(
      clientY: number,
      blocks: BlockRect[],
      dragPos: number
    ): number | null {
      if (blocks.length === 0) return null;

      const viewportHeight = window.innerHeight;

      const candidates = blocks.filter(
        (b) => b.pos !== dragPos && b.rect.bottom > 0 && b.rect.top < viewportHeight
      );

      if (candidates.length === 0) return null;

      for (let i = 0; i < candidates.length; i++) {
        const midY = candidates[i].rect.top + candidates[i].rect.height / 2;
        if (clientY < midY) {
          return i === 0
            ? null
            : candidates[i - 1].pos;
        }
      }

      return candidates[candidates.length - 1].pos;
    }

    function showIndicator(
      blocks: BlockRect[],
      insertAfterPos: number | null,
      dragPos: number
    ) {
      const indicator = indicatorRef.current;
      if (!indicator || blocks.length === 0) return;

      const visible = blocks.filter((b) => b.pos !== dragPos);
      if (visible.length === 0) return;

      let y: number;

      if (insertAfterPos === null) {
        y = visible[0].rect.top;
      } else {
        const aboveIdx = visible.findIndex((b) => b.pos === insertAfterPos);

        if (aboveIdx === -1) {
          indicator.style.display = "none";
          return;
        }

        if (aboveIdx === visible.length - 1) {
          y = visible[visible.length - 1].rect.bottom;
        } else {
          const above = visible[aboveIdx];
          const below = visible[aboveIdx + 1];
          y = above.rect.bottom + (below.rect.top - above.rect.bottom) * 0.5;
        }
      }

      const editorEl = editorWrapRef.current;
      if (!editorEl) return;
      const editorRect = editorEl.getBoundingClientRect();
      const inset = 8;

      indicator.style.display = "block";
      indicator.style.top    = `${y}px`;
      indicator.style.left   = `${editorRect.left + inset}px`;
      indicator.style.width  = `${editorRect.width - inset * 2}px`;
    }

    function hideIndicator() {
      if (indicatorRef.current) indicatorRef.current.style.display = "none";
    }

    function dimDraggedBlock(dom: HTMLElement) {
      dom.style.opacity    = "0.4";
      dom.style.transition = "opacity 120ms ease";
      draggedDomRef.current = dom;
    }

    function undimDraggedBlock() {
      if (draggedDomRef.current) {
        draggedDomRef.current.style.opacity   = "";
        draggedDomRef.current.style.transition = "";
        draggedDomRef.current = null;
      }
    }

    // ── Scroll invalidation ───────────────────────────────────────────────────
    //
    // Scroll shifts every block rect by the scroll delta. Clearing cachedBlocks
    // causes getBlocks() to rebuild on the next mousemove event.

    function onScrollDuringDrag() {
      if (dragState.current) dragState.current.cachedBlocks = null;
    }

    function attachScrollListener() {
      const el = scrollRef.current;
      if (el) el.addEventListener("scroll", onScrollDuringDrag, { passive: true });
    }

    function detachScrollListener() {
      const el = scrollRef.current;
      if (el) el.removeEventListener("scroll", onScrollDuringDrag);
    }

    // ── Auto-scroll ───────────────────────────────────────────────────────────
    //
    // When the cursor is within SCROLL_ZONE px of the top or bottom edge of the
    // scroll container, we drive scrollTop via a rAF loop so the user can drag
    // past the visible area without touching the keyboard.
    //
    // Speed scales linearly from 0 at the zone boundary to SCROLL_MAX_SPEED at
    // the very edge, so the scroll feels proportional to how far into the zone
    // the cursor has moved.

    const SCROLL_ZONE      = 80;  // px from edge that triggers scroll
    const SCROLL_MAX_SPEED = 16;  // px per frame at maximum proximity

    function stopScrollAnim() {
      if (scrollAnimRef.current !== null) {
        cancelAnimationFrame(scrollAnimRef.current);
        scrollAnimRef.current = null;
      }
    }

    function scrollLoop() {
      const el = scrollRef.current;
      if (!el || !dragState.current?.active) {
        scrollAnimRef.current = null;
        return;
      }

      const clientY = scrollClientYRef.current;
      const rect    = el.getBoundingClientRect();

      const distFromTop    = clientY - rect.top;
      const distFromBottom = rect.bottom - clientY;

      let delta = 0;
      if (distFromTop < SCROLL_ZONE && distFromTop >= 0) {
        // Cursor near top — scroll up (negative delta)
        delta = -SCROLL_MAX_SPEED * (1 - distFromTop / SCROLL_ZONE);
      } else if (distFromBottom < SCROLL_ZONE && distFromBottom >= 0) {
        // Cursor near bottom — scroll down (positive delta)
        delta = SCROLL_MAX_SPEED * (1 - distFromBottom / SCROLL_ZONE);
      }

      if (delta !== 0) {
        el.scrollTop += delta;
        // Scroll event fires → onScrollDuringDrag → cache invalidated automatically
        scrollAnimRef.current = requestAnimationFrame(scrollLoop);
      } else {
        scrollAnimRef.current = null;
      }
    }

    // Called on every mousemove while dragging. Starts the loop if cursor is
    // in a scroll zone, stops it if it has left.
    function tickScroll(clientY: number) {
      scrollClientYRef.current = clientY;
      const el = scrollRef.current;
      if (!el) return;

      const rect         = el.getBoundingClientRect();
      const distFromTop  = clientY - rect.top;
      const distFromBot  = rect.bottom - clientY;
      const inZone       = (distFromTop < SCROLL_ZONE && distFromTop >= 0)
                        || (distFromBot  < SCROLL_ZONE && distFromBot  >= 0);

      if (inZone && scrollAnimRef.current === null) {
        scrollAnimRef.current = requestAnimationFrame(scrollLoop);
      } else if (!inZone) {
        stopScrollAnim();
      }
    }

    function cancelDrag() {
      detachScrollListener();
      stopScrollAnim();
      dragState.current = null;
      isDraggingRef.current = false;
      hideIndicator();
      undimDraggedBlock();
      editorWrapRef.current?.classList.remove("is-dragging-block");
    }

    // ── Core: resolve what the handle is sitting next to ─────────────────────
    //
    // Strategy: sample points to the right of the handle at increasing offsets
    // until we hit an element inside the editor DOM. A fixed 20px offset fails
    // when the editor has wide left padding or the handle sits near the viewport
    // edge. We also try two vertical positions (centre and 25% from top) in case
    // the centre lands in a gap between inline elements.

    function resolveHandleTarget(handleEl: HTMLElement): {
      dragDom: HTMLElement;
      nodePos: number;
      isListItem: boolean;
      listParentPos: number;
    } | null {
      const handleRect = handleEl.getBoundingClientRect();
      const editorDom  = ed.view.dom;
      const editorRect = editorDom.getBoundingClientRect();

      // X probes: start at 20px right of handle, step by 20px up to the editor
      // right edge. This covers narrow and wide padding layouts.
      const xProbes: number[] = [];
      for (let offset = 20; handleRect.right + offset < editorRect.right; offset += 20) {
        xProbes.push(handleRect.right + offset);
      }
      // Always include a point well inside the editor as a final fallback
      xProbes.push(editorRect.left + editorRect.width * 0.5);

      // Y probes: vertical centre first, then 25% from top (avoids inter-line gaps)
      const yProbes = [
        handleRect.top + handleRect.height * 0.5,
        handleRect.top + handleRect.height * 0.25,
      ];

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
      try {
        pos = ed.view.posAtDOM(targetEl, 0);
      } catch {
        return null;
      }

      const { doc } = ed.view.state;
      const $pos = doc.resolve(Math.max(0, pos));

      const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);
      const LIST_TYPES      = new Set(["bulletList", "orderedList", "taskList"]);

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
                dragDom: itemDom,
                nodePos: itemPos,
                isListItem: true,
                listParentPos: listPos,
              };
            }
          }
        }
      }

      const topDom = getTopLevelDom(targetEl);
      if (!topDom) return null;

      let topPos: number;
      try {
        topPos = ed.view.posAtDOM(topDom, 0);
      } catch {
        return null;
      }

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
        insertAfterPos: null,
        cachedBlocks: null,
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
          attachScrollListener();  // start watching for scroll invalidation
        } else {
          return;
        }
      }

      if (!ds.active) return;

      tickScroll(e.clientY);  // start/stop auto-scroll based on cursor proximity

      // getBlocks() returns cached rects, rebuilding only after scroll
      const blocks = getBlocks();
      const insertAfterPos = findInsertionPos(e.clientY, blocks, ds.nodePos);
      ds.insertAfterPos = insertAfterPos;
      showIndicator(blocks, insertAfterPos, ds.nodePos);
    }

    function onMouseUp(e: MouseEvent) {
      const ds = dragState.current;

      hideIndicator();
      undimDraggedBlock();
      detachScrollListener();
      stopScrollAnim();
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

        if (ds.insertAfterPos === null) {
          reordered.splice(0, 0, dragged);
        } else {
          const refIdx = reordered.findIndex((n) => n.pos === ds.insertAfterPos);
          if (refIdx === -1) reordered.push(dragged);
          else reordered.splice(refIdx + 1, 0, dragged);
        }

        const unchanged = reordered.every((n, i) => n.pos === items[i].pos);
        if (unchanged) return;

        const originalSize  = items.reduce((acc, n) => acc + n.node.nodeSize, 0);
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

      if (ds.insertAfterPos === null) {
        reordered.splice(0, 0, dragged);
      } else {
        const refIdx = reordered.findIndex((n) => n.pos === ds.insertAfterPos);
        if (refIdx === -1) reordered.push(dragged);
        else reordered.splice(refIdx + 1, 0, dragged);
      }

      const unchanged = reordered.every((n, i) => n.pos === topLevelNodes[i].pos);
      if (unchanged) return;

      const originalSize  = topLevelNodes.reduce((acc, n) => acc + n.node.nodeSize, 0);
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