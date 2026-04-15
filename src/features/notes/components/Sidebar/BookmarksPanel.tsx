// src/features/notes/components/Sidebar/BookmarksPanel.tsx
export function BookmarksPanel() {
  return (
    <div className="flex flex-col h-full min-h-0 bg-idemora-bg-secondary">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted shrink-0">
            <path d="M2 3h9M2 6h6M2 9h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">
            Bookmarks
          </span>
        </div>
      </div>
      <div className="mx-3 border-t border-idemora-border shrink-0" />
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
          <path d="M4 4h16v16H4zM8 8h8M8 12h6M8 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <p className="text-xs text-idemora-text-muted">Bookmarks coming soon</p>
        <p className="text-xs text-idemora-text-faint">Save important notes for quick access</p>
      </div>
    </div>
  );
}