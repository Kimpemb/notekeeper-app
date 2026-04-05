// src/features/editor/hooks/useDragReorder.ts
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
    nodePos: number;
    nodeSize: number;
    startX: number;
    startY: number;
    thresholdMet: boolean;
    insertAfterIndex: number;
  } | null>(null);

  useEffect(() => {
    // Create indicator once per mount — cleaned up on unmount
    const indicator = document.createElement("div");
    indicator.className = "drag-drop-indicator";
    indicator.style.display = "none";
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

    // ── Helpers ──────────────────────────────────────────────────────────────

    function getTopLevelBlockRects() {
      const { view } = editor;
      const { doc } = view.state;
      const results: { rect: DOMRect; pos: number; size: number; dom: HTMLElement }[] = [];
      doc.forEach((node, pos) => {
        const dom = view.nodeDOM(pos) as HTMLElement | null;
        if (!dom) return;
        const rect = dom.getBoundingClientRect();
        if (rect.height === 0) return;
        results.push({ rect, pos, size: node.nodeSize, dom });
      });
      return results;
    }

    function findClosestBlock(
      clientY: number,
      blocks: { rect: DOMRect; pos: number; size: number; dom: HTMLElement }[]
    ): { pos: number; size: number; dom: HTMLElement } | null {
      if (blocks.length === 0) return null;
      let closest = blocks[0];
      let closestDist = Infinity;
      for (const block of blocks) {
        const midY = block.rect.top + block.rect.height / 2;
        const dist = Math.abs(clientY - midY);
        if (dist < closestDist) { closestDist = dist; closest = block; }
      }
      return closest;
    }

    function findInsertionIndex(
      clientY: number,
      blocks: { rect: DOMRect; pos: number; size: number }[],
      dragPos: number
    ): number {
      if (blocks.length === 0) return -1;

      const viewportHeight = window.innerHeight;

      // Only consider blocks visible in the viewport — avoids boundary snapping
      // when items are scrolled partially out of view
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

    // ── Event handlers ────────────────────────────────────────────────────────

    function onMouseDown(e: MouseEvent) {
      const handle = (e.target as HTMLElement).closest(".drag-handle");
      if (!handle || e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      const blocks = getTopLevelBlockRects();
      const closest = findClosestBlock(e.clientY, blocks);
      if (!closest) return;

      dragState.current = {
        active: false,
        nodePos: closest.pos,
        nodeSize: closest.size,
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
          const dom = editor.view.nodeDOM(ds.nodePos) as HTMLElement | null;
          if (dom) dimDraggedBlock(dom);
        } else {
          return;
        }
      }

      if (!ds.active) return;

      const blocks = getTopLevelBlockRects();
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

      const { view } = editor;
      const { state } = view;
      const { doc } = state;

      const topLevelNodes: { pos: number; node: PmNode }[] = [];
      doc.forEach((node, pos) => topLevelNodes.push({ pos, node }));
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

      // Safety check — reordered content must account for exactly the same
      // total size as the original. If not, something went wrong — abort.
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
        const inside =
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top  && e.clientY <= rect.bottom;
        if (inside) view.focus();
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