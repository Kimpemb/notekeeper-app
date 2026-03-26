// src/App.tsx
import { useEffect, useCallback, useState, useRef } from "react";
import { initDb } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import { Sidebar } from "@/features/notes/components/Sidebar";
import { Editor } from "@/features/editor/components/Editor";
import { EmptyState } from "@/features/ui/components/EmptyState";
import { CommandPalette } from "@/features/ui/components/CommandPalette";
import { KeyboardShortcuts } from "@/features/ui/components/KeyboardShortcuts";
import { ImportModal } from "@/features/ui/components/ImportModal";
import { TemplatePickerModal } from "@/features/ui/components/TemplatePickerModal";
import { SettingsModal } from "@/features/ui/components/SettingsModal";
import { TabBar } from "@/features/ui/components/TabBar";
import { SplitDivider } from "@/features/ui/components/SplitDivider";
import { TipsPanel } from "@/features/ui/components/TipsPanel";
import { ThemeToggle } from "@/features/ui/components/ThemeToggle";
import { FileTreePanel } from "@/features/notes/components/FileTree/FileTreePanel";
import { GraphView, type GraphViewHandle } from "@/features/graph/GraphView";
import { exportNotesToFile } from "@/lib/tauri/fs";
import { prosemirrorToMarkdown } from "@/lib/exporters/markdown";
import { exportToPdf } from "@/lib/exporters/pdf";
import { ResurfaceBar } from "@/features/ui/components/ResurfaceBar";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Template } from "@/lib/templates";
import "@/styles/main.css";
import { cancelSidebarCollapse } from "@/lib/sidebarTimer";
import { OnboardingModal, useSampleNotes } from "./features/onboarding";

// Block F5 / Ctrl+R — causes full state loss in Tauri
document.addEventListener("keydown", (e) => {
  if (e.key === "F5") e.preventDefault();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") e.preventDefault();
});

interface BreadcrumbSegment { id: string; title: string; }

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
  const appWindow = getCurrentWindow();
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Store hooks
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const notes = useNoteStore((s) => s.notes);
  const createNoteFromTemplate = useNoteStore((s) => s.createNoteFromTemplate);
  const setActive = useNoteStore((s) => s.setActiveNote);
  const goBack = useNoteStore((s) => s.goBack);
  const goForward = useNoteStore((s) => s.goForward);
  const pane1CanGoBack = useNoteStore((s) => s.canGoBack());
  const pane1CanGoForward = useNoteStore((s) => s.canGoForward());

  // UI store hooks
  const sidebarState = useUIStore((s) => s.sidebarState);
  const setSidebarState = useUIStore((s) => s.setSidebarState);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const togglePalette = useUIStore((s) => s.togglePalette);
  const openShortcuts = useUIStore((s) => s.openShortcuts);
  const openSettings = useUIStore((s) => s.openSettings);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const pane1FileTreeOpen = useUIStore((s) => s.pane1FileTreeOpen);
  const pane2FileTreeOpen = useUIStore((s) => s.pane2FileTreeOpen);
  const toggleFileTree = useUIStore((s) => s.toggleFileTree);
  const toggleBacklinks = useUIStore((s) => s.toggleBacklinks);
  const toggleOutline = useUIStore((s) => s.toggleOutline);
  const templatePickerOpen = useUIStore((s) => s.templatePickerOpen);
  const closeTemplatePicker = useUIStore((s) => s.closeTemplatePicker);
  const toggleTips = useUIStore((s) => s.toggleTips);
  const graphOpen = useUIStore((s) => s.graphOpen);
  const openGraph = useUIStore((s) => s.openGraph);
  const graphFocusNoteId = useUIStore((s) => s.graphFocusNoteId);
  const activePaneId = useUIStore((s) => s.activePaneId);
  const pane2CanGoBack = useUIStore((s) => s.pane2CanGoBack());
  const pane2CanGoForward = useUIStore((s) => s.pane2CanGoForward());
  const pane2GoBack = useUIStore((s) => s.pane2GoBack);
  const pane2GoForward = useUIStore((s) => s.pane2GoForward);
  const tabs = useUIStore((s) => s.tabs);
  const activeTabId = useUIStore((s) => s.activeTabId);
  const openTab = useUIStore((s) => s.openTab);
  const replaceTab = useUIStore((s) => s.replaceTab);
  const closeActiveTab = useUIStore((s) => s.closeActiveTab);
  const cycleTab = useUIStore((s) => s.cycleTab);
  const pane2Tabs = useUIStore((s) => s.pane2Tabs);
  const pane2ActiveTabId = useUIStore((s) => s.pane2ActiveTabId);
  const splitOpen = useUIStore((s) => s.splitOpen);
  const splitDirection = useUIStore((s) => s.splitDirection);
  const setActivePaneId = useUIStore((s) => s.setActivePaneId);

  // App settings
  const settings = useAppSettings((s) => s.settings);
  const updateSetting = useAppSettings((s) => s.updateSetting);
  const settingsLoaded = useAppSettings((s) => s.loaded);

  // Refs
  const graphViewRef = useRef<GraphViewHandle>(null);
  const slideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openInNewTabRef = useRef(false);
  const newNoteParentRef = useRef<string | null>(null);
  const scrollPositions = useRef<Map<string, number>>(new Map());

  const canGoBack = activePaneId === 2 ? pane2CanGoBack : pane1CanGoBack;
  const canGoForward = activePaneId === 2 ? pane2CanGoForward : pane1CanGoForward;
  const isClosed = sidebarState === "closed" || sidebarState === "peek";

  // Track window maximize state
  useEffect(() => {
    appWindow.isMaximized().then(setIsWindowMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsWindowMaximized);
    });
    return () => { unlisten.then(fn => fn()); };
  }, [appWindow]);

  // Bootstrap DB, settings, and notes
  useEffect(() => {
    initDb()
      .then(() => {
        setDbReady(true);
        return Promise.all([
          useUIStore.getState().loadSettings(),
          useAppSettings.getState().load(),
        ]);
      })
      .then(() => loadNotes())
      .catch((err) => setDbError(String(err)));
  }, [loadNotes]);

  // Sample notes insertion - runs after notes are loaded
  useSampleNotes();

  // Onboarding modal trigger
  useEffect(() => {
    if (settingsLoaded && !settings.hasCompletedOnboarding) {
      setShowOnboarding(true);
    }
  }, [settingsLoaded, settings.hasCompletedOnboarding]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    updateSetting('hasCompletedOnboarding', true);
  }, [updateSetting]);

  // Rest of your component remains the same...
  useEffect(() => {
    if (!activeNoteId) return;
    const currentTabNoteId = useUIStore.getState().activeTabNoteId();
    if (currentTabNoteId !== activeNoteId) replaceTab(activeNoteId);
  }, [activeNoteId]);

  useEffect(() => {
    function handle() {
      openInNewTabRef.current = true;
      newNoteParentRef.current = useNoteStore.getState().activeNoteId;
      useUIStore.getState().openTemplatePicker();
    }
    window.addEventListener("notekeeper:new-note-new-tab", handle);
    return () => window.removeEventListener("notekeeper:new-note-new-tab", handle);
  }, []);

  useEffect(() => {
    const noteId = useUIStore.getState().activeTabNoteId();
    if (noteId && noteId !== useNoteStore.getState().activeNoteId) setActive(noteId, true);
  }, [activeTabId]);

  useEffect(() => {
    const noteId = useUIStore.getState().paneActiveNoteId(2);
    if (noteId) useUIStore.getState().pane2PushNav(noteId);
  }, [pane2ActiveTabId]);

  function triggerNav(action: () => void) {
    if (slideTimeout.current) clearTimeout(slideTimeout.current);
    action();
    slideTimeout.current = setTimeout(() => {}, 300);
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!dbReady) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === "Tab") { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }
    if (ctrl && e.key === "k") { e.preventDefault(); togglePalette(); }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openInNewTabRef.current = true;
      newNoteParentRef.current = useNoteStore.getState().activeNoteId;
      useUIStore.getState().openTemplatePicker();
      return;
    }
    if (ctrl && e.key === "t") { e.preventDefault(); toggleFileTree(activePaneId); }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openInNewTabRef.current = false;
      newNoteParentRef.current = useNoteStore.getState().activeNoteId;
      useUIStore.getState().openTemplatePicker();
    }
    if (ctrl && e.key === "\\") { e.preventDefault(); toggleSidebar(); }
    if (ctrl && e.key === ";") { e.preventDefault(); toggleBacklinks(activePaneId); }
    if (ctrl && e.key === "'") { e.preventDefault(); toggleOutline(activePaneId); }
    if (ctrl && e.shiftKey && e.key === "?") { e.preventDefault(); openShortcuts(); }
    if (ctrl && e.key === "w") { e.preventDefault(); closeActiveTab(); }
    if (ctrl && e.key === "[") {
      e.preventDefault();
      if (activePaneId === 2) { triggerNav(pane2GoBack); } else { triggerNav(goBack); }
    }
    if (ctrl && e.key === "]") {
      e.preventDefault();
      if (activePaneId === 2) { triggerNav(pane2GoForward); } else { triggerNav(goForward); }
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      useUIStore.getState().setRefreshStatus("reloading");
      loadNotes().then(() => { useUIStore.getState().setRefreshStatus("reloaded"); });
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      toggleTips();
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (graphOpen) { graphViewRef.current?.animatedClose(); } else { openGraph(); }
    }
    if (ctrl && e.key === ",") {
      e.preventDefault();
      openSettings();
    }
  }, [dbReady, togglePalette, toggleSidebar, toggleFileTree, toggleBacklinks, toggleOutline,
      openShortcuts, openSettings, goBack, goForward, pane2GoBack, pane2GoForward,
      closeActiveTab, cycleTab, graphOpen, openGraph, activePaneId, loadNotes, toggleTips]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function handleTemplateSelect(template: Template) {
    closeTemplatePicker();
    const parentId = newNoteParentRef.current ?? undefined;
    const note = await createNoteFromTemplate(template, parentId ? { parent_id: parentId } : {});

    if (openInNewTabRef.current) {
      if (activePaneId === 2) { openTabInPane2(note.id); } else { openTab(note.id); }
    } else {
      if (activePaneId === 2) { openTabInPane2(note.id); } else { setActive(note.id); replaceTab(note.id); }
    }

    openInNewTabRef.current = false;
    newNoteParentRef.current = null;
  }

  function noteSlug(title: string): string { return title.replace(/[^a-z0-9]/gi, "-").toLowerCase(); }

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  useEffect(() => {
    useUIStore.getState().setExportHandlers({
      exportAll: async () => {
        setExporting(true);
        try { await exportNotesToFile(JSON.stringify(notes, null, 2), "notekeeper-export.json"); }
        catch (err) { console.error("Export failed:", err); } finally { setExporting(false); }
      },
      exportNoteJson: async () => {
        if (!activeNote) return; setExporting(true);
        try { await exportNotesToFile(JSON.stringify([activeNote], null, 2), `${noteSlug(activeNote.title)}.json`); }
        catch (err) { console.error("Export failed:", err); } finally { setExporting(false); }
      },
      exportNoteMarkdown: async () => {
        if (!activeNote) return; setExporting(true);
        try { const md = prosemirrorToMarkdown(activeNote.title, activeNote.content ?? ""); await exportNotesToFile(md, `${noteSlug(activeNote.title)}.md`); }
        catch (err) { console.error("Export failed:", err); } finally { setExporting(false); }
      },
      exportNotePdf: async () => {
        if (!activeNote) return;
        try { await exportToPdf(activeNote.title, activeNote.content ?? ""); }
        catch (err) { console.error("Export failed:", err); }
      },
    });
  }, [notes, activeNote]);

  const breadcrumb = buildBreadcrumb(activeNoteId, notes);
  const isUntitled = activeNote ? /^Untitled-\d+$/.test(activeNote.title) : false;

  function handleHamburgerClick() {
    if (sidebarState === "open") {
      setSidebarState("closed");
    } else {
      setSidebarState("open");
    }
  }

  function renderPane(paneId: 1 | 2) {
    const paneTabs = paneId === 1 ? tabs : pane2Tabs;
    const paneActiveTabId = paneId === 1 ? activeTabId : pane2ActiveTabId;

    return (
      <div className="flex flex-col flex-1 overflow-hidden min-w-0 min-h-0"
        onMouseDown={() => { if (activePaneId !== paneId) setActivePaneId(paneId); }}
      >
        <TabBar paneId={paneId} />
        <div className="flex-1 flex overflow-hidden relative">
          {paneTabs.length === 0 ? <EmptyState /> : paneTabs.map((tab) => {
            const isActive = tab.id === paneActiveTabId;
            return (
              <div key={tab.id} className="flex-1 flex overflow-hidden" style={{ display: isActive ? "flex" : "none" }}>
                <Editor
                  key={tab.noteId}
                  noteId={tab.noteId}
                  paneId={paneId}
                  initialScrollTop={scrollPositions.current.get(tab.noteId) ?? 0}
                  onScrollChange={(top) => scrollPositions.current.set(tab.noteId, top)}
                />
              </div>
            );
          })}
          {(paneId === 1 ? pane1FileTreeOpen : pane2FileTreeOpen) && <FileTreePanel paneId={paneId} />}
        </div>
      </div>
    );
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

  return (
    <>
      <OnboardingModal isOpen={showOnboarding} onComplete={handleOnboardingComplete} />

      <div className="flex h-screen w-screen flex-col overflow-hidden bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden transition-[width,flex] duration-500 ease-in-out">
            <header
              data-tauri-drag-region
              className="flex items-center px-3 h-12 shrink-0 z-50 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 select-none gap-2"
              onMouseEnter={() => { if (useUIStore.getState().sidebarState === "peek") cancelSidebarCollapse(); }}
            >
              <div className="flex items-center gap-0 min-w-0 flex-1">
                <div className="overflow-hidden shrink-0" style={{ opacity: isClosed ? 1 : 0, width: isClosed ? "28px" : "0px", transition: sidebarState === "closed" ? "opacity 250ms ease 100ms, width 250ms ease 100ms" : "none" }}>
                  <button
                    onClick={handleHamburgerClick}
                    title="Open sidebar (Ctrl+\)"
                    className="w-7 h-7 flex flex-col items-center justify-center gap-[4.5px] rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                  >
                    <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
                    <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
                    <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
                  </button>
                </div>

                <button
                  onClick={() => triggerNav(activePaneId === 2 ? pane2GoBack : goBack)}
                  disabled={!canGoBack}
                  title="Go back (Ctrl+'[')"
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button
                  onClick={() => triggerNav(activePaneId === 2 ? pane2GoForward : goForward)}
                  disabled={!canGoForward}
                  title="Go forward (Ctrl+']')"
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 3L9.5 7l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
                            <span className={`truncate text-sm ${isUntitled ? "text-zinc-400 dark:text-zinc-600" : "text-zinc-600 dark:text-zinc-400"}`}>{displayTitle}</span>
                          ) : (
                            <button onClick={() => setActive(segment.id)} title={`Open "${segment.title}"`} className="truncate text-sm text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors duration-100">{displayTitle}</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleFileTree(activePaneId)}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 ${(activePaneId === 1 ? pane1FileTreeOpen : pane2FileTreeOpen) ? "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 3.5a1 1 0 011-1h3l1 1.5h6a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M4 8.5h3M4 6.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                </button>

                <button
                  onClick={() => graphOpen ? graphViewRef.current?.animatedClose() : openGraph()}
                  title="Graph view (Ctrl+Shift+G)"
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 ${graphOpen ? "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
                    <circle cx="2.5" cy="4" r="1.5" fill="currentColor"/>
                    <circle cx="11.5" cy="4" r="1.5" fill="currentColor"/>
                    <circle cx="2.5" cy="10" r="1.5" fill="currentColor"/>
                    <circle cx="11.5" cy="10" r="1.5" fill="currentColor"/>
                    <path d="M7 7L2.5 4M7 7l4.5-3M7 7l-4.5 3M7 7l4.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                </button>

                <button onClick={toggleTips} title="Tips & shortcuts"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    <circle cx="7" cy="4.5" r="0.7" fill="currentColor"/>
                  </svg>
                </button>

                <button onClick={openShortcuts} title="Keyboard shortcuts (Ctrl+Shift+?)"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M5 5.5a2 2 0 113 1.7V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <circle cx="7" cy="10" r="0.7" fill="currentColor"/>
                  </svg>
                </button>

                <button
                  onClick={openSettings}
                  title="Settings (Ctrl+,)"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.1 3.1l.7.7M10.2 10.2l.7.7M10.9 3.1l-.7.7M3.8 10.2l-.7.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </button>

                <ThemeToggle />

                <div className="flex items-center gap-1 ml-2 border-l border-zinc-200 dark:border-zinc-700 pl-2">
                  <button
                    onClick={async () => { const window = getCurrentWindow(); await window.minimize(); }}
                    title="Minimize"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                  >
                    <svg width="12" height="12" viewBox="0 0 10 2" fill="none">
                      <rect width="10" height="1.5" fill="currentColor" />
                    </svg>
                  </button>
                  <button
                    onClick={async () => {
                      const window = getCurrentWindow();
                      const isMax = await window.isMaximized();
                      if (isMax) { await window.unmaximize(); } else { await window.maximize(); }
                    }}
                    title="Maximize"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                  >
                    {isWindowMaximized ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M3 1H9C10.1046 1 11 1.89543 11 3V9C11 10.1046 10.1046 11 9 11H3C1.89543 11 1 10.1046 1 9V3C1 1.89543 1.89543 1 3 1Z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                        <path d="M4 4L8 8M8 4L4 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <rect x="1" y="1" width="10" height="10" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={async () => { const window = getCurrentWindow(); await window.close(); }}
                    title="Close"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:bg-red-500 hover:text-white transition-colors duration-150"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </header>

            <TipsPanel />
            <ResurfaceBar />

            <main className={`flex-1 flex overflow-hidden ${splitOpen && splitDirection === "vertical" ? "flex-col items-stretch" : "flex-row"}`}>
              {renderPane(1)}
              {splitOpen && <><SplitDivider />{renderPane(2)}</>}
            </main>
          </div>
        </div>

        <CommandPalette />
        <KeyboardShortcuts />
        <ImportModal />
        <SettingsModal />
        <TemplatePickerModal
          open={templatePickerOpen}
          onSelect={handleTemplateSelect}
          onCancel={() => { openInNewTabRef.current = false; newNoteParentRef.current = null; closeTemplatePicker(); }}
        />

        {graphOpen && <GraphView ref={graphViewRef} initialFocusNoteId={graphFocusNoteId} />}

        {exporting && (
          <div className="fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg bg-zinc-800 dark:bg-zinc-700 text-xs text-zinc-200 shadow-lg animate-pulse">
            Exporting…
          </div>
        )}
      </div>
    </>
  );
}