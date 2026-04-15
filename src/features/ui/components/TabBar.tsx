// src/features/ui/components/TabBar.tsx
import { useState, useRef, useEffect } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

interface ContextMenu { x: number; y: number; tabId: string; noteId: string; flip: boolean; }

export function TabBar() {
  const notes        = useNoteStore((s) => s.notes);
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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [contextMenu]);

  return (
    <div className="relative flex items-end flex-1 min-w-0 h-full overflow-hidden">
      <div
        className="flex items-end h-full overflow-x-auto min-w-0 flex-1"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const note     = tab.noteId ? notes.find((n) => n.id === tab.noteId) : null;
          const title    = tab.noteId === null ? "New tab"
            : note ? (/^Untitled-\d+$/.test(note.title) ? "Untitled" : note.title) : "…";
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              onClick={() => { setActive(tab.id); if (activePaneId === 1 && tab.noteId) setActiveNote(tab.noteId, true); }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } }}
              onContextMenu={(e) => {
                if (!tab.noteId) return;
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id, noteId: tab.noteId, flip: window.innerHeight - e.clientY < 120 });
              }}
              title={note?.title ?? undefined}
              style={isActive ? {
                borderRadius: "6px 6px 0 0",
                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.08)",
              } : undefined}
              className={`
                group relative flex items-center gap-1.5 shrink-0 cursor-pointer select-none
                px-3 h-[calc(100%-4px)] max-w-40 min-w-0
                text-xs font-medium transition-colors duration-100
                ${isActive
                  ? "bg-idemora-bg-primary  text-zinc-100"
                  : "text-idemora-text-muted   /40 /40 rounded-t-md"
                }
              `}
            >
              <span className={`flex-1 truncate ${tab.noteId === null ? "italic text-idemora-text-muted" : ""}`}>
                {title}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className={`
                  shrink-0 w-3.5 h-3.5 rounded flex items-center justify-center
                  text-idemora-text-muted  transition-colors duration-75
                  ${isActive ? "opacity-100" : "opacity-0 group-"}
                `}
              >
                <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
                  <path d="M1 1l5 5M6 1L1 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          );
        })}

        <button
          onClick={() => activePaneId === 1 ? openEmptyTab() : openEmptyTabInPane2()}
          title="New tab"
          className="shrink-0 w-7 h-full flex items-center justify-center text-idemora-text-muted  /40 transition-colors duration-75 rounded-t-md"
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          style={{ position: "fixed", left: contextMenu.x, ...(contextMenu.flip ? { bottom: window.innerHeight - contextMenu.y } : { top: contextMenu.y }), zIndex: 50 }}
          className="min-w-44 py-1 rounded-lg bg-idemora-bg-primary border  shadow-lg"
        >
          <button
            onClick={() => { activePaneId === 1 ? useUIStore.getState().openTab(contextMenu.noteId) : openTabInPane2(contextMenu.noteId); setContextMenu(null); }}
            className="w-full text-left px-3 py-2 text-xs text-idemora-text-normal  transition-colors duration-75"
          >
            Open in new tab
          </button>
          <button
            onClick={() => { activePaneId === 1 ? openInSplit(contextMenu.noteId) : (useUIStore.getState().openTab(contextMenu.noteId), setActivePaneId(1)); setContextMenu(null); }}
            className="w-full text-left px-3 py-2 text-xs text-idemora-text-normal  transition-colors duration-75"
          >
            {activePaneId === 1 ? "Open in split pane" : "Open in main pane"}
          </button>
        </div>
      )}
    </div>
  );
}