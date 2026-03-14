// src/features/editor/components/Editor/BacklinksPanel.tsx
import { useEffect, useState } from "react";
import { getBacklinksForNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { Note } from "@/types";

interface Props { noteId: string; }

export function BacklinksPanel({ noteId }: Props) {
  const [backlinks, setBacklinks] = useState<Note[]>([]);
  const [loading, setLoading]     = useState(true);
  const setActiveNote             = useNoteStore((s) => s.setActiveNote);
  const closeBacklinks            = useUIStore((s) => s.closeBacklinks);

  useEffect(() => {
    setLoading(true);
    getBacklinksForNote(noteId).then(setBacklinks).catch(console.error).finally(() => setLoading(false));
  }, [noteId]);

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950 flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-blue-500 dark:text-blue-400">
              <path d="M9 4H5a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M7 2h4v4M11 2L6.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Backlinks</span>
          {!loading && backlinks.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 tabular-nums">
              {backlinks.length}
            </span>
          )}
        </div>
        <button
          onClick={closeBacklinks}
          className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-xs text-zinc-400 animate-pulse">Loading…</span>
          </div>

        ) : backlinks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-zinc-300 dark:text-zinc-600">
                <path d="M16 7H6a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2v-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M13 2h7v7M20 2l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No backlinks yet</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 leading-relaxed">
                Type <kbd className="font-mono px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-[10px]">[[</kbd> in any note to link here.
              </p>
            </div>
          </div>

        ) : (
          <div className="px-3 py-3 space-y-1.5">
            {backlinks.map((note) => (
              <BacklinkCard key={note.id} note={note} onNavigate={() => setActiveNote(note.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Backlink Card ─────────────────────────────────────────────────────────────

function BacklinkCard({ note, onNavigate }: { note: Note; onNavigate: () => void }) {
  return (
    <button
      onClick={onNavigate}
      className="w-full text-left rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 hover:shadow-sm transition-all duration-150 group overflow-hidden"
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {/* Icon */}
        <div className="w-6 h-6 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shrink-0 mt-0.5 group-hover:border-blue-200 dark:group-hover:border-blue-800 transition-colors duration-150">
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none" className="text-zinc-400 dark:text-zinc-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors duration-150">
            <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M4 6h5M4 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors duration-150">
            {note.title}
          </p>
          {note.plaintext && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5 leading-relaxed">
              {note.plaintext.slice(0, 80)}
            </p>
          )}
        </div>

        {/* Arrow */}
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none"
          className="text-zinc-300 dark:text-zinc-700 group-hover:text-blue-400 dark:group-hover:text-blue-500 shrink-0 mt-1 transition-all duration-150 group-hover:translate-x-0.5"
        >
          <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </button>
  );
}