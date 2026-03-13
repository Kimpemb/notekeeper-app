// src/components/Editor/BacklinksPanel.tsx
import { useEffect, useState } from "react";
import { getBacklinksForNote } from "@/db/queries";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import type { Note } from "@/types";

interface Props {
  noteId: string;
}

export function BacklinksPanel({ noteId }: Props) {
  const [backlinks, setBacklinks] = useState<Note[]>([]);
  const [loading, setLoading]     = useState(true);
  const setActiveNote             = useNoteStore((s) => s.setActiveNote);
  const closeBacklinks            = useUIStore((s) => s.closeBacklinks);

  useEffect(() => {
    setLoading(true);
    getBacklinksForNote(noteId)
      .then(setBacklinks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [noteId]);

  return (
    <div className="
      flex flex-col h-full w-64 shrink-0
      border-l border-zinc-200 dark:border-zinc-800
      bg-zinc-50 dark:bg-zinc-900
    ">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-zinc-400">
            <path d="M9 4H5a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V7"
              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M7 2h4v4M11 2L6.5 6.5"
              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
            Backlinks
          </span>
          {!loading && (
            <span className="text-xs text-zinc-400 dark:text-zinc-600 tabular-nums">
              {backlinks.length}
            </span>
          )}
        </div>
        <button
          onClick={closeBacklinks}
          className="
            w-6 h-6 flex items-center justify-center rounded-md
            text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
            hover:bg-zinc-200 dark:hover:bg-zinc-700
            transition-colors duration-100
          "
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-zinc-400 animate-pulse">Loading…</span>
          </div>
        ) : backlinks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-zinc-300 dark:text-zinc-700">
              <path d="M17 8H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2v-5"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M14 3h7v7M21 3l-9 9"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">
              No notes link here yet.
            </p>
            <p className="text-xs text-zinc-300 dark:text-zinc-700">
              Type <kbd className="font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">[[</kbd> in any note to link here.
            </p>
          </div>
        ) : (
          <ul className="py-2">
            {backlinks.map((note) => (
              <li key={note.id}>
                <button
                  onClick={() => setActiveNote(note.id)}
                  className="
                    w-full flex items-start gap-2.5 px-4 py-2.5 text-left
                    hover:bg-zinc-100 dark:hover:bg-zinc-800
                    transition-colors duration-75 group
                  "
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
                    className="text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-400 mt-0.5 shrink-0">
                    <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M4 6h5M4 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">
                      {note.title}
                    </p>
                    {note.plaintext && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                        {note.plaintext.slice(0, 80)}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}