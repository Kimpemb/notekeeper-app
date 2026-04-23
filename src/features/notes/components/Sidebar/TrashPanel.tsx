// src/features/notes/components/Sidebar/TrashPanel.tsx
import { useEffect, useState, useRef } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

const PURGE_DAYS = 30;

function daysLeft(deletedAt: number): number {
  const elapsed = Math.floor((Date.now() - deletedAt) / (1000 * 60 * 60 * 24));
  return Math.max(0, PURGE_DAYS - elapsed);
}

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
    <circle cx="9.5" cy="9.5" r="5.5" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M13.5 13.5L18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);

export function TrashPanel() {
  const trashedNotes          = useNoteStore((s) => s.trashedNotes);
  const loadTrashedNotes      = useNoteStore((s) => s.loadTrashedNotes);
  const restoreNote           = useNoteStore((s) => s.restoreNote);
  const permanentlyDeleteNote = useNoteStore((s) => s.permanentlyDeleteNote);
  const emptyTrash            = useNoteStore((s) => s.emptyTrash);
  const setActiveNote         = useNoteStore((s) => s.setActiveNote);
  const replaceTab            = useUIStore((s) => s.replaceTab);
  const activePaneId          = useUIStore((s) => s.activePaneId);
  const replacePane2Tab       = useUIStore((s) => s.replacePane2Tab);

  const [search, setSearch]       = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTrashedNotes().catch(console.error);
  }, [loadTrashedNotes]);

  // Auto-focus when search opens
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [searchOpen]);

  const filtered = trashedNotes.filter((n) =>
    n.title.toLowerCase().includes(search.toLowerCase())
  );

  const btnClass = "w-8 h-8 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/6 dark:hover:bg-white/7 transition-colors duration-150";

  function handleClear() {
    setSearch("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setSearch("");
      setSearchOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-center gap-2 px-2 pt-0 pb-0 shrink-0">
        {/* Empty trash */}
        <button
          onClick={() => emptyTrash().catch(console.error)}
          title="Empty trash"
          disabled={trashedNotes.length === 0}
          className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed hover:text-red-400`}
        >
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
            <path d="M3 6h16M8 6V4.5h6V6M5.5 6l.8 12h9.4l.8-12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 10v5M13 10v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Search toggle */}
        <button
          onClick={() => setSearchOpen((v) => !v)}
          title="Search trash"
          className={`${btnClass} ${searchOpen ? "text-idemora-text-normal bg-black/6 dark:bg-white/7" : ""}`}
        >
          <SearchIcon />
        </button>
      </div>

      {/* Search bar — slides in/out with clean design */}
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out shrink-0"
        style={{ maxHeight: searchOpen ? "48px" : "0px", opacity: searchOpen ? 1 : 0 }}
      >
        <div className="px-3 pb-2">
          <div className="relative flex items-center w-full">
            <span className="absolute left-2.5 text-idemora-text-muted pointer-events-none flex items-center">
              <SearchIcon />
            </span>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search trash…"
              className="w-full h-8 pl-8 pr-7 rounded-md text-sm bg-idemora-bg-primary text-idemora-text-normal placeholder:text-idemora-text-muted outline-none border border-idemora-border focus:border-idemora-text-muted transition-colors duration-100"
            />
            {search && (
              <button
                onClick={handleClear}
                className="absolute right-2 text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 min-h-0">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-xs text-idemora-text-muted text-center select-none">
            {search ? "No results" : "Trash is empty"}
          </p>
        ) : (
          <ul className="px-2 space-y-0.5">
            {filtered.map((note) => {
              const remaining = note.deleted_at ? daysLeft(note.deleted_at) : PURGE_DAYS;
              const urgent = remaining <= 7;
              return (
                <li key={note.id}>
                  <div
                    className="group flex items-start gap-2 px-2 py-2.5 rounded-md hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 cursor-pointer"
                    onClick={() => {
                      if (activePaneId === 2) {
                        replacePane2Tab(note.id);
                      } else {
                        setActiveNote(note.id);
                        replaceTab(note.id);
                      }
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className="shrink-0 text-idemora-text-muted mt-0.5">
                      <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-idemora-text-normal truncate leading-snug">
                        {note.title}
                      </p>
                      <p className={`text-[10px] mt-0.5 tabular-nums ${urgent ? "text-red-400" : "text-idemora-text-faint"}`}>
                        {remaining}d left
                      </p>
                    </div>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); restoreNote(note.id).catch(console.error); }}
                        title="Restore"
                        className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted hover:text-blue-400 hover:bg-blue-500/10 transition-all duration-100"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <path d="M2 7a5 5 0 105-5H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                          <path d="M2 4v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); permanentlyDeleteNote(note.id).catch(console.error); }}
                        title="Delete permanently"
                        className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all duration-100"
                      >
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                          <path d="M2 3h9M5 3V2h3v1M3.5 3l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}