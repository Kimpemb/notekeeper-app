// src/features/editor/hooks/useDragReorder.ts
//
// Pure mousemove-based block reordering — no HTML5 drag API involved.
//
// Game-dev approach: DOM first, ProseMirror positions last.
//   mousemove  → find block under cursor → position handle
//   mousedown  → if handle clicked → begin drag or open menu (right-click)
//   mousemove  → find insertion point from visible block rects
//   mouseup    → if no drag threshold met → open block action menu
//            → if drag → convert to PM positions → dispatch targeted transaction
//
// Menu logic lives in useBlockMenu. This file calls openMenu/closeMenu at the
// two trigger points and reads menuOpenRef to freeze the mouse loop while open.
//
// Fixes in this version:
//   B — hide handle during text selection
//   R — throttle getBoundingClientRect in onMouseMove
//   E — drag list item out of its list to become a top-level paragraph

import { useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { useBlockMenu } from "./useBlockMenu";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseDragReorderOptions {
  editor:               Editor | null;
  scrollRef:            React.RefObject<HTMLDivElement | null>;
  editorWrapRef:        React.RefObject<HTMLDivElement | null>;
  editorTextColumnRef:  React.RefObject<HTMLDivElement | null>;
  getEditorLeft:        () => number;
}

interface UseDragReorderResult {
  isDraggingRef: React.RefObject<boolean>;
}

type BlockRect = { rect: DOMRect; pos: number; size: number; dom: HTMLElement };

// ── Constants ─────────────────────────────────────────────────────────────────

const DRAG_THRESHOLD       = 6;
const SHOW_HANDLE_DELAY    = 70;
const SCROLL_ZONE          = 80;
const SCROLL_MAX_SPEED     = 16;
const MOUSEMOVE_THROTTLE   = 16; // R — ~1 frame at 60fps

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDragReorder({
  editor,
  scrollRef,
  editorWrapRef,
  editorTextColumnRef,
  getEditorLeft,
}: UseDragReorderOptions): UseDragReorderResult {

  const indicatorRef     = useRef<HTMLDivElement | null>(null);
  const handleRef        = useRef<HTMLDivElement | null>(null);
  const ghostRef         = useRef<HTMLDivElement | null>(null);
  const draggedDomRef    = useRef<HTMLElement | null>(null);
  const isDraggingRef    = useRef<boolean>(false);
  const scrollAnimRef    = useRef<number | null>(null);
  const scrollClientYRef = useRef<number>(0);
  const lastMoveTimeRef  = useRef<number>(0); // R — throttle timestamp
  const hoveredBlockRef  = useRef<{
    dom: HTMLElement; pos: number; isListItem: boolean; listParentPos: number;
  } | null>(null);

  const isScrollingRef     = useRef<boolean>(false);
  const scrollEndTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHandleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dragState = useRef<{
    active:         boolean;
    dragDom:        HTMLElement;
    nodePos:        number;
    isListItem:     boolean;
    listParentPos:  number;
    escapedList:    boolean; // E — true once cursor leaves list boundary
    startX:         number;
    startY:         number;
    thresholdMet:   boolean;
    insertAfterPos: number | null;
    cachedBlocks:   BlockRect[] | null;
    listBounds:     { top: number; bottom: number } | null; // E — list el bounds
  } | null>(null);

  // ── Block action menu ─────────────────────────────────────────────────────
  const { menuRef, menuOpenRef, openMenu, closeMenu } = useBlockMenu({
    handleRef,
    editorWrapRef,
  });

  // ── showHandle ────────────────────────────────────────────────────────────
  const showHandle = useCallback((dom: HTMLElement) => {
    const handle = handleRef.current;
    if (!handle) return;
    const rect = dom.getBoundingClientRect();
    const left = getEditorLeft() - 28;
    handle.style.display = "flex";
    handle.style.left    = `${left}px`;
    handle.style.top     = `${rect.top + 4}px`;
  }, [getEditorLeft]);

  // ── scheduleShowHandle ────────────────────────────────────────────────────
  const scheduleShowHandle = useCallback((dom: HTMLElement) => {
    if (showHandleTimerRef.current !== null) clearTimeout(showHandleTimerRef.current);
    showHandleTimerRef.current = setTimeout(() => {
      showHandleTimerRef.current = null;
      if (!isScrollingRef.current) showHandle(dom);
    }, SHOW_HANDLE_DELAY);
  }, [showHandle]);

  const cancelShowHandleTimer = useCallback(() => {
    if (showHandleTimerRef.current !== null) {
      clearTimeout(showHandleTimerRef.current);
      showHandleTimerRef.current = null;
    }
  }, []);

  // ── Create handle, indicator, ghost ──────────────────────────────────────
  useEffect(() => {
    // Drop indicator
    const indicator = document.createElement("div");
    indicator.style.cssText = [
      "display:none", "position:fixed", "height:2px",
      "background:rgba(59,130,246,0.75)", "border-radius:1px",
      "pointer-events:none", "z-index:9999", "transform:translateY(-1px)",
    ].join(";");
    document.body.appendChild(indicator);
    indicatorRef.current = indicator;

    // Drag handle
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.setAttribute("data-drag-handle", "");
    handle.style.cssText = [
      "display:none", "position:fixed", "z-index:100",
      "width:20px", "height:24px",
      "align-items:center", "justify-content:center",
      "border-radius:4px", "cursor:grab",
      "color:#c4c4c4", "background:transparent", "user-select:none",
    ].join(";");
    handle.innerHTML = `
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <circle cx="2.5" cy="2.5"  r="1.5"/>
        <circle cx="7.5" cy="2.5"  r="1.5"/>
        <circle cx="2.5" cy="7"    r="1.5"/>
        <circle cx="7.5" cy="7"    r="1.5"/>
        <circle cx="2.5" cy="11.5" r="1.5"/>
        <circle cx="7.5" cy="11.5" r="1.5"/>
      </svg>
    `;
    handle.addEventListener("mouseenter", () => {
      if (menuOpenRef.current) return;
      handle.style.color      = "#9ca3af";
      handle.style.background = "rgba(0,0,0,0.06)";
    });
    handle.addEventListener("mouseleave", () => {
      if (menuOpenRef.current) return;
      handle.style.color      = "#c4c4c4";
      handle.style.background = "transparent";
    });
    document.body.appendChild(handle);
    handleRef.current = handle;

    // Ghost preview
    const ghost = document.createElement("div");
    ghost.className     = "drag-ghost";
    ghost.style.display = "none";
    document.body.appendChild(ghost);
    ghostRef.current = ghost;

    // ResizeObserver — snap handle when editor column shifts
    const colEl = editorTextColumnRef.current;
    let ro: ResizeObserver | null = null;
    if (colEl) {
      ro = new ResizeObserver(() => {
        const hovered = hoveredBlockRef.current;
        if (hovered && handleRef.current?.style.display !== "none") {
          showHandle(hovered.dom);
        }
      });
      ro.observe(colEl);
    }

    return () => {
      ro?.disconnect();
      indicator.remove();
      handle.remove();
      ghost.remove();
      indicatorRef.current = null;
      handleRef.current    = null;
      ghostRef.current     = null;
    };
  }, [editorTextColumnRef, showHandle, menuOpenRef]);

  // ── Scroll — hide handle, restore only on mousemove ──────────────────────
  // ── Scroll — hide handle, restore only on mousemove ──────────────────────
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;

  function onScroll() {
    cancelShowHandleTimer();
    if (menuOpenRef.current) closeMenu();
    const handle = handleRef.current;
    if (handle) handle.style.display = "none";
    hoveredBlockRef.current   = null;
    isScrollingRef.current    = true;
    if (scrollEndTimerRef.current !== null) clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = setTimeout(() => {
      isScrollingRef.current    = false;
      scrollEndTimerRef.current = null;
    }, 300);
  }

  el.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    el.removeEventListener("scroll", onScroll);
    if (scrollEndTimerRef.current !== null) clearTimeout(scrollEndTimerRef.current);
  };
}, [scrollRef, cancelShowHandleTimer, closeMenu, menuOpenRef]);

  // ── Main mouse + keyboard loop ────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return;
    const ed = editor;

    // ── Handle visibility ─────────────────────────────────────────────────

    function hideHandle() {
      cancelShowHandleTimer();
      const handle = handleRef.current;
      if (!handle) return;
      handle.style.display    = "none";
      hoveredBlockRef.current = null;
    }

    // ── Ghost helpers ─────────────────────────────────────────────────────

    function initGhost(dom: HTMLElement) {
      const ghost = ghostRef.current;
      if (!ghost) return;

      const blockRect = dom.getBoundingClientRect();
      const clone     = dom.cloneNode(true) as HTMLElement;

      clone.style.width         = `${blockRect.width}px`;
      clone.style.height        = `${blockRect.height}px`;
      clone.style.minHeight     = "unset";
      clone.style.maxHeight     = "unset";
      clone.style.overflow      = "hidden";
      clone.style.pointerEvents = "none";
      clone.style.margin        = "0";
      clone.style.position      = "static";
      clone.style.transform     = "none";
      clone.style.flex          = "unset";

      // B — dark mode: force text color since clone lives outside editor scope
      const dark = document.documentElement.classList.contains("dark");
      if (dark) {
        clone.style.color = "#e4e4e7";
        clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
          el.style.color = "inherit";
        });
      }

      clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

      ghost.innerHTML = "";
      ghost.appendChild(clone);
      ghost.style.width  = `${blockRect.width}px`;
      ghost.style.height = `${blockRect.height}px`;
    }

    function moveGhost(dom: HTMLElement, clientY: number) {
      const ghost = ghostRef.current;
      if (!ghost) return;
      const blockRect = dom.getBoundingClientRect();
      ghost.style.display = "block";
      ghost.style.left    = `${getEditorLeft()}px`;
      ghost.style.top     = `${clientY - blockRect.height / 2}px`;
    }

    function hideGhost() {
      const ghost = ghostRef.current;
      if (!ghost) return;
      ghost.style.display = "none";
      ghost.innerHTML     = "";
    }

    // ── DOM helpers ───────────────────────────────────────────────────────

    function getTopLevelDom(node: HTMLElement): HTMLElement | null {
      const root = ed.view.dom;
      let current: HTMLElement | null = node;
      while (current && current.parentElement !== root) current = current.parentElement;
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

    // E — get the list parent DOM element's bounding rect
    function getListBounds(listParentPos: number): { top: number; bottom: number } | null {
      const listDom = ed.view.nodeDOM(listParentPos) as HTMLElement | null;
      if (!listDom) return null;
      const rect = listDom.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }

    function getBlocks(): BlockRect[] {
      const ds = dragState.current;
      if (!ds) return [];
      if (ds.cachedBlocks) return ds.cachedBlocks;
      // E — if escaped, use top-level blocks regardless of isListItem
      const blocks = (ds.isListItem && !ds.escapedList)
        ? getListItemRects(ds.listParentPos)
        : getTopLevelBlockRects();
      ds.cachedBlocks = blocks;
      return blocks;
    }

    // ── Block detection from cursor ───────────────────────────────────────

    function resolveBlockFromPoint(_clientX: number, clientY: number): {
      dragDom: HTMLElement; nodePos: number; isListItem: boolean; listParentPos: number;
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
      try { pos = ed.view.posAtDOM(targetEl, 0); }
      catch { return null; }

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
              return { dragDom: itemDom, nodePos: itemPos, isListItem: true, listParentPos: listPos };
            }
          }
        }
      }

      const topDom = getTopLevelDom(targetEl);
      if (!topDom) return null;

      let topPos: number;
      try { topPos = ed.view.posAtDOM(topDom, 0); }
      catch { return null; }

      const $topPos = doc.resolve(Math.max(0, topPos));
      const nodePos = $topPos.depth > 0 ? $topPos.before(1) : topPos;

      return { dragDom: topDom, nodePos, isListItem: false, listParentPos: -1 };
    }

    // ── Insertion math ────────────────────────────────────────────────────

    function findInsertionPos(clientY: number, blocks: BlockRect[], dragPos: number): number | null {
      if (blocks.length === 0) return null;
      const vh = window.innerHeight;
      const candidates = blocks.filter(
        (b) => b.pos !== dragPos && b.rect.bottom > 0 && b.rect.top < vh
      );
      if (candidates.length === 0) return null;
      for (let i = 0; i < candidates.length; i++) {
        const midY = candidates[i].rect.top + candidates[i].rect.height / 2;
        if (clientY < midY) return i === 0 ? null : candidates[i - 1].pos;
      }
      return candidates[candidates.length - 1].pos;
    }

    function showIndicator(blocks: BlockRect[], insertAfterPos: number | null, dragPos: number) {
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
      indicator.style.top     = `${y}px`;
      indicator.style.left    = `${editorRect.left + inset}px`;
      indicator.style.width   = `${editorRect.width - inset * 2}px`;
    }

    function hideIndicator() {
      if (indicatorRef.current) indicatorRef.current.style.display = "none";
    }

    function dimDraggedBlock(dom: HTMLElement) {
      dom.style.opacity     = "0.4";
      dom.style.transition  = "opacity 120ms ease";
      draggedDomRef.current = dom;
    }

    function undimDraggedBlock() {
      if (draggedDomRef.current) {
        draggedDomRef.current.style.opacity    = "";
        draggedDomRef.current.style.transition = "";
        draggedDomRef.current = null;
      }
    }

    // ── Auto-scroll during drag ───────────────────────────────────────────

    function onScrollDuringDrag() {
      if (dragState.current) dragState.current.cachedBlocks = null;
    }
    function attachScrollListener() {
      scrollRef.current?.addEventListener("scroll", onScrollDuringDrag, { passive: true });
    }
    function detachScrollListener() {
      scrollRef.current?.removeEventListener("scroll", onScrollDuringDrag);
    }

    function stopScrollAnim() {
      if (scrollAnimRef.current !== null) {
        cancelAnimationFrame(scrollAnimRef.current);
        scrollAnimRef.current = null;
      }
    }

    function scrollLoop() {
      const el = scrollRef.current;
      if (!el || !dragState.current?.active) { scrollAnimRef.current = null; return; }

      const clientY        = scrollClientYRef.current;
      const rect           = el.getBoundingClientRect();
      const distFromTop    = clientY - rect.top;
      const distFromBottom = rect.bottom - clientY;
      let delta = 0;
      if (distFromTop < SCROLL_ZONE && distFromTop >= 0)
        delta = -SCROLL_MAX_SPEED * (1 - distFromTop / SCROLL_ZONE);
      else if (distFromBottom < SCROLL_ZONE && distFromBottom >= 0)
        delta = SCROLL_MAX_SPEED * (1 - distFromBottom / SCROLL_ZONE);

      if (delta !== 0) {
        el.scrollTop += delta;

        const ds = dragState.current;
        if (ds) {
          ds.cachedBlocks = null;
          const blocks         = getBlocks();
          const insertAfterPos = findInsertionPos(clientY, blocks, ds.nodePos);
          ds.insertAfterPos    = insertAfterPos;
          showIndicator(blocks, insertAfterPos, ds.nodePos);
          moveGhost(ds.dragDom, clientY);
        }

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
      dragState.current     = null;
      isDraggingRef.current = false;
      hideIndicator();
      hideGhost();
      undimDraggedBlock();
      editorWrapRef.current?.classList.remove("is-dragging-block");
    }

    // ── B — hide handle during text selection ─────────────────────────────

    function onSelectionChange() {
      if (dragState.current) return; // don't interfere during drag
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) hideHandle();
    }

    // ── Event handlers ────────────────────────────────────────────────────

    function onMouseMove(e: MouseEvent) {
      // R — throttle: skip frames faster than MOUSEMOVE_THROTTLE ms
      const now = performance.now();
      const isDragging = !!dragState.current?.active;
      if (!isDragging && now - lastMoveTimeRef.current < MOUSEMOVE_THROTTLE) return;
      lastMoveTimeRef.current = now;

      const handle = handleRef.current;

      // ── Dragging ──────────────────────────────────────────────────────────
      const ds = dragState.current;
      if (ds) {
        const dx = Math.abs(e.clientX - ds.startX);
        const dy = Math.abs(e.clientY - ds.startY);

        if (!ds.thresholdMet) {
          if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
            ds.thresholdMet       = true;
            ds.active             = true;
            isDraggingRef.current = true;
            editorWrapRef.current?.classList.add("is-dragging-block");
            dimDraggedBlock(ds.dragDom);
            attachScrollListener();

            // E — cache list bounds at drag start so we can detect escape
            if (ds.isListItem) {
              ds.listBounds = getListBounds(ds.listParentPos);
            }

            initGhost(ds.dragDom);
            moveGhost(ds.dragDom, e.clientY);
          } else {
            return;
          }
        }

        if (!ds.active) return;
        tickScroll(e.clientY);
        moveGhost(ds.dragDom, e.clientY);

        // E — check if cursor has escaped the list boundary
        if (ds.isListItem && !ds.escapedList && ds.listBounds) {
          const escaped = e.clientY < ds.listBounds.top || e.clientY > ds.listBounds.bottom;
          if (escaped) {
            ds.escapedList  = true;
            ds.cachedBlocks = null; // force re-measure with top-level blocks
          }
        }

        const blocks         = getBlocks();
        const insertAfterPos = findInsertionPos(e.clientY, blocks, ds.nodePos);
        ds.insertAfterPos    = insertAfterPos;
        showIndicator(blocks, insertAfterPos, ds.nodePos);
        return;
      }

      // ── First mousemove after scroll — clear flag, skip frame ─────────────
      if (isScrollingRef.current) { isScrollingRef.current = false; return; }

      // ── Freeze loop while menu is open ────────────────────────────────────
      if (menuOpenRef.current) return;

      // ── Keep handle alive if cursor is on it ──────────────────────────────
      if (handle && (e.target === handle || handle.contains(e.target as Node))) return;

      const editorEl = editorWrapRef.current;
      if (!editorEl || !handle) return;

      const editorRect = editorEl.getBoundingClientRect();
      const handleLeft = handle.style.display !== "none"
        ? parseFloat(handle.style.left || "0")
        : editorRect.left;

      const inEditor = (
        e.clientX >= Math.min(handleLeft, editorRect.left) &&
        e.clientX <= editorRect.right &&
        e.clientY >= editorRect.top   &&
        e.clientY <= editorRect.bottom
      );

      if (!inEditor) { hideHandle(); return; }

      if (e.clientX >= editorRect.left) {
        const target = resolveBlockFromPoint(e.clientX, e.clientY);
        if (!target) { hideHandle(); return; }

        hoveredBlockRef.current = {
          dom:           target.dragDom,
          pos:           target.nodePos,
          isListItem:    target.isListItem,
          listParentPos: target.listParentPos,
        };
        scheduleShowHandle(target.dragDom);
      }
    }

    function onMouseDown(e: MouseEvent) {
      if (menuOpenRef.current) {
        const menu   = menuRef.current;
        const handle = handleRef.current;
        const target = e.target as Node;
        const clickedMenu   = menu   && (menu.contains(target)   || menu   === target);
        const clickedHandle = handle && (handle.contains(target) || handle === target);
        if (!clickedMenu && !clickedHandle) { closeMenu(); return; }
        if (clickedMenu) return;
      }

      const handleEl = (e.target as HTMLElement).closest(".drag-handle") as HTMLElement | null;
      if (!handleEl) return;

      if (e.button === 0 || e.button === 2) {
        e.preventDefault();
        e.stopPropagation();

        const hovered = hoveredBlockRef.current;
        if (!hovered) return;

        if (e.button === 0) {
          dragState.current = {
            active:         false,
            dragDom:        hovered.dom,
            nodePos:        hovered.pos,
            isListItem:     hovered.isListItem,
            listParentPos:  hovered.listParentPos,
            escapedList:    false,
            startX:         e.clientX,
            startY:         e.clientY,
            thresholdMet:   false,
            insertAfterPos: null,
            cachedBlocks:   null,
            listBounds:     null,
          };
        } else {
          openMenu(hovered.dom, hovered.pos, ed);
        }
      }
    }

    function onContextMenu(e: MouseEvent) {
      if ((e.target as HTMLElement).closest(".drag-handle")) e.preventDefault();
    }

    function onMouseUp(e: MouseEvent) {
  const ds = dragState.current;

  hideIndicator();
  hideGhost();
  undimDraggedBlock();
  detachScrollListener();
  stopScrollAnim();
  editorWrapRef.current?.classList.remove("is-dragging-block");
  isDraggingRef.current = false;
  dragState.current     = null;

  if (!ds) return;

  // ── Click without drag → open menu ──────────────────────────────────────
  if (!ds.thresholdMet) {
    const hovered = hoveredBlockRef.current;
    if (hovered) openMenu(hovered.dom, hovered.pos, ed);
    return;
  }

  if (!ds.active) return;

  const { view }  = ed;
  const { state } = view;
  const { doc }   = state;

  function refocusIfInEditor() {
    const editorEl = editorWrapRef.current;
    if (!editorEl) return;
    const rect = editorEl.getBoundingClientRect();
    if (
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top  && e.clientY <= rect.bottom
    ) view.focus();
  }

  // ── E — list item escaped: insert wrapped in its original list type ────────
if (ds.isListItem && ds.escapedList) {
  const listNode = doc.nodeAt(ds.listParentPos);
  if (!listNode) return;

  // Find the dragged list item node
  let draggedItem: PmNode | null = null;
  listNode.forEach((child: PmNode, childOffset: number) => {
    if (ds.listParentPos + 1 + childOffset === ds.nodePos) draggedItem = child;
  });
  if (!draggedItem) return;

  const itemNode   = draggedItem as PmNode;
  const { schema } = state;

  // ── Determine the correct wrapper and item node types ───────────────────
  // Walk up from the list node type name to find the matching item type.
  // taskList → taskItem, bulletList → listItem, orderedList → listItem
  const listTypeName = listNode.type.name; // "bulletList" | "orderedList" | "taskList"
  const itemTypeName = itemNode.type.name; // "listItem"   | "taskItem"

  // Preserve attrs (checked state, etc.) and full content (nested paragraphs,
  // nested lists, etc.) — don't flatten to a single paragraph.
  const newItem = schema.nodes[itemTypeName].create(
    itemNode.attrs,   // preserves checked: true/false on taskItem
    itemNode.content, // preserves everything inside the item
  );
  const wrappedList = schema.nodes[listTypeName].create(null, newItem);

  // Collect siblings — list items that are NOT the dragged one
  const siblings: PmNode[] = [];
  listNode.forEach((child: PmNode, childOffset: number) => {
    if (ds.listParentPos + 1 + childOffset !== ds.nodePos) siblings.push(child);
  });

  // Resolve where in the top-level node array to insert
  const topLevelNodes: { pos: number; node: PmNode }[] = [];
  doc.forEach((node: PmNode, pos: number) => topLevelNodes.push({ pos, node }));

  let insertAt: number;
  if (ds.insertAfterPos === null) {
    insertAt = 0;
  } else {
    const ref = topLevelNodes.find((n) => n.pos === ds.insertAfterPos);
    insertAt  = ref ? ref.pos + ref.node.nodeSize : doc.content.size;
  }

  const tr = state.tr;

  if (siblings.length === 0) {
    // List becomes empty — replace the entire list with the wrapped single item
    tr.replaceWith(ds.listParentPos, ds.listParentPos + listNode.nodeSize, wrappedList);

    // Adjust insertAt for the size difference between old list and new wrapped list
    if (insertAt > ds.listParentPos) {
      const shift = listNode.nodeSize - wrappedList.nodeSize;
      insertAt   -= shift;
    }

    // If the wrapped list didn't land where we want it, move it
    const currentPos = ds.listParentPos;
    if (insertAt !== currentPos) {
      tr.delete(currentPos, currentPos + wrappedList.nodeSize);
      const finalPos = insertAt > currentPos
        ? insertAt - wrappedList.nodeSize
        : insertAt;
      tr.insert(Math.max(0, finalPos), wrappedList);
    }
  } else {
    // List keeps remaining siblings
    // Step 1: remove the dragged item from the list
    const listContentStart = ds.listParentPos + 1;
    const listContentEnd   = ds.listParentPos + listNode.nodeSize - 1;
    tr.replaceWith(listContentStart, listContentEnd, siblings);

    // Step 2: adjust insertAt — list shrank by the dragged item's nodeSize
    if (insertAt > ds.nodePos) {
      insertAt -= itemNode.nodeSize;
    }

    // Step 3: insert the wrapped list at the resolved position
    tr.insert(Math.max(0, insertAt), wrappedList);
  }

  // Place cursor inside the first text position of the dropped item
  try {
    const resolvedInsert = siblings.length === 0
      ? Math.min(ds.listParentPos + 1, tr.doc.content.size - 1)
      : Math.min(insertAt + 1, tr.doc.content.size - 1);
    const $pos = tr.doc.resolve(Math.max(0, resolvedInsert));
    tr.setSelection(Selection.near($pos));
  } catch { /**/ }

  view.dispatch(tr);
  refocusIfInEditor();
  return;
}

  // ── List item reorder (within list) ─────────────────────────────────────
  if (ds.isListItem && !ds.escapedList) {
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
    const tr        = state.tr;
    tr.replaceWith(listStart, listEnd, reordered.map((n) => n.node));

    try {
      const finalIdx = reordered.findIndex((n) => n.node === dragged.node);
      const newPos   = ds.listParentPos + 1 +
        reordered.slice(0, finalIdx).reduce((acc, n) => acc + n.node.nodeSize, 0);
      const $pos = tr.doc.resolve(Math.min(newPos + 1, tr.doc.content.size - 1));
      tr.setSelection(Selection.near($pos));
    } catch { /**/ }

    view.dispatch(tr);
    refocusIfInEditor();
    return;
  }

  // ── Top-level block reorder ──────────────────────────────────────────────
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
  const tr            = state.tr;
  tr.replaceWith(0, doc.content.size, reordered.map((n) => n.node));

  try {
    const newPos = reordered
      .slice(0, finalInsertAt)
      .reduce((acc, n) => acc + n.node.nodeSize, 0);
    const $pos = tr.doc.resolve(Math.min(newPos + 1, tr.doc.content.size - 1));
    tr.setSelection(Selection.near($pos));
  } catch { /**/ }

  view.dispatch(tr);
  refocusIfInEditor();
}

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (menuOpenRef.current) { closeMenu(); return; }
        if (dragState.current) cancelDrag();
      }
    }

    document.addEventListener("mousemove",      onMouseMove);
    document.addEventListener("mousedown",      onMouseDown, true);
    document.addEventListener("mouseup",        onMouseUp);
    document.addEventListener("keydown",        onKeyDown);
    document.addEventListener("contextmenu",    onContextMenu, true);
    document.addEventListener("selectionchange", onSelectionChange); // B

    return () => {
      document.removeEventListener("mousemove",      onMouseMove);
      document.removeEventListener("mousedown",      onMouseDown, true);
      document.removeEventListener("mouseup",        onMouseUp);
      document.removeEventListener("keydown",        onKeyDown);
      document.removeEventListener("contextmenu",    onContextMenu, true);
      document.removeEventListener("selectionchange", onSelectionChange); // B
      cancelDrag();
      hideHandle();
      closeMenu();
    };
  }, [editor, showHandle, scheduleShowHandle, cancelShowHandleTimer, openMenu, closeMenu, menuOpenRef, menuRef]);

  return { isDraggingRef };
}