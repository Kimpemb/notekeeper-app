// src/features/notes/components/Sidebar/SearchPanel.tsx
import { useEffect, useRef } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { SearchResults } from "./SearchResults";

export function SearchPanel() {
  const searchQuery           = useUIStore((s) => s.searchQuery);
  const setQuery              = useUIStore((s) => s.setSearchQuery);
  const clearSearch           = useUIStore((s) => s.clearSearch);
  const setFocusSidebarSearch = useUIStore((s) => s.setFocusSidebarSearch);
  const inputRef              = useRef<HTMLInputElement>(null);

  // Register the focus function so Ctrl+F and Sidebar/index.tsx can call it
  useEffect(() => {
    const focusFn = () => {
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    setFocusSidebarSearch(focusFn);
    return () => setFocusSidebarSearch(null);
  }, [setFocusSidebarSearch]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      clearSearch();
      inputRef.current?.blur();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search input */}
      <div className="px-2 pt-2 pb-1.5 shrink-0">
        <div className="relative flex items-center">
          <span className="absolute left-2.5 text-idemora-text-muted pointer-events-none flex items-center">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes…"
            autoFocus
            className="w-full h-8 pl-8 pr-7 rounded-md text-sm bg-idemora-bg-primary  text-idemora-text-normal placeholder:text-idemora-text-muted :text-idemora-text-muted outline-none border-none transition-colors duration-100"
          />
          {searchQuery && (
            <button
              onClick={() => { clearSearch(); inputRef.current?.focus(); }}
              className="absolute right-2 text-idemora-text-muted   transition-colors duration-100"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="mx-2 border-t border-idemora-border shrink-0" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        {searchQuery.trim() ? (
          <SearchResults query={searchQuery} />
        ) : (
          <p className="px-4 py-6 text-xs text-idemora-text-muted text-center select-none">
            Type to search all notes
          </p>
        )}
      </div>
    </div>
  );
}