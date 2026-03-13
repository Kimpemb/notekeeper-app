// src/App.tsx
import { useEffect, useCallback, useState, useRef } from "react";
import { initDb } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { Sidebar } from "@/features/notes/components/Sidebar";
import { Editor } from "@/features/editor/components/Editor";
import { EmptyState } from "@/features/ui/components/EmptyState";
import { CommandPalette } from "@/features/ui/components/CommandPalette";
import { KeyboardShortcuts } from "@/features/ui/components/KeyboardShortcuts";
import { ImportModal } from "@/features/ui/components/ImportModal";
import { ThemeToggle } from "@/features/ui/components/ThemeToggle";
import { FileTreePanel } from "@/features/notes/components/FileTree/FileTreePanel";
import { exportNotesToFile } from "@/lib/tauri/fs";
import "@/styles/main.css";
import { cancelSidebarCollapse, scheduleSidebarCollapse } from "@/lib/sidebarTimer";

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

export default function App() {
  const loadNotes      = useNoteStore((s) => s.loadNotes);
  const activeNote     = useNoteStore((s) => s.activeNote());
  const notes          = useNoteStore((s) => s.notes);
  const createNote     = useNoteStore((s) => s.createNote);

  const sidebarState   = useUIStore((s) => s.sidebarState);
  const setSidebarState = useUIStore((s) => s.setSidebarState);
  const toggleSidebar  = useUIStore((s) => s.toggleSidebar);
  const openPalette    = useUIStore((s) => s.openPalette);
  const togglePalette  = useUIStore((s) => s.togglePalette);
  const openShortcuts  = useUIStore((s) => s.openShortcuts);
  const openImport     = useUIStore((s) => s.openImport);
  const fileTreeOpen   = useUIStore((s) => s.fileTreeOpen);
  const toggleFileTree = useUIStore((s) => s.toggleFileTree);

  const [dbReady, setDbReady]       = useState(false);
  const [dbError, setDbError]       = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting]   = useState(false);
  const exportRef                   = useRef<HTMLDivElement>(null);

  const isClosed = sidebarState === "closed" || sidebarState === "peek";

  useEffect(() => {
    initDb()
      .then(() => { setDbReady(true); return loadNotes(); })
      .catch((err) => setDbError(String(err)));
  }, [loadNotes]);

  useEffect(() => {
    if (!exportOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [exportOpen]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!dbReady) return;
    const target = e.target as HTMLElement;
    const isEditing = target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "k")       { e.preventDefault(); togglePalette(); }
    if (ctrl && e.key === "n")       { e.preventDefault(); createNote().catch(console.error); }
    if (ctrl && e.key === "\\")      { e.preventDefault(); toggleSidebar(); }
    if (ctrl && e.key === "t")       { e.preventDefault(); toggleFileTree(); }
    if (e.key === "?" && !isEditing) { e.preventDefault(); openShortcuts(); }
  }, [dbReady, togglePalette, createNote, toggleSidebar, toggleFileTree, openShortcuts]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const breadcrumb = buildBreadcrumb(activeNote?.id ?? null, notes);
  const isUntitled = activeNote ? /^Untitled-\d+$/.test(activeNote.title) : false;

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

  async function handleExportAll() {
    setExporting(true); setExportOpen(false);
    try {
      await exportNotesToFile(JSON.stringify(notes, null, 2), "notekeeper-export.json");
    } catch (err) { console.error("Export failed:", err); }
    finally { setExporting(false); }
  }

  async function handleExportNote() {
    if (!activeNote) return;
    setExporting(true); setExportOpen(false);
    try {
      const slug = activeNote.title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      await exportNotesToFile([`# ${activeNote.title}`, "", activeNote.plaintext ?? ""].join("\n"), `${slug}.md`);
    } catch (err) { console.error("Export failed:", err); }
    finally { setExporting(false); }
  }

  async function handleExportNoteJson() {
    if (!activeNote) return;
    setExporting(true); setExportOpen(false);
    try {
      const slug = activeNote.title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
      await exportNotesToFile(JSON.stringify([activeNote], null, 2), `${slug}.json`);
    } catch (err) { console.error("Export failed:", err); }
    finally { setExporting(false); }
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
      <Sidebar />

      <div className="flex flex-col flex-1 overflow-hidden transition-[width,flex] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]">
        <header
          className="relative flex items-center px-3 h-12 shrink-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none"
          onMouseEnter={() => {
            if (useUIStore.getState().sidebarState === "peek") cancelSidebarCollapse();
          }}
        >
          {/* Left — hamburger + breadcrumb */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div
              className="overflow-hidden shrink-0"
              style={{
                opacity: isClosed ? 1 : 0,
                width: isClosed ? "28px" : "0px",
                transition: sidebarState === "closed"
                  ? "opacity 250ms ease 100ms, width 250ms ease 100ms"
                  : "none",
              }}
            >
              <button
                onMouseEnter={handleHamburgerEnter}
                onMouseLeave={handleHamburgerLeave}
                onClick={handleHamburgerClick}
                title="Open sidebar (Ctrl+\)"
                className="w-7 h-7 flex flex-col items-center justify-center gap-[4.5px] rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
              >
                <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
                <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
                <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
              </button>
            </div>

            {breadcrumb.length > 0 && (
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                {breadcrumb.map((segment, i) => {
                  const isLast = i === breadcrumb.length - 1;
                  return (
                    <div key={i} className="flex items-center gap-1 min-w-0">
                      {i > 0 && <span className="shrink-0 text-zinc-300 dark:text-zinc-600 text-xs">/</span>}
                      <span className={`truncate text-sm ${isLast ? isUntitled ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-600 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-600"}`}>
                        {isLast && isUntitled ? "Untitled" : segment}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Centre — search + export + import */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 max-w-[min(420px,40vw)]">
            <button
              onClick={openPalette}
              className="flex items-center gap-2 px-3 h-7 rounded-md min-w-0 bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-400 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150 overflow-hidden"
            >
              <svg width="12" height="12" viewBox="0 0 11 11" fill="none" className="shrink-0">
                <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <span className="truncate">Search or jump to…</span>
              <kbd className="font-mono text-xs bg-zinc-200 dark:bg-zinc-700 px-1.5 rounded shrink-0">⌘K</kbd>
            </button>

            <div ref={exportRef} className="relative">
              <button
                onClick={() => setExportOpen((o) => !o)}
                disabled={exporting}
                title="Export"
                className="flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-400 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150 disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v7M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M1 9v1a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <span>Export</span>
              </button>

              {exportOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
                  <button onClick={handleExportAll} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors duration-100">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M4 6.5h5M4 4.5h5M4 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    Export all notes (JSON)
                  </button>
                  <div className="mx-3 border-t border-zinc-100 dark:border-zinc-800" />
                  <button onClick={handleExportNote} disabled={!activeNote} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                    Export current note (MD)
                  </button>
                  <button onClick={handleExportNoteJson} disabled={!activeNote} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M4 7h5M4 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                    Export current note (JSON)
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={openImport}
              title="Import notes"
              className="flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-400 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 8V1M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M1 9v1a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <span>Import</span>
            </button>
          </div>

          {/* Right — file tree + shortcuts + theme */}
          <div className="flex items-center justify-end gap-1 flex-1">
            <button
              onClick={toggleFileTree}
              title="File tree (Ctrl+T)"
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 ${fileTreeOpen ? "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 3.5a1 1 0 011-1h3l1 1.5h6a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                <path d="M4 8.5h3M4 6.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </button>

            <button
              onClick={openShortcuts}
              title="Keyboard shortcuts (?)"
              className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M5 5.5a2 2 0 113 1.7V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <circle cx="7" cy="10" r="0.7" fill="currentColor"/>
              </svg>
            </button>

            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden relative">
          {activeNote ? <Editor /> : <EmptyState />}
          {fileTreeOpen && <FileTreePanel />}
        </main>
      </div>

      <CommandPalette />
      <KeyboardShortcuts />
      <ImportModal />
    </div>
  );
}
