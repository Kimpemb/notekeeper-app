// src/features/editor/hooks/useHandleElements.ts
//
// Owns every piece of DOM that the drag handle system renders:
//   - grip (⠿)         — the draggable dots
//   - insert (+)        — the insert-block button
//   - highlight         — light wash over the hovered block (T1-1)
//   - indicator         — the drop position line
//   - ghost             — the semi-transparent drag preview
//
// Also owns:
//   - showHandle / scheduleShowHandle / cancelShowHandleTimer
//   - showIndicator / hideIndicator
//   - initGhost / moveGhost / hideGhost
//   - dimDraggedBlock / undimDraggedBlock
//   - findInsertionPos
//   - ResizeObserver that re-snaps handle when editor column shifts
//
// JS owns all position values. drag-handle.css is appearance only.

import { useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import type { BlockRect } from "./useBlockDetection";

// ── Constants ─────────────────────────────────────────────────────────────────

const SHOW_HANDLE_DELAY = 30;

// ── Types ─────────────────────────────────────────────────────────────────────

export type HoveredBlock = {
  dom:           HTMLElement;
  pos:           number;
  isListItem:    boolean;
  listParentPos: number;
};

interface UseHandleElementsOptions {
  editorRef:           React.RefObject<Editor | null>;
  editorTextColumnRef: React.RefObject<HTMLDivElement | null>;
  editorWrapRef:       React.RefObject<HTMLDivElement | null>;
  hoveredBlockRef:     React.RefObject<HoveredBlock | null>;
  isScrollingRef:      React.RefObject<boolean>;
  menuOpenRef:         React.RefObject<boolean>;
  getEditorLeft:       () => number;
}

interface UseHandleElementsResult {
  gripRef:              React.RefObject<HTMLDivElement | null>;
  insertRef:            React.RefObject<HTMLDivElement | null>;
  indicatorRef:         React.RefObject<HTMLDivElement | null>;
  ghostRef:             React.RefObject<HTMLDivElement | null>;
  highlightRef:         React.RefObject<HTMLDivElement | null>;   // T1-1
  draggedDomRef:        React.RefObject<HTMLElement | null>;
  showHandleTimerRef:   React.RefObject<ReturnType<typeof setTimeout> | null>;
  showHandle:           (dom: HTMLElement) => void;
  scheduleShowHandle:   (dom: HTMLElement) => void;
  cancelShowHandleTimer: () => void;
  hideHandle:           () => void;
  showIndicator:        (blocks: BlockRect[], insertAfterPos: number | null, dragPos: number) => void;
  hideIndicator:        () => void;
  findInsertionPos:     (clientY: number, blocks: BlockRect[], dragPos: number) => number | null;
  initGhost:            (dom: HTMLElement) => void;
  moveGhost:            (dom: HTMLElement, clientY: number) => void;
  hideGhost:            () => void;
  dimDraggedBlock:      (dom: HTMLElement) => void;
  undimDraggedBlock:    () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useHandleElements({
  editorRef,
  editorTextColumnRef,
  editorWrapRef,
  hoveredBlockRef,
  isScrollingRef,
  menuOpenRef,
  getEditorLeft,
}: UseHandleElementsOptions): UseHandleElementsResult {

  const gripRef            = useRef<HTMLDivElement | null>(null);
  const insertRef          = useRef<HTMLDivElement | null>(null);
  const indicatorRef       = useRef<HTMLDivElement | null>(null);
  const ghostRef           = useRef<HTMLDivElement | null>(null);
  const highlightRef       = useRef<HTMLDivElement | null>(null);   // T1-1
  const draggedDomRef      = useRef<HTMLElement | null>(null);
  const showHandleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── showHandle ────────────────────────────────────────────────────────────
  // T1-2: grip spacing increased from -28 to -36 (8 px extra breathing room)

  const showHandle = useCallback((dom: HTMLElement) => {
    const grip      = gripRef.current;
    const insert    = insertRef.current;
    const highlight = highlightRef.current;
    if (!grip || !insert) return;

    const rect       = dom.getBoundingClientRect();
    const gripLeft   = getEditorLeft() - 36;  // T1-2: was -28, now -36
    const insertLeft = gripLeft - 20;         // + sits left of grip

    grip.style.display  = "flex";
    grip.style.left     = `${gripLeft}px`;
    grip.style.top      = `${rect.top + 4}px`;

    insert.style.display = "flex";
    insert.style.left    = `${insertLeft}px`;
    insert.style.top     = `${rect.top + 4}px`;

    // T1-1: position highlight flush behind the block, edge-to-edge with editor
    if (highlight) {
      const editorEl = editorWrapRef.current;
      if (editorEl) {
        const editorRect = editorEl.getBoundingClientRect();
        const inset      = 4; // small breathing gap so it doesn't bleed to viewport edge
        highlight.style.display = "block";
        highlight.style.top     = `${rect.top}px`;
        highlight.style.left    = `${editorRect.left + inset}px`;
        highlight.style.width   = `${editorRect.width - inset * 2}px`;
        highlight.style.height  = `${rect.height}px`;
      }
    }
  }, [getEditorLeft, editorWrapRef]);

  // ── scheduleShowHandle ────────────────────────────────────────────────────

  const cancelShowHandleTimer = useCallback(() => {
    if (showHandleTimerRef.current !== null) {
      clearTimeout(showHandleTimerRef.current);
      showHandleTimerRef.current = null;
    }
  }, []);

  const scheduleShowHandle = useCallback((dom: HTMLElement) => {
    cancelShowHandleTimer();
    showHandleTimerRef.current = setTimeout(() => {
      showHandleTimerRef.current = null;
      if (!isScrollingRef.current) showHandle(dom);
    }, SHOW_HANDLE_DELAY);
  }, [showHandle, cancelShowHandleTimer, isScrollingRef]);

  // ── hideHandle ────────────────────────────────────────────────────────────

  const hideHandle = useCallback(() => {
    cancelShowHandleTimer();
    if (gripRef.current)      gripRef.current.style.display      = "none";
    if (insertRef.current)    insertRef.current.style.display    = "none";
    if (highlightRef.current) highlightRef.current.style.display = "none"; // T1-1
    hoveredBlockRef.current = null;
  }, [cancelShowHandleTimer, hoveredBlockRef]);

  // ── findInsertionPos ──────────────────────────────────────────────────────

  const findInsertionPos = useCallback((
    clientY: number,
    blocks:  BlockRect[],
    dragPos: number,
  ): number | null => {
    if (blocks.length === 0) return null;
    const vh = window.innerHeight;
    const candidates = blocks.filter(
      (b) => b.pos !== dragPos && b.rect.bottom > 0 && b.rect.top < vh
    );
    if (candidates.length === 0) return null;
    for (let i = 0; i < candidates.length; i++) {
      const midY = candidates[i].rect.top;
      if (clientY < midY) return i === 0 ? null : candidates[i - 1].pos;
    }
    return candidates[candidates.length - 1].pos;
  }, []);

  // ── showIndicator ─────────────────────────────────────────────────────────

  const showIndicator = useCallback((
    blocks:         BlockRect[],
    insertAfterPos: number | null,
    dragPos:        number,
  ) => {
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
  }, [editorWrapRef]);

  // ── hideIndicator ─────────────────────────────────────────────────────────

  const hideIndicator = useCallback(() => {
    if (indicatorRef.current) indicatorRef.current.style.display = "none";
  }, []);

  // ── Ghost helpers ─────────────────────────────────────────────────────────

  const initGhost = useCallback((dom: HTMLElement) => {
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
  }, []);

  const moveGhost = useCallback((dom: HTMLElement, clientY: number) => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    const blockRect = dom.getBoundingClientRect();
    ghost.style.display = "block";
    ghost.style.left    = `${getEditorLeft()}px`;
    ghost.style.top     = `${clientY - blockRect.height / 2}px`;
  }, [getEditorLeft]);

  const hideGhost = useCallback(() => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    ghost.style.display = "none";
    ghost.innerHTML     = "";
  }, []);

  // ── dimDraggedBlock / undimDraggedBlock ───────────────────────────────────

  const dimDraggedBlock = useCallback((dom: HTMLElement) => {
    dom.style.opacity     = "0.4";
    dom.style.transition  = "opacity 120ms ease";
    draggedDomRef.current = dom;
  }, []);

  const undimDraggedBlock = useCallback(() => {
    if (draggedDomRef.current) {
      draggedDomRef.current.style.opacity    = "";
      draggedDomRef.current.style.transition = "";
      draggedDomRef.current = null;
    }
  }, []);

  // ── Mount: create DOM elements ────────────────────────────────────────────

  useEffect(() => {

    // ── Drop indicator ───────────────────────────────────────────────────
    const indicator = document.createElement("div");
    indicator.style.cssText = [
      "display:none", "position:fixed", "height:2px",
      "background:rgba(59,130,246,0.75)", "border-radius:1px",
      "pointer-events:none", "z-index:9999", "transform:translateY(-1px)",
    ].join(";");
    document.body.appendChild(indicator);
    indicatorRef.current = indicator;

    // ── T1-1: Block highlight ────────────────────────────────────────────
    // Sits behind everything (z-index:50) — below the grip and insert button.
    // pointer-events:none so it doesn't interfere with mouse hit-testing.
    const highlight = document.createElement("div");
    highlight.className     = "drag-handle-highlight";
    highlight.style.cssText = [
      "display:none", "position:fixed", "z-index:50",
      "pointer-events:none",
      "border-radius:4px",
      // Light mode: very subtle warm grey wash
      "background:rgba(0,0,0,0.035)",
      "transition:top 10ms ease, height 10ms ease",
    ].join(";");
    document.body.appendChild(highlight);
    highlightRef.current = highlight;

    // ── Grip (⠿) ─────────────────────────────────────────────────────────
    const grip = document.createElement("div");
    grip.className = "drag-handle-grip";
    grip.setAttribute("data-drag-handle", "");
    grip.setAttribute("title", "Drag to move, click to open menu");
    grip.style.cssText = [
      "display:none", "position:fixed", "z-index:100",
      "width:20px", "height:24px",
      "align-items:center", "justify-content:center",
      "border-radius:4px", "cursor:grab",
      "color:#c4c4c4", "background:transparent", "user-select:none",
    ].join(";");
    grip.innerHTML = `
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <circle cx="2.5" cy="2.5"  r="1.5"/>
        <circle cx="7.5" cy="2.5"  r="1.5"/>
        <circle cx="2.5" cy="7"    r="1.5"/>
        <circle cx="7.5" cy="7"    r="1.5"/>
        <circle cx="2.5" cy="11.5" r="1.5"/>
        <circle cx="7.5" cy="11.5" r="1.5"/>
      </svg>
    `;
    grip.addEventListener("mouseenter", () => {
      if (menuOpenRef.current) return;
      grip.style.color      = "#9ca3af";
      grip.style.background = "rgba(0,0,0,0.06)";
    });
    grip.addEventListener("mouseleave", () => {
      if (menuOpenRef.current) return;
      grip.style.color      = "#c4c4c4";
      grip.style.background = "transparent";
    });
    document.body.appendChild(grip);
    gripRef.current = grip;

    // ── Insert (+) button ────────────────────────────────────────────────
    const insert = document.createElement("div");
    insert.className = "drag-handle-insert";
    insert.setAttribute("data-insert-btn", "");
    insert.setAttribute("title", "Click to add below, Alt+click to add above");
    insert.style.cssText = [
      "display:none", "position:fixed", "z-index:100",
      "width:20px", "height:24px",
      "align-items:center", "justify-content:center",
      "border-radius:4px", "cursor:pointer",
      "color:#c4c4c4", "background:transparent", "user-select:none",
    ].join(";");
    insert.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `;
    insert.addEventListener("mouseenter", () => {
      insert.style.color      = "#9ca3af";
      insert.style.background = "rgba(0,0,0,0.06)";
    });
    insert.addEventListener("mouseleave", () => {
      insert.style.color      = "#c4c4c4";
      insert.style.background = "transparent";
    });
    insert.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();

      const hovered = hoveredBlockRef.current;
      const ed      = editorRef.current;
      if (!hovered || !ed) return;

      const { state, view } = ed;
      const hoveredNode = state.doc.nodeAt(hovered.pos);
      if (!hoveredNode) return;

      // Alt+click — insert above
      if (e.altKey) {
        const tr = state.tr.insert(hovered.pos, state.schema.nodes.paragraph.create());
        try {
          const $pos = tr.doc.resolve(hovered.pos + 1);
          tr.setSelection(Selection.near($pos));
        } catch { /**/ }
        view.dispatch(tr);
        view.focus();
        return;
      }

      // Default — insert below
      const insertPos = hovered.pos + hoveredNode.nodeSize;
      const tr = state.tr.insert(insertPos, state.schema.nodes.paragraph.create());
      try {
        const $pos = tr.doc.resolve(insertPos + 1);
        tr.setSelection(Selection.near($pos));
      } catch { /**/ }
      view.dispatch(tr);
      view.focus();
    });
    document.body.appendChild(insert);
    insertRef.current = insert;

    // ── Ghost preview ────────────────────────────────────────────────────
    const ghost = document.createElement("div");
    ghost.className     = "drag-ghost";
    ghost.style.display = "none";
    document.body.appendChild(ghost);
    ghostRef.current = ghost;

    // ── ResizeObserver — re-snap when editor column shifts ───────────────
    const colEl = editorTextColumnRef.current;
    let ro: ResizeObserver | null = null;
    if (colEl) {
      ro = new ResizeObserver(() => {
        const hovered = hoveredBlockRef.current;
        if (hovered && gripRef.current?.style.display !== "none") {
          showHandle(hovered.dom);
        }
      });
      ro.observe(colEl);
    }

    return () => {
      ro?.disconnect();
      indicator.remove();
      highlight.remove();
      grip.remove();
      insert.remove();
      ghost.remove();
      indicatorRef.current  = null;
      highlightRef.current  = null;
      gripRef.current       = null;
      insertRef.current     = null;
      ghostRef.current      = null;
    };
  }, [
    editorRef,
    editorTextColumnRef,
    hoveredBlockRef,
    menuOpenRef,
    showHandle,
  ]);

  return {
    gripRef,
    insertRef,
    indicatorRef,
    ghostRef,
    highlightRef,
    draggedDomRef,
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
  };
}