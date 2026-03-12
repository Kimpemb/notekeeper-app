// src/components/Sidebar/NoteTree.tsx
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import { NoteTreeItem } from "./NoteTreeItem";

function byRecency(a: { updated_at: number }, b: { updated_at: number }) {
  return b.updated_at - a.updated_at;
}

export function NoteTree() {
  // Select primitives only — no derived arrays inside the selector
  const notes       = useNoteStore((s) => s.notes);
  const pinnedIds   = useNoteStore((s) => s.pinnedIds);
  const searchQuery = useUIStore((s) => s.searchQuery);

  // Derive outside the selector so no new array is created during snapshot
  const rootNotes   = notes.filter((n) => n.parent_id === null);
  const pinnedNotes = rootNotes.filter((n) => pinnedIds.has(n.id)).sort(byRecency);
  const recentNotes = rootNotes.filter((n) => !pinnedIds.has(n.id)).sort(byRecency);

  // ── Search mode ───────────────────────────────────────────────────────────
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

  // ── Empty state ───────────────────────────────────────────────────────────
  if (pinnedNotes.length === 0 && recentNotes.length === 0) {
    return (
      <p className="px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">
        No notes yet.
        <br />
        Click + to create one.
      </p>
    );
  }

  // ── Normal tree ───────────────────────────────────────────────────────────
  return (
    <div className="px-2 space-y-0.5">

      {/* Pinned section */}
      {pinnedNotes.length > 0 && (
        <div className="mb-1">
          <p className="
            px-2 pt-2 pb-1
            text-[10px] font-semibold tracking-widest uppercase
            text-zinc-400 dark:text-zinc-600
            select-none
          ">
            Pinned
          </p>
          <ul className="space-y-0.5">
            {pinnedNotes.map((note) => (
              <NoteTreeItem key={note.id} noteId={note.id} depth={0} />
            ))}
          </ul>
        </div>
      )}

      {/* Divider */}
      {pinnedNotes.length > 0 && recentNotes.length > 0 && (
        <div className="mx-2 border-t border-zinc-200 dark:border-zinc-800 my-1" />
      )}

      {/* Recent notes */}
      {recentNotes.length > 0 && (
        <div>
          {pinnedNotes.length > 0 && (
            <p className="
              px-2 pt-1 pb-1
              text-[10px] font-semibold tracking-widest uppercase
              text-zinc-400 dark:text-zinc-600
              select-none
            ">
              Recent
            </p>
          )}
          <ul className="space-y-0.5">
            {recentNotes.map((note) => (
              <NoteTreeItem key={note.id} noteId={note.id} depth={0} />
            ))}
          </ul>
        </div>
      )}

    </div>
  );
}