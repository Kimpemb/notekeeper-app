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

export default function App() {
  const loadNotes     = useNoteStore((s) => s.loadNotes);
  const activeNote    = useNoteStore((s) => s.activeNote());
  const createNote    = useNoteStore((s) => s.createNote);

  const sidebarOpen   = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openPalette   = useUIStore((s) => s.openPalette);
  const togglePalette = useUIStore((s) => s.togglePalette);

  const [dbReady, setDbReady]   = useState(false);
  const [dbError, setDbError]   = useState<string | null>(null);

  // Init DB and load notes on first mount
  useEffect(() => {
    console.log("[App] initializing DB…");
    initDb()
      .then(() => {
        console.log("[App] DB ready");
        setDbReady(true);
        return loadNotes();
      })
      .then(() => {
        console.log("[App] notes loaded");
      })
      .catch((err) => {
        console.error("[App] DB init failed:", err);
        setDbError(String(err));
      });
  }, [loadNotes]);

  // Global keyboard shortcuts — only active once DB is ready
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!dbReady) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "k") { e.preventDefault(); togglePalette(); }
    if (ctrl && e.key === "n") { e.preventDefault(); createNote().catch(console.error); }
    if (ctrl && e.key === "\\") { e.preventDefault(); toggleSidebar(); }
  }, [dbReady, togglePalette, createNote, toggleSidebar]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // ── DB error screen ────────────────────────────────────────────────────────
  if (dbError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-zinc-950 p-8">
        <div className="max-w-md text-center space-y-3">
          <p className="text-sm font-semibold text-red-500">Failed to initialize database</p>
          <p className="text-xs text-zinc-500 font-mono bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg break-all">
            {dbError}
          </p>
          <p className="text-xs text-zinc-400">
            Check the console for more details. Make sure tauri-plugin-sql is correctly configured.
          </p>
        </div>
      </div>
    );
  }

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (!dbReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white dark:bg-zinc-950">
        <p className="text-xs text-zinc-400 animate-pulse">Loading…</p>
      </div>
    );
  }

  // ── Main app ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">

      {/* Title bar */}
      <header className="
        flex items-center justify-between px-3 h-10 shrink-0
        border-b border-zinc-200 dark:border-zinc-800
        bg-zinc-50 dark:bg-zinc-900
        select-none
      ">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSidebar}
            title="Toggle sidebar (Ctrl+\)"
            className="
              w-7 h-7 flex items-center justify-center rounded-md
              text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
              hover:bg-zinc-200 dark:hover:bg-zinc-700
              transition-colors duration-100
            "
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M2 4h11M2 7.5h11M2 11h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          <span className="text-xs font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-500">
            NoteKeeper
          </span>
        </div>

        <button
          onClick={openPalette}
          className="
            hidden sm:flex items-center gap-2 px-3 h-6 rounded-md
            bg-zinc-100 dark:bg-zinc-800
            text-xs text-zinc-400 dark:text-zinc-500
            hover:bg-zinc-200 dark:hover:bg-zinc-700
            transition-colors duration-100
          "
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <span>Search or jump to…</span>
          <kbd className="font-mono text-[10px] bg-zinc-200 dark:bg-zinc-700 px-1 rounded">⌘K</kbd>
        </button>

        <ThemeToggle />
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {sidebarOpen && (
          <div className="w-px bg-zinc-200 dark:bg-zinc-800 shrink-0" />
        )}
        <main className="flex-1 flex overflow-hidden relative">
          {activeNote ? <Editor /> : <EmptyState />}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}