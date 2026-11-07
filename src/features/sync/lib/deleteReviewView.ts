// src/features/sync/lib/deleteReviewView.ts
//
// Stage 4d.3, step 13 (stage 2) — PURE view models for the two delete reviews.
// No DB, no network, no store, no React; the only import is another pure module.
//
//   D1  "deleted here, edited elsewhere": shows the other device's version.
//       Default: restore it. Destructive: delete it everywhere (needs a confirm click).
//   D2  "deleted elsewhere, edited here": shows YOUR version (the deleted one is wiped
//       on the server, so yours is the only copy). Default: keep mine.
//       Destructive: let the deletion stand (needs a confirm click).
//
// Wording rule: say what each choice does to this device and to the server, and
// mention the backup whenever something is destroyed.

import { contentToLines, countMedia, describeMedia, type MediaCount } from "@/features/sync/lib/wholeNoteView";

export type DeleteReviewChoiceId = "keep_it" | "delete_anyway" | "keep_mine" | "let_go";

export interface DeleteReviewChoice {
  id: DeleteReviewChoiceId;
  label: string;
  description: string;
  /** The safe, highlighted choice. */
  isDefault: boolean;
  /** Destructive choices need a second click on a confirmation. */
  requiresConfirm: boolean;
  confirmText: string | null;
  warning: string | null;
}

export interface DeleteReviewView {
  case: "d1" | "d2";
  heading: string;
  explanation: string;
  /** What the lines below are: "The other device's version" or "Your version". */
  contentLabel: string;
  lines: string[];
  media: MediaCount;
  mediaNotice: string | null;
  choices: DeleteReviewChoice[];
}

const displayTitle = (title: string): string => (title.trim() === "" ? "Untitled" : title);

// ─── D1 ───────────────────────────────────────────────────────────────────

export interface D1ViewInput {
  title: string;
  hostedContent: string;
  /** The other device has this note in its trash. */
  hostedInTrash: boolean;
}

export function buildD1View(input: D1ViewInput): DeleteReviewView {
  const name = displayTitle(input.title);
  const media = countMedia(input.hostedContent);

  return {
    case: "d1",
    heading: name,
    explanation:
      "You deleted this note on this device. The other device changed it afterwards, so it was not deleted there.",
    contentLabel: "The other device's version",
    lines: contentToLines(input.hostedContent),
    media,
    mediaNotice:
      media.total === 0
        ? null
        : `The other device's version has ${describeMedia(media)}. Images and attachments are stored as files on one device and are not synced, so they may not show here.`,
    choices: [
      {
        id: "keep_it",
        label: "Restore the note",
        description:
          "The other device's version comes back on this device. Nothing on the server changes." +
          (input.hostedInTrash ? " It comes back in the trash, because that is where the other device has it." : ""),
        isDefault: true,
        requiresConfirm: false,
        confirmText: null,
        warning:
          media.total > 0
            ? "The restored note has images or attachments whose files are on the other device, so they may not show here."
            : null,
      },
      {
        id: "delete_anyway",
        label: "Delete it everywhere",
        description:
          "The other device's version is deleted from the server too, and its changes are lost there. A backup of it is saved on this device first.",
        isDefault: false,
        requiresConfirm: true,
        confirmText: `Delete "${name}" everywhere? The other device's changes will be gone from the server. A backup is saved on this device first.`,
        warning: null,
      },
    ],
  };
}

// ─── D2 ───────────────────────────────────────────────────────────────────

export interface D2ViewInput {
  title: string;
  localContent: string;
}

export function buildD2View(input: D2ViewInput): DeleteReviewView {
  const name = displayTitle(input.title);
  const media = countMedia(input.localContent);

  return {
    case: "d2",
    heading: name,
    explanation:
      "This note was deleted on another device, but you changed it here. The deleted version cannot be shown, because deleting wipes it. Your version is the only copy left.",
    contentLabel: "Your version",
    lines: contentToLines(input.localContent),
    media,
    mediaNotice:
      media.total === 0
        ? null
        : `Your version has ${describeMedia(media)}. Images and attachments are stored as files on this device and are not synced, so other devices may not show them.`,
    choices: [
      {
        id: "keep_mine",
        label: "Keep my note",
        description:
          "Your version is restored on the server, so the note exists everywhere again. A backup is saved first. Sharing and publishing settings are not restored.",
        isDefault: true,
        requiresConfirm: false,
        confirmText: null,
        warning: null,
      },
      {
        id: "let_go",
        label: "Let the deletion stand",
        description: "Your version is deleted from this device too. A backup is saved first.",
        isDefault: false,
        requiresConfirm: true,
        confirmText: `Delete "${name}" from this device? Your changes will be gone from your notes. A backup is saved first, and it will be the only copy.`,
        warning: null,
      },
    ],
  };
}
