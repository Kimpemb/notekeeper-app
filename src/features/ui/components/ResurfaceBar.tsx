// src/features/ui/components/ResurfaceBar.tsx
//
// Slides down from the top of the editor area on app open.
// Shows up to 3 notes not opened in the past N days.
// Dismissed per session — never re-appears after dismiss.

import { useEffect, useState } from "react";
import { getStaleNotes } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { Note } from "@/types";

const STALE_DAYS    = 7;
const MAX_NOTES     = 3;
const SLIDE_DELAY   = 800; // ms after app ready before bar appears

export function ResurfaceBar() {
  const [staleNotes, setStaleNotes]   = useState<Note[]>([]);
  const [visible, setVisible]         = useState(false);
  const [rendered, setRendered]       = useState(false);

  const setActiveNote               = useNoteStore((s) => s.setActiveNote);
  const resurfaceDismissed          = useUIStore((s) => s.resurfaceDismissed);
  const dismissResurface            = useUIStore((s) => s.dismissResurface);

  useEffect(() => {
    if (resurfaceDismissed) return;

    async function load() {
      try {
        const notes = await getStaleNotes(STALE_DAYS, MAX_NOTES);
        if (notes.length === 0) return;
        setStaleNotes(notes);
        setRendered(true);
        // Slight delay so the app feels settled before the bar appears
        setTimeout(() => setVisible(true), SLIDE_DELAY);
      } catch (err) {
        console.error("ResurfaceBar: failed to load stale notes", err);
      }
    }

    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDismiss() {
    setVisible(false);
    dismissResurface();
    setTimeout(() => setRendered(false), 350);
  }

  function handleNoteClick(id: string) {
    setActiveNote(id);
    handleDismiss();
  }

  if (!rendered) return null;

  return (
    <div
      style={{
        overflow: "hidden",
        maxHeight: visible ? "56px" : "0px",
        opacity: visible ? 1 : 0,
        transition: "max-height 340ms cubic-bezier(0.4,0,0.2,1), opacity 280ms ease",
        flexShrink: 0,
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/50">
        {/* Icon */}
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-amber-500 dark:text-amber-400 shrink-0">
          <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M6.5 3.5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>

        {/* Label */}
        <span className="text-xs text-amber-700 dark:text-amber-400 shrink-0 font-medium">
          Revisit
        </span>

        {/* Note pills */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
          {staleNotes.map((note) => (
            <button
              key={note.id}
              onClick={() => handleNoteClick(note.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-amber-200 dark:border-amber-700/60 bg-white dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors duration-100 max-w-[160px] truncate shrink-0"
              title={note.title}
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0 opacity-50">
                <rect x="0.5" y="0.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="0.8"/>
                <path d="M2 3h5M2 5h4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
              </svg>
              <span className="truncate">{note.title}</span>
            </button>
          ))}
        </div>

        {/* Days hint */}
        <span className="text-[10px] text-amber-500 dark:text-amber-500 shrink-0 opacity-70">
          {STALE_DAYS}d+
        </span>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          title="Dismiss"
          className="w-5 h-5 flex items-center justify-center rounded text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors duration-100 shrink-0"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}