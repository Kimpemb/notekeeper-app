// src/features/notes/components/Sidebar/SearchBar.tsx
import { useRef, useEffect, useCallback } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";

const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export function SearchBar() {
  const searchQuery           = useUIStore((s) => s.searchQuery);
  const setQuery              = useUIStore((s) => s.setSearchQuery);
  const clearSearch           = useUIStore((s) => s.clearSearch);
  const setFocusSidebarSearch = useUIStore((s) => s.setFocusSidebarSearch);
  const setActiveSidebarPanel = useUIStore((s) => s.setActiveSidebarPanel);
  const activeSidebarPanel    = useUIStore((s) => s.activeSidebarPanel);
  const inputRef              = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    if (activeSidebarPanel !== "search") setActiveSidebarPanel("search");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [activeSidebarPanel, setActiveSidebarPanel]);

  useEffect(() => {
    setFocusSidebarSearch(focusSearch);
    return () => setFocusSidebarSearch(null);
  }, [focusSearch, setFocusSidebarSearch]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      clearSearch();
      inputRef.current?.blur();
    }
  }

  function handleClear() {
    clearSearch();
    inputRef.current?.focus();
  }

  return (
    <div className="relative flex items-center w-full">
      <span className="absolute left-2.5 text-zinc-400 dark:text-zinc-500 pointer-events-none flex items-center">
        <SearchIcon />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search…"
        className="w-full h-8 pl-8 pr-7 rounded-md text-sm bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:bg-zinc-100 dark:focus:bg-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none border-none transition-colors duration-100"
      />
      {searchQuery && (
        <button
          onClick={handleClear}
          className="absolute right-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-100"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}