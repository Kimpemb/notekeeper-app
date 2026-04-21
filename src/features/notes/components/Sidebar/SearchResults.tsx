// src/features/notes/components/Sidebar/SearchResults.tsx
import { useEffect, useState, useRef } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { searchNotes } from "@/features/notes/db/queries";
import type { SearchResult } from "@/features/notes/db/queries";

// Detects the snippet kind so tag/frontmatter hits can render differently
function snippetKind(snippet: string): "tag" | "frontmatter" | "text" {
  if (snippet.startsWith("Tag: ")) return "tag";
  // frontmatter snippets look like "status: active · priority: high"
  if (/^[\w-]+: .+/.test(snippet) && snippet.includes(" · ")) return "frontmatter";
  return "text";
}

// Renders **word** FTS markers as highlighted <mark> spans
function SnippetText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <mark
            key={i}
            className="bg-amber-100/50 text-amber-800 rounded px-0.5 not-italic font-medium"
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

// Tag icon — small # symbol
function TagIcon() {
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" fill="none" className="shrink-0 mt-px">
      <path
        d="M1 3.5h7M1 6.5h7M3 1l-1 8M7 1l-1 8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface Props {
  query: string;
}

export function SearchResults({ query }: Props) {
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
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

      // Only handle keys when the search panel is the active sidebar panel
      if (useUIStore.getState().activeSidebarPanel !== "search") return;

      // Never intercept keys when focus is inside an editor or input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleResultClick(results[selectedIndex], selectedIndex);
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
  function handleResultClick(result: SearchResult, index: number) {
    const { replaceTab } = useUIStore.getState();

    setSelectedIndex(index);
    setActiveNote(result.id);
    replaceTab(result.id);

    setTimeout(() => {
      setPendingScrollQuery(query.trim());
    }, 350);
  }

  // ── Loading / No results ─────────────────────────────
  if (loading) {
    return (
      <div className="px-4 py-6 flex items-center justify-center">
        <span className="text-xs text-idemora-text-muted animate-pulse">
          Searching…
        </span>
      </div>
    );
  }

  if (searched && results.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-idemora-text-muted">
          No results for{" "}
          <span className="font-medium text-idemora-text-muted">
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
        const isActive = index === selectedIndex;
        return (
          <li
            key={result.id}
            ref={(el) => void (itemRefs.current[index] = el)}
          >
            <button
              onClick={() => handleResultClick(result, index)}
              className={`w-full text-left px-2.5 py-2 rounded-md transition-colors duration-75 group ${
                isActive
                  ? "bg-idemora-bg-primary"
                  : ""
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  fill="none"
                  className="text-idemora-text-normal shrink-0"
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
                <span className="text-xs font-medium text-idemora-text-normal truncate">
                  {result.title}
                </span>
              </div>
              {result.snippet && (() => {
                const kind = snippetKind(result.snippet);
                if (kind === "tag") {
                  const tags = result.snippet.slice(5).split(", "); // strip "Tag: "
                  return (
                    <div className="flex items-center gap-1 pl-4 mt-0.5 flex-wrap">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-idemora-bg-primary text-idemora-text-muted border border-idemora-border"
                        >
                          <TagIcon />
                          {tag}
                        </span>
                      ))}
                    </div>
                  );
                }
                if (kind === "frontmatter") {
                  return (
                    <p className="text-[11px] leading-relaxed text-idemora-text-muted line-clamp-1 pl-4 mt-0.5 italic">
                      {result.snippet}
                    </p>
                  );
                }
                return (
                  <p className="text-[11px] leading-relaxed text-idemora-text-muted line-clamp-2 pl-4 mt-0.5">
                    <SnippetText text={result.snippet} />
                  </p>
                );
              })()}
            </button>
          </li>
        );
      })}

      {results.length > 0 && (
        <li className="px-2.5 pt-1">
          <p className="text-[10px] text-idemora-text-normal tabular-nums">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
        </li>
      )}
    </ul>
  );
}