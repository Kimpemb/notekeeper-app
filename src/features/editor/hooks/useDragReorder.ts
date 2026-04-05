// src/features/editor/hooks/useDragReorder.ts
//
// Pure mousemove-based block reordering — no HTML5 drag API involved.
//
// Game-dev approach: DOM first, ProseMirror positions last.
//   mousemove  → find block under cursor → position handle
//   mousedown  → if handle clicked → begin drag
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
  getEditorLeft: () => number;
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
  getEditorLeft,
}: UseDragReorderOptions): UseDragReorderResult {
  const indicatorRef     = useRef<HTMLDivElement | null>(null);
  const handleRef        = useRef<HTMLDivElement | null>(null);
  const draggedDomRef    = useRef<HTMLElement | null>(null);
  const isDraggingRef    = useRef<boolean>(false);
  const scrollAnimRef    = useRef<number | null>(null);
  const scrollClientYRef = useRef<number>(0);
  const hoveredBlockRef  = useRef<{ dom: HTMLElement; pos: number; isListItem: boolean; listParentPos: number } | null>(null);

  const dragState = useRef<{
    active: boolean;
    dragDom: HTMLElement;
    nodePos: number;
    isListItem: boolean;
    listParentPos: number;
    startX: number;
    startY: number;
    thresholdMet: boolean;
    insertAfterPos: number | null;
    cachedBlocks: BlockRect[] | null;
  } | null>(null);

  // ── Create handle and indicator elements ──────────────────────────────────
  useEffect(() => {
    // Indicator
    const indicator = document.createElement("div");
    indicator.style.cssText = [
      "display:none",
      "position:fixed",
      "height:2px",
      "background:rgba(59,130,246,0.75)",
      "border-radius:1px",
      "pointer-events:none",
      "z-index:9999",
      "transform:translateY(-1px)",
    ].join(";");
    document.body.appendChild(indicator);
    indicatorRef.current = indicator;

    // Handle
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.setAttribute("data-drag-handle", "");
    handle.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:100",
      "width:20px",
      "height:24px",
      "align-items:center",
      "justify-content:center",
      "border-radius:4px",
      "cursor:grab",
      "color:#c4c4c4",
      "background:transparent",
      "user-select:none",
    ].join(";");
    handle.innerHTML = `
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <circle cx="2.5" cy="2.5" r="1.5"/>
        <circle cx="7.5" cy="2.5" r="1.5"/>
        <circle cx="2.5" cy="7" r="1.5"/>
        <circle cx="7.5" cy="7" r="1.5"/>
        <circle cx="2.5" cy="11.5" r="1.5"/>
        <circle cx="7.5" cy="11.5" r="1.5"/>
      </svg>
    `;
    handle.addEventListener("mouseenter", () => {
      handle.style.color = "#9ca3af";
      handle.style.background = "rgba(0,0,0,0.06)";
    });
    handle.addEventListener("mouseleave", () => {
      handle.style.color = "#c4c4c4";
      handle.style.background = "transparent";
    });
    document.body.appendChild(handle);
    handleRef.current = handle;

    return () => {
      indicator.remove();
      handle.remove();
      indicatorRef.current = null;
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const ed = editor;

    // ── Handle positioning ────────────────────────────────────────────────────

    function showHandle(dom: HTMLElement) {
      const handle = handleRef.current;
      if (!handle) return;
      const rect = dom.getBoundingClientRect();
      const left = getEditorLeft() - 28;
      handle.style.display = "flex";
      handle.style.left = `${left}px`;
      handle.style.top = `${rect.top + 4}px`;
    }

    function hideHandle() {
      const handle = handleRef.current;
      if (!handle) return;
      handle.style.display = "none";
      hoveredBlockRef.current = null;
    }

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

    // ── Block detection from cursor ───────────────────────────────────────────

    function resolveBlockFromPoint(_clientX: number, clientY: number): {
      dragDom: HTMLElement;
      nodePos: number;
      isListItem: boolean;
      listParentPos: number;
    } | null {
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

    // ── Insertion math ────────────────────────────────────────────────────────

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
          return i === 0 ? null : candidates[i - 1].pos;
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
        if (aboveIdx === -1) { indicator.style.display = "none"; return; }
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
      indicator.style.top   = `${y}px`;
      indicator.style.left  = `${editorRect.left + inset}px`;
      indicator.style.width = `${editorRect.width - inset * 2}px`;
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
        draggedDomRef.current.style.opacity    = "";
        draggedDomRef.current.style.transition = "";
        draggedDomRef.current = null;
      }
    }

    // ── Scroll ────────────────────────────────────────────────────────────────

    function onScrollDuringDrag() {
      if (dragState.current) dragState.current.cachedBlocks = null;
    }

    function attachScrollListener() {
      scrollRef.current?.addEventListener("scroll", onScrollDuringDrag, { passive: true });
    }

    function detachScrollListener() {
      scrollRef.current?.removeEventListener("scroll", onScrollDuringDrag);
    }

    const SCROLL_ZONE      = 80;
    const SCROLL_MAX_SPEED = 16;

    function stopScrollAnim() {
      if (scrollAnimRef.current !== null) {
        cancelAnimationFrame(scrollAnimRef.current);
        scrollAnimRef.current = null;
      }
    }

    function scrollLoop() {
      const el = scrollRef.current;
      if (!el || !dragState.current?.active) { scrollAnimRef.current = null; return; }
      const clientY = scrollClientYRef.current;
      const rect    = el.getBoundingClientRect();
      const distFromTop    = clientY - rect.top;
      const distFromBottom = rect.bottom - clientY;
      let delta = 0;
      if (distFromTop < SCROLL_ZONE && distFromTop >= 0)
        delta = -SCROLL_MAX_SPEED * (1 - distFromTop / SCROLL_ZONE);
      else if (distFromBottom < SCROLL_ZONE && distFromBottom >= 0)
        delta = SCROLL_MAX_SPEED * (1 - distFromBottom / SCROLL_ZONE);
      if (delta !== 0) {
        el.scrollTop += delta;
        scrollAnimRef.current = requestAnimationFrame(scrollLoop);
      } else {
        scrollAnimRef.current = null;
      }
    }

    function tickScroll(clientY: number) {
      scrollClientYRef.current = clientY;
      const el = scrollRef.current;
      if (!el) return;
      const rect        = el.getBoundingClientRect();
      const distFromTop = clientY - rect.top;
      const distFromBot = rect.bottom - clientY;
      const inZone = (distFromTop < SCROLL_ZONE && distFromTop >= 0)
                  || (distFromBot  < SCROLL_ZONE && distFromBot  >= 0);
      if (inZone && scrollAnimRef.current === null)
        scrollAnimRef.current = requestAnimationFrame(scrollLoop);
      else if (!inZone)
        stopScrollAnim();
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

    // ── Event handlers ────────────────────────────────────────────────────────

    function onMouseMove(e: MouseEvent) {
      const handle = handleRef.current;

      // ── Dragging ───────────────────────────────────────────────────────────
      const ds = dragState.current;
      if (ds) {
        const dx = Math.abs(e.clientX - ds.startX);
        const dy = Math.abs(e.clientY - ds.startY);

        if (!ds.thresholdMet) {
          if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
            ds.thresholdMet = true;
            ds.active = true;
            isDraggingRef.current = true;
            editorWrapRef.current?.classList.add("is-dragging-block");
            dimDraggedBlock(ds.dragDom);
            attachScrollListener();
          } else {
            return;
          }
        }

        if (!ds.active) return;
        tickScroll(e.clientY);
        const blocks = getBlocks();
        const insertAfterPos = findInsertionPos(e.clientY, blocks, ds.nodePos);
        ds.insertAfterPos = insertAfterPos;
        showIndicator(blocks, insertAfterPos, ds.nodePos);
        return;
      }

      // ── Hovering — keep handle alive if cursor is on it ───────────────────
      if (handle && (e.target === handle || handle.contains(e.target as Node))) return;

      const editorEl = editorWrapRef.current;
      if (!editorEl || !handle) return;

      const editorRect = editorEl.getBoundingClientRect();

      // Extend the left boundary to include the handle's gutter column
      // so the handle stays visible as the cursor moves toward it
      const handleLeft = handle.style.display !== "none"
        ? parseFloat(handle.style.left || "0")
        : editorRect.left;

      const inEditor = (
        e.clientX >= Math.min(handleLeft, editorRect.left) &&
        e.clientX <= editorRect.right &&
        e.clientY >= editorRect.top &&
        e.clientY <= editorRect.bottom
      );

      if (!inEditor) {
        hideHandle();
        return;
      }

      // Only re-resolve block if cursor is inside the actual editor content
      // — not in the gutter — to avoid flicker while hovering the handle zone
      if (e.clientX >= editorRect.left) {
        const target = resolveBlockFromPoint(e.clientX, e.clientY);
        if (!target) {
          hideHandle();
          return;
        }

        hoveredBlockRef.current = {
          dom: target.dragDom,
          pos: target.nodePos,
          isListItem: target.isListItem,
          listParentPos: target.listParentPos,
        };

        showHandle(target.dragDom);
      }
      // If in gutter (between handle and editor left edge), do nothing —
      // handle stays exactly where it is, hoveredBlockRef stays valid
    }

    function onMouseDown(e: MouseEvent) {
      const handleEl = (e.target as HTMLElement).closest(".drag-handle") as HTMLElement | null;
      if (!handleEl || e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      const hovered = hoveredBlockRef.current;
      if (!hovered) return;

      dragState.current = {
        active: false,
        dragDom: hovered.dom,
        nodePos: hovered.pos,
        isListItem: hovered.isListItem,
        listParentPos: hovered.listParentPos,
        startX: e.clientX,
        startY: e.clientY,
        thresholdMet: false,
        insertAfterPos: null,
        cachedBlocks: null,
      };
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

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
      cancelDrag();
      hideHandle();
    };
  }, [editor]);

  return { isDraggingRef };
}