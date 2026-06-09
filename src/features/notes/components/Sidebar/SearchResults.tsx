// src/features/notes/components/Sidebar/SearchResults.tsx
import { useEffect, useState, useRef } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteSearch } from "@/features/notes/hooks/useNoteSearch";
import { useOpenNoteWithScroll } from "@/features/notes/hooks/useOpenNoteWithScroll";
import { snippetKind, SnippetText, TagIcon } from "./searchUtils";
import type { SearchResult } from "@/features/notes/db/queries";

interface Props {
  query: string;
}

// ── Match count reader ────────────────────────────────────────────────────────
// Reads match count from the active editor after navigation settles

function useEditorMatchCount(query: string, activeNoteId: string | null, onCount: (n: number) => void) {
  useEffect(() => {
    if (!activeNoteId || !query.trim()) return;
    // Wait for editor to mount and scroll to settle
    const timer = setTimeout(() => {
const activeEditor = useUIStore.getState().activeEditor
console.log("[matchCount] activeEditor=", activeEditor, "query=", query)
if (!activeEditor || activeEditor.isDestroyed) return
      let count = 0
      const needle  = query.trim().toLowerCase()
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const regex   = new RegExp(escaped, "gi")
      activeEditor.state.doc.descendants((node: { isText: boolean; text?: string }) => {
        if (!node.isText || !node.text) return true
        const matches = node.text.match(regex)
        if (matches) count += matches.length
      })
      onCount(count)
    }, 500)
    return () => clearTimeout(timer)
  }, [activeNoteId, query, onCount])
}

// ── Match cycler UI ───────────────────────────────────────────────────────────

function MatchCycler({ current, total, onPrev, onNext }: {
  current: number;
  total:   number;
  onPrev:  () => void;
  onNext:  () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="text-[10px] text-idemora-text-muted tabular-nums">
        {current + 1}/{total} matches
      </span>
      <div className="flex items-center gap-0.5 ml-auto">
        <button
          onClick={onPrev}
          disabled={current === 0}
          className="w-5 h-5 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-75"
          title="Previous match"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M4 6.5L1.5 4 4 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          onClick={onNext}
          disabled={current === total - 1}
          className="w-5 h-5 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-75"
          title="Next match"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M4 1.5L6.5 4 4 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export function SearchResults({ query }: Props) {
  const openNote             = useOpenNoteWithScroll(1);
  const { results, loading } = useNoteSearch(query);

  const setPendingScrollQuery = useUIStore((s) => s.setPendingScrollQuery);
  const setPendingScrollIndex = useUIStore((s) => s.setPendingScrollIndex);

  const [searched, setSearched]           = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeNoteId, setActiveNoteId]   = useState<string | null>(null);
  const [matchCount, setMatchCount]       = useState(0);
  const [matchIndex, setMatchIndex]       = useState(0);

  const listRef  = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Reset cycling state when query changes
  useEffect(() => {
    if (!query.trim()) { setSearched(false); setSelectedIndex(0); setActiveNoteId(null); setMatchCount(0); setMatchIndex(0); return; }
    setSearched(true);
    setSelectedIndex(0);
    setActiveNoteId(null);
    setMatchCount(0);
    setMatchIndex(0);
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
    setSelectedIndex(index);
    setActiveNoteId(result.id);
    setMatchIndex(0);
    // We don't know matchCount yet — editor will scroll to index 0
    // matchCount gets set via the counter UI after editor mounts
    openNote(result.id, query);
  }

function handleCycleMatch(dir: 1 | -1) {
  const next = Math.max(0, Math.min(matchCount - 1, matchIndex + dir));
  setMatchIndex(next);
  setPendingScrollQuery(null);
  setTimeout(() => {
    setPendingScrollIndex(next);
    setPendingScrollQuery(query);
  }, 0);
}

  function handleMatchCount(count: number) {
    setMatchCount(count);
  }

  useEditorMatchCount(query, activeNoteId, handleMatchCount);

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

      {activeNoteId && matchCount > 1 && (
        <li className="px-2.5 py-1.5">
          <MatchCycler
            current={matchIndex}
            total={matchCount}
            onPrev={() => handleCycleMatch(-1)}
            onNext={() => handleCycleMatch(1)}
          />
        </li>
      )}
    </ul>
  );
}