// src/features/ui/components/EmptyState.tsx
import { useNoteStore } from "@/features/notes/store/useNoteStore";

export function EmptyState() {
  const createNote = useNoteStore((s) => s.createNote);

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full select-none">
      <div className="flex flex-col items-center gap-4">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          className="text-zinc-500 dark:text-zinc-300"
        >
          <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16 16h16M16 22h16M16 28h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        <div className="text-center">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-200">No note selected</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Select a note from the sidebar or create a new one
          </p>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => createNote()}
            className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            New note
          </button>
          <span className="text-xs text-zinc-600 dark:text-zinc-300">or press</span>
          <kbd className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded font-mono">
            Ctrl K
          </kbd>
        </div>
      </div>
    </div>
  );
}