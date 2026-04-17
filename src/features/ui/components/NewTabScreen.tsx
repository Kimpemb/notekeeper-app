// src/features/ui/components/NewTabScreen.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { FileText } from "lucide-react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { searchNotes } from "@/features/notes/db/queries";
import { TEMPLATES } from "@/lib/templates";
import type { Template } from "@/lib/templates";
import type { SearchResult } from "@/features/notes/db/queries";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  paneId: 1 | 2;
}

type View = "home" | "templates";

type Note = ReturnType<typeof useNoteStore.getState>["notes"][number];

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useOpenNote(paneId: Props["paneId"]) {
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  return useCallback(
    (noteId: string) => {
      if (paneId === 1) {
        useUIStore.getState().replaceTab(noteId);
        setActiveNote(noteId, true);
      } else {
        useUIStore.getState().replacePane2Tab(noteId);
      }
    },
    [paneId, setActiveNote]
  );
}

function useDebouncedSearch(query: string, delayMs = 150) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        const res = await searchNotes(query);
        setResults(res);
      } catch {
        setResults([]);
        setError("Search failed. Please try again.");
      } finally {
        setLoading(false);
      }
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, delayMs]);

  return { results, loading, error };
}

function useRecentNotes(limit = 8) {
  const notes = useNoteStore((s) => s.notes);

  return useMemo(
    () =>
      notes
        .filter((n) => !n.deleted_at)
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, limit),
    [notes, limit]
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function isUntitled(title: string): boolean {
  return /^Untitled(-\d+)?$/.test(title);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <p className="text-[10px] uppercase tracking-[0.12em] text-idemora-text-faint font-semibold">
        {children}
      </p>
      {aside && (
        <span className="text-[9px] text-idemora-text-faint tabular-nums">{aside}</span>
      )}
    </div>
  );
}

interface NoteRowProps {
  title: string;
  timestamp?: number;
  snippet?: string;
  isSelected?: boolean;
  onClick: () => void;
  onHover?: () => void;
}

function NoteRow({ title, timestamp, snippet, isSelected, onClick, onHover }: NoteRowProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
        transition-all duration-100 group relative
        ${isSelected
          ? "bg-blue-500/[0.08] text-blue-400 shadow-[inset_2px_0_0_rgb(59_130_246_/_0.5)]"
          : "text-idemora-text-normal hover:bg-idemora-bg-secondary hover:shadow-[inset_2px_0_0_rgb(255_255_255_/_0.08)]"
        }
      `}
    >
      <FileText
        size={13}
        className={`shrink-0 transition-colors duration-100 ${
          isSelected
            ? "text-blue-400"
            : "text-idemora-text-faint group-hover:text-idemora-text-muted"
        }`}
      />
      <div className="flex-1 min-w-0 text-left">
        <div className="truncate">
          {isUntitled(title) ? (
            <span className="text-idemora-text-faint italic">Untitled</span>
          ) : (
            title
          )}
        </div>
        {snippet && (
          <div
            className="text-[11px] text-idemora-text-muted truncate mt-0.5 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: snippet }}
          />
        )}
      </div>
      {timestamp != null && (
        <span className="text-[10px] text-idemora-text-faint shrink-0 tabular-nums w-14 text-right">
          {formatRelativeTime(timestamp)}
        </span>
      )}
    </button>
  );
}

// ─── Views ────────────────────────────────────────────────────────────────────

interface SearchResultsViewProps {
  results: SearchResult[];
  selectedIdx: number;
  query: string;
  error: string | null;
  onOpen: (id: string) => void;
  onHover: (i: number) => void;
  onCreateFromQuery: () => void;
}

function SearchResultsView({
  results,
  selectedIdx,
  query,
  error,
  onOpen,
  onHover,
  onCreateFromQuery,
}: SearchResultsViewProps) {
  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 rounded-lg bg-red-500/5 border border-red-500/20">
        <span className="text-red-400 text-xs">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {results.length > 0 && (
        <div>
          <SectionLabel aside={`${results.length} found`}>Results</SectionLabel>
          <ul className="space-y-0.5">
            {results.map((r, i) => (
              <li key={r.id}>
                <NoteRow
                  title={r.title}
                  snippet={r.snippet}
                  isSelected={i === selectedIdx}
                  onClick={() => onOpen(r.id)}
                  onHover={() => onHover(i)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onCreateFromQuery}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-dashed border-idemora-border/60 hover:border-blue-500/40 hover:bg-blue-500/[0.04] transition-all duration-150 group"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-idemora-bg-secondary border border-idemora-border flex items-center justify-center group-hover:border-blue-500/40 transition-colors shrink-0">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M4 1v6M1 4h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-sm text-idemora-text-muted group-hover:text-idemora-text-normal transition-colors">
            Create{" "}
            <span className="font-medium text-idemora-text-normal">"{query}"</span>
          </span>
        </div>
        <kbd className="px-1.5 py-0.5 text-[9px] font-mono bg-idemora-bg-secondary border border-idemora-border rounded text-idemora-text-faint shrink-0">
          ↵
        </kbd>
      </button>
    </div>
  );
}

interface RecentNotesViewProps {
  notes: Note[];
  onOpen: (id: string) => void;
}

function RecentNotesView({ notes, onOpen }: RecentNotesViewProps) {
  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 select-none">
        <div className="relative w-16 h-16 mb-5">
          <div className="absolute inset-0 rounded-full border border-idemora-border/40" />
          <div className="absolute inset-[5px] rounded-full border border-idemora-border/25" />
          <div className="absolute inset-[10px] rounded-full bg-idemora-bg-secondary border border-idemora-border/40 flex items-center justify-center">
            <FileText size={15} className="text-idemora-text-faint" />
          </div>
        </div>
        <p className="text-sm font-medium text-idemora-text-muted">No notes yet</p>
        <p className="text-xs text-idemora-text-faint mt-1.5 text-center leading-relaxed">
          Press{" "}
          <kbd className="px-1 py-0.5 text-[9px] bg-idemora-bg-secondary border border-idemora-border rounded font-mono">
            ⌘N
          </kbd>{" "}
          or click New note to begin
        </p>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel aside={`${notes.length}`}>Recent</SectionLabel>
      <ul className="space-y-0.5">
        {notes.map((n) => (
          <li key={n.id}>
            <NoteRow
              title={n.title}
              timestamp={n.updated_at}
              onClick={() => onOpen(n.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TemplatesViewProps {
  onSelect: (template: Template) => void;
}

function TemplatesView({ onSelect }: TemplatesViewProps) {
  return (
    <div className="animate-in fade-in slide-in-from-top-1 duration-150">
      <SectionLabel>Templates</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className="
              flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
              bg-idemora-bg-secondary border border-idemora-border
              hover:border-blue-500/30 hover:bg-idemora-bg-primary
              hover:shadow-[0_0_0_3px_rgb(59_130_246_/_0.06)]
              transition-all duration-150 group
            "
          >
            <div className="w-8 h-8 rounded-md bg-idemora-bg-primary border border-idemora-border flex items-center justify-center shrink-0 text-base group-hover:border-blue-500/25 transition-colors">
              {template.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-idemora-text-normal truncate">
                {template.label}
              </div>
              <div className="text-[10px] text-idemora-text-faint truncate mt-0.5">
                {template.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SHORTCUTS = [
  { key: "⌘K", label: "Focus" },
  { key: "⌘N", label: "New note" },
  { key: "↑↓", label: "Navigate" },
  { key: "↵", label: "Open" },
  { key: "Esc", label: "Clear" },
] as const;

export function NewTabScreen({ paneId }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [view, setView] = useState<View>("home");

  const inputRef = useRef<HTMLInputElement>(null);

  const createNote = useNoteStore((s) => s.createNote);
  const createNoteFromTemplate = useNoteStore((s) => s.createNoteFromTemplate);
  const openNote = useOpenNote(paneId);
  const recentNotes = useRecentNotes();

  const { results, loading, error } = useDebouncedSearch(query);

  // Search always takes over regardless of view
  const isSearching = Boolean(query.trim());

  // Reset selection when results change
  useEffect(() => { setSelectedIdx(0); }, [results]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  const handleNewNote = useCallback(async () => {
    const note = await createNote({ title: "Untitled" });
    openNote(note.id);
  }, [createNote, openNote]);

  const handleTemplateNote = useCallback(
    async (template: Template) => {
      const note = await createNoteFromTemplate(template);
      openNote(note.id);
      setView("home");
    },
    [createNoteFromTemplate, openNote]
  );

  const handleCreateFromQuery = useCallback(async () => {
    if (!query.trim()) return;
    const note = await createNote({ title: query.trim() });
    openNote(note.id);
  }, [query, createNote, openNote]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (view === "templates") setView("home");
          setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
          break;

        case "ArrowUp":
          e.preventDefault();
          setSelectedIdx((i) => Math.max(i - 1, 0));
          break;

        case "Enter":
          e.preventDefault();
          if (results.length > 0 && selectedIdx < results.length) {
            openNote(results[selectedIdx].id);
          } else if (query.trim()) {
            handleCreateFromQuery();
          }
          break;

        case "ArrowRight":
          if (!isSearching && view === "home") {
            e.preventDefault();
            setView("templates");
          }
          break;

        case "Escape":
          e.preventDefault();
          if (query) {
            setQuery("");
          } else if (view === "templates") {
            setView("home");
          }
          inputRef.current?.focus();
          break;
      }
    },
    [view, results, selectedIdx, query, isSearching, openNote, handleCreateFromQuery]
  );

  const isTemplatesActive = !isSearching && view === "templates";

  return (
    <div className="flex flex-col items-center w-full h-full bg-idemora-bg-primary overflow-y-auto">
      <div className="w-full max-w-xl mt-12 px-6 pb-12">

        {/* Search input */}
        <div className="relative mb-5">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-idemora-text-faint pointer-events-none"
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
          >
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or open a note…"
            className="
              w-full h-10 pl-9 pr-14 rounded-lg text-sm
              bg-idemora-bg-secondary text-idemora-text-normal
              placeholder:text-idemora-text-faint
              outline-none border border-idemora-border
              focus:border-blue-500/40 focus:bg-idemora-bg-primary
              focus:shadow-[0_0_0_3px_rgb(59_130_246_/_0.08)]
              transition-all duration-150
            "
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <kbd className="px-1.5 py-0.5 text-[9px] font-mono bg-idemora-bg-primary border border-idemora-border/60 rounded text-idemora-text-faint">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={handleNewNote}
            className={`
              flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              transition-all duration-150
              ${!isTemplatesActive
                ? "bg-blue-500/10 text-blue-400 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.25)]"
                : "bg-idemora-bg-secondary border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-primary"
              }
            `}
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            New note
            <kbd className={`ml-0.5 px-1.5 py-0.5 text-[9px] font-mono rounded ${
              !isTemplatesActive
                ? "bg-blue-500/15 text-blue-300"
                : "bg-idemora-bg-primary border border-idemora-border text-idemora-text-faint"
            }`}>
              ⌘N
            </kbd>
          </button>

          <button
            onClick={() => setView((v) => (v === "templates" ? "home" : "templates"))}
            className={`
              flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              transition-all duration-150
              ${isTemplatesActive
                ? "bg-blue-500/10 text-blue-400 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.25)]"
                : "bg-idemora-bg-secondary border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-primary"
              }
            `}
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
              <rect x="1" y="1" width="3.3" height="3.3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="5.7" y="1" width="3.3" height="3.3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="1" y="5.7" width="3.3" height="3.3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
              <rect x="5.7" y="5.7" width="3.3" height="3.3" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            Templates
          </button>
          <button
  onClick={async () => {
    const createCanvasNote = useNoteStore.getState().createCanvasNote;
    const note = await createCanvasNote("Untitled");
    openNote(note.id);
  }}
  className={`
    flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
    transition-all duration-150
    bg-idemora-bg-secondary border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-primary
  `}
>
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
    <circle cx="4" cy="4" r="1" fill="currentColor"/>
    <circle cx="8" cy="4" r="1" fill="currentColor"/>
    <path d="M3 8l2-2 2 1.5 2-2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
  New canvas
</button>
        </div>

        {/* Body */}
        {loading && (
          <div className="flex items-center justify-center py-10 gap-2.5">
            <div className="w-4 h-4 border-[1.5px] border-blue-500/25 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-xs text-idemora-text-faint">Searching…</span>
          </div>
        )}

        {!loading && isSearching && (
          <SearchResultsView
            results={results}
            selectedIdx={selectedIdx}
            query={query}
            error={error}
            onOpen={openNote}
            onHover={setSelectedIdx}
            onCreateFromQuery={handleCreateFromQuery}
          />
        )}

        {!loading && !isSearching && view === "templates" && (
          <TemplatesView onSelect={handleTemplateNote} />
        )}

        {!loading && !isSearching && view === "home" && (
          <RecentNotesView notes={recentNotes} onOpen={openNote} />
        )}

        {/* Shortcuts footer */}
        <div className="mt-10 pt-4 border-t border-idemora-border/20">
          <div className="flex justify-center items-center flex-wrap">
            {SHORTCUTS.map(({ key, label }, i) => (
              <span key={key} className="flex items-center gap-1 px-2 py-1 text-[10px] text-idemora-text-faint">
                <kbd className="px-1.5 py-0.5 bg-idemora-bg-secondary border border-idemora-border/60 rounded text-[9px] font-mono">
                  {key}
                </kbd>
                <span>{label}</span>
                {i < SHORTCUTS.length - 1 && (
                  <span className="ml-2 opacity-20">·</span>
                )}
              </span>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}