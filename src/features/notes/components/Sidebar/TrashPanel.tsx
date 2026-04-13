// src/features/notes/components/Sidebar/TrashPanel.tsx
import { useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

export function TrashPanel() {
  const notes = useNoteStore((s) => s.notes);
  const restoreNote = useNoteStore((s) => s.restoreNote);
  const permanentlyDeleteNote = useNoteStore((s) => s.permanentlyDeleteNote);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const trashedNotes = notes
    .filter((n) => n.deleted_at)
    .sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));

  function formatRelative(ts: number): string {
    const diff = Date.now() - ts;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    return `${days} days ago`;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center px-3 pt-3 pb-2 shrink-0">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
          Trash
        </span>
      </div>
      <div className="mx-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {trashedNotes.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center mt-8">
            Trash is empty
          </p>
        )}
        {trashedNotes.map((note) => (
          <div
            key={note.id}
            className="group flex flex-col gap-0.5 px-2 py-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate flex-1">
                {note.title || "Untitled"}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  onClick={() => restoreNote(note.id)}
                  title="Restore"
                  className="text-[10px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Restore
                </button>
                {confirmId === note.id ? (
                  <button
                    onClick={() => { permanentlyDeleteNote(note.id); setConfirmId(null); }}
                    title="Confirm delete"
                    className="text-[10px] px-1.5 py-0.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                  >
                    Confirm
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmId(note.id)}
                    title="Delete permanently"
                    className="text-[10px] px-1.5 py-0.5 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
              {note.deleted_at ? formatRelative(note.deleted_at) : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}