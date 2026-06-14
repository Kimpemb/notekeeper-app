// src/features/calendar/components/CalendarView.tsx

import { useEffect, useState, useCallback, forwardRef, useImperativeHandle, useRef } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { CalendarPanel } from "./CalendarPanel";

const TRANSITION_MS = 260;
const DEFAULT_WIDTH_PCT = 85;
const MIN_WIDTH_PCT     = 50;
const MAX_WIDTH_PCT     = 100;

export interface CalendarViewHandle {
  animatedClose: () => void;
}

export const CalendarView = forwardRef<CalendarViewHandle>(
  function CalendarView(_props, ref) {
    const closeCalendar = useUIStore((s) => s.closeCalendar);

    const [mounted,      setMounted]      = useState(false);
    const [widthPct,     setWidthPct]     = useState(DEFAULT_WIDTH_PCT);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isResizing,   setIsResizing]   = useState(false);

    const hasInnerModalOpen = useRef(false);
    const dragStartX        = useRef(0);
    const dragStartWidth    = useRef(0);

    useEffect(() => {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }, []);

    const handleClose = useCallback(() => {
      if (hasInnerModalOpen.current) return;
      setMounted(false);
      setTimeout(() => closeCalendar(), TRANSITION_MS);
    }, [closeCalendar]);

    useImperativeHandle(ref, () => ({ animatedClose: handleClose }), [handleClose]);

    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        handleClose();
      }
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }, [handleClose]);

    // ── Resize handle drag ──────────────────────────────────────────────────

    const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      dragStartX.current     = e.clientX;
      dragStartWidth.current = isFullscreen ? 100 : widthPct;
      setIsResizing(true);
      setIsFullscreen(false);

      function onMouseMove(ev: MouseEvent) {
        const screenW   = window.innerWidth;
        const deltaPct  = ((ev.clientX - dragStartX.current) / screenW) * 100;
        const newWidth  = Math.min(MAX_WIDTH_PCT, Math.max(MIN_WIDTH_PCT, dragStartWidth.current + deltaPct));
        setWidthPct(newWidth);
        // Snap to fullscreen when dragged to the right edge
        if (newWidth >= 98) setIsFullscreen(true);
      }

      function onMouseUp() {
        setIsResizing(false);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup",   onMouseUp);
      }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup",   onMouseUp);
    }, [widthPct, isFullscreen]);

    function toggleFullscreen() {
      if (isFullscreen) {
        setIsFullscreen(false);
        setWidthPct(DEFAULT_WIDTH_PCT);
      } else {
        setIsFullscreen(true);
      }
    }

    const effectiveWidth = isFullscreen ? "100%" : `${widthPct}%`;
    const showBackdrop   = !isFullscreen && widthPct < MAX_WIDTH_PCT;

    return (
      <>
        {/* Backdrop — clicking closes the calendar */}
        <div
          data-overlay-sentinel
          onClick={handleClose}
          style={{
            position: "fixed", inset: 0, zIndex: 49,
            background: "rgba(0,0,0,0.4)",
            opacity: mounted && showBackdrop ? 1 : 0,
            pointerEvents: showBackdrop ? "auto" : "none",
            transition: `opacity ${TRANSITION_MS}ms ease`,
          }}
        />

        {/* Panel */}
        <div
          style={{
            position:   "fixed",
            top:        0,
            left:       0,
            bottom:     0,
            width:      effectiveWidth,
            zIndex:     50,
            display:    "flex",
            flexDirection: "column",
            background: "var(--color-bg-primary, #0f0f0f)",
            transform:  mounted ? "translateX(0)" : "translateX(-100%)",
            // Disable transition while resizing so the panel tracks the cursor exactly
            transition: isResizing
              ? "none"
              : `transform ${TRANSITION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), width ${TRANSITION_MS}ms ease`,
            boxShadow:  mounted ? "4px 0 32px rgba(0,0,0,0.4)" : "none",
            // Prevent text selection during drag
            userSelect: isResizing ? "none" : "auto",
          }}
        >
          {/* ── Top-right controls ── */}
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {/* Expand / contract toggle */}
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 flex items-center justify-center rounded-md
                         text-idemora-text-muted hover:text-idemora-text-normal
                         hover:bg-idemora-bg-secondary transition-colors"
              title={isFullscreen ? "Restore default width" : "Expand to full screen"}
            >
              {isFullscreen ? (
                // Contract icon
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 1v4h4M5 13V9H1M1 5h4V1M13 9h-4v4"
                        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                // Expand icon
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9"
                        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>

            {/* Close button */}
            <button
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center rounded-md
                         text-idemora-text-muted hover:text-idemora-text-normal
                         hover:bg-idemora-bg-secondary transition-colors"
              title="Close calendar (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 2.5l9 9M11.5 2.5l-9 9"
                      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* ── Resize handle — right edge ── */}
          {!isFullscreen && (
            <div
              onMouseDown={onResizeMouseDown}
              style={{
                position:  "absolute",
                top:       0,
                right:     -4,
                bottom:    0,
                width:     8,
                zIndex:    51,
                cursor:    "ew-resize",
                // Invisible hit area; highlight on hover so user knows it's draggable
              }}
              className="group"
            >
              {/* Visual indicator line */}
              <div
                style={{
                  position:        "absolute",
                  top:             0,
                  bottom:          0,
                  left:            "50%",
                  width:           2,
                  transform:       "translateX(-50%)",
                  background:      "var(--color-border, rgba(255,255,255,0.1))",
                  opacity:         isResizing ? 1 : 0,
                  transition:      "opacity 150ms ease",
                }}
                className="group-hover:opacity-100"
              />
            </div>
          )}

          <CalendarPanel
            onInnerModalChange={(open) => { hasInnerModalOpen.current = open; }}
          />
        </div>
      </>
    );
  }
);