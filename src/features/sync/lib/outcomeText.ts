// src/features/sync/lib/outcomeText.ts
//
// Stage 4d.3, step 13 — PURE plain-language text for what a commit did, for the
// review screens. No DB, no network, no React. Takes a loose structural type so it
// accepts both the review commit's outcomes and the delete commit's outcomes without
// importing either (and without reaching supabaseClient).
//
// Rules for the wording: say what changed and what did not; never imply that
// "nothing happened" when a hosted write may have gone through; tell the user what
// to do next only when there is something to do.

export interface OutcomeLike {
  status: string;
  reason?: string;
  hosted?: string;
  maybeApplied?: boolean;
  copyNoteId?: string;
  variant?: string;
  choice?: string;
}

export type OutcomeTone = "success" | "info" | "warning" | "error";

export interface OutcomeText {
  text: string;
  tone: OutcomeTone;
  /** true when something may have changed, so the list should be refreshed. */
  changed: boolean;
}

function committedText(o: OutcomeLike): string {
  switch (o.choice) {
    case "keep_it":
      return "Done. The note is back on this device with the other device's version. Nothing on the server changed.";
    case "delete_anyway":
      return "Done. The note was deleted everywhere. A backup of the other device's version was saved on this device.";
    case "keep_mine":
      return "Done. Your version is restored on the server, so the note exists everywhere again. A backup was saved.";
    case "let_go":
      return "Done. The note was deleted from this device. A backup was saved.";
  }
  if (o.copyNoteId) {
    return "Done. Your version is kept, and the other device's version was saved as a new note. A backup of both was saved.";
  }
  switch (o.variant) {
    case "whole_take_theirs":
      return "Done. The other device's version is now on this device. A backup of your version was saved.";
    case "whole_keep_mine":
      return "Done. Your version now replaces the other device's version. A backup was saved.";
    default:
      return "Done.";
  }
}

function refusedText(reason: string | undefined): string {
  switch (reason) {
    case "signed_out":
      return "You are signed out. Sign in and try again. Nothing was changed.";
    case "note_open":
      return "This note is open in a tab. Close it, then try again. Nothing was changed.";
    case "busy":
      return "Another sync step is using this note. Try again in a moment. Nothing was changed.";
    case "backup_failed":
      return "A backup could not be saved, so nothing was changed.";
    case "copy_failed":
      return "The copy could not be created, so nothing was changed.";
    case "rebuild_failed":
    case "read_failed":
      return "Could not re-check the note against the server. Nothing was changed.";
    case "plan_failed":
      return "This choice cannot be applied to this note. Nothing was changed.";
    default:
      return "Could not start. Nothing was changed.";
  }
}

export function describeOutcome(o: OutcomeLike): OutcomeText {
  switch (o.status) {
    case "committed":
      return { text: committedText(o), tone: "success", changed: true };

    case "committed_unrecorded":
      return {
        text: "The change was made on the server, but this device could not record it. Do not repeat the action. Check this note first.",
        tone: "warning",
        changed: true,
      };

    case "stale":
      if (o.reason === "local_changed") {
        return {
          text: "This note changed on this device while you were reviewing. Nothing was written. Open it again to see the latest.",
          tone: "info",
          changed: false,
        };
      }
      return {
        text: "The other device changed this note again while you were reviewing. Nothing was written. Open it again to see the latest.",
        tone: "info",
        changed: false,
      };

    case "refused":
      return { text: refusedText(o.reason), tone: "error", changed: false };

    case "push_lost":
      return {
        text: "The note on the server changed or went away before your version could be saved. Nothing on this device was changed.",
        tone: "info",
        changed: false,
      };

    case "network_error":
      if (o.maybeApplied) {
        return {
          text: "The connection dropped, so it is not certain whether the server took your change. Wait for the next sync and check this note. Do not repeat the action yet.",
          tone: "warning",
          changed: true,
        };
      }
      return { text: "The server could not be reached. Nothing was changed.", tone: "error", changed: false };

    case "local_failed":
      return {
        text: "This device could not save the change. Nothing was sent to the server, and a backup was saved.",
        tone: "error",
        changed: false,
      };

    case "server_won_local_failed":
      return {
        text: "The server took the change, but this device could not finish saving it. Do not repeat the action. Check this note first.",
        tone: "warning",
        changed: true,
      };

    default:
      return {
        text: `Unexpected result (${o.status}). Check the note before trying again.`,
        tone: "warning",
        changed: true,
      };
  }
}
