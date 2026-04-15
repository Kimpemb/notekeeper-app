import { useState, useRef, useEffect } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

interface ContextMenu { x: number; y: number; tabId: string; noteId: string; flip: boolean; }

export function TabBar() {
  const notes = useNoteStore((s) => s.notes);
  const activePaneId = useUIStore((s) => s.activePaneId);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  
  // Dynamic selectors based on active pane
  const tabs = useUIStore((s) => activePaneId === 1 ? s.tabs : s.pane2Tabs);
  const activeTabId = useUIStore((s) => activePaneId === 1 ? s.activeTabId : s.pane2ActiveTabId);
  const setActive = useUIStore((s) => activePaneId === 1 ? s.setActiveTab : s.setPane2ActiveTab);
  const closeTab = useUIStore((s) => activePaneId === 1 ? s.closeTab : s.closePane2Tab);
  
  const openEmptyTab = useUIStore((s) => activePaneId === 1 ? s.openEmptyTab : s.openEmptyTabInPane2);
  const openInSplit = useUIStore((s) => s.openInSplit);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const setActivePaneId = useUIStore((s) => s.setActivePaneId);

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [contextMenu]);

  return (
    <div className="relative flex items-center flex-1 min-w-0 h-full">
      <div
        className="flex items-center h-full overflow-x-auto min-w-0 flex-1 gap-1 px-2"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const note = tab.noteId ? notes.find((n) => n.id === tab.noteId) : null;
          const title = tab.noteId === null ? "New tab" : note ? note.title : "…";
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              onClick={() => {
                setActive(tab.id);
                if (activePaneId === 1 && tab.noteId) setActiveNote(tab.noteId, true);
              }}
              onAuxClick={(e) => { if (e.button === 1) closeTab(tab.id); }}
              onContextMenu={(e) => {
                if (!tab.noteId) return;
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id, noteId: tab.noteId, flip: window.innerHeight - e.clientY < 120 });
              }}
              className={`
                group relative flex items-center gap-2 shrink-0 cursor-pointer select-none px-3 h-8 w-40 text-sm font-medium transition-colors
                ${isActive 
                  ? "bg-idemora-bg-primary text-idemora-text-normal rounded-t-md z-20" 
                  : "bg-transparent text-idemora-text-muted hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-md"
                }
              `}
            >
              {/* Vertical Alignment Guard: Icon and Text */}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 opacity-50">
                <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M3.5 4h5M3.5 6h5M3.5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              
              <span className="flex-1 truncate">{title}</span>

              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className={`p-0.5 rounded-sm hover:bg-black/10 dark:hover:bg-white/10 transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
              >
                <svg width="8" height="8" viewBox="0 0 7 7" fill="none">
                  <path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>

              {/* IMMERSION BRIDGE */}
              {/* This absolute div sits at the bottom and covers the gap/border of the header */}
              {isActive && (
                <div className="absolute -bottom-2 left-0 right-0 h-2 bg-idemora-bg-primary z-20" />
              )}
            </div>
          );
        })}

        <button
          onClick={() => openEmptyTab()}
          className="shrink-0 p-1.5 text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-md transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          style={{ 
            position: "fixed", 
            left: contextMenu.x, 
            ...(contextMenu.flip ? { bottom: window.innerHeight - contextMenu.y } : { top: contextMenu.y }), 
            zIndex: 100 
          }}
          className="min-w-44 py-1 rounded-lg shadow-xl bg-idemora-bg-secondary border border-idemora-border"
        >
          <button
            onClick={() => { activePaneId === 1 ? useUIStore.getState().openTab(contextMenu.noteId) : openTabInPane2(contextMenu.noteId); setContextMenu(null); }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
          >
            Open in new tab
          </button>
          <button
            onClick={() => { activePaneId === 1 ? openInSplit(contextMenu.noteId) : (useUIStore.getState().openTab(contextMenu.noteId), setActivePaneId(1)); setContextMenu(null); }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
          >
            {activePaneId === 1 ? "Open in split pane" : "Open in main pane"}
          </button>
        </div>
      )}
    </div>
  );
}