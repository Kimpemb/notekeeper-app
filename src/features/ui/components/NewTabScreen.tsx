// src/features/ui/components/NewTabScreen.tsx
import { useState, useRef, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { searchNotes } from "@/features/notes/db/queries";
import type { SearchResult } from "@/features/notes/db/queries";

interface Props {
  paneId: 1 | 2;
}

export function NewTabScreen({ paneId }: Props) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const notes       = useNoteStore((s) => s.notes);
  const createNote  = useNoteStore((s) => s.createNote);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchNotes(query);
        setResults(res);
        setSelectedIdx(0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function openNote(noteId: string) {
    if (paneId === 1) {
      useUIStore.getState().replaceTab(noteId);
      setActiveNote(noteId, true);
    } else {
      useUIStore.getState().replacePane2Tab(noteId);
    }
  }

  async function handleNewNote() {
    const note = await createNote({ title: "Untitled" });
    openNote(note.id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter")     { e.preventDefault(); openNote(results[selectedIdx].id); }
  }

  // Recent notes when no query
  const recentNotes = notes
    .filter((n) => !n.deleted_at)
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 8);

  const showRecent  = !query.trim();
  const showResults = query.trim() && !loading;

  return (
    <div className="flex flex-col items-center w-full h-full bg-white dark:bg-zinc-950 overflow-y-auto">
      <div className="w-full max-w-lg mt-16 px-6">

        {/* Search input */}
        <div className="relative mb-6">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or open a note…"
            className="w-full h-10 pl-9 pr-4 rounded-lg text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none border border-zinc-200 dark:border-zinc-700 focus:border-blue-400 dark:focus:border-blue-500 transition-colors duration-100"
          />
        </div>

        {/* New note button */}
        <button
          onClick={handleNewNote}
          className="w-full flex items-center gap-3 px-4 h-10 rounded-lg text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors duration-100 border border-dashed border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 mb-6"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          New note
        </button>

        {/* Search results */}
        {loading && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center animate-pulse">Searching…</p>
        )}

        {showResults && results.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">No results for "{query}"</p>
        )}

        {showResults && results.length > 0 && (
          <ul className="space-y-0.5">
            {results.map((r, i) => (
              <li key={r.id}>
                <button
                  onClick={() => openNote(r.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-75 ${
                    i === selectedIdx
                      ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="font-medium truncate">{r.title}</div>
                  {r.snippet && (
                    <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{r.snippet.replace(/\*\*/g, "")}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Recent notes */}
        {showRecent && recentNotes.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-medium mb-2 px-1">Recent</p>
            <ul className="space-y-0.5">
              {recentNotes.map((n) => {
                const isUntitled = /^Untitled-\d+$/.test(n.title);
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => openNote(n.id)}
                      className="w-full text-left px-3 py-2 rounded-md text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-75 truncate"
                    >
                      {isUntitled ? <span className="text-zinc-400 dark:text-zinc-600">Untitled</span> : n.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}