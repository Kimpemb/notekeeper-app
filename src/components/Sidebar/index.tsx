// src/components/Sidebar/index.tsx
import { useEffect } from "react";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import { cancelSidebarCollapse, scheduleSidebarCollapse } from "@/lib/sidebarTimer";
import { NoteTree } from "./NoteTree";
import { SearchBar } from "./SearchBar";

export function Sidebar() {
  const loadNotes       = useNoteStore((s) => s.loadNotes);
  const createNote      = useNoteStore((s) => s.createNote);
  const sidebarState    = useUIStore((s) => s.sidebarState);
  const setSidebarState = useUIStore((s) => s.setSidebarState);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const isOpen    = sidebarState === "open";
  const isPeek    = sidebarState === "peek";
  const isVisible = isOpen || isPeek;

  function collapse() {
    if (useUIStore.getState().sidebarState === "peek") setSidebarState("closed");
  }

  function lock() {
    cancelSidebarCollapse();
    setSidebarState("open");
  }

  function close() {
    cancelSidebarCollapse();
    setSidebarState("closed");
  }

  function onSidebarEnter() {
    cancelSidebarCollapse();
  }

  function onSidebarLeave() {
    if (useUIStore.getState().sidebarState === "peek") {
      scheduleSidebarCollapse(collapse);
    }
  }

  return (
    <>
      <aside
        id="sidebar-panel"
        onMouseEnter={onSidebarEnter}
        onMouseLeave={onSidebarLeave}
        style={{ width: isVisible ? "288px" : "0px" }}
        className={`
          flex flex-col h-full shrink-0
          bg-zinc-50 dark:bg-zinc-900
          border-r border-zinc-200 dark:border-zinc-800
          overflow-hidden
          ${isPeek ? "absolute left-0 top-0 z-40 shadow-2xl" : "relative"}
        `}
      >
        <div className="flex items-center justify-end gap-1 px-3 pt-4 pb-3 shrink-0">
          {isPeek && (
            <button
              onClick={lock}
              title="Lock sidebar open"
              className="
                w-7 h-7 flex flex-col items-center justify-center gap-[4.5px] rounded-md
                text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
                hover:bg-zinc-200 dark:hover:bg-zinc-700 mr-auto
              "
            >
              <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
              <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
              <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
            </button>
          )}

          {isOpen && <div className="flex-1" />}

          {isOpen && (
            <button
              onClick={close}
              title="Close sidebar (Ctrl+\)"
              className="
                w-7 h-7 flex items-center justify-center rounded-md
                text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
                hover:bg-zinc-200 dark:hover:bg-zinc-700
              "
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5 2L0 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
              </svg>
            </button>
          )}

          <button
            onClick={() => createNote()}
            title="New note (Ctrl+N)"
            className="
              w-7 h-7 flex items-center justify-center rounded-md
              text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
              hover:bg-zinc-200 dark:hover:bg-zinc-700
            "
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path
                d="M9.5 2.5L12.5 5.5M2 13l1-4L10.5 1.5a1.414 1.414 0 012 2L5 11l-3 1z"
                stroke="currentColor" strokeWidth="1.3"
                strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="px-3 pb-3 shrink-0">
          <SearchBar />
        </div>

        <div className="mx-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />

        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          <NoteTree />
        </div>
      </aside>

      {sidebarState === "closed" && (
        <div
          onMouseEnter={() => { cancelSidebarCollapse(); setSidebarState("peek"); }}
          className="absolute left-0 top-0 w-6 h-full z-50"
        />
      )}
    </>
  );
}