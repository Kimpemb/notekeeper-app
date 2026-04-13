// src/features/ui/components/TabBar.tsx
import { useState, useRef, useEffect } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

interface ContextMenu {
  x: number;
  y: number;
  tabId: string;
  noteId: string;
  flip: boolean;
}

export function TabBar() {
  const notes = useNoteStore((s) => s.notes);

  const tabs1        = useUIStore((s) => s.tabs);
  const activeTabId1 = useUIStore((s) => s.activeTabId);
  const setActive1   = useUIStore((s) => s.setActiveTab);
  const closeTab1    = useUIStore((s) => s.closeTab);

  const tabs2        = useUIStore((s) => s.pane2Tabs);
  const activeTabId2 = useUIStore((s) => s.pane2ActiveTabId);
  const setActive2   = useUIStore((s) => s.setPane2ActiveTab);
  const closeTab2    = useUIStore((s) => s.closePane2Tab);

  const openEmptyTab        = useUIStore((s) => s.openEmptyTab);
  const openEmptyTabInPane2 = useUIStore((s) => s.openEmptyTabInPane2);
  const openInSplit         = useUIStore((s) => s.openInSplit);
  const openTabInPane2      = useUIStore((s) => s.openTabInPane2);
  const activePaneId        = useUIStore((s) => s.activePaneId);
  const setActivePaneId     = useUIStore((s) => s.setActivePaneId);
  const setActiveNote       = useNoteStore((s) => s.setActiveNote);

  const tabs        = activePaneId === 1 ? tabs1 : tabs2;
  const activeTabId = activePaneId === 1 ? activeTabId1 : activeTabId2;
  const setActive   = activePaneId === 1 ? setActive1 : setActive2;
  const closeTab    = activePaneId === 1 ? closeTab1 : closeTab2;

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [contextMenu]);

  function handleTabClick(tabId: string, noteId: string | null) {
    setActive(tabId);
    if (activePaneId === 1 && noteId) setActiveNote(noteId, true);
  }

  function handleClose(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    closeTab(tabId);
  }

  function handleAuxClick(e: React.MouseEvent, tabId: string) {
    if (e.button === 1) { e.preventDefault(); closeTab(tabId); }
  }

  function handleContextMenu(e: React.MouseEvent, tabId: string, noteId: string | null) {
    if (!noteId) return;
    e.preventDefault();
    setContextMenu({
      x: e.clientX, y: e.clientY, tabId, noteId,
      flip: window.innerHeight - e.clientY < 120,
    });
  }

  function handleOpenInSplit() {
    if (!contextMenu) return;
    if (activePaneId === 1) { openInSplit(contextMenu.noteId); }
    else { useUIStore.getState().openTab(contextMenu.noteId); setActivePaneId(1); }
    setContextMenu(null);
  }

  function handleOpenInNewTab() {
    if (!contextMenu) return;
    if (activePaneId === 1) { useUIStore.getState().openTab(contextMenu.noteId); }
    else { openTabInPane2(contextMenu.noteId); }
    setContextMenu(null);
  }

  function handleNewTab() {
    if (activePaneId === 1) { openEmptyTab(); }
    else { openEmptyTabInPane2(); }
  }

  const splitLabel = activePaneId === 1 ? "Open in split pane" : "Open in main pane";

  return (
    <div className="relative flex items-center flex-1 min-w-0 overflow-hidden h-full border-x border-zinc-200 dark:border-zinc-800">
      <div
        className="flex items-center h-full overflow-x-auto min-w-0 flex-1"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const note       = tab.noteId ? notes.find((n) => n.id === tab.noteId) : null;
          const isUntitled = note ? /^Untitled-\d+$/.test(note.title) : false;
          const title      = tab.noteId === null
            ? "New tab"
            : note ? (isUntitled ? "Untitled" : note.title) : "…";
          const isActive   = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              onClick={() => handleTabClick(tab.id, tab.noteId)}
              onAuxClick={(e) => handleAuxClick(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id, tab.noteId)}
              title={note?.title ?? (tab.noteId === null ? "New tab" : undefined)}
              className={`
                group relative flex items-center gap-1.5 h-full px-3 shrink-0 cursor-pointer
                text-xs font-medium transition-colors duration-100
                min-w-0 max-w-36
                border-r border-zinc-200 dark:border-zinc-800
                ${isActive
                  ? "bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                  : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }
              `}
            >
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 dark:bg-blue-400" />
              )}
              <span className={`flex-1 truncate ${tab.noteId === null ? "italic text-zinc-400 dark:text-zinc-500" : ""}`}>
                {title}
              </span>
              <button
                onClick={(e) => handleClose(e, tab.id)}
                title="Close tab"
                className={`
                  shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded
                  transition-colors duration-75
                  ${isActive
                    ? "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }
                `}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          );
        })}

        <button
          onClick={handleNewTab}
          title="New tab"
          className="shrink-0 w-7 h-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-75"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: contextMenu.x,
            ...(contextMenu.flip
              ? { bottom: window.innerHeight - contextMenu.y }
              : { top: contextMenu.y }),
            zIndex: 50,
          }}
          className="min-w-48 py-1 rounded-lg shadow-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
        >
          <button
            onClick={handleOpenInNewTab}
            className="w-full text-left px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors duration-75"
          >
            Open in new tab
          </button>
          <button
            onClick={handleOpenInSplit}
            className="w-full text-left px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors duration-75"
          >
            {splitLabel}
          </button>
        </div>
      )}
    </div>
  );
}