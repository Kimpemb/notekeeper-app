// src/components/Sidebar/SearchBar.tsx
import { useRef } from "react";
import { useUIStore } from "@/store/useUIStore";

export function SearchBar() {
  const searchQuery  = useUIStore((s) => s.searchQuery);
  const setQuery     = useUIStore((s) => s.setSearchQuery);
  const clearSearch  = useUIStore((s) => s.clearSearch);
  const inputRef     = useRef<HTMLInputElement>(null);

  return (
    <div className="relative flex items-center">
      {/* Search icon */}
      <span className="absolute left-2.5 text-zinc-400 dark:text-zinc-500 pointer-events-none">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </span>

      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            clearSearch();
            inputRef.current?.blur();
          }
        }}
        placeholder="Search notes…"
        className="
          w-full h-7 pl-7 pr-7 rounded-md text-[12px]
          bg-zinc-100 dark:bg-zinc-800
          border border-transparent
          focus:border-zinc-300 dark:focus:border-zinc-600
          focus:bg-white dark:focus:bg-zinc-750
          text-zinc-700 dark:text-zinc-300
          placeholder:text-zinc-400 dark:placeholder:text-zinc-600
          outline-none transition-colors duration-100
        "
      />

      {/* Clear button */}
      {searchQuery && (
        <button
          onClick={() => { clearSearch(); inputRef.current?.focus(); }}
          className="
            absolute right-2 text-zinc-400 hover:text-zinc-600
            dark:hover:text-zinc-300 transition-colors duration-100
          "
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}