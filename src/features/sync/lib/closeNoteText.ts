// src/features/sync/lib/closeNoteText.ts
//
// Stage 4d.3, step 14 ("close it for me"), Phase B1 b - PURE plain-language text
// for what the "Close the note" button did. No DB, no network, no React, no store
// imports. Takes a loose structural type (the shape closeNoteForReview returns) so
// it never imports the live file.
//
// Three outcomes:
//   1. closed and saved           -> success, safe to go on
//   2. closed, save not confirmed -> warning, safe to go on (the review is rebuilt
//                                    fresh and compares stamps), but say so plainly
//   3. could not close            -> error, nothing changed, do not go on
//
// Where the person goes next depends on the screen: a review screen says to go
// Back and open the review again; the Backups screen says to press Replace again.

export interface CloseResultLike {
  closed: boolean;
  flushConfirmed: boolean;
  error?: string;
}

export type CloseContext = "review" | "backups";

export type CloseTone = "success" | "warning" | "error";

export interface CloseText {
  text: string;
  tone: CloseTone;
  /** true when the note is closed, so the screen may go on (reload, reopen the review, Replace again). */
  closed: boolean;
}

function nextStep(context: CloseContext): string {
  return context === "backups"
    ? "Press Replace again."
    : "Go Back and open the review again.";
}

export function describeCloseResult(
  result: CloseResultLike,
  context: CloseContext
): CloseText {
  if (!result.closed) {
    return {
      text: "The note could not be closed. Close its tab yourself, then try again. Nothing was changed.",
      tone: "error",
      closed: false,
    };
  }
  if (!result.flushConfirmed) {
    return {
      text:
        "The note was closed, but we could not confirm that its latest edits were saved in time. " +
        "Wait a few seconds, then " +
        (context === "backups" ? "press Replace again." : "go Back and open the review again."),
      tone: "warning",
      closed: true,
    };
  }
  return {
    text: `The note was closed and its latest edits were saved. ${nextStep(context)}`,
    tone: "success",
    closed: true,
  };
}
