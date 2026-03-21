// src/features/ui/components/SplitDivider.tsx
import { useUIStore } from "@/features/ui/store/useUIStore";

export function SplitDivider() {
  const splitDirection       = useUIStore((s) => s.splitDirection);
  const toggleSplitDirection = useUIStore((s) => s.toggleSplitDirection);
  const swapPanes            = useUIStore((s) => s.swapPanes);
  const closePane2           = useUIStore((s) => s.closePane2);

  const isHorizontal = splitDirection === "horizontal";

  const btnClass = "flex items-center justify-center w-5 h-5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-100";

  if (isHorizontal) {
    // Panes are side by side — divider is a vertical bar
    return (
      <div className="group relative flex items-center justify-center w-2 shrink-0 h-full cursor-col-resize">
        <div className="w-[1px] h-full bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 transition-colors duration-150" />
        <div className="absolute flex flex-col items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg py-1.5 px-1 shadow-md z-10">
          <button onClick={toggleSplitDirection} title="Switch to top/bottom split" className={btnClass}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M0.5 5.5h10" stroke="currentColor" strokeWidth="1.1"/>
            </svg>
          </button>
          <button onClick={swapPanes} title="Swap panes" className={btnClass}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 3.5h9M7.5 1.5l2 2-2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 7.5H1M3.5 5.5l-2 2 2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={closePane2} title="Close split pane" className={btnClass}>
            <svg width="9" height="9" viewBox="0 0 8 8" fill="none">
              <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Panes are top/bottom — divider is a horizontal bar
  return (
    <div className="group relative flex items-center justify-center h-2.5 min-h-[10px] shrink-0 w-full cursor-row-resize">
      <div className="h-[1px] w-full bg-zinc-200 dark:bg-zinc-800 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700 transition-colors duration-150" />
      <div className="absolute flex flex-row items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg px-1.5 py-1 shadow-md z-10">
        <button onClick={toggleSplitDirection} title="Switch to side-by-side split" className={btnClass}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
            <path d="M5.5 0.5v10" stroke="currentColor" strokeWidth="1.1"/>
          </svg>
        </button>
        <button onClick={swapPanes} title="Swap panes" className={btnClass}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M3.5 1v9M1.5 7.5l2 2 2-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7.5 10V1M5.5 3.5l2-2 2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={closePane2} title="Close split pane" className={btnClass}>
          <svg width="9" height="9" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}