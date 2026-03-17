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
import { prosemirrorToMarkdown } from "@/lib/exporters/markdown";
import { exportToPdf } from "@/lib/exporters/pdf";
import "@/styles/main.css";
import { cancelSidebarCollapse, scheduleSidebarCollapse } from "@/lib/sidebarTimer";

interface BreadcrumbSegment {
  id: string;
  title: string;
}

function buildBreadcrumb(
  noteId: string | null,
  notes: Array<{ id: string; title: string; parent_id: string | null }>
): BreadcrumbSegment[] {
  if (!noteId) return [];
  const path: BreadcrumbSegment[] = [];
  let current = notes.find((n) => n.id === noteId);
  while (current) {
    path.unshift({ id: current.id, title: current.title });
    if (!current.parent_id) break;
    current = notes.find((n) => n.id === current!.parent_id);
  }
  return path;
}

export default function App() {
  const loadNotes    = useNoteStore((s) => s.loadNotes);
  const activeNote   = useNoteStore((s) => s.activeNote());
  const notes        = useNoteStore((s) => s.notes);
  const createNote   = useNoteStore((s) => s.createNote);
  const setActive    = useNoteStore((s) => s.setActiveNote);
  const goBack       = useNoteStore((s) => s.goBack);
  const goForward    = useNoteStore((s) => s.goForward);
  const canGoBack    = useNoteStore((s) => s.canGoBack());
  const canGoForward = useNoteStore((s) => s.canGoForward());

  const sidebarState    = useUIStore((s) => s.sidebarState);
  const setSidebarState = useUIStore((s) => s.setSidebarState);
  const toggleSidebar   = useUIStore((s) => s.toggleSidebar);
  const togglePalette   = useUIStore((s) => s.togglePalette);
  const openShortcuts   = useUIStore((s) => s.openShortcuts);
  const fileTreeOpen    = useUIStore((s) => s.fileTreeOpen);
  const toggleFileTree  = useUIStore((s) => s.toggleFileTree);
  const toggleBacklinks = useUIStore((s) => s.toggleBacklinks);
  const toggleOutline   = useUIStore((s) => s.toggleOutline);

  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Slide transition state: "left" = sliding in from left, "right" = from right, null = no transition
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const slideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isClosed = sidebarState === "closed" || sidebarState === "peek";

  useEffect(() => {
    initDb()
      .then(() => {
        setDbReady(true);
        useUIStore.getState().loadSettings().catch(console.error);
        return loadNotes();
      })
      .catch((err) => setDbError(String(err)));
  }, [loadNotes]);

  function triggerSlide(dir: "left" | "right", action: () => void) {
    if (slideTimeout.current) clearTimeout(slideTimeout.current);
    setSlideDir(dir);
    action();
    slideTimeout.current = setTimeout(() => setSlideDir(null), 300);
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!dbReady) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "k")               { e.preventDefault(); togglePalette(); }
    if (ctrl && e.key === "n")               { e.preventDefault(); createNote().catch(console.error); }
    if (ctrl && e.key === "\\")              { e.preventDefault(); toggleSidebar(); }
    if (ctrl && e.key === "t")               { e.preventDefault(); toggleFileTree(); }
    if (ctrl && e.key === ";")               { e.preventDefault(); toggleBacklinks(); }
    if (ctrl && e.key === "'")               { e.preventDefault(); toggleOutline(); }
    if (ctrl && e.shiftKey && e.key === "?") { e.preventDefault(); openShortcuts(); }
    if (ctrl && e.key === "[")               { e.preventDefault(); triggerSlide("right", goBack); }
    if (ctrl && e.key === "]")               { e.preventDefault(); triggerSlide("left", goForward); }
  }, [dbReady, togglePalette, createNote, toggleSidebar, toggleFileTree,
      toggleBacklinks, toggleOutline, openShortcuts, goBack, goForward]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function noteSlug(title: string): string {
    return title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  }

  useEffect(() => {
    useUIStore.getState().setExportHandlers({
      exportAll: async () => {
        setExporting(true);
        try { await exportNotesToFile(JSON.stringify(notes, null, 2), "notekeeper-export.json"); }
        catch (err) { console.error("Export failed:", err); }
        finally { setExporting(false); }
      },
      exportNoteJson: async () => {
        if (!activeNote) return;
        setExporting(true);
        try { await exportNotesToFile(JSON.stringify([activeNote], null, 2), `${noteSlug(activeNote.title)}.json`); }
        catch (err) { console.error("Export failed:", err); }
        finally { setExporting(false); }
      },
      exportNoteMarkdown: async () => {
        if (!activeNote) return;
        setExporting(true);
        try {
          const md = prosemirrorToMarkdown(activeNote.title, activeNote.content ?? "");
          await exportNotesToFile(md, `${noteSlug(activeNote.title)}.md`);
        } catch (err) { console.error("Export failed:", err); }
        finally { setExporting(false); }
      },
      exportNotePdf: async () => {
        if (!activeNote) return;
        try { await exportToPdf(activeNote.title, activeNote.content ?? ""); }
        catch (err) { console.error("Export failed:", err); }
      },
    });
  }, [notes, activeNote]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-base text-zinc-400 animate-pulse">Loading…</p>
      </div>
    );
  }

  // Slide animation: back = new note slides in from left, forward = from right
  const slideStyle: React.CSSProperties = slideDir
    ? {
        animation: `slideIn${slideDir === "left" ? "Right" : "Left"} 220ms cubic-bezier(0.25,0.46,0.45,0.94) both`,
      }
    : {};

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(-18px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(18px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <Sidebar />

      <div className="flex flex-col flex-1 overflow-hidden transition-[width,flex] duration-500 ease-in-out">
        <header
          className="flex items-center px-3 h-12 shrink-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none gap-2"
          onMouseEnter={() => {
            if (useUIStore.getState().sidebarState === "peek") cancelSidebarCollapse();
          }}
        >
          {/* Left — hamburger + back/forward + breadcrumb */}
          <div className="flex items-center gap-0 min-w-0 flex-1">
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

            {/* Back / Forward — plain text chevrons, no button background */}
              <button
                onClick={() => triggerSlide("right", goBack)}
                disabled={!canGoBack}
                title="Go back (Ctrl+[)"
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => triggerSlide("left", goForward)}
                disabled={!canGoForward}
                title="Go forward (Ctrl+])"
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 3L9.5 7l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

            {breadcrumb.length > 0 && (
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                {breadcrumb.map((segment, i) => {
                  const isLast = i === breadcrumb.length - 1;
                  const displayTitle = isLast && isUntitled ? "Untitled" : segment.title;
                  return (
                    <div key={segment.id} className="flex items-center gap-1 min-w-0">
                      {i > 0 && <span className="shrink-0 text-zinc-300 dark:text-zinc-600 text-xs">/</span>}
                      {isLast ? (
                        <span className={`truncate text-sm ${isUntitled ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-600 dark:text-zinc-400"}`}>
                          {displayTitle}
                        </span>
                      ) : (
                        <button
                          onClick={() => setActive(segment.id)}
                          title={`Open "${segment.title}"`}
                          className="truncate text-sm text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors duration-100"
                        >
                          {displayTitle}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right — file tree, shortcuts, theme toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={toggleFileTree}
              title="File tree (Ctrl+T)"
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 ${
                fileTreeOpen
                  ? "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                  : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 3.5a1 1 0 011-1h3l1 1.5h6a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                <path d="M4 8.5h3M4 6.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </button>

            <button
              onClick={openShortcuts}
              title="Keyboard shortcuts (Ctrl+Shift+?)"
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
          {activeNote
            ? <div key={activeNote.id} style={slideStyle} className="flex-1 flex overflow-hidden"><Editor /></div>
            : <EmptyState />
          }
          {fileTreeOpen && <FileTreePanel />}
        </main>
      </div>

      <CommandPalette />
      <KeyboardShortcuts />
      <ImportModal />
      {exporting && (
        <div className="fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg bg-zinc-800 dark:bg-zinc-700 text-xs text-zinc-200 shadow-lg animate-pulse">
          Exporting…
        </div>
      )}
    </div>
  );
}