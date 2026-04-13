// src/features/notes/components/Sidebar/NotesPanel.tsx
import { useUIStore } from "@/features/ui/store/useUIStore";
import { NoteTree } from "./NoteTree";

export function NotesPanel() {
  const openTemplatePicker = useUIStore((s) => s.openTemplatePicker);
  const collapseAll        = useUIStore((s) => s.collapseAll);
  const toggleFileTree     = useUIStore((s) => s.toggleFileTree);
  const activePaneId       = useUIStore((s) => s.activePaneId);
  const pane1FileTreeOpen  = useUIStore((s) => s.pane1FileTreeOpen);
  const pane2FileTreeOpen  = useUIStore((s) => s.pane2FileTreeOpen);
  const fileTreeOpen       = activePaneId === 1 ? pane1FileTreeOpen : pane2FileTreeOpen;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1.5 shrink-0">
        <button
          onClick={openTemplatePicker}
          title="New note"
          className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M9.5 2L12.5 5M2 13l1-3.5L10 2l3 3-7 7.5L2 13z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <button
          onClick={collapseAll}
          title="Collapse all"
          className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2 4h10M2 7h7M2 10h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>

        <button
          onClick={() => toggleFileTree(activePaneId)}
          title="Toggle file tree"
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 ${
            fileTreeOpen
              ? "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
              : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M1 3.5a1 1 0 011-1h3l1 1.5h6a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M4 8.5h3M4 6.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="mx-2 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        <NoteTree />
      </div>
    </div>
  );
}