// src/features/sync/lib/blockMergeView.ts
//
// Stage 4d.3, step 13 (stage 3) — PURE view model for the block-merge review screen.
// Turns a block-mode (or identical) review into what the screen shows: one decision
// card per block that needs a choice (plain-text preview of mine, theirs and, when it
// exists, the common ancestor), a short list of what merges by itself, the metadata
// rows, and whether Apply is allowed yet. Also turns the user's picks into the item
// list the existing block_merge commit expects.
// No DB, no network, no store, no React. Imports only pure modules (type imports are
// erased; wholeNoteView.ts is pure).
//
// Rules carried over from the design:
//   - a true conflict has no default; the user must pick keep mine or take theirs
//   - the two delete-versus-edit cases default to keeping this device's side
//   - merge_ai is not offered in 4d.3
//   - block order changes and untracked nodes are not merged (the gate guards these)

import type { ApplyItem } from "@/features/notes/lib/applyReconcile";
import type { ReconcileAction } from "@/features/notes/lib/reconcileSession";
import type { BlockSnapshot, DiffClassification } from "@/features/notes/lib/threeWayDiff";
import {
  buildMediaNotice,
  contentToLines,
  countMedia,
  toMetaRows,
  type MetaRowInput,
  type WholeNoteMetaRow,
} from "@/features/sync/lib/wholeNoteView";

// ─── Cards ────────────────────────────────────────────────────────────────

export type CardKind = "conflict" | "removed_there" | "removed_here";

export interface CardOption {
  action: ReconcileAction;
  label: string;
  description: string;
  /** The safe, highlighted choice. Never true for a conflict. */
  isDefault: boolean;
}

export interface DecisionCard {
  blockId: string;
  kind: CardKind;
  badge: string;
  heading: string;
  explanation: string;
  /** null when the block did not exist on that side (or there is no common ancestor). */
  base: string[] | null;
  mine: string[] | null;
  theirs: string[] | null;
  options: CardOption[];
  /** The effective choice: the user's pick, else the safe default, else null (a conflict not yet decided). */
  selected: ReconcileAction | null;
}

export interface AutoLine {
  blockId: string;
  label: string;
  excerpt: string;
}

export type ScreenState =
  | "decide" // at least one card needs a choice
  | "apply_only" // nothing to decide, but there are changes to merge (Test C&D)
  | "identical"; // both sides hold the same blocks; only recording the agreement is left

export interface BlockMergeCounts {
  decisions: number;
  decided: number;
  pending: number;
  auto: number;
  unchanged: number;
}

export interface BlockMergeView {
  state: ScreenState;
  cards: DecisionCard[];
  autoLines: AutoLine[];
  counts: BlockMergeCounts;
  mediaNotice: string | null;
  metaRows: WholeNoteMetaRow[];
  /** Apply is allowed: no card is still pending. */
  canApply: boolean;
  applyLabel: string;
  /** One plain sentence under the heading. */
  summary: string;
}

export interface BlockMergeViewInput {
  mode: "block" | "identical";
  items: readonly ApplyItem[];
  /** The user's picks by block id (anything not allowed for that kind of block is ignored). */
  choices?: Readonly<Record<string, ReconcileAction>>;
  mineContent: string;
  theirsContent: string;
  metaRows: readonly MetaRowInput[];
  parentTitles?: ReadonlyMap<string, string>;
}

// ─── Per-kind rules ───────────────────────────────────────────────────────

const NEEDS_DECISION: ReadonlySet<DiffClassification> = new Set<DiffClassification>([
  "conflict",
  "source_deleted",
  "mine_deleted_theirs_edited",
]);

function kindOf(c: DiffClassification): CardKind | null {
  if (c === "conflict") return "conflict";
  if (c === "source_deleted") return "removed_there";
  if (c === "mine_deleted_theirs_edited") return "removed_here";
  return null;
}

const OPTIONS: Record<CardKind, CardOption[]> = {
  conflict: [
    {
      action: "keep_mine",
      label: "Keep mine",
      description: "Your version of this block goes into the merged note.",
      isDefault: false,
    },
    {
      action: "take_theirs",
      label: "Take theirs",
      description: "The other device's version of this block goes into the merged note.",
      isDefault: false,
    },
  ],
  removed_there: [
    {
      action: "keep_local",
      label: "Keep it here",
      description: "The block stays in your note and goes back to the other device.",
      isDefault: true,
    },
    {
      action: "remove_here_too",
      label: "Remove it here too",
      description: "The block is taken out of your note, like on the other device.",
      isDefault: false,
    },
  ],
  removed_here: [
    {
      action: "keep_local",
      label: "Keep it removed",
      description: "The block stays out of the merged note, as you left it.",
      isDefault: true,
    },
    {
      action: "restore_theirs",
      label: "Bring it back",
      description: "The block returns with the other device's edit.",
      isDefault: false,
    },
  ],
};

const COPY: Record<CardKind, { badge: string; heading: string; explanation: string }> = {
  conflict: {
    badge: "CONFLICT",
    heading: "Changed on both devices",
    explanation: "This block was edited here and on the other device. Pick the version to keep.",
  },
  removed_there: {
    badge: "REMOVED ELSEWHERE",
    heading: "Removed on the other device",
    explanation: "The other device removed this block. It is still in your version.",
  },
  removed_here: {
    badge: "YOU REMOVED",
    heading: "You removed this; the other device edited it",
    explanation: "You removed this block here, but the other device changed it before it was removed.",
  },
};

/** The picks a block of this classification can take; empty for blocks that never need one. */
export function allowedActions(c: DiffClassification): ReconcileAction[] {
  const k = kindOf(c);
  return k ? OPTIONS[k].map((o) => o.action) : [];
}

// ─── Preview text ─────────────────────────────────────────────────────────

const EMPTY_BLOCK = "(empty block)";
const EXCERPT_MAX = 80;

function linesOf(snap: BlockSnapshot | undefined): string[] | null {
  if (!snap) return null;
  const lines = contentToLines(snap.content);
  return lines.length === 0 ? [EMPTY_BLOCK] : lines;
}

function excerptOf(snap: BlockSnapshot | undefined): string {
  const lines = linesOf(snap);
  if (!lines) return EMPTY_BLOCK;
  const meaningful = lines.filter((l) => l.trim() !== "");
  if (meaningful.length === 0) return EMPTY_BLOCK;
  const first = meaningful[0];
  const cut = first.length > EXCERPT_MAX;
  const text = cut ? first.slice(0, EXCERPT_MAX).trimEnd() : first;
  return cut || meaningful.length > 1 ? `${text} …` : text;
}

// ─── Effective choice, and the items the commit takes ─────────────────────

/** The user's pick if it is allowed for this block; else the already-resolved value (the safe default or a saved choice); else null. */
export function effectiveChoice(
  item: ApplyItem,
  choices: Readonly<Record<string, ReconcileAction>> = {}
): ReconcileAction | null {
  const allowed = allowedActions(item.classification);
  if (allowed.length === 0) return null;
  const picked = choices[item.blockId];
  if (picked && allowed.includes(picked)) return picked;
  if (item.status === "resolved" && item.chosenAction && allowed.includes(item.chosenAction)) return item.chosenAction;
  return null;
}

/**
 * The item list for the block_merge commit: every item as given, with each decision
 * block resolved to its effective choice, or left pending when there is none (the
 * commit refuses a pending item, so it can never go through undecided).
 */
export function itemsForCommit(
  items: readonly ApplyItem[],
  choices: Readonly<Record<string, ReconcileAction>> = {}
): ApplyItem[] {
  return items.map((item): ApplyItem => {
    if (!NEEDS_DECISION.has(item.classification)) return item;
    const chosen = effectiveChoice(item, choices);
    const { chosenAction: _drop, ...rest } = item;
    void _drop;
    return chosen ? { ...rest, status: "resolved", chosenAction: chosen } : { ...rest, status: "pending" };
  });
}

// ─── Auto-merged lines ────────────────────────────────────────────────────

function autoLineFor(item: ApplyItem): AutoLine | null {
  switch (item.classification) {
    case "pulled_theirs":
      return item.theirs
        ? { blockId: item.blockId, label: "Changed on the other device: their change is taken", excerpt: excerptOf(item.theirs) }
        : {
            blockId: item.blockId,
            label: "Removed on the other device: kept here because you did not change it",
            excerpt: excerptOf(item.mine ?? item.base),
          };
    case "kept_mine":
      return item.mine
        ? { blockId: item.blockId, label: "Changed here: your change is kept", excerpt: excerptOf(item.mine) }
        : { blockId: item.blockId, label: "Removed here: stays removed", excerpt: excerptOf(item.base ?? item.theirs) };
    case "added":
      return item.theirs && !item.mine
        ? { blockId: item.blockId, label: "Added on the other device: added here", excerpt: excerptOf(item.theirs) }
        : { blockId: item.blockId, label: "Added here: kept", excerpt: excerptOf(item.mine) };
    default:
      return null;
  }
}

// ─── The view ─────────────────────────────────────────────────────────────

const KIND_RANK: Record<CardKind, number> = { conflict: 0, removed_here: 1, removed_there: 2 };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildBlockMergeView(input: BlockMergeViewInput): BlockMergeView {
  const choices = input.choices ?? {};

  const cards: DecisionCard[] = [];
  for (const item of input.items) {
    const kind = kindOf(item.classification);
    if (!kind) continue;
    const copy = COPY[kind];
    cards.push({
      blockId: item.blockId,
      kind,
      badge: copy.badge,
      heading: copy.heading,
      explanation: copy.explanation,
      base: linesOf(item.base),
      mine: linesOf(item.mine),
      theirs: linesOf(item.theirs),
      options: OPTIONS[kind].map((o) => ({ ...o })),
      selected: effectiveChoice(item, choices),
    });
  }
  // Conflicts first (they need the most attention); otherwise the diff's order.
  const ordered = cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => KIND_RANK[a.c.kind] - KIND_RANK[b.c.kind] || a.i - b.i)
    .map((x) => x.c);

  const autoLines: AutoLine[] = [];
  for (const item of input.items) {
    if (item.status !== "auto" || item.classification === "unchanged") continue;
    const line = autoLineFor(item);
    if (line) autoLines.push(line);
  }

  const decided = ordered.filter((c) => c.selected !== null).length;
  const counts: BlockMergeCounts = {
    decisions: ordered.length,
    decided,
    pending: ordered.length - decided,
    auto: autoLines.length,
    unchanged: input.items.filter((i) => i.classification === "unchanged").length,
  };

  const state: ScreenState =
    ordered.length > 0 ? "decide" : input.mode === "identical" ? "identical" : "apply_only";

  const mineMedia = countMedia(input.mineContent);
  const theirsMedia = countMedia(input.theirsContent);

  let summary: string;
  if (state === "decide") {
    summary =
      counts.pending > 0
        ? `${plural(counts.decisions, "block needs", "blocks need")} your decision (${counts.decided} of ${counts.decisions} decided). ${plural(counts.auto, "other change merges", "other changes merge")} by itself.`
        : `All ${counts.decisions} decisions are made. ${plural(counts.auto, "other change merges", "other changes merge")} by itself. Nothing is saved until you apply.`;
  } else if (state === "apply_only") {
    summary = `Nothing needs your decision. ${plural(counts.auto, "change merges", "changes merge")} by itself. Nothing is saved until you apply.`;
  } else {
    summary = "Both versions already match. Finishing records that they agree.";
  }

  return {
    state,
    cards: ordered,
    autoLines,
    counts,
    mediaNotice: buildMediaNotice(mineMedia, theirsMedia),
    metaRows: toMetaRows(input.metaRows, input.parentTitles),
    canApply: counts.pending === 0,
    applyLabel: state === "identical" ? "Finish" : "Apply merge",
    summary,
  };
}
