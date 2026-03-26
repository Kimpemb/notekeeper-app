// src/features/ui/components/ResurfaceBar.tsx
import { useEffect, useState, useRef, useCallback } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import {
  identifyCluster,
  shouldTrigger,
  scoreGapCandidates,
  buildBacklinkMap,
  buildUnlinkedMentionMap,
  isNewCluster,
} from "@/features/notes/similarity/clusterEngine";
import {
  getClusterSuggestionMeta,
  saveClusterSuggestionMeta,
  getClusterDismissedPairs,
  dismissClusterPair,
  getAllBacklinkRows,
  getSuggestionFeedback,
} from "@/features/notes/db/queries";

const SHOW_DELAY    = 1200;
const TWENTY_FOUR_H  = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL = 60 * 1000;
interface Suggestion {
  noteId: string;
  noteTitle: string;
  referringNoteId: string;   // ← needed for dismissClusterPair
  referringNoteTitle: string;
  score: number;
}

export function ResurfaceBar() {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [visible, setVisible]       = useState(false);
  const [rendered, setRendered]     = useState(false);
  const [exiting, setExiting]       = useState(false);

  const notes          = useNoteStore((s) => s.notes);
  const activeNoteId   = useNoteStore((s) => s.activeNoteId);
  const setActiveNote  = useNoteStore((s) => s.setActiveNote);
  const openTab        = useUIStore((s) => s.openTab);
  const clusterSession = useUIStore((s) => s.clusterSession);
  const tickCluster    = useUIStore((s) => s.tickClusterSession);
  const resetCluster   = useUIStore((s) => s.resetClusterSession);

  const shownRef    = useRef(false);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick session time every 30s so leftAt stays current
  useEffect(() => {
    const id = setInterval(() => tickCluster(), 30_000);
    return () => clearInterval(id);
  }, [tickCluster]);

  const checkTrigger = useCallback(async () => {
    if (shownRef.current) return;
    if (clusterSession.visits.length === 0) return;

    try {
      const [allBacklinks, feedback, dismissedPairs, meta] = await Promise.all([
        getAllBacklinkRows(),
        getSuggestionFeedback(),
        getClusterDismissedPairs(),
        getClusterSuggestionMeta(),
      ]);

      const backlinkMap        = buildBacklinkMap(allBacklinks);
      const unlinkedMentionMap = buildUnlinkedMentionMap(notes);
      const cluster            = identifyCluster(clusterSession, notes, backlinkMap, feedback);

      if (!shouldTrigger(clusterSession, cluster)) return;

      // 24-hour gate — skip if same cluster was shown within last 24h
      if (meta) {
        const withinWindow = Date.now() - meta.lastShownAt < TWENTY_FOUR_H;
        const sameCluster  = !isNewCluster(meta.lastClusterNoteIds, cluster);
        if (withinWindow && sameCluster) return;
      }

      const candidates = scoreGapCandidates(
        cluster, clusterSession, notes, backlinkMap,
        feedback, dismissedPairs, unlinkedMentionMap
      );

      if (candidates.length === 0) return;

      const best    = candidates[0];
      const noteMap = new Map(notes.map((n) => [n.id, n]));
      const candNote = noteMap.get(best.noteId);
      const refNote  = noteMap.get(best.referringNoteId);
      if (!candNote || !refNote) return;
      if (best.noteId === activeNoteId) return;

      shownRef.current = true;
      setSuggestion({
        noteId: best.noteId,
        noteTitle: candNote.title,
        referringNoteId: best.referringNoteId,
        referringNoteTitle: refNote.title,
        score: best.score,
      });
      setRendered(true);
      timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY);

    } catch (err) {
      console.error("ResurfaceBar: trigger check failed", err);
    }
  }, [clusterSession, notes, activeNoteId]);

  useEffect(() => {
    intervalRef.current = setInterval(checkTrigger, CHECK_INTERVAL);
    checkTrigger();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timerRef.current)    clearTimeout(timerRef.current);
    };
  }, [checkTrigger]);

  function animateOut(then: () => void) {
    setExiting(true);
    setTimeout(() => { setVisible(false); setExiting(false); then(); }, 260);
  }

  async function persistMeta() {
    const [allBacklinks, feedback] = await Promise.all([
      getAllBacklinkRows(),
      getSuggestionFeedback(),
    ]);
    const backlinkMap = buildBacklinkMap(allBacklinks);
    const cluster     = identifyCluster(clusterSession, notes, backlinkMap, feedback);
    await saveClusterSuggestionMeta({
      lastShownAt: Date.now(),
      lastClusterNoteIds: [...cluster],
    });
  }

  function handleDismiss() {
    if (!suggestion) return;
    animateOut(async () => {
      await dismissClusterPair(suggestion.referringNoteId, suggestion.noteId);
      await persistMeta();
      setTimeout(() => setRendered(false), 300);
    });
  }

  function handleOpen() {
    if (!suggestion) return;
    setActiveNote(suggestion.noteId);
    openTab(suggestion.noteId);
    animateOut(async () => {
      await persistMeta();
      resetCluster();
      setTimeout(() => setRendered(false), 300);
    });
  }

  function handleLink() {
    if (!suggestion) return;
    window.dispatchEvent(new CustomEvent("idemora:insert-link", {
      detail: { noteId: suggestion.noteId, noteTitle: suggestion.noteTitle },
    }));
    animateOut(async () => {
      await persistMeta();
      setTimeout(() => setRendered(false), 300);
    });
  }

  if (!rendered || !suggestion) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: "50%",
        transform: `translateX(-50%) translateY(${visible && !exiting ? "12px" : "-110%"})`,
        transition: "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 240ms ease",
        opacity: visible && !exiting ? 1 : 0,
        zIndex: 60,
        width: 380,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        className="rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 overflow-hidden"
        style={{ backdropFilter: "blur(12px)" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-zinc-100 dark:border-zinc-800">
          <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-indigo-500 dark:text-indigo-400">
              <circle cx="3" cy="9" r="1.8" stroke="currentColor" strokeWidth="1.1"/>
              <circle cx="9" cy="9" r="1.8" stroke="currentColor" strokeWidth="1.1"/>
              <circle cx="6" cy="2.5" r="1.8" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M4.3 8L5.2 4M7.7 8L6.8 4M4.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Related note
            </span>
          </div>
          <button
            onClick={handleDismiss}
            title="Dismiss — won't suggest this again"
            className="w-5 h-5 flex items-center justify-center rounded-md text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-4 py-3">
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">
            You've been working in{" "}
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              {suggestion.referringNoteTitle}
            </span>
            {" "}— this note might be relevant:
          </p>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate leading-snug">
            {suggestion.noteTitle}
          </p>
        </div>

        {/* ── Actions ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            onClick={handleLink}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors duration-100 text-center"
          >
            Link →
          </button>
          <button
            onClick={handleOpen}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors duration-100 text-center"
          >
            Open note
          </button>
        </div>
      </div>
    </div>
  );
}