// src/features/notes/components/Sidebar/NoteTree.tsx
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { NoteTreeItem } from "./NoteTreeItem";

function byRecency(a: { updated_at: number }, b: { updated_at: number }) {
  return b.updated_at - a.updated_at;
}

function noteHasTag(tags: string | null, tag: string): boolean {
  if (!tags) return false;
  try { return (JSON.parse(tags) as string[]).includes(tag); }
  catch { return false; }
}

export function NoteTree() {
  const notes          = useNoteStore((s) => s.notes);
  const pinnedIds      = useNoteStore((s) => s.pinnedIds);
  const visitedNoteIds = useNoteStore((s) => s.visitedNoteIds);
  const searchQuery    = useUIStore((s) => s.searchQuery);
  const activeTag      = useUIStore((s) => s.activeTag);
  const setActiveTag   = useUIStore((s) => s.setActiveTag);

  // ── Tag filter view ────────────────────────────────────────────────────────
  if (activeTag) {
    const tagged = notes.filter((n) => noteHasTag(n.tags, activeTag)).sort(byRecency);
    return (
      <div className="px-2">
        {/* Active tag header */}
        <div className="flex items-center gap-2 px-2 pt-2 pb-1">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-600 select-none flex-1">
            #{activeTag}
          </span>
          <button
            onClick={() => setActiveTag(null)}
            className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-100"
            title="Clear tag filter"
          >
            Clear
          </button>
        </div>
        {tagged.length === 0 ? (
          <p className="px-2 py-4 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">
            No notes tagged #{activeTag}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {tagged.map((note) => <NoteTreeItem key={note.id} noteId={note.id} depth={0} />)}
          </ul>
        )}
      </div>
    );
  }

  const rootNotes   = notes.filter((n) => n.parent_id === null);
  const pinnedNotes = rootNotes.filter((n) => pinnedIds.has(n.id)).sort(byRecency);

  const unpinned = rootNotes.filter((n) => !pinnedIds.has(n.id));
  const seen = new Set<string>();
  const recentNotes: typeof unpinned = [];
  for (const id of visitedNoteIds) {
    const note = unpinned.find((n) => n.id === id);
    if (note) { recentNotes.push(note); seen.add(id); }
  }
  unpinned.filter((n) => !seen.has(n.id)).sort(byRecency).forEach((n) => recentNotes.push(n));

  // ── Search view ────────────────────────────────────────────────────────────
  if (searchQuery.trim()) {
    const lower    = searchQuery.toLowerCase();
    const filtered = notes.filter(
      (n) => n.title.toLowerCase().includes(lower) || n.plaintext.toLowerCase().includes(lower)
    );
    if (filtered.length === 0) {
      return <p className="px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">No notes match "{searchQuery}"</p>;
    }
    return (
      <ul className="px-2 space-y-0.5">
        {filtered.map((note) => <NoteTreeItem key={note.id} noteId={note.id} depth={0} />)}
      </ul>
    );
  }

  // ── Default view ───────────────────────────────────────────────────────────
  if (pinnedNotes.length === 0 && recentNotes.length === 0) {
    return <p className="px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500 text-center select-none">No notes yet.<br />Click + to create one.</p>;
  }

  return (
    <div className="px-2 space-y-0.5">
      {pinnedNotes.length > 0 && (
        <div className="mb-1">
          <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-600 select-none">Pinned</p>
          <ul className="space-y-0.5">{pinnedNotes.map((note) => <NoteTreeItem key={note.id} noteId={note.id} depth={0} />)}</ul>
        </div>
      )}
      {pinnedNotes.length > 0 && recentNotes.length > 0 && <div className="mx-2 border-t border-zinc-200 dark:border-zinc-800 my-1" />}
      {recentNotes.length > 0 && (
        <div>
          {pinnedNotes.length > 0 && <p className="px-2 pt-1 pb-1 text-[10px] font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-600 select-none">Recent</p>}
          <ul className="space-y-0.5">{recentNotes.map((note) => <NoteTreeItem key={note.id} noteId={note.id} depth={0} />)}</ul>
        </div>
      )}
    </div>
  );
}