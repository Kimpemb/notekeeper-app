// src/components/Sidebar/index.tsx
import { useEffect } from "react";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import { NoteTree } from "./NoteTree";
import { SearchBar } from "./SearchBar";

export function Sidebar() {
  const loadNotes      = useNoteStore((s) => s.loadNotes);
  const createNote     = useNoteStore((s) => s.createNote);
  const sidebarOpen    = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar  = useUIStore((s) => s.toggleSidebar);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  return (
    <aside
      className={`
        flex flex-col h-full bg-zinc-50 dark:bg-zinc-900
        border-r border-zinc-200 dark:border-zinc-800
        transition-all duration-200 ease-in-out overflow-hidden
        ${sidebarOpen ? "w-72 min-w-[18rem]" : "w-0 min-w-0"}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-4 pb-3 shrink-0">
        {/* Hamburger — toggles sidebar closed */}
        <button
          onClick={toggleSidebar}
          title="Close sidebar"
          className="
            w-7 h-7 flex flex-col items-center justify-center gap-[4.5px] rounded-md
            text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
            hover:bg-zinc-200 dark:hover:bg-zinc-700
            transition-colors duration-100
          "
        >
          <span className="w-[14px] h-[1.5px] bg-current rounded-full" />
          <span className="w-[14px] h-[1.5px] bg-current rounded-full" />
          <span className="w-[14px] h-[1.5px] bg-current rounded-full" />
        </button>

        {/* New note */}
        <button
          onClick={() => createNote()}
          title="New note (Ctrl+N)"
          className="
            w-7 h-7 flex items-center justify-center rounded-md
            text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
            hover:bg-zinc-200 dark:hover:bg-zinc-700
            transition-colors duration-100
          "
        >
          {/* Notion-style: square with a pencil line */}
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path
              d="M9.5 2.5L12.5 5.5M2 13l1-4L10.5 1.5a1.414 1.414 0 012 2L5 11l-3 1z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-3 shrink-0">
        <SearchBar />
      </div>

      {/* Divider */}
      <div className="mx-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />

      {/* Note tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <NoteTree />
      </div>
    </aside>
  );
}