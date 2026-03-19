// src/features/ui/components/SplitDivider.tsx
//
// The bar rendered between pane 1 and pane 2 when a split is open.
// Contains three controls:
//   ↕ / ↔  — toggle between vertical (top/bottom) and horizontal (side by side)
//   ⇄       — swap the contents of pane 1 and pane 2
//   ✕       — close pane 2

import { useUIStore } from "@/features/ui/store/useUIStore";

export function SplitDivider() {
  const splitDirection      = useUIStore((s) => s.splitDirection);
  const toggleSplitDirection = useUIStore((s) => s.toggleSplitDirection);
  const swapPanes           = useUIStore((s) => s.swapPanes);
  const closePane2          = useUIStore((s) => s.closePane2);

  const isHorizontal = splitDirection === "horizontal";

  // The divider sits between two flex children.
  // In horizontal mode it's a vertical bar (thin, full height).
  // In vertical mode it's a horizontal bar (thin, full width).
  const dividerClass = isHorizontal
    ? "flex flex-col items-center justify-center w-6 shrink-0 h-full border-x border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 gap-1.5 py-2"
    : "flex flex-row items-center justify-center h-6 shrink-0 w-full border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 gap-1.5 px-2";

  const btnClass = "flex items-center justify-center w-4 h-4 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-100";

  return (
    <div className={dividerClass}>
      {/* Toggle orientation */}
      <button
        onClick={toggleSplitDirection}
        title={isHorizontal ? "Switch to top/bottom split" : "Switch to side-by-side split"}
        className={btnClass}
      >
        {isHorizontal ? (
          // Horizontal split active → show vertical split icon
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
            <path d="M0.5 5.5h10" stroke="currentColor" strokeWidth="1.1"/>
          </svg>
        ) : (
          // Vertical split active → show horizontal split icon
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
            <path d="M5.5 0.5v10" stroke="currentColor" strokeWidth="1.1"/>
          </svg>
        )}
      </button>

      {/* Swap panes */}
      <button
        onClick={swapPanes}
        title="Swap panes"
        className={btnClass}
      >
        {isHorizontal ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1 3.5h9M7.5 1.5l2 2-2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 7.5H1M3.5 5.5l-2 2 2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M3.5 1v9M1.5 7.5l2 2 2-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7.5 10V1M5.5 3.5l2-2 2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Close pane 2 */}
      <button
        onClick={closePane2}
        title="Close split pane"
        className={btnClass}
      >
        <svg width="9" height="9" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}