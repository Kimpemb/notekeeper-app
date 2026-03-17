// src/features/ui/components/TabBar.tsx
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

export function TabBar() {
  const tabs          = useUIStore((s) => s.tabs);
  const activeTabId   = useUIStore((s) => s.activeTabId);
  const setActiveTab  = useUIStore((s) => s.setActiveTab);
  const closeTab      = useUIStore((s) => s.closeTab);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const notes         = useNoteStore((s) => s.notes);

  if (tabs.length === 0) return null;

  function handleTabClick(tabId: string, noteId: string) {
    setActiveTab(tabId);
    setActiveNote(noteId, true); // skipHistory=true — tab switching isn't a nav event
  }

  function handleClose(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    closeTab(tabId);
  }

  function handleAuxClick(e: React.MouseEvent, tabId: string) {
    if (e.button === 1) { // middle-click
      e.preventDefault();
      closeTab(tabId);
    }
  }

  return (
    <div
      className="flex items-center h-7 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-x-auto select-none"
      style={{ scrollbarWidth: "none" }}
    >
      {tabs.map((tab) => {
        const note       = notes.find((n) => n.id === tab.noteId);
        const isUntitled = note ? /^Untitled-\d+$/.test(note.title) : false;
        const title      = note ? (isUntitled ? "Untitled" : note.title) : "…";
        const isActive   = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            onClick={() => handleTabClick(tab.id, tab.noteId)}
            onAuxClick={(e) => handleAuxClick(e, tab.id)}
            title={note?.title}
            className={`
              group relative flex items-center gap-2 h-full px-4 shrink-0 cursor-pointer
              text-xs font-medium transition-colors duration-100
              min-w-[140px] max-w-[240px]
              border-r border-zinc-200 dark:border-zinc-800
              ${isActive
                ? "bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200"
                : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }
            `}
          >
            {/* Active indicator bar at top */}
            {isActive && (
              <span className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 dark:bg-blue-400 rounded-b-sm" />
            )}

            <span className="flex-1 truncate">{title}</span>

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

      {/* Trailing spacer */}
      <div className="flex-1 min-w-4" />
    </div>
  );
}