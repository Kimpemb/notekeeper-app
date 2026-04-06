// src/features/editor/hooks/useAutoScroll.ts
//
// Handles auto-scrolling while the user drags a block near the top or bottom
// edge of the scroll container.
//
// Game-loop approach: a requestAnimationFrame loop runs for as long as the
// cursor stays inside a scroll zone. Each frame:
//   1. Computes scroll delta based on distance from edge
//   2. Applies it to scrollRef
//   3. Invalidates the block rect cache (positions have shifted)
//   4. Recomputes insertion point and updates indicator + ghost
//
// tickScroll() is called on every drag mousemove — it starts or stops the
// rAF loop based on whether the cursor is in a scroll zone.
//
// The scroll listener (onScrollDuringDrag) is attached only while a drag is
// active, separate from the scroll-hide listener in useScrollHide.

import { useRef, useCallback } from "react";
import type { BlockRect } from "./useBlockDetection";

// ── Constants ─────────────────────────────────────────────────────────────────

const SCROLL_ZONE      = 80;
const SCROLL_MAX_SPEED = 16;

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseAutoScrollOptions {
  scrollRef:     React.RefObject<HTMLDivElement | null>;
  dragStateRef:  React.RefObject<{ active: boolean; cachedBlocks: BlockRect[] | null; nodePos: number; insertAfterPos: number | null } | null>;
  getBlocks:     () => BlockRect[];
  findInsertionPos: (clientY: number, blocks: BlockRect[], dragPos: number) => number | null;
  showIndicator: (blocks: BlockRect[], insertAfterPos: number | null, dragPos: number) => void;
  moveGhost:     (dom: HTMLElement, clientY: number) => void;
}

interface UseAutoScrollResult {
  scrollAnimRef:       React.RefObject<number | null>;
  tickScroll:          (clientY: number) => void;
  stopScrollAnim:      () => void;
  attachScrollListener: () => void;
  detachScrollListener: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAutoScroll({
  scrollRef,
  dragStateRef,
  getBlocks,
  findInsertionPos,
  showIndicator,
  moveGhost,
}: UseAutoScrollOptions): UseAutoScrollResult {

  const scrollAnimRef    = useRef<number | null>(null);
  const scrollClientYRef = useRef<number>(0);

  // ── stopScrollAnim ────────────────────────────────────────────────────────

  const stopScrollAnim = useCallback(() => {
    if (scrollAnimRef.current !== null) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
  }, []);

  // ── scrollLoop ────────────────────────────────────────────────────────────
  // rAF loop — runs only while cursor is in a scroll zone during a drag.
  // Each frame scrolls by a speed proportional to proximity to the edge.

  const scrollLoop = useCallback(() => {
    const el = scrollRef.current;
    const ds = dragStateRef.current;
    if (!el || !ds?.active) { scrollAnimRef.current = null; return; }

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

      // Rects have shifted — invalidate cache and recompute indicator
      ds.cachedBlocks      = null;
      const blocks         = getBlocks();
      const insertAfterPos = findInsertionPos(clientY, blocks, ds.nodePos);
      ds.insertAfterPos    = insertAfterPos;
      showIndicator(blocks, insertAfterPos, ds.nodePos);
      moveGhost(ds.dragDom as HTMLElement, clientY);

      scrollAnimRef.current = requestAnimationFrame(scrollLoop);
    } else {
      scrollAnimRef.current = null;
    }
  }, [scrollRef, dragStateRef, getBlocks, findInsertionPos, showIndicator, moveGhost]);

  // ── tickScroll ────────────────────────────────────────────────────────────
  // Called on every drag mousemove. Starts the rAF loop if the cursor enters
  // a scroll zone, stops it if the cursor leaves.

  const tickScroll = useCallback((clientY: number) => {
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
  }, [scrollRef, scrollLoop, stopScrollAnim]);

  // ── onScrollDuringDrag ────────────────────────────────────────────────────
  // Attached to the scroll container only while a drag is active.
  // Invalidates the block rect cache when the container scrolls (e.g. via
  // keyboard or trackpad) outside of the rAF loop.

  const onScrollDuringDrag = useCallback(() => {
    if (dragStateRef.current) dragStateRef.current.cachedBlocks = null;
  }, [dragStateRef]);

  // ── attach / detach ───────────────────────────────────────────────────────

  const attachScrollListener = useCallback(() => {
    scrollRef.current?.addEventListener("scroll", onScrollDuringDrag, { passive: true });
  }, [scrollRef, onScrollDuringDrag]);

  const detachScrollListener = useCallback(() => {
    scrollRef.current?.removeEventListener("scroll", onScrollDuringDrag);
  }, [scrollRef, onScrollDuringDrag]);

  return {
    scrollAnimRef,
    tickScroll,
    stopScrollAnim,
    attachScrollListener,
    detachScrollListener,
  };
}