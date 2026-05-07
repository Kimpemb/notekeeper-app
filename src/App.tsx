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
import { CanvasWorkspace } from "@/features/canvas/components/CanvasWorkspace";
import { MoveBlockModal } from "@/features/ui/components/MoveBlockModal";
// PATCH: 1. Add import near the top with other modal imports
import { AISetupModal } from "@/features/ai/components/AISetupModal";
import { setDev429Simulation } from "@/features/ai/lib/client"


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
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [moveBlockOpen, setMoveBlockOpen] = useState(false);
  // PATCH: 2. Add state variable near the other useState declarations
  const [showAISetup, setShowAISetup] = useState(false);

  const moveBlockDetailRef = useRef<{
    nodeJson:         unknown;
    deleteFromSource: () => void;
  } | null>(null);

  // Note store
  const loadNotes              = useNoteStore((s) => s.loadNotes);
  const activeNoteId           = useNoteStore((s) => s.activeNoteId);
  const notes                  = useNoteStore((s) => s.notes);
  const createNoteFromTemplate = useNoteStore((s) => s.createNoteFromTemplate);
  const setActive              = useNoteStore((s) => s.setActiveNote);
  const setDbSettled           = useNoteStore((s) => s.setDbSettled);

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
  let cancelled = false;

  initDb()
    .then(async () => {
      if (cancelled) return;
      setDbReady(true);
      return Promise.all([
        useUIStore.getState().loadSettings(),
        useAppSettings.getState().load(),
        useAIStore.getState().loadAISettings(),
      ]);
    })
    .then(() => { if (!cancelled) return loadNotes(); })
    .then(() => {
      if (cancelled) return;
      setNotesLoaded(true);
      setTimeout(() => { if (!cancelled) setDbSettled(); }, 6000);
      return runScheduledBackupIfDue();
    })
    .catch((err) => { if (!cancelled) setDbError(String(err)); });

  return () => { cancelled = true; };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  useSampleNotes();

useEffect(() => {
  const unsub = useNoteStore.subscribe((state, prev) => {
    if (prev.notes.length > 0 && state.notes.length === 0) {
      console.error("[WIPE] notes array went to 0", new Error().stack);
    } else if (prev.notes.length > 0 && state.notes.length < prev.notes.length) {
      console.warn(`[SHRINK] notes dropped from ${prev.notes.length} to ${state.notes.length}`, new Error().stack);
    }
  });
  return unsub;
}, []);

useEffect(() => {
  if (!dbReady) console.error("[dbReady flipped false]", new Error().stack);
}, [dbReady]);

useEffect(() => {
  if (!notesLoaded) console.error("[notesLoaded flipped false]", new Error().stack);
}, [notesLoaded]);

  useEffect(() => {
    if (settingsLoaded && !settings.hasCompletedOnboarding) setShowOnboarding(true);
  }, [settingsLoaded, settings.hasCompletedOnboarding]);

useEffect(() => {
  // PATCH: Add dev testing hook
  (window as any).__aiTest = { setDev429Simulation }
}, [])

  // PATCH: 3. Add effect near the onboarding effect (after it, so it fires after)
  useEffect(() => {
  if (
    settingsLoaded &&
    settings.hasCompletedOnboarding &&
    !settings.hasSeenAISetup
  ) {
    setShowAISetup(true);
  }
}, [settingsLoaded, settings.hasCompletedOnboarding, settings.hasSeenAISetup]);

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
    function handle() {
      openInNewTabRef.current = true;
      newNoteParentRef.current = useNoteStore.getState().activeNoteId;
      useUIStore.getState().openTemplatePicker();
    }
    window.addEventListener("idemora:new-note-new-tab", handle);
    return () => window.removeEventListener("idemora:new-note-new-tab", handle);
  }, []);

  useEffect(() => {
    function handle(e: Event) {
      const detail = (e as CustomEvent).detail as {
        nodeJson:         unknown;
        deleteFromSource: () => void;
      };
      moveBlockDetailRef.current = detail;
      setMoveBlockOpen(true);
    }
    window.addEventListener("idemora:move-block", handle);
    return () => window.removeEventListener("idemora:move-block", handle);
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

  async function handleMoveBlockConfirm(destNoteId: string) {
    const detail = moveBlockDetailRef.current;
    if (!detail) return;

    const { nodeJson, deleteFromSource } = detail;
    const destNote = notes.find((n) => n.id === destNoteId);
    if (!destNote) return;

    // Parse destination content and append the block node JSON
    let content: { type: string; content?: unknown[] };
    try {
      content = destNote.content ? JSON.parse(destNote.content) : { type: "doc", content: [] };
    } catch {
      content = { type: "doc", content: [] };
    }

    if (!Array.isArray(content.content)) content.content = [];
    content.content.push(nodeJson);

    // Persist the updated destination note
    await useNoteStore.getState().updateNote(destNoteId, {
      content: JSON.stringify(content),
    });

    // Remove block from source editor
    deleteFromSource();

    moveBlockDetailRef.current = null;
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

  // Derive this pane's panel states directly (not from activePaneId)
  const paneBacklinksOpen = paneId === 1 ? pane1BacklinksOpen : pane2BacklinksOpen;
  const paneOutlineOpen   = paneId === 1 ? pane1OutlineOpen   : pane2OutlineOpen;
  const paneChatOpen      = paneId === 1 ? chatOpen1          : chatOpen2;
  const paneTagsOpen      = paneId === 1 ? pane1TagsOpen      : pane2TagsOpen;
  const paneNoteId        = paneTabs.find(t => t.id === paneActiveTabId)?.noteId ?? null;

  // Only show inline panels when right panel bar is open AND this pane is active
  const showPanels = rightPanelOpen && activePaneId === paneId;

  return (
    <div
      className="flex flex-1 overflow-hidden min-w-0 min-h-0"
      onMouseDown={() => { if (activePaneId !== paneId) setActivePaneId(paneId); }}
    >
      {/* Editor column */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0 min-h-0">
        <div className="flex-1 flex overflow-hidden relative">
          {paneTabs.length === 0 ? <EmptyState /> : paneTabs.map((tab) => {
            const isActive = tab.id === paneActiveTabId;
            return (
              <div key={tab.noteId && notes.find(n => n.id === tab.noteId)?.is_canvas ? `${tab.id}-${isActive}` : tab.id} className="flex-1 flex overflow-hidden" style={{ display: isActive ? "flex" : "none" }}>
                {tab.noteId === null ? (
                  <NewTabScreen paneId={paneId} />
                ) : (() => {
                  const noteId = tab.noteId!;
                  const note = notes.find((n) => n.id === noteId);
                  return note?.is_canvas
                    ? <CanvasWorkspace key={noteId} noteId={noteId} paneId={paneId} />
                    : <Editor
                        key={noteId}
                        noteId={noteId}
                        paneId={paneId}
                        initialScrollTop={scrollPositions.current.get(noteId) ?? 0}
                        onScrollChange={(top) => scrollPositions.current.set(noteId, top)}
                      />;
                })()}
              </div>
            );
          })}
          {(paneId === 1 ? pane1FileTreeOpen : pane2FileTreeOpen) && <FileTreePanel paneId={paneId} />}
        </div>
      </div>

      {/* Inline panels for this pane */}
      {showPanels && (
        <div className="flex shrink-0 border-l border-idemora-border">
          {paneTagsOpen && <TagsPanel />}
          {paneBacklinksOpen && paneNoteId && (
            <BacklinksPanel noteId={paneNoteId} paneId={paneId} />
          )}
          {paneOutlineOpen && activeEditor && (
            <OutlinePanel editor={activeEditor} paneId={paneId} />
          )}
          {paneChatOpen && paneNoteId && (
            <ChatPanel noteId={paneNoteId} paneId={paneId} />
          )}
        </div>
      )}
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

  if (!dbReady || !notesLoaded) {
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
      {/* PATCH: 4. Mount the modal alongside <OnboardingModal> in the return */}
      <AISetupModal isOpen={showAISetup} onClose={() => setShowAISetup(false)} />

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
                {["notes", "search", "bookmarks", "trash"].map((id) => (
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
                        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
                        <path d="M12.5 12.5l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    )}
                    {id === "bookmarks" && (
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M5 2.5h8a1.5 1.5 0 011.5 1.5v11l-5.5-3-5.5 3V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {id === "trash" && (
                      <svg width="18" height="18" viewBox="0 0 640 640" fill="none">
                        <path d="M216.3 124C262.5 44 378 44 424.2 124L461.5 188.6L489.2 172.6C497.6 167.7 508.1 168.4 515.8 174.3C523.5 180.2 526.9 190.2 524.4 199.6L500.9 287C497.5 299.8 484.3 307.4 471.5 304L384.1 280.6C374.7 278.1 367.8 270.2 366.5 260.6C365.2 251 369.9 241.5 378.3 236.7L406 220.7L368.7 156.1C347.1 118.8 293.3 118.8 271.7 156.1L266.4 165.2C257.6 180.5 238 185.7 222.7 176.9C207.4 168.1 202.2 148.5 211 133.1L216.3 124zM513.7 343.1C529 334.3 548.6 339.5 557.4 354.8L562.7 363.9C608.9 443.9 551.2 543.9 458.8 543.9L384.2 543.9L384.2 575.9C384.2 585.6 378.4 594.4 369.4 598.1C360.4 601.8 350.1 599.8 343.2 592.9L279.2 528.9C269.8 519.5 269.8 504.3 279.2 495L343.2 431C350.1 424.1 360.4 422.1 369.4 425.8C378.4 429.5 384.2 438.3 384.2 448L384.2 480L458.8 480C501.9 480 528.9 433.3 507.3 396L502 386.9C493.2 371.6 498.4 352 513.7 343.2zM115 299.4L87.3 283.4C78.9 278.5 74.2 269.1 75.5 259.5C76.8 249.9 83.7 242 93.1 239.5L180.5 216C193.3 212.6 206.5 220.2 209.9 233L233.3 320.4C235.8 329.8 232.4 339.7 224.7 345.7C217 351.7 206.5 352.3 198.1 347.4L170.4 331.4L133.1 396C111.5 433.3 138.5 480 181.6 480L192.2 480C209.9 480 224.2 494.3 224.2 512C224.2 529.7 209.9 544 192.2 544L181.6 544C89.3 544 31.6 444 77.8 364L115 299.4z" fill="currentColor"/>
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
            </div>

            {/* Chat button - outside sliding container, hidden when chat is open */}
            {rightPanelOpen && !chatActive && (
              <button
                onClick={() => {
                  const { openChat } = useUIStore.getState();
                  openChat(activePaneId);
                }}
                className="relative w-8 h-8 flex items-center justify-center rounded-md transition-colors shrink-0 text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2.5 2.5h13a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5h-4.5l-4 2.5v-2.5h-4.5A1.5 1.5 0 011 12V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                  <path d="M5.5 8h7M5.5 5.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>
            )}

            {/* Separator line */}
            <div className="w-px h-5 bg-idemora-border/50 mx-1 shrink-0" />

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
  <div className="flex-1 flex flex-col min-w-0">
    <div className="flex-1 flex overflow-hidden">
      {renderPane(1)}
      {splitOpen && <><SplitDivider />{renderPane(2)}</>}
    </div>
  </div>
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

      <MoveBlockModal
        open={moveBlockOpen}
        onClose={() => setMoveBlockOpen(false)}
        onConfirm={handleMoveBlockConfirm}
      />
    </>
  );
}

