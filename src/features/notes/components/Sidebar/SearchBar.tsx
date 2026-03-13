// src/features/notes/components/Sidebar/SearchBar.tsx
import { useRef, useState, useEffect } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
    <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export function SearchBar() {
  const searchQuery  = useUIStore((s) => s.searchQuery);
  const setQuery     = useUIStore((s) => s.setSearchQuery);
  const clearSearch  = useUIStore((s) => s.clearSearch);
  const inputRef     = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => { if (searchQuery) setIsExpanded(true); }, [searchQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (!searchQuery) setIsExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchQuery]);

  const handleExpand = () => { setIsExpanded(true); setTimeout(() => inputRef.current?.focus(), 50); };
  const handleClear  = () => { clearSearch(); inputRef.current?.focus(); };
  const handleEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { clearSearch(); setIsExpanded(false); inputRef.current?.blur(); }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button onClick={handleExpand} aria-label="Search notes"
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300 transition-all duration-200 ease-in-out ${isExpanded ? "opacity-0 pointer-events-none absolute inset-0" : "opacity-100 pointer-events-auto relative"}`}
      >
        <span className="text-zinc-400 dark:text-zinc-500 flex items-center"><SearchIcon /></span>
        <span className="text-base">Search</span>
      </button>

      <div className={`w-full transition-all duration-200 ease-in-out ${isExpanded ? "opacity-100 pointer-events-auto relative" : "opacity-0 pointer-events-none absolute inset-0"}`}>
        <div className="relative flex items-center">
          <span className="absolute left-3 text-zinc-400 dark:text-zinc-500 pointer-events-none flex items-center"><SearchIcon /></span>
          <input ref={inputRef} type="text" value={searchQuery} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleEscape}
            placeholder="Search notes…"
            className="w-full h-10 pl-9 pr-8 rounded-md text-base bg-zinc-100 dark:bg-zinc-800 border border-transparent text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none transition-colors duration-100"
          />
          {searchQuery && (
            <button onClick={handleClear} className="absolute right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-100">
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}