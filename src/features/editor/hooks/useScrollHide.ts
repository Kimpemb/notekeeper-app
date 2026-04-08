// src/features/editor/hooks/useScrollHide.ts
//
// Hides the drag handle, + button, and block highlight whenever the user
// scrolls — whether via the scrollable container or the mouse wheel anywhere
// on the page.
//
// Restoring visibility is intentionally NOT done here. Only onMouseMove in
// useDragReorder restores the handle, ensuring it always reflects where the
// cursor actually is after the page settles.

import { useEffect, useRef } from "react";

interface UseScrollHideOptions {
  scrollRef:            React.RefObject<HTMLDivElement | null>;
  gripRef:              React.RefObject<HTMLDivElement | null>;
  insertRef:            React.RefObject<HTMLDivElement | null>;
  highlightRef:         React.RefObject<HTMLDivElement | null>;   // T1-1
  hoveredBlockRef:      React.RefObject<{ dom: HTMLElement; pos: number; isListItem: boolean; listParentPos: number } | null>;
  showHandleTimerRef:   React.RefObject<ReturnType<typeof setTimeout> | null>;
  menuOpenRef:          React.RefObject<boolean>;
  closeMenu:            () => void;
}

interface UseScrollHideResult {
  isScrollingRef: React.RefObject<boolean>;
}

export function useScrollHide({
  scrollRef,
  gripRef,
  insertRef,
  highlightRef,
  hoveredBlockRef,
  showHandleTimerRef,
  menuOpenRef,
  closeMenu,
}: UseScrollHideOptions): UseScrollHideResult {

  const isScrollingRef    = useRef<boolean>(false);
  const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onScroll() {
      // Cancel any pending show-handle timer immediately
      if (showHandleTimerRef.current !== null) {
        clearTimeout(showHandleTimerRef.current);
        showHandleTimerRef.current = null;
      }

      // Close menu if open
      if (menuOpenRef.current) closeMenu();

      // Hide all three handle elements
      if (gripRef.current)      gripRef.current.style.display      = "none";
      if (insertRef.current)    insertRef.current.style.display    = "none";
      if (highlightRef.current) highlightRef.current.style.display = "none"; // T1-1

      // Clear hovered block — stale after scroll
      hoveredBlockRef.current = null;

      // Mark scrolling active
      isScrollingRef.current = true;

      // Reset the debounce timer — only clears the flag, never re-shows handle
      if (scrollEndTimerRef.current !== null) clearTimeout(scrollEndTimerRef.current);
      scrollEndTimerRef.current = setTimeout(() => {
        isScrollingRef.current    = false;
        scrollEndTimerRef.current = null;
      }, 300);
    }

    // scroll  — catches scrollbar drag and keyboard scroll on the container
    // wheel   — catches mouse wheel over the text area and gutter
    el.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("wheel", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      document.removeEventListener("wheel", onScroll);
      if (scrollEndTimerRef.current !== null) clearTimeout(scrollEndTimerRef.current);
    };
  // Refs are stable object identities and will never trigger a re-run.
  // closeMenu is the only value here that could change between renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeMenu]);

  return { isScrollingRef };
}