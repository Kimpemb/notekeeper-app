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
import { FileTreePanel } from "@/features/notes/components/FileTree/FileTreePanel";
import { GraphView, type GraphViewHandle } from "@/features/graph/GraphView";
import { exportNotesToFile } from "@/lib/tauri/fs";
import { prosemirrorToMarkdown } from "@/lib/exporters/markdown";
import { exportToPdf } from "@/lib/exporters/pdf";
import { ResurfaceBar } from "@/features/ui/components/ResurfaceBar";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Template } from "@/lib/templates";
import "@/styles/main.css";
import "@/styles/idemora-theme.css";
import { invoke } from "@tauri-apps/api/core";
import { OnboardingModal, useSampleNotes } from "./features/onboarding";
import { UpdateToast } from "@/features/ui/components/UpdateToast";
import { useAIStore } from "./features/ai/store/useAIStore";
import { runScheduledBackupIfDue } from "@/features/backup/lib/scheduler";
import { NewTabScreen } from "@/features/ui/components/NewTabScreen";
import { TagsPanel } from "@/features/notes/components/Sidebar/TagsPanel";
import { BacklinksPanel } from "@/features/editor/components/Editor/BacklinksPanel";
import { OutlinePanel } from "@/features/editor/components/Editor/OutlinePanel";
import { ChatPanel } from "@/features/ai/components/ChatPanel";

document.addEventListener("keydown", (e) => {
  if (e.key === "F5") e.preventDefault();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") e.preventDefault();
});

// Left zone is always 272px when open, 40px when closed.
const LEFT_ZONE_OPEN   = 272;
const LEFT_ZONE_CLOSED = 40;

export default function App() {
  const appWindow = getCurrentWindow();
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [dbReady, setDbReady]     = useState(false);
  const [dbError, setDbError]     = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Note store
  const loadNotes              = useNoteStore((s) => s.loadNotes);
  const activeNoteId           = useNoteStore((s) => s.activeNoteId);
  const notes                  = useNoteStore((s) => s.notes);
  const createNoteFromTemplate = useNoteStore((s) => s.createNoteFromTemplate);
  const setActive              = useNoteStore((s) => s.setActiveNote);

  // UI store
  const activeSidebarPanel  = useUIStore((s) => s.activeSidebarPanel);
  const toggleSidebarPanel  = useUIStore((s) => s.toggleSidebarPanel);
  const togglePalette       = useUIStore((s) => s.togglePalette);
  const openShortcuts       = useUIStore((s) => s.openShortcuts);
  const openSettings        = useUIStore((s) => s.openSettings);
  const openTabInPane2      = useUIStore((s) => s.openTabInPane2);
  const pane1FileTreeOpen   = useUIStore((s) => s.pane1FileTreeOpen);
  const pane2FileTreeOpen   = useUIStore((s) => s.pane2FileTreeOpen);
  const toggleFileTree      = useUIStore((s) => s.toggleFileTree);
  const openBacklinks       = useUIStore((s) => s.openBacklinks);
  const closeBacklinks      = useUIStore((s) => s.closeBacklinks);
  const openOutline         = useUIStore((s) => s.openOutline);
  const closeOutline        = useUIStore((s) => s.closeOutline);
  const templatePickerOpen  = useUIStore((s) => s.templatePickerOpen);
  const closeTemplatePicker = useUIStore((s) => s.closeTemplatePicker);
  const graphOpen           = useUIStore((s) => s.graphOpen);
  const openGraph           = useUIStore((s) => s.openGraph);
  const graphFocusNoteId    = useUIStore((s) => s.graphFocusNoteId);
  const activePaneId        = useUIStore((s) => s.activePaneId);
  const tabs                = useUIStore((s) => s.tabs);
  const activeTabId         = useUIStore((s) => s.activeTabId);
  const openTab             = useUIStore((s) => s.openTab);
  const replaceTab          = useUIStore((s) => s.replaceTab);
  const closeActiveTab      = useUIStore((s) => s.closeActiveTab);
  const cycleTab            = useUIStore((s) => s.cycleTab);
  const pane2Tabs           = useUIStore((s) => s.pane2Tabs);
  const pane2ActiveTabId    = useUIStore((s) => s.pane2ActiveTabId);
  const splitOpen           = useUIStore((s) => s.splitOpen);
  const setActivePaneId     = useUIStore((s) => s.setActivePaneId);
  const pane1BacklinksOpen  = useUIStore((s) => s.pane1BacklinksOpen);
  const pane2BacklinksOpen  = useUIStore((s) => s.pane2BacklinksOpen);
  const pane1OutlineOpen    = useUIStore((s) => s.pane1OutlineOpen);
  const pane2OutlineOpen    = useUIStore((s) => s.pane2OutlineOpen);
  const chatOpen1           = useUIStore((s) => s.chatOpen1);
  const chatOpen2           = useUIStore((s) => s.chatOpen2);
  const activeEditor = useUIStore((s) => s.activeEditor);
  const openEmptyTab = useUIStore((s) => s.openEmptyTab);

  
  // Right panel state from store (single source of truth)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);

  // Add these with the other UI store hooks
const openTags = useUIStore((s) => s.openTags);
const closeTags = useUIStore((s) => s.closeTags);
const pane1TagsOpen = useUIStore((s) => s.pane1TagsOpen);
const pane2TagsOpen = useUIStore((s) => s.pane2TagsOpen);

  // App settings
  const settings       = useAppSettings((s) => s.settings);
  const updateSetting  = useAppSettings((s) => s.updateSetting);
  const settingsLoaded = useAppSettings((s) => s.loaded);

  // Refs
  const graphViewRef     = useRef<GraphViewHandle>(null);
  const slideTimeout     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openInNewTabRef  = useRef(false);
  const newNoteParentRef = useRef<string | null>(null);
  const scrollPositions  = useRef<Map<string, number>>(new Map());

  // Right panel active states
const tagsActive = activePaneId === 1 ? pane1TagsOpen : pane2TagsOpen;
  const backlinkActive = activePaneId === 1 ? pane1BacklinksOpen : pane2BacklinksOpen;
  const outlineActive  = activePaneId === 1 ? pane1OutlineOpen   : pane2OutlineOpen;
  const chatActive     = activePaneId === 1 ? chatOpen1          : chatOpen2;

  const panelOpen     = activeSidebarPanel !== null;
  const leftZoneWidth = panelOpen ? LEFT_ZONE_OPEN : LEFT_ZONE_CLOSED;

  useEffect(() => {
    function preventZoom(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) {
        e.preventDefault();
      }
    }
    function preventWheelZoom(e: WheelEvent) {
      if (e.ctrlKey) e.preventDefault();
    }
    window.addEventListener("keydown", preventZoom);
    window.addEventListener("wheel", preventWheelZoom, { passive: false });
    return () => {
      window.removeEventListener("keydown", preventZoom);
      window.removeEventListener("wheel", preventWheelZoom);
    };
  }, []);

  useEffect(() => {
    appWindow.isMaximized().then(setIsWindowMaximized);
  }, [appWindow]);

  useEffect(() => {
    initDb()
      .then(async () => {
        setDbReady(true);
        return Promise.all([
          useUIStore.getState().loadSettings(),
          useAppSettings.getState().load(),
          useAIStore.getState().loadAISettings(),
        ]);
      })
      .then(() => loadNotes())
      .then(() => runScheduledBackupIfDue())
      .catch((err) => setDbError(String(err)));
  }, [loadNotes]);

  useSampleNotes();

  useEffect(() => {
    if (settingsLoaded && !settings.hasCompletedOnboarding) setShowOnboarding(true);
  }, [settingsLoaded, settings.hasCompletedOnboarding]);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    updateSetting("hasCompletedOnboarding", true);
  }, [updateSetting]);

  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!dbReady) return;
    async function checkForUpdates() {
      try {
        const version = await invoke<string | null>("check_for_updates");
        if (version) setUpdateVersion(version);
      } catch (err) {
        console.error("Updater error:", err);
      }
    }
    checkForUpdates();
  }, [dbReady]);

  useEffect(() => {
    if (!activeNoteId) return;
    const currentTabNoteId = useUIStore.getState().activeTabNoteId();
    if (currentTabNoteId === null) return;
    if (currentTabNoteId !== activeNoteId) replaceTab(activeNoteId);
  }, [activeNoteId]);

  useEffect(() => {
    function handle() {
      openInNewTabRef.current = true;
      newNoteParentRef.current = useNoteStore.getState().activeNoteId;
      useUIStore.getState().openTemplatePicker();
    }
    window.addEventListener("idemora:new-note-new-tab", handle);
    return () => window.removeEventListener("idemora:new-note-new-tab", handle);
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
    if (ctrl && e.key === "k")   { e.preventDefault(); togglePalette(); }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openInNewTabRef.current = true;
      newNoteParentRef.current = useNoteStore.getState().activeNoteId;
      useUIStore.getState().openTemplatePicker();
      return;
    }
  if (ctrl && e.key === "t") { e.preventDefault(); openEmptyTab(); }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openInNewTabRef.current = false;
      newNoteParentRef.current = useNoteStore.getState().activeNoteId;
      useUIStore.getState().openTemplatePicker();
    }
    if (ctrl && e.key === "\\") { e.preventDefault(); toggleSidebarPanel("notes"); }
    if (ctrl && e.key === ";")  { 
  e.preventDefault(); 
  if (!rightPanelOpen) setRightPanelOpen(true);  // ADD THIS LINE
  backlinkActive ? closeBacklinks(activePaneId) : openBacklinks(activePaneId);
}
    if (ctrl && e.key === "'")  { 
  e.preventDefault(); 
  if (!rightPanelOpen) setRightPanelOpen(true);  // ADD THIS LINE
  outlineActive ? closeOutline(activePaneId) : openOutline(activePaneId);
}
    if (ctrl && e.shiftKey && e.key === "?") { e.preventDefault(); openShortcuts(); }
    if (ctrl && e.key === "w")  { e.preventDefault(); closeActiveTab(); }
    if (ctrl && e.key === "[") {
      e.preventDefault();
      const { pane2GoBack } = useUIStore.getState();
      const { canGoBack, goBack } = useNoteStore.getState();
      if (activePaneId === 2) { triggerNav(pane2GoBack); } else if (canGoBack()) { triggerNav(goBack); }
    }
    if (ctrl && e.key === "]") {
      e.preventDefault();
      const { pane2GoForward } = useUIStore.getState();
      const { canGoForward, goForward } = useNoteStore.getState();
      if (activePaneId === 2) { triggerNav(pane2GoForward); } else if (canGoForward()) { triggerNav(goForward); }
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "a") {
  e.preventDefault();
  if (!rightPanelOpen) setRightPanelOpen(true);  // ADD THIS LINE
  const { openChat, closeChat } = useUIStore.getState();
  const chatOpen = activePaneId === 2 ? chatOpen2 : chatOpen1;
  chatOpen ? closeChat(activePaneId) : openChat(activePaneId);
}
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      useUIStore.getState().setRefreshStatus("reloading");
      loadNotes().then(() => { useUIStore.getState().setRefreshStatus("reloaded"); });
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (graphOpen) { graphViewRef.current?.animatedClose(); } else { openGraph(); }
    }
    if (ctrl && e.key === ",") { e.preventDefault(); openSettings(); }
  }, [dbReady, togglePalette, toggleSidebarPanel, toggleFileTree, openBacklinks, closeBacklinks, openOutline, closeOutline,
    openShortcuts, openSettings, closeActiveTab, cycleTab, graphOpen, openGraph, activePaneId, loadNotes, backlinkActive, outlineActive, setRightPanelOpen]);

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
    openInNewTabRef.current  = false;
    newNoteParentRef.current = null;
  }

  function noteSlug(title: string): string {
    return title.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  }

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  useEffect(() => {
    useUIStore.getState().setExportHandlers({
      exportAll: async () => {
        setExporting(true);
        try { await exportNotesToFile(JSON.stringify(notes, null, 2), "idemora-export.json"); }
        catch (err) { console.error("Export failed:", err); } finally { setExporting(false); }
      },
      exportNoteJson: async () => {
        if (!activeNote) return;
        setExporting(true);
        try { await exportNotesToFile(JSON.stringify([activeNote], null, 2), `${noteSlug(activeNote.title)}.json`); }
        catch (err) { console.error("Export failed:", err); } finally { setExporting(false); }
      },
      exportNoteMarkdown: async () => {
        if (!activeNote) return;
        setExporting(true);
        try {
          const md = prosemirrorToMarkdown(activeNote.title, activeNote.content ?? "", activeNote.tags, activeNote.frontmatter);
          await exportNotesToFile(md, `${noteSlug(activeNote.title)}.md`);
        } catch (err) { console.error("Export failed:", err); } finally { setExporting(false); }
      },
      exportNotePdf: async () => {
        if (!activeNote) return;
        try { await exportToPdf(activeNote.title, activeNote.content ?? ""); }
        catch (err) { console.error("Export failed:", err); }
      },
    });
  }, [notes, activeNote]);

  function renderPane(paneId: 1 | 2) {
    const paneTabs        = paneId === 1 ? tabs        : pane2Tabs;
    const paneActiveTabId = paneId === 1 ? activeTabId : pane2ActiveTabId;
    return (
      <div
        className="flex flex-col flex-1 overflow-hidden min-w-0 min-h-0"
        onMouseDown={() => { if (activePaneId !== paneId) setActivePaneId(paneId); }}
      >
        <div className="flex-1 flex overflow-hidden relative">
          {paneTabs.length === 0 ? <EmptyState /> : paneTabs.map((tab) => {
            const isActive = tab.id === paneActiveTabId;
            return (
              <div key={tab.id} className="flex-1 flex overflow-hidden" style={{ display: isActive ? "flex" : "none" }}>
                {tab.noteId === null ? (
                  <NewTabScreen paneId={paneId} />
                ) : (
                  (() => {
                    const noteId = tab.noteId;
                    return (
                      <Editor
                        key={noteId}
                        noteId={noteId}
                        paneId={paneId}
                        initialScrollTop={scrollPositions.current.get(noteId) ?? 0}
                        onScrollChange={(top) => scrollPositions.current.set(noteId, top)}
                      />
                    );
                  })()
                )}
              </div>
            );
          })}
          {(paneId === 1 ? pane1FileTreeOpen : pane2FileTreeOpen) && <FileTreePanel paneId={paneId} />}
        </div>
      </div>
    );
  }

  // ── Error / loading screens ───────────────────────────────────────────────
  if (dbError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-idemora-bg-primary p-8">
        <div className="max-w-md text-center space-y-3">
          <p className="text-base font-semibold text-red-500">Failed to initialize database</p>
          <p className="text-sm text-idemora-text-muted font-mono bg-idemora-bg-secondary p-3 rounded-lg border border-idemora-border break-all">{dbError}</p>
          <p className="text-sm text-idemora-text-faint">Check the console for more details.</p>
        </div>
      </div>
    );
  }

  if (!dbReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-idemora-bg-primary">
        <p className="text-base text-idemora-text-muted animate-pulse">Loading…</p>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <>
      <OnboardingModal isOpen={showOnboarding} onComplete={handleOnboardingComplete} />

      <div className="flex h-screen w-screen flex-col overflow-hidden bg-idemora-bg-primary text-idemora-text-normal">

        {/* ── Header — full width across the top ── */}
        <header
  data-tauri-drag-region
  className="flex items-center h-11 shrink-0 z-50 bg-idemora-bg-header select-none"
>
  {/* LEFT ZONE */}
  <div
    className="flex items-center gap-1 px-2 shrink-0 overflow-hidden transition-[width] duration-150 ease-in-out"
    style={{ width: `${leftZoneWidth}px` }}
  >
    <button
      onClick={() => toggleSidebarPanel(activeSidebarPanel ?? "notes")}
      title={panelOpen ? "Collapse sidebar" : "Expand sidebar"}
      className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-150
        ${panelOpen
          ? "text-idemora-text-normal bg-blue-500/10"
          : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"
        }`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20">
        <rect x="1" y="1" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4.5 4 Q3 4 3 6.5 L3 13.5 Q3 16 4.5 16 L7 16 Q8.5 16 8.5 14.5 L8.5 5.5 Q8.5 4 7 4 Z" fill="currentColor" opacity={panelOpen ? 1 : 0.4}/>
      </svg>
    </button>

    {panelOpen && (
      <div className="flex items-center gap-1">
        {["notes", "search", "bookmarks"].map((id) => (
          <button
            key={id}
            onClick={() => toggleSidebarPanel(id as any)}
            className={`relative shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors
              ${activeSidebarPanel === id ? "text-idemora-text-normal" : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"}`}
          >
            {activeSidebarPanel === id && <span className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full bg-blue-500" />}
            {id === "notes" && (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 5.5a1.5 1.5 0 011.5-1.5h3.5L9 6.5h5.5a1.5 1.5 0 011.5 1.5v5.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 012 13.5v-8z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {id === "search" && (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="7.5" cy="7.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M11 11l4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            )}
            {id === "bookmarks" && (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M5 2.5h8a1.5 1.5 0 011.5 1.5v11l-5.5-3-5.5 3V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        ))}
      </div>
    )}
  </div>

  {/* CENTER ZONE - TABS */}
  <TabBar />

  {/* RIGHT ZONE - REORDERED: Power switch FIRST, then sliding buttons */}
  <div className="flex items-center gap-1 px-2 shrink-0">
    
    {/* POWER SWITCH BUTTON - now FIRST in the right zone */}
    <button
      onClick={() => {
        toggleRightPanel();
        // When closing and tags panel is open, close it too
        if (rightPanelOpen && activeSidebarPanel === "tags") {
          toggleSidebarPanel("tags");
        }
      }}
      className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-all duration-150
        ${rightPanelOpen 
          ? "text-blue-500 bg-blue-500/10" 
          : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"
        }`}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" style={{ transform: "scaleX(-1)" }}>
        <rect x="1" y="1" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4.5 4 Q3 4 3 6.5 L3 13.5 Q3 16 4.5 16 L7 16 Q8.5 16 8.5 14.5 L8.5 5.5 Q8.5 4 7 4 Z" fill="currentColor" opacity={rightPanelOpen ? 1 : 0.4}/>
      </svg>
    </button>

    {/* SLIDING BUTTONS CONTAINER - now to the RIGHT of power switch */}
    <div 
      className={`flex items-center gap-1 transition-all duration-200 ease-in-out overflow-hidden ${
        rightPanelOpen 
          ? "w-auto opacity-100 ml-0" 
          : "w-0 opacity-0 -ml-1"
      }`}
    >
      {/* Tags button */}
      <button
        onClick={() => {
          if (!rightPanelOpen) setRightPanelOpen(true);
          tagsActive ? closeTags(activePaneId) : openTags(activePaneId);
        }}
        className={`relative w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${
          tagsActive 
            ? "text-idemora-text-normal" 
            : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"
        }`}
      >
        {tagsActive && <span className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full bg-blue-500" />}
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M2 2h6.5l8 8-6.5 6.5-8-8V2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          <circle cx="5.5" cy="5.5" r="1.2" fill="currentColor"/>
        </svg>
      </button>

      {/* Backlinks button */}
      <button
        onClick={() => backlinkActive ? closeBacklinks(activePaneId) : openBacklinks(activePaneId)}
        className={`relative w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${
          backlinkActive 
            ? "text-idemora-text-normal" 
            : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"
        }`}
      >
        {backlinkActive && <span className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full bg-blue-500" />}
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11.5 5h-5a1.5 1.5 0 00-1.5 1.5v5a1.5 1.5 0 001.5 1.5h5a1.5 1.5 0 001.5-1.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <path d="M9 2.5h5v5M13.5 2.5L9 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Outline button */}
      <button
        onClick={() => outlineActive ? closeOutline(activePaneId) : openOutline(activePaneId)}
        className={`relative w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${
          outlineActive 
            ? "text-idemora-text-normal" 
            : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"
        }`}
      >
        {outlineActive && <span className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full bg-blue-500" />}
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M2.5 4.5h13M2.5 9h9M2.5 13.5h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Chat button */}
      <button
        onClick={() => {
          const { openChat, closeChat } = useUIStore.getState();
          chatActive ? closeChat(activePaneId) : openChat(activePaneId);
        }}
        className={`relative w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${
          chatActive 
            ? "text-idemora-text-normal" 
            : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"
        }`}
      >
        {chatActive && <span className="absolute bottom-1 left-2 right-2 h-0.5 rounded-full bg-blue-500" />}
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M2.5 2.5h13a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5h-4.5l-4 2.5v-2.5h-4.5A1.5 1.5 0 011 12V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          <path d="M5.5 8h7M5.5 5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>

    {/* Separator line */}
    <div className="w-px h-5 bg-idemora-border/50 mx-1 shrink-0" />

    {/* WINDOW CONTROLS */}
    <button onClick={async () => (await getCurrentWindow()).minimize()} className="w-8 h-8 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/6 dark:hover:bg-white/7 transition-colors">
      <svg width="14" height="14" viewBox="0 0 14 2" fill="none"><rect width="14" height="1.5" fill="currentColor"/></svg>
    </button>

    <button 
      onClick={async () => {
        const w = getCurrentWindow();
        (await w.isMaximized()) ? await w.unmaximize() : await w.maximize();
      }} 
      className="w-8 h-8 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/6 dark:hover:bg-white/7 transition-colors"
    >
      {isWindowMaximized ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3.5 1.5h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2v-7a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.3" fill="none"/>
          <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="1.5" width="11" height="11" stroke="currentColor" strokeWidth="1.3" fill="none"/>
        </svg>
      )}
    </button>

    <button onClick={async () => (await getCurrentWindow()).close()} className="w-8 h-8 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-red-500/80 hover:text-white transition-colors">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
    </button>
  </div>
</header>

        <TipsPanel />
        <ResurfaceBar />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          
          <main className="flex-1 flex overflow-hidden min-w-0">
            {/* Main content area */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 flex overflow-hidden">
                {renderPane(1)}
                {splitOpen && <><SplitDivider />{renderPane(2)}</>}
              </div>
            </div>

            {/* Right panels column - visibility controlled by rightPanelOpen */}
            {rightPanelOpen && (
  <div className="flex shrink-0 border-l border-idemora-border">
    {tagsActive && <TagsPanel />}
    {backlinkActive && activeNoteId && (
      <BacklinksPanel noteId={activeNoteId} paneId={activePaneId} />
    )}
    {outlineActive && activeEditor && (
      <OutlinePanel editor={activeEditor} paneId={activePaneId} />
    )}
    {chatActive && <ChatPanel noteId={activeNoteId ?? ""} paneId={activePaneId} />}
  </div>
)}
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
        <div className="fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg bg-idemora-bg-secondary border border-idemora-border text-idemora-text-muted shadow-lg animate-pulse">
          Exporting…
        </div>
      )}

      {updateVersion && (
        <UpdateToast version={updateVersion} onDismiss={() => setUpdateVersion(null)} />
      )}
    </>
  );
}