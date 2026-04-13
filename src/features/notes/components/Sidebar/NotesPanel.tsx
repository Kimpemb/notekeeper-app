// src/features/notes/components/Sidebar/NotesPanel.tsx
import { NoteTree } from "./NoteTree";

export function NotesPanel() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center px-3 pt-3 pb-2 shrink-0">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
          Notes
        </span>
      </div>
      <div className="mx-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        <NoteTree />
      </div>
    </div>
  );
}