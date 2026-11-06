// src/features/sync/lib/wholeNoteView.ts
//
// Stage 4d.3, step 13 (stage 1) — PURE view model for the whole-note review screen.
// Turns a review into what the screen shows: both versions as readable lines, an
// exact notice about images and attachments, the title/parent rows with plain
// labels, and the three choices (keep mine highlighted) with their warnings.
// No DB, no network, no store, no React; the only import is another pure module.
//
// Why the media notice: images and attachments are files on one machine; a note
// stores their absolute path as attrs.src (node types "image" and "attachment")
// and the files do not sync. Nothing is lost by any choice (files stay on disk and
// mine's content goes into the backup), but the user should know what to expect.

import { conflictCopyTitle } from "@/features/sync/lib/conflictCopy";

// ─── Content helpers ──────────────────────────────────────────────────────

interface DocNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

function parse(contentJson: string): DocNode | null {
  try {
    const v: unknown = JSON.parse(contentJson);
    return v !== null && typeof v === "object" ? (v as DocNode) : null;
  } catch {
    return null;
  }
}

export interface MediaCount {
  images: number;
  attachments: number;
  total: number;
}

/** Counts image and attachment nodes anywhere in the content. Unreadable content counts as none. */
export function countMedia(contentJson: string): MediaCount {
  const m: MediaCount = { images: 0, attachments: 0, total: 0 };
  const root = parse(contentJson);
  if (!root) return m;
  const walk = (n: DocNode): void => {
    if (n.type === "image") m.images++;
    else if (n.type === "attachment") m.attachments++;
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(root);
  m.total = m.images + m.attachments;
  return m;
}

export const UNREADABLE_LINE = "(this version could not be read)";
export const RULE_LINE = "───";

const TEXT_BLOCKS: ReadonlySet<string> = new Set(["paragraph", "heading", "codeBlock"]);

function inlineText(n: DocNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return " ";
  if (!Array.isArray(n.content)) return typeof n.attrs?.title === "string" ? `[${n.attrs.title}]` : "";
  return n.content.map(inlineText).join("");
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function mediaLabel(n: DocNode): string {
  const a = n.attrs ?? {};
  if (typeof a.filename === "string" && a.filename !== "") return a.filename;
  if (typeof a.alt === "string" && a.alt !== "") return a.alt;
  if (typeof a.src === "string" && a.src !== "") return baseName(a.src);
  return "unnamed";
}

/** The note as readable lines: one per paragraph, heading or code block, in document order. */
export function contentToLines(contentJson: string): string[] {
  const root = parse(contentJson);
  if (!root) return [UNREADABLE_LINE];
  const lines: string[] = [];
  const walk = (n: DocNode): void => {
    const t = n.type ?? "";
    if (TEXT_BLOCKS.has(t)) {
      lines.push(inlineText(n));
      return;
    }
    if (t === "horizontalRule") {
      lines.push(RULE_LINE);
      return;
    }
    if (t === "image") {
      lines.push(`[image: ${mediaLabel(n)}]`);
      return;
    }
    if (t === "attachment") {
      lines.push(`[attachment: ${mediaLabel(n)}]`);
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(root);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

export function describeMedia(m: MediaCount): string {
  if (m.total === 0) return "no images or attachments";
  const parts: string[] = [];
  if (m.images > 0) parts.push(`${m.images} ${m.images === 1 ? "image" : "images"}`);
  if (m.attachments > 0) parts.push(`${m.attachments} ${m.attachments === 1 ? "attachment" : "attachments"}`);
  return parts.join(" and ");
}

// ─── Metadata rows ────────────────────────────────────────────────────────

/** One row from the commit plan's metaRows (title, parent and so on). */
export interface MetaRowInput {
  field: string;
  mine: unknown;
  theirs: unknown;
  /** The choice the plan pre-selected. */
  choice: "mine" | "theirs";
  /** Whether taking theirs is possible (a hosted parent this device lacks is never taken). */
  canTakeTheirs: boolean;
}

export interface WholeNoteMetaRow {
  field: string;
  label: string;
  mineLabel: string;
  theirsLabel: string;
  preselected: "mine" | "theirs";
  canTakeTheirs: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  parentId: "Parent note",
  sortOrder: "Position",
  tags: "Tags",
  frontmatter: "Properties",
  deletedAt: "Trash",
};

function valueLabel(field: string, v: unknown, parentTitles?: ReadonlyMap<string, string>): string {
  if (field === "parentId") {
    if (v === null || v === undefined || v === "") return "Top level";
    const id = String(v);
    return parentTitles?.get(id) ?? `Another note (${id.slice(0, 8)})`;
  }
  if (field === "title") return v === null || v === undefined || v === "" ? "Untitled" : String(v);
  if (field === "deletedAt") return v === null || v === undefined ? "Not in the trash" : "In the trash";
  if (v === null || v === undefined || v === "") return "(none)";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

// ─── The view ─────────────────────────────────────────────────────────────

export type WholeNoteChoiceId = "keep_mine" | "take_theirs" | "keep_both";

export interface WholeNoteChoice {
  id: WholeNoteChoiceId;
  /** The commit variant this choice runs. */
  variant: "whole_keep_mine" | "whole_take_theirs" | "whole_keep_both";
  label: string;
  description: string;
  /** The safe, highlighted choice. */
  isDefault: boolean;
  /** Plain-language heads-up about media; null when there is nothing to say. */
  warning: string | null;
}

export interface WholeNoteViewInput {
  mineContent: string;
  theirsContent: string;
  mineTitle: string;
  metaRows: readonly MetaRowInput[];
  /** Note titles by id, so the parent row can show names instead of ids. */
  parentTitles?: ReadonlyMap<string, string>;
}

export interface WholeNoteSide {
  lines: string[];
  media: MediaCount;
}

export interface WholeNoteView {
  mine: WholeNoteSide;
  theirs: WholeNoteSide;
  /** The readable text is the same on both sides; only formatting or non-text parts differ. */
  sameText: boolean;
  /** null when neither version has images or attachments. */
  mediaNotice: string | null;
  metaRows: WholeNoteMetaRow[];
  choices: WholeNoteChoice[];
}

export function buildWholeNoteView(input: WholeNoteViewInput): WholeNoteView {
  const mine: WholeNoteSide = { lines: contentToLines(input.mineContent), media: countMedia(input.mineContent) };
  const theirs: WholeNoteSide = { lines: contentToLines(input.theirsContent), media: countMedia(input.theirsContent) };

  const mediaNotice =
    mine.media.total + theirs.media.total === 0
      ? null
      : `Images and attachments are stored as files on one device and are not synced, so they may not appear on your other device. Your version has ${describeMedia(mine.media)}; the other version has ${describeMedia(theirs.media)}.`;

  const takeTheirsWarnings: string[] = [];
  if (mine.media.total > 0) {
    takeTheirsWarnings.push(
      `Your version has ${describeMedia(mine.media)}; after this they stop showing in this note. The files stay on disk and your version is backed up.`
    );
  }
  if (theirs.media.total > 0) {
    takeTheirsWarnings.push(
      `The other version has ${describeMedia(theirs.media)}; those files are on the other device and may not show here.`
    );
  }

  const choices: WholeNoteChoice[] = [
    {
      id: "keep_mine",
      variant: "whole_keep_mine",
      label: "Keep mine",
      description: "Your version replaces the other device's version. A backup of both is saved first.",
      isDefault: true,
      warning:
        mine.media.total > 0
          ? "Images and attachments in your version are files on this device. Other devices may not show them."
          : null,
    },
    {
      id: "take_theirs",
      variant: "whole_take_theirs",
      label: "Take theirs",
      description: "The other device's version replaces yours on this device. A backup of both is saved first.",
      isDefault: false,
      warning: takeTheirsWarnings.length > 0 ? takeTheirsWarnings.join(" ") : null,
    },
    {
      id: "keep_both",
      variant: "whole_keep_both",
      label: "Keep both",
      description: `Your version stays. The other device's version is saved as a new note called "${conflictCopyTitle(input.mineTitle)}". A backup of both is saved first.`,
      isDefault: false,
      warning:
        theirs.media.total > 0
          ? "The copy keeps the other version's images and attachments. Those files are on the other device and may not show here."
          : null,
    },
  ];

  return {
    mine,
    theirs,
    sameText: mine.lines.join("\n") === theirs.lines.join("\n"),
    mediaNotice,
    metaRows: input.metaRows.map((r) => ({
      field: r.field,
      label: FIELD_LABELS[r.field] ?? r.field,
      mineLabel: valueLabel(r.field, r.mine, input.parentTitles),
      theirsLabel: valueLabel(r.field, r.theirs, input.parentTitles),
      preselected: r.choice,
      canTakeTheirs: r.canTakeTheirs,
    })),
    choices,
  };
}
