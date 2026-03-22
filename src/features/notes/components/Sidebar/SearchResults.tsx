// src/features/notes/components/Sidebar/SearchResults.tsx
import { useEffect, useState, useRef } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { searchNotes } from "@/features/notes/db/queries";
import type { SearchResult } from "@/features/notes/db/queries";

// Converts **word** markers from FTS5 snippet() into highlighted spans
function SnippetText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <mark
            key={i}
            className="bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 rounded px-0.5 not-italic font-medium"
          >
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

interface Props {
  query: string;
}

export function SearchResults({ query }: Props) {
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setPendingScrollQuery = useUIStore((s) => s.setPendingScrollQuery);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  // ── Fetch results with debounce ─────────────────────────────
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      setSelectedIndex(0);
      return;
    }

    setLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchNotes(query);
        setResults(res);
        setSelectedIndex(0);
      } catch (err) {
        console.error("Search error:", err);
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // ── Keyboard navigation ─────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!results.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleResultClick(results[selectedIndex]);
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [results, selectedIndex]);

  // ── Scroll active item into view smoothly ─────────────
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedIndex, results]);

  // ── Handle click ─────────────────────────────
  function handleResultClick(result: SearchResult) {
  const { replaceTab, sidebarState } = useUIStore.getState();
  
  // Set active note first so the editor starts mounting
  setActiveNote(result.id);
  replaceTab(result.id);
  
  // Delay pendingScrollQuery so it fires after the editor has remounted and painted
  setTimeout(() => {
  setPendingScrollQuery(query.trim());
}, 350);

if (sidebarState === "peek") useUIStore.getState().setSidebarState("closed");
}

  // ── Loading / No results ─────────────────────────────
  if (loading) {
    return (
      <div className="px-4 py-6 flex items-center justify-center">
        <span className="text-xs text-zinc-400 dark:text-zinc-500 animate-pulse">
          Searching…
        </span>
      </div>
    );
  }

  if (searched && results.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          No results for{" "}
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            "{query}"
          </span>
        </p>
      </div>
    );
  }

  // ── Results list ─────────────────────────────
  return (
    <ul
      ref={listRef}
      className="px-2 space-y-0.5 pb-2 overflow-y-auto max-h-[calc(100vh-10rem)]"
    >
      {results.map((result, index) => {
        const isActive = result.id === activeNoteId || index === selectedIndex;
        return (
          <li
            key={result.id}
            ref={(el) => void (itemRefs.current[index] = el)}          >
            <button
              onClick={() => handleResultClick(result)}
              className={`w-full text-left px-2.5 py-2 rounded-md transition-colors duration-75 group ${
                isActive
                  ? "bg-zinc-200 dark:bg-zinc-700"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  fill="none"
                  className="text-zinc-300 dark:text-zinc-600 shrink-0"
                >
                  <rect
                    x="1.5"
                    y="1"
                    width="9"
                    height="10"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                  <path
                    d="M3.5 4h5M3.5 6.5h5M3.5 9h3"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate">
                  {result.title}
                </span>
              </div>
              {result.snippet && (
                <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500 line-clamp-2 pl-4">
                  <SnippetText text={result.snippet} />
                </p>
              )}
            </button>
          </li>
        );
      })}

      {results.length > 0 && (
        <li className="px-2.5 pt-1">
          <p className="text-[10px] text-zinc-300 dark:text-zinc-700 tabular-nums">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
        </li>
      )}
    </ul>
  );
}