// src/App.tsx
import { useEffect, useCallback, useState } from "react";
import { initDb } from "@/db/queries";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import { Sidebar } from "@/components/Sidebar";
import { Editor } from "@/components/Editor";
import { EmptyState } from "@/components/EmptyState";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import "@/styles/main.css";
import { cancelSidebarCollapse, scheduleSidebarCollapse } from "@/lib/sidebarTimer";

// ─── Breadcrumb helper ────────────────────────────────────────────────────────

function buildBreadcrumb(
  noteId: string | null,
  notes: Array<{ id: string; title: string; parent_id: string | null }>
): string[] {
  if (!noteId) return [];
  const path: string[] = [];
  let current = notes.find((n) => n.id === noteId);
  while (current) {
    path.unshift(current.title);
    if (!current.parent_id) break;
    current = notes.find((n) => n.id === current!.parent_id);
  }
  return path;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function App() {
  const loadNotes       = useNoteStore((s) => s.loadNotes);
  const activeNote      = useNoteStore((s) => s.activeNote());
  const notes           = useNoteStore((s) => s.notes);
  const createNote      = useNoteStore((s) => s.createNote);

  const sidebarState    = useUIStore((s) => s.sidebarState);
  const setSidebarState = useUIStore((s) => s.setSidebarState);
  const toggleSidebar   = useUIStore((s) => s.toggleSidebar);
  const openPalette     = useUIStore((s) => s.openPalette);
  const togglePalette   = useUIStore((s) => s.togglePalette);

  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const isClosed = sidebarState === "closed" || sidebarState === "peek";

  useEffect(() => {
    initDb()
      .then(() => { setDbReady(true); return loadNotes(); })
      .catch((err) => setDbError(String(err)));
  }, [loadNotes]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!dbReady) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "k")  { e.preventDefault(); togglePalette(); }
    if (ctrl && e.key === "n")  { e.preventDefault(); createNote().catch(console.error); }
    if (ctrl && e.key === "\\") { e.preventDefault(); toggleSidebar(); }
  }, [dbReady, togglePalette, createNote, toggleSidebar]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const breadcrumb = buildBreadcrumb(activeNote?.id ?? null, notes);
  const isUntitled = activeNote ? /^Untitled-\d+$/.test(activeNote.title) : false;

  // Hover → peek (only from closed, sidebar handles its own collapse timer)
  function handleHamburgerEnter() {
    const current = useUIStore.getState().sidebarState;
    if (current === "closed" || current === "peek") {
      cancelSidebarCollapse();
      setSidebarState("peek");
    }
  }

  function handleHamburgerLeave() {
    if (useUIStore.getState().sidebarState === "peek") {
      scheduleSidebarCollapse(() => {
        if (useUIStore.getState().sidebarState === "peek") setSidebarState("closed");
      });
    }
  }

  function handleHamburgerClick() {
    cancelSidebarCollapse();
    setSidebarState("open");
  }

  if (dbError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-zinc-950 p-8">
        <div className="max-w-md text-center space-y-3">
          <p className="text-base font-semibold text-red-500">Failed to initialize database</p>
          <p className="text-sm text-zinc-500 font-mono bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg break-all">{dbError}</p>
          <p className="text-sm text-zinc-400">Check the console for more details.</p>
        </div>
      </div>
    );
  }

  if (!dbReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-zinc-950">
        <p className="text-base text-zinc-400 animate-pulse">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">

      {/* ── Sidebar — full height, flush to top ── */}
      <Sidebar />

      {/* ── Right column — header + editor ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        <header
          className="
            relative flex items-center px-3 h-12 shrink-0 z-50
            border-b border-zinc-200 dark:border-zinc-800
            bg-zinc-50 dark:bg-zinc-900
            select-none
          "
          onMouseEnter={() => {
            // Cancel collapse when mouse travels through header toward hamburger
            if (useUIStore.getState().sidebarState === "peek") cancelSidebarCollapse();
          }}
        >
          {/* Left — hamburger (only when sidebar is closed or peeking) + breadcrumb */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className="overflow-hidden shrink-0"
              style={{
                opacity: isClosed ? 1 : 0,
                width: isClosed ? "28px" : "0px",
                transition: sidebarState === "peek"
                  ? "opacity 150ms ease, width 150ms ease"
                  : "none",
              }}
            >
              <button
                onMouseEnter={handleHamburgerEnter}
                onMouseLeave={handleHamburgerLeave}
                onClick={handleHamburgerClick}
                title="Open sidebar (Ctrl+\)"
                className="
                  w-7 h-7 flex flex-col items-center justify-center gap-[4.5px] rounded-md
                  text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
                  hover:bg-zinc-200 dark:hover:bg-zinc-700
                  transition-colors duration-150
                "
              >
                <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
                <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
                <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
              </button>
            </div>

            {/* Breadcrumb */}
            {breadcrumb.length > 0 && (
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                {breadcrumb.map((segment, i) => {
                  const isLast = i === breadcrumb.length - 1;
                  return (
                    <div key={i} className="flex items-center gap-1 min-w-0">
                      {i > 0 && (
                        <span className="shrink-0 text-zinc-300 dark:text-zinc-600 text-xs">/</span>
                      )}
                      <span className={`
                        truncate text-sm
                        ${isLast
                          ? isUntitled
                            ? "text-zinc-400 dark:text-zinc-600"
                            : "text-zinc-600 dark:text-zinc-400"
                          : "text-zinc-400 dark:text-zinc-600"
                        }
                      `}>
                        {isLast && isUntitled ? "Untitled" : segment}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Centre — search */}
          <div className="absolute left-1/2 -translate-x-1/2">
            <button
              onClick={openPalette}
              className="
                flex items-center gap-2 px-3 h-7 rounded-md
                bg-zinc-100 dark:bg-zinc-800
                text-xs text-zinc-400 dark:text-zinc-500
                hover:bg-zinc-200 dark:hover:bg-zinc-700
                transition-colors duration-150
              "
            >
              <svg width="12" height="12" viewBox="0 0 11 11" fill="none">
                <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <span>Search or jump to…</span>
              <kbd className="font-mono text-xs bg-zinc-200 dark:bg-zinc-700 px-1.5 rounded">⌘K</kbd>
            </button>
          </div>

          {/* Right — theme toggle */}
          <div className="flex items-center justify-end flex-1">
            <ThemeToggle />
          </div>
        </header>

        {/* Editor */}
        <main className="flex-1 flex overflow-hidden relative">
          {activeNote ? <Editor /> : <EmptyState />}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}