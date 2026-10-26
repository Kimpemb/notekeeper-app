// src/features/notes/lib/reconcileGate.ts
//
// Stage 4d.3 — the gate (design rev 2, section 5.1). Pure, synchronous, no DB.
//
// A block-level merge is only trustworthy when the diff can see everything
// that matters. The gate says "yes" or gives plain reasons why the note must
// go to the whole-note review instead. It refuses when, on either side:
//   - a blockId appears more than once (the diff keys blocks by id, so
//     duplicates would be silently collapsed; see blockIdRepairApply.ts)
//   - a block of a tracked type has no blockId (the diff cannot see it)
//   - the note has more blocks than the size guard allows (the diff's parent
//     search is O(n^2) with substring searches, see threeWayDiff.ts)
// and when the ordered list of UNTRACKED top-level nodes (images, sub-pages,
// horizontal rules, ...) differs between the two sides: the diff cannot merge
// those, so a difference there must not be hidden behind a "merged" result.
//
// Untracked nodes that CONTAIN tracked blocks (for example a callout holding
// paragraphs) are compared with each tracked descendant replaced by a
// placeholder, so an edit to a paragraph inside a callout does not trip the
// gate: that paragraph is diffed on its own.

export interface DocNode {
  type?: string;
  attrs?: { blockId?: string | null; [k: string]: unknown };
  content?: DocNode[];
  [k: string]: unknown;
}

// Keep in sync with TARGET_TYPES in
// src/features/editor/components/Editor/BlockIdExtension.ts.
export const TRACKED_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
  "table",
  "toggle",
]);

// A starting guess, NOT a measurement. The dry run (reconcileDryRun.ts) logs
// the diff time per note so this can be replaced by a measured value.
export const DEFAULT_MAX_BLOCKS = 1000;

export function blockIdOf(node: DocNode | undefined): string | null {
  const id = node?.attrs?.blockId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function childrenOf(node: DocNode): DocNode[] {
  return Array.isArray(node.content) ? node.content : [];
}

/** Every blockId in pre-order, duplicates included. Same rule as computeBlockSnapshots. */
export function collectBlockIds(doc: DocNode): string[] {
  const out: string[] = [];
  const walk = (n: DocNode): void => {
    const id = blockIdOf(n);
    if (id) out.push(id);
    for (const c of childrenOf(n)) walk(c);
  };
  walk(doc);
  return out;
}

export function findDuplicateBlockIds(doc: DocNode): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of collectBlockIds(doc)) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

/** Nodes of a tracked type with no blockId, anywhere in the tree. */
export function countUnstampedTrackedBlocks(doc: DocNode): number {
  let count = 0;
  const walk = (n: DocNode): void => {
    if (TRACKED_TYPES.has(n.type ?? "") && !blockIdOf(n)) count++;
    for (const c of childrenOf(n)) walk(c);
  };
  walk(doc);
  return count;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

function canonAttrs(attrs: DocNode["attrs"], ignore: ReadonlySet<string>): unknown {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(attrs).sort()) {
    if (k === "blockId" || ignore.has(k)) continue;
    out[k] = sortKeys(attrs[k]);
  }
  return out;
}

function canonNode(node: DocNode, ignore: ReadonlySet<string>): unknown {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "content") continue;
    if (key === "attrs") {
      const a = canonAttrs(node.attrs, ignore);
      if (a !== undefined) out.attrs = a;
      continue;
    }
    out[key] = sortKeys(node[key]);
  }
  if (Array.isArray(node.content)) {
    out.content = node.content.map((c) => {
      const id = blockIdOf(c);
      return id ? { $tracked: id } : canonNode(c, ignore);
    });
  }
  return out;
}

/**
 * The ordered list of top-level nodes the diff cannot see, each as canonical
 * JSON (keys sorted, `blockId` removed, `ignoreAttrs` removed, tracked
 * descendants replaced by a placeholder). Tracked top-level nodes are skipped.
 */
export function untrackedSequence(doc: DocNode, ignoreAttrs: readonly string[] = []): string[] {
  const ignore = new Set(ignoreAttrs);
  const out: string[] = [];
  for (const c of childrenOf(doc)) {
    if (blockIdOf(c) || TRACKED_TYPES.has(c.type ?? "")) continue;
    out.push(JSON.stringify(canonNode(c, ignore)));
  }
  return out;
}

function canonShell(node: DocNode, ignore: ReadonlySet<string>): unknown {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "content") continue;
    if (key === "attrs") {
      const a = canonAttrs(node.attrs, ignore);
      if (a !== undefined) out.attrs = a;
      continue;
    }
    out[key] = sortKeys(node[key]);
  }
  if (Array.isArray(node.content)) {
    out.content = node.content.filter((c) => !blockIdOf(c)).map((c) => canonShell(c, ignore));
  }
  return out;
}

/** For each tracked node that contains tracked blocks: its shape with those blocks left out (the diff cannot see this part). */
export function containerShells(doc: DocNode, ignoreAttrs: readonly string[] = []): Map<string, string> {
  const ignore = new Set(ignoreAttrs);
  const out = new Map<string, string>();
  const hasTrackedBelow = (n: DocNode): boolean => childrenOf(n).some((c) => blockIdOf(c) || hasTrackedBelow(c));
  const walk = (n: DocNode): void => {
    const id = blockIdOf(n);
    if (id && hasTrackedBelow(n)) out.set(id, JSON.stringify(canonShell(n, ignore)));
    for (const c of childrenOf(n)) walk(c);
  };
  walk(doc);
  return out;
}

/** JSON paths where two values differ (at most `limit`), for tuning ignoreAttrs. */
export function differingPaths(
  a: unknown,
  b: unknown,
  path = "",
  out: string[] = [],
  limit = 20
): string[] {
  if (out.length >= limit || a === b) return out;
  const aObj = a !== null && typeof a === "object";
  const bObj = b !== null && typeof b === "object";
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
    out.push(path || "(root)");
    return out;
  }
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ar), ...Object.keys(br)])) {
    differingPaths(ar[k], br[k], path ? `${path}.${k}` : k, out, limit);
  }
  return out;
}

export type GateReasonCode =
  | "duplicate_block_ids"
  | "unstamped_blocks"
  | "too_many_blocks"
  | "untracked_differs"
  | "container_differs";

export interface GateReason {
  code: GateReasonCode;
  side: "theirs" | "mine" | "both";
  detail: string; // technical, for logs
}

export type GateVerdict = { ok: true } | { ok: false; reasons: GateReason[] };

export interface GateOptions {
  maxBlocks?: number;
  ignoreAttrs?: readonly string[];
}

export function evaluateGate(theirs: DocNode, mine: DocNode, opts: GateOptions = {}): GateVerdict {
  const max = opts.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const reasons: GateReason[] = [];

  const sides: Array<["theirs" | "mine", DocNode]> = [
    ["theirs", theirs],
    ["mine", mine],
  ];
  for (const [side, doc] of sides) {
    const dups = findDuplicateBlockIds(doc);
    if (dups.length > 0) {
      reasons.push({ code: "duplicate_block_ids", side, detail: `${dups.length} repeated id(s)` });
    }
    const unstamped = countUnstampedTrackedBlocks(doc);
    if (unstamped > 0) {
      reasons.push({ code: "unstamped_blocks", side, detail: `${unstamped} block(s) without an id` });
    }
    const n = collectBlockIds(doc).length;
    if (n > max) {
      reasons.push({ code: "too_many_blocks", side, detail: `${n} blocks (limit ${max})` });
    }
  }

  const a = untrackedSequence(theirs, opts.ignoreAttrs);
  const b = untrackedSequence(mine, opts.ignoreAttrs);
  if (a.length !== b.length || a.some((s, i) => s !== b[i])) {
    reasons.push({
      code: "untracked_differs",
      side: "both",
      detail: `${a.length} vs ${b.length} untracked top-level node(s), content differs`,
    });
  }

  const shellsTheirs = containerShells(theirs, opts.ignoreAttrs);
  const shellsMine = containerShells(mine, opts.ignoreAttrs);
  const changed = [...shellsTheirs.keys()].filter((id) => shellsMine.has(id) && shellsTheirs.get(id) !== shellsMine.get(id));
  if (changed.length > 0) {
    reasons.push({ code: "container_differs", side: "both", detail: `${changed.length} container block(s) differ outside their children` });
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/** Plain-language wording for the review screen (no ids, hashes or revisions). */
export function describeGateReason(reason: GateReason): string {
  switch (reason.code) {
    case "duplicate_block_ids":
      return "This note has a structural problem that stops it being merged piece by piece.";
    case "unstamped_blocks":
      return "Parts of this note were never prepared for merging.";
    case "too_many_blocks":
      return "This note is too large to merge piece by piece.";
    case "untracked_differs":
      return "The two versions differ in images, sub-pages, dividers or similar content that cannot be merged automatically.";
    case "container_differs":
      return "The two versions differ in the layout around some blocks, such as a toggle's title or a table's structure.";
  }
}
