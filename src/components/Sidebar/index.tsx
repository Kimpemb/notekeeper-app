// src/components/Sidebar/index.tsx
import { useEffect } from "react";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import { NoteTree } from "./NoteTree";
import { SearchBar } from "./SearchBar";

export function Sidebar() {
  const loadNotes   = useNoteStore((s) => s.loadNotes);
  const createNote  = useNoteStore((s) => s.createNote);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

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
      <div className="flex items-center justify-between px-4 pt-6 pb-3 shrink-0">
        <span className="text-sm font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500 select-none">
          Notes
        </span>
        <button
          onClick={() => createNote()}
          title="New note (Ctrl+N)"
          className="
            w-8 h-8 flex items-center justify-center rounded-md
            text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
            hover:bg-zinc-200 dark:hover:bg-zinc-700
            transition-colors duration-100
          "
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
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