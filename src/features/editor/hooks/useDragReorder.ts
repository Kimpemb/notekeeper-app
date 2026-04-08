// src/features/editor/hooks/useDragReorder.ts
//
// Orchestrator — wires all drag handle sub-hooks together and owns the
// document-level event loop.
//
// Game-dev approach: DOM first, ProseMirror positions last.
//   mousemove  → find block under cursor → position handle
//   mousedown  → if handle clicked → begin drag or open menu (right-click)
//   mousemove  → find insertion point from visible block rects
//   mouseup    → if no drag threshold met → open block action menu
//            → if drag → convert to PM positions → dispatch targeted transaction
//
// Sub-hook responsibilities:
//   useScrollHide          — hides handle on scroll/wheel, owns isScrollingRef
//   useBlockDetection      — resolves blocks from cursor position, caches rects
//   useHandleElements      — owns all DOM elements, showHandle, indicator, ghost
//   useAutoScroll          — rAF scroll loop during drag
//   useReorderTransaction  — all ProseMirror dispatch branches
//   useBlockMenu           — block action menu (existing hook, unchanged)

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { BlockRect } from "./useBlockDetection";
import { useBlockDetection }     from "./useBlockDetection";
import { useHandleElements }     from "./useHandleElements";
import { useAutoScroll }         from "./useAutoScroll";
import { useReorderTransaction } from "./useReorderTransaction";
import { useScrollHide }         from "./useScrollHide";
import { useBlockMenu }          from "./useBlockMenu";

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

type DragState = {
  active:         boolean;
  dragDom:        HTMLElement;
  nodePos:        number;
  isListItem:     boolean;
  listParentPos:  number;
  escapedList:    boolean;
  startX:         number;
  startY:         number;
  thresholdMet:   boolean;
  insertAfterPos: number | null;
  cachedBlocks:   BlockRect[] | null;
  listBounds:     { top: number; bottom: number } | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DRAG_THRESHOLD     = 6;
const MOUSEMOVE_THROTTLE = 16; // ~1 frame at 60 fps

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDragReorder({
  editor,
  scrollRef,
  editorWrapRef,
  editorTextColumnRef,
  getEditorLeft,
}: UseDragReorderOptions): UseDragReorderResult {

  const editorRef      = useRef<Editor | null>(null);
  const isDraggingRef  = useRef<boolean>(false);
  const lastMoveTimeRef = useRef<number>(0);
  const dragState      = useRef<DragState | null>(null);

  const hoveredBlockRef = useRef<{
    dom:           HTMLElement;
    pos:           number;
    isListItem:    boolean;
    listParentPos: number;
  } | null>(null);

  // ── Block action menu ─────────────────────────────────────────────────────

  const { menuRef, menuOpenRef, openMenu, closeMenu } = useBlockMenu({
    handleRef: { current: null } as React.RefObject<HTMLDivElement | null>,
    editorWrapRef,
  });

  // ── Handle elements — DOM, showHandle, indicator, ghost ───────────────────

  const {
    gripRef,
    insertRef,
    highlightRef,
    showHandleTimerRef,
    showHandle,
    scheduleShowHandle,
    cancelShowHandleTimer,
    hideHandle,
    showIndicator,
    hideIndicator,
    findInsertionPos,
    initGhost,
    moveGhost,
    hideGhost,
    dimDraggedBlock,
    undimDraggedBlock,
  } = useHandleElements({
    editorRef,
    editorTextColumnRef,
    editorWrapRef,
    hoveredBlockRef,
    isScrollingRef: { current: false } as React.RefObject<boolean>, // replaced below
    menuOpenRef,
    getEditorLeft,
  });

  // ── Scroll hide — hides handle on scroll/wheel ────────────────────────────

  const { isScrollingRef } = useScrollHide({
    scrollRef,
    gripRef,
    insertRef,
    highlightRef,  // T1-1: also hide highlight on scroll
    hoveredBlockRef,
    showHandleTimerRef,
    menuOpenRef,
    closeMenu,
  });

  // ── Block detection — resolves blocks from cursor ─────────────────────────

  const {
    resolveBlockFromPoint,
    getListBounds,
    getBlocks,
  } = useBlockDetection({
    editorRef,
    dragStateRef: dragState,
  });

  // ── Reorder transaction — ProseMirror dispatch ────────────────────────────

  const { dispatchReorder } = useReorderTransaction({
    editorRef,
    editorWrapRef,
  });

  // ── Auto-scroll — rAF loop during drag ───────────────────────────────────

  const {
    tickScroll,
    stopScrollAnim,
    attachScrollListener,
    detachScrollListener,
  } = useAutoScroll({
    scrollRef,
    dragStateRef: dragState,
    getBlocks,
    findInsertionPos,
    showIndicator,
    moveGhost,
  });

  // ── cancelDrag ────────────────────────────────────────────────────────────

  function cancelDrag() {
    detachScrollListener();
    stopScrollAnim();
    dragState.current     = null;
    isDraggingRef.current = false;
    hideIndicator();
    hideGhost();
    undimDraggedBlock();
    // Ensure highlight is hidden when a drag is cancelled mid-motion
    if (highlightRef.current) highlightRef.current.style.display = "none";
    editorWrapRef.current?.classList.remove("is-dragging-block");
  }

  // ── Main event loop ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor;

    // ── B — hide handle during text selection ───────────────────────────
    function onSelectionChange() {
      if (dragState.current) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) hideHandle();
    }

    // ── onMouseMove ──────────────────────────────────────────────────────
    function onMouseMove(e: MouseEvent) {
      const now        = performance.now();
      const isDragging = !!dragState.current?.active;
      if (!isDragging && now - lastMoveTimeRef.current < MOUSEMOVE_THROTTLE) return;
      lastMoveTimeRef.current = now;

      // ── Active drag ────────────────────────────────────────────────────
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
            if (insertRef.current) insertRef.current.style.display = "none";
            // Hide highlight during active drag — indicator takes over
            if (highlightRef.current) highlightRef.current.style.display = "none";
            dimDraggedBlock(ds.dragDom);
            attachScrollListener();

            if (ds.isListItem) ds.listBounds = getListBounds(ds.listParentPos);

            initGhost(ds.dragDom);
            moveGhost(ds.dragDom, e.clientY);
          } else {
            return;
          }
        }

        if (!ds.active) return;
        tickScroll(e.clientY);
        moveGhost(ds.dragDom, e.clientY);

        // Detect list escape
        if (ds.isListItem && !ds.escapedList && ds.listBounds) {
          const escaped = e.clientY < ds.listBounds.top || e.clientY > ds.listBounds.bottom;
          if (escaped) {
            ds.escapedList  = true;
            ds.cachedBlocks = null;
          }
        }

        const blocks         = getBlocks();
        const insertAfterPos = findInsertionPos(e.clientY, blocks, ds.nodePos);
        ds.insertAfterPos    = insertAfterPos;
        showIndicator(blocks, insertAfterPos, ds.nodePos);
        return;
      }

      // ── Suppress handle while scrolling ───────────────────────────────
      if (isScrollingRef.current) return;

      // ── Freeze loop while menu is open ─────────────────────────────────
      if (menuOpenRef.current) return;

      // ── Keep both elements alive if cursor is on either ────────────────
      const grip   = gripRef.current;
      const insert = insertRef.current;
      const overGrip   = grip   && (e.target === grip   || grip.contains(e.target as Node));
      const overInsert = insert && (e.target === insert || insert.contains(e.target as Node));
      if (overGrip || overInsert) return;

      const editorEl = editorWrapRef.current;
      if (!editorEl || !grip) return;

      const editorRect = editorEl.getBoundingClientRect();

      // Gutter zone: from just beyond the + button left edge to editor right
      // gripLeft   = getEditorLeft() - 36 (T1-2)
      // insertLeft = gripLeft - 20
      // + 8px breathing room
      const gutterLeft = getEditorLeft() - 64; // updated to match new grip position

      const inZone = (
        e.clientX >= gutterLeft        &&
        e.clientX <= editorRect.right  &&
        e.clientY >= editorRect.top    &&
        e.clientY <= editorRect.bottom
      );

      if (!inZone) { hideHandle(); return; }

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

    // ── onMouseDown ───────────────────────────────────────────────────────
    function onMouseDown(e: MouseEvent) {
      if (menuOpenRef.current) {
        const menu   = menuRef.current;
        const grip   = gripRef.current;
        const target = e.target as Node;
        const clickedMenu   = menu && (menu.contains(target) || menu === target);
        const clickedHandle = grip && (grip.contains(target) || grip === target);
        if (!clickedMenu && !clickedHandle) { closeMenu(); return; }
        if (clickedMenu) return;
      }

      // Insert button has its own click listener
      if ((e.target as HTMLElement).closest("[data-insert-btn]")) return;

      const gripEl = (e.target as HTMLElement).closest("[data-drag-handle]") as HTMLElement | null;
      if (!gripEl) return;

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
          if (editor) openMenu(hovered.dom, hovered.pos, editor);
        }
      }
    }

    // ── onContextMenu ─────────────────────────────────────────────────────
    function onContextMenu(e: MouseEvent) {
      if ((e.target as HTMLElement).closest("[data-drag-handle]")) e.preventDefault();
    }

    // ── onMouseUp ─────────────────────────────────────────────────────────
    function onMouseUp(e: MouseEvent) {
      const ds = dragState.current;

      hideIndicator();
      hideGhost();
      undimDraggedBlock();
      // Restore highlight visibility on mouse up (hideHandle clears it on move-away)
      if (highlightRef.current) highlightRef.current.style.display = "none";
      detachScrollListener();
      stopScrollAnim();
      editorWrapRef.current?.classList.remove("is-dragging-block");
      isDraggingRef.current = false;
      dragState.current     = null;

      if (!ds) return;

      // Click without drag → open menu
      if (!ds.thresholdMet) {
        const hovered = hoveredBlockRef.current;
        if (hovered && editor) openMenu(hovered.dom, hovered.pos, editor);
        return;
      }

      if (!ds.active) return;

      dispatchReorder(
        {
          dragDom:        ds.dragDom,
          nodePos:        ds.nodePos,
          isListItem:     ds.isListItem,
          listParentPos:  ds.listParentPos,
          escapedList:    ds.escapedList,
          insertAfterPos: ds.insertAfterPos,
        },
        e.clientX,
        e.clientY,
      );
    }

    // ── onKeyDown ─────────────────────────────────────────────────────────
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (menuOpenRef.current) { closeMenu(); return; }
        if (dragState.current) cancelDrag();
      }
    }

    document.addEventListener("mousemove",       onMouseMove);
    document.addEventListener("mousedown",       onMouseDown, true);
    document.addEventListener("mouseup",         onMouseUp);
    document.addEventListener("keydown",         onKeyDown);
    document.addEventListener("contextmenu",     onContextMenu, true);
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      document.removeEventListener("mousemove",       onMouseMove);
      document.removeEventListener("mousedown",       onMouseDown, true);
      document.removeEventListener("mouseup",         onMouseUp);
      document.removeEventListener("keydown",         onKeyDown);
      document.removeEventListener("contextmenu",     onContextMenu, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      cancelDrag();
      hideHandle();
      closeMenu();
    };
  }, [
    editor,
    showHandle,
    scheduleShowHandle,
    cancelShowHandleTimer,
    hideHandle,
    showIndicator,
    hideIndicator,
    findInsertionPos,
    initGhost,
    moveGhost,
    hideGhost,
    dimDraggedBlock,
    undimDraggedBlock,
    resolveBlockFromPoint,
    getListBounds,
    getBlocks,
    tickScroll,
    stopScrollAnim,
    attachScrollListener,
    detachScrollListener,
    dispatchReorder,
    openMenu,
    closeMenu,
    menuOpenRef,
    menuRef,
    gripRef,
    insertRef,
    highlightRef,
    isScrollingRef,
    getEditorLeft,
  ]);

  return { isDraggingRef };
}