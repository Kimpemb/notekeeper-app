// src/features/calendar/components/CalendarView.tsx

import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { CalendarPanel } from "./CalendarPanel";

const TRANSITION_MS = 260;

export interface CalendarViewHandle {
  animatedClose: () => void;
}

export const CalendarView = forwardRef<CalendarViewHandle>(
  function CalendarView(_props, ref) {
    const closeCalendar = useUIStore((s) => s.closeCalendar);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }, []);

    const handleClose = useCallback(() => {
      setMounted(false);
      setTimeout(() => closeCalendar(), TRANSITION_MS);
    }, [closeCalendar]);

    useImperativeHandle(ref, () => ({ animatedClose: handleClose }), [handleClose]);

    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        if (e.key === "Escape") handleClose();
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [handleClose]);

    return (
      <>
        {/* Backdrop */}
        <div
          data-overlay-sentinel
          onClick={handleClose}
          style={{
            position: "fixed", inset: 0, zIndex: 49,
            background: "rgba(0,0,0,0.4)",
            opacity: mounted ? 1 : 0,
            transition: `opacity ${TRANSITION_MS}ms ease`,
          }}
        />

        {/* Panel */}
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            display: "flex", flexDirection: "column",
            background: "var(--color-bg-primary, #0f0f0f)",
            opacity: mounted ? 1 : 0,
            transform: mounted ? "scale(1)" : "scale(0.98)",
            transition: `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
          }}
        >
          {/* Close button */}
          <button
            onClick={handleClose}
            style={{ position: "absolute", top: 12, right: 16, zIndex: 10 }}
            className="w-8 h-8 flex items-center justify-center rounded-md
                       text-idemora-text-muted hover:text-idemora-text-normal
                       hover:bg-idemora-bg-secondary transition-colors"
            title="Close calendar (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>

          <CalendarPanel />
        </div>
      </>
    );
  }
);