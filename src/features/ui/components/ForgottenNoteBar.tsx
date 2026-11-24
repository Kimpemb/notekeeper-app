// src/features/ui/components/ForgottenNoteBar.tsx
//
// Once per app launch, offers one note you have not touched in a while.
// Off by default. While the setting is off the outer component renders null, so no
// timer, query or listener exists at all.
import { useEffect, useRef, useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import {
  getForgottenNoteCandidates,
  getForgottenNotesState,
  snoozeForgottenNote,
} from "@/features/notes/db/queries";
import { DAY_MS, daysSince, pickForgottenNote } from "@/features/ui/lib/forgottenNotes";

const FORGOTTEN_AFTER_DAYS = 30;  // not opened or edited for this long
const SNOOZE_DAYS          = 14;  // "Not now" hides the note for this long
const CHECK_DELAY          = 8000; // let app boot finish first
const SHOW_DELAY           = 1200;

// One check per app launch, even if the setting is toggled off and on again.
let checkedThisLaunch = false;

interface Suggestion {
  noteId: string;
  title: string;
  lastTouched: number;
}

export function ForgottenNoteBar() {
  const enabled = useAppSettings((s) => s.settings.forgottenNotesEnabled ?? false);
  if (!enabled) return null;
  return <ForgottenNoteBarActive />;
}

function ForgottenNoteBarActive() {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [rendered, setRendered]     = useState(false);
  const [visible, setVisible]       = useState(false);
  const [exiting, setExiting]       = useState(false);

  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const openTab       = useUIStore((s) => s.openTab);
  const showTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (checkedThisLaunch) return;
    let cancelled = false;

    const checkTimer = setTimeout(async () => {
      if (cancelled) return;
      checkedThisLaunch = true;
      try {
        const now = Date.now();
        const [candidates, state] = await Promise.all([
          getForgottenNoteCandidates(now - FORGOTTEN_AFTER_DAYS * DAY_MS),
          getForgottenNotesState(),
        ]);
        if (cancelled) return;
        const pick = pickForgottenNote(candidates, state.snoozed, now);
        if (!pick) return;
        setSuggestion({ noteId: pick.id, title: pick.title, lastTouched: pick.last_touched });
        setRendered(true);
        showTimerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY);
      } catch (err) {
        console.error("ForgottenNoteBar: check failed", err);
      }
    }, CHECK_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(checkTimer);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
    };
  }, []);

  function animateOut(then: () => void | Promise<void>) {
    setExiting(true);
    setTimeout(async () => {
      setVisible(false);
      setExiting(false);
      await then();
      setTimeout(() => setRendered(false), 300);
    }, 260);
  }

  function handleOpen() {
    if (!suggestion) return;
    setActiveNote(suggestion.noteId);
    openTab(suggestion.noteId);
    animateOut(() => {});
  }

  function handleSnooze() {
    if (!suggestion) return;
    const id = suggestion.noteId;
    animateOut(async () => {
      await snoozeForgottenNote(id, Date.now() + SNOOZE_DAYS * DAY_MS).catch(console.error);
    });
  }

  // The X only hides it for this launch; nothing is saved.
  function handleClose() {
    animateOut(() => {});
  }

  if (!rendered || !suggestion) return null;

  const days = daysSince(suggestion.lastTouched, Date.now());

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
        className="rounded-xl shadow-2xl border border-idemora-border bg-idemora-bg-secondary overflow-hidden"
        style={{ backdropFilter: "blur(12px)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-idemora-border">
          <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-blue-400">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M6 3.5V6l1.7 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">
              Forgotten note
            </span>
          </div>
          <button
            onClick={handleClose}
            title="Close"
            className="w-5 h-5 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          <p className="text-xs text-idemora-text-muted mb-1">
            You haven't opened this in {days} days:
          </p>
          <p className="text-sm font-semibold text-idemora-text-normal truncate leading-snug">
            {suggestion.title}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            onClick={handleSnooze}
            title={`Don't suggest this note for ${SNOOZE_DAYS} days`}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 text-center"
          >
            Not now
          </button>
          <button
            onClick={handleOpen}
            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors duration-100 text-center"
          >
            Open note
          </button>
        </div>
      </div>
    </div>
  );
}
