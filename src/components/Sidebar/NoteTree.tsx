// src/components/Sidebar/NoteTree.tsx
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import { NoteTreeItem } from "./NoteTreeItem";

export function NoteTree() {
  const notes       = useNoteStore((s) => s.notes);
  const searchQuery = useUIStore((s) => s.searchQuery);

  // When searching, flatten and filter — ignore tree structure
  if (searchQuery.trim()) {
    const lower    = searchQuery.toLowerCase();
    const filtered = notes.filter(
      (n) =>
        n.title.toLowerCase().includes(lower) ||
        n.plaintext.toLowerCase().includes(lower)
    );

    if (filtered.length === 0) {
      return (
        <p className="px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">
          No notes match "{searchQuery}"
        </p>
      );
    }

    return (
      <ul className="px-2 space-y-0.5">
        {filtered.map((note) => (
          <NoteTreeItem key={note.id} noteId={note.id} depth={0} />
        ))}
      </ul>
    );
  }

  // Normal tree — show only root notes, children render recursively
  const rootNotes = notes.filter((n) => n.parent_id === null);

  if (rootNotes.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">
        No notes yet.
        <br />
        Click + to create one.
      </p>
    );
  }

  return (
    <ul className="px-2 space-y-0.5">
      {rootNotes.map((note) => (
        <NoteTreeItem key={note.id} noteId={note.id} depth={0} />
      ))}
    </ul>
  );
}