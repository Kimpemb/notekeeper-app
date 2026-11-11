// src/features/sync/components/CloseNoteButton.tsx
//
// Stage 4d.3, step 14 ("close it for me"), Phase B1 c. The "Close the note" button
// shown when a review or a recover was refused because the note is open in a tab.
// Presentational: the closing and waiting is closeNoteForReview (closeNoteLive.ts),
// the wording is describeCloseResult (closeNoteText.ts, pure and tested).
//
// Two ways to use it:
//   - review screens: leave onClosed out. After a successful close the button shows
//     the plain message (closed and saved, go Back and open the review again).
//   - Backups screen: pass onClosed. The screen reloads its overview and returns to
//     the version picker itself, and shows the message there.

import { useState } from "react";
import { closeNoteForReview } from "@/features/sync/lib/closeNoteLive";
import {
  describeCloseResult,
  type CloseContext,
  type CloseText,
} from "@/features/sync/lib/closeNoteText";

const TONE_CLASS: Record<CloseText["tone"], string> = {
  success: "text-green-600",
  warning: "text-amber-600",
  error: "text-red-500",
};

interface Props {
  noteId: string;
  context: CloseContext;
  /** Called after the note was closed (also when the save could not be confirmed). */
  onClosed?: (text: CloseText) => void;
  /** Lets the dialog block Esc and Back while the note is closing. */
  onBusyChange?: (busy: boolean) => void;
}

export function CloseNoteButton({ noteId, context, onClosed, onBusyChange }: Props) {
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<CloseText | null>(null);

  async function close() {
    setRunning(true);
    onBusyChange?.(true);
    try {
      const text = describeCloseResult(await closeNoteForReview(noteId), context);
      setOutcome(text);
      if (text.closed) onClosed?.(text);
    } finally {
      setRunning(false);
      onBusyChange?.(false);
    }
  }

  // Closed, and the screen handles what comes next: show nothing here.
  if (outcome?.closed && onClosed) return null;

  return (
    <div className="mt-2">
      {outcome && <p className={`mb-2 ${TONE_CLASS[outcome.tone]}`}>{outcome.text}</p>}
      {!outcome?.closed && (
        <button
          onClick={() => void close()}
          disabled={running}
          className="px-2 py-1 rounded text-white bg-blue-500 disabled:opacity-50"
        >
          {running ? "Closing…" : "Close the note"}
        </button>
      )}
    </div>
  );
}
