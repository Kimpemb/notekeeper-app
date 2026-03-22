// src/features/ui/components/ResurfaceBar.tsx
//
// Modernised browser-permission-style dropdown card.
// Drops from the top of the editor area on app open.
// Shows one note at a time with title, snippet, and days-since-last-visit.
// Skip → cycles to next note. Open → opens and dismisses. ✕ dismisses entirely.

import { useEffect, useState, useRef } from "react";
import { getStaleNotes, type StaleNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

const STALE_DAYS  = 7;
const MAX_NOTES   = 5;   // pre-fetch 5, cycle through them with Skip
const SHOW_DELAY  = 900; // ms after app ready before card drops in

function daysAgo(lastVisit: number | null): string | null {
  if (lastVisit === null) return null;
  const days = Math.floor((Date.now() - lastVisit) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function getSnippet(plaintext: string | null): string {
  if (!plaintext) return "";
  const lines = plaintext.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 2).join(" ").slice(0, 120);
}

export function ResurfaceBar() {
  const [notes, setNotes]       = useState<StaleNote[]>([]);
  const [visible, setVisible]   = useState(false);
  const [rendered, setRendered] = useState(false);
  const [exiting, setExiting]   = useState(false);

  const setActiveNote      = useNoteStore((s) => s.setActiveNote);
  const resurfaceDismissed = useUIStore((s) => s.resurfaceDismissed);
  const resurfaceIndex     = useUIStore((s) => s.resurfaceIndex);
  const dismissResurface   = useUIStore((s) => s.dismissResurface);
  const nextResurface      = useUIStore((s) => s.nextResurface);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (resurfaceDismissed) return;

    async function load() {
      try {
        const fetched = await getStaleNotes(STALE_DAYS, MAX_NOTES);
        if (fetched.length === 0) return;
        setNotes(fetched);
        setRendered(true);
        timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY);
      } catch (err) {
        console.error("ResurfaceBar: failed to load stale notes", err);
      }
    }

    load();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function animateOut(then: () => void) {
    setExiting(true);
    setTimeout(() => { setVisible(false); setExiting(false); then(); }, 260);
  }

  function handleDismiss() {
    animateOut(() => { dismissResurface(); setTimeout(() => setRendered(false), 300); });
  }

  function handleOpen(id: string) {
    setActiveNote(id);
    animateOut(() => { dismissResurface(); setTimeout(() => setRendered(false), 300); });
  }

  function handleSkip() {
    // If we've cycled through all notes, dismiss entirely
    if (resurfaceIndex >= notes.length - 1) {
      handleDismiss();
      return;
    }
    animateOut(() => {
      nextResurface();
      // Re-show after a short pause so the card feels like it refreshed
      setTimeout(() => { setExiting(false); setVisible(true); }, 80);
    });
  }

  if (!rendered || notes.length === 0) return null;

  const note    = notes[resurfaceIndex % notes.length];
  const snippet = getSnippet(note?.plaintext ?? null);
  const hasMore = resurfaceIndex < notes.length - 1;

  return (
    // Outer wrapper — positions the card absolutely so it overlays the editor
    // without pushing content down (like a browser permission prompt)
    <div
      style={{
  position: "absolute",
  top: 0,
  left: "50%",
  transform: `translateX(-50%) translateY(${visible && !exiting ? "12px" : "-110%"})`,
  transition: "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease",
  opacity: visible && !exiting ? 1 : 0,
  zIndex: 60,  // ← was 40, needs to be above header's z-50
  width: 360,
  pointerEvents: visible ? "auto" : "none",
}}
    >
      <div
        className="rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 overflow-hidden"
        style={{ backdropFilter: "blur(12px)" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
          {/* Clock icon */}
          <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-amber-500 dark:text-amber-400">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 3.5v2.75l1.5 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
  Revisit
</span>
            {notes.length > 1 && (
              <span className="ml-1.5 text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
                {resurfaceIndex + 1} / {notes.length}
              </span>
            )}
          </div>

          {/* Dismiss */}
          <button
            onClick={handleDismiss}
            className="w-5 h-5 flex items-center justify-center rounded-md text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
            title="Dismiss"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-4 py-3">
          {/* Note title */}
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate leading-snug">
            {note?.title ?? ""}
          </p>

          {/* Days ago */}
<p className="text-[11px] text-amber-500 dark:text-amber-400 mt-0.5 font-medium">
  {note?.last_visit === null ? "Never opened" : `Last opened ${daysAgo(note.last_visit)}`}
</p>

          {/* Snippet */}
          {snippet && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5 leading-relaxed line-clamp-2">
              {snippet}
            </p>
          )}

          {!snippet && (
            <p className="text-xs text-zinc-300 dark:text-zinc-600 mt-1.5 italic">
              No content preview available.
            </p>
          )}
        </div>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 pb-3">
          {/* Skip — only show if there are more notes to cycle through */}
          {hasMore && (
            <button
              onClick={handleSkip}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100 text-center"
            >
              Skip →
            </button>
          )}

          {/* Open */}
          <button
            onClick={() => note && handleOpen(note.id)}
            className={`${hasMore ? "flex-1" : "w-full"} py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors duration-100 text-center`}
          >
            Open note
          </button>
        </div>
      </div>
    </div>
  );
}