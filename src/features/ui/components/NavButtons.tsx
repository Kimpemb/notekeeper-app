// src/features/ui/components/NavButtons.tsx
import { useUIStore } from "@/features/ui/store/useUIStore";

export function NavButtons({ paneId }: { paneId: 1 | 2 }) {
  const paneGoBack    = useUIStore((s) => s.paneGoBack);
  const paneGoForward = useUIStore((s) => s.paneGoForward);
  const canGoBack     = useUIStore((s) => s.paneCanGoBack(paneId));
  const canGoForward  = useUIStore((s) => s.paneCanGoForward(paneId));

  const cls =
    "shrink-0 w-9 h-9 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary";

  return (
    <>
      <button onClick={() => paneGoBack(paneId)} disabled={!canGoBack} title="Go back (Ctrl+[)" className={cls}>
        <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
          <path d="M9 7H3M3 7l3.5-3.5M3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <button onClick={() => paneGoForward(paneId)} disabled={!canGoForward} title="Go forward (Ctrl+])" className={cls}>
        <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
          <path d="M5 7h6M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </>
  );
}