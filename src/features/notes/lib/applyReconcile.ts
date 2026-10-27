// src/features/notes/lib/applyReconcile.ts
//
// Stage 4d.3 — apply a resolved review to a document. Pure: no DB, no network,
// no store. Design rev 2, section 5.3.
//
// Starts from MINE's tree and changes it by blockId, using the items that
// diffNoteRevisions produced (top-most changed node only; children of an added
// or deleted subtree are never reported separately).
//
//   pulled_theirs                          replace with theirs' node
//   kept_mine / unchanged                  nothing
//   added (theirs only)                    insert theirs' node
//   added (mine only)                      nothing
//   conflict       keep_mine | take_theirs nothing | replace
//   source_deleted keep_local | remove_here_too            nothing | remove
//   mine_deleted_theirs_edited keep_local | restore_theirs nothing | insert
//
// Insert position (a heuristic): after the nearest previous sibling in THEIRS
// that exists in the merged tree; else before the nearest next sibling that
// does; else, when the node sits directly under theirs' root, at the start of
// the merged document; else at the end of the merged document with a note.
//
// Completeness check: every blockId present in mine or theirs must be in the
// merged tree, unless a decision deliberately left it out. If one is missing,
// the result is { ok: false, reason: "missing_blocks" } and the caller must not
// push anything.
//
// Not merged (by design): block moves and order changes outside changed
// containers, and untracked nodes (see reconcileGate.ts).

import type { BlockDiffResult, DiffClassification } from "./threeWayDiff";
import type { ReconcileAction, ReconcileItem } from "./reconcileSession";
import { blockIdOf, collectBlockIds, findDuplicateBlockIds, type DocNode } from "./reconcileGate";

export type ApplyItem = Pick<
  ReconcileItem,
  "blockId" | "classification" | "status" | "chosenAction" | "mine" | "theirs" | "base"
>;

export type ApplyFailure =
  | "unparseable"
  | "duplicate_block_ids"
  | "unresolved_item"
  | "item_not_found"
  | "missing_blocks";

export type ApplyResult =
  | {
      ok: true;
      doc: DocNode;
      notes: string[];
      counts: { replaced: number; inserted: number; removed: number };
    }
  | { ok: false; reason: ApplyFailure; detail: string[] };

type Op = "none" | "replace" | "insert" | "remove" | "unresolved";

const AUTO_CLASSES: ReadonlySet<DiffClassification> = new Set<DiffClassification>([
  "unchanged",
  "pulled_theirs",
  "kept_mine",
  "added",
]);

/**
 * Turns diff output into apply-ready items. Auto-safe classes become "auto".
 * Others become "resolved" using `choices[blockId]`, else the diff's default
 * (conflicts have none, so `conflictFallback` is used if given, e.g. by a dry
 * run), else they stay "pending" and applyReconcile will refuse them.
 */
export function itemsFromDiff(
  results: BlockDiffResult[],
  choices: Record<string, ReconcileAction> = {},
  conflictFallback?: ReconcileAction
): ApplyItem[] {
  return results.map((r): ApplyItem => {
    const common = {
      blockId: r.blockId,
      classification: r.classification,
      base: r.base,
      theirs: r.theirs,
      mine: r.mine,
    };
    if (AUTO_CLASSES.has(r.classification)) return { ...common, status: "auto" };
    const chosen: ReconcileAction | undefined =
      choices[r.blockId] ?? (r.classification === "conflict" ? conflictFallback : r.defaultAction);
    return chosen
      ? { ...common, status: "resolved", chosenAction: chosen }
      : { ...common, status: "pending" };
  });
}

function operationFor(item: ApplyItem): Op {
  const chosen = item.status === "resolved" ? item.chosenAction : undefined;
  switch (item.classification) {
    case "unchanged":
    case "kept_mine":
      return "none";
    case "pulled_theirs":
      // Theirs has no node for this block (theirs deleted it, mine left it unchanged): keep mine.
      return item.theirs ? "replace" : "none";
    case "added":
      return item.theirs && !item.mine ? "insert" : "none";
    case "conflict":
      if (chosen === "take_theirs") return "replace";
      if (chosen === "keep_mine") return "none";
      return "unresolved"; // includes merge_ai, which 4d.3 does not offer
    case "source_deleted":
      if (chosen === "remove_here_too") return "remove";
      if (chosen === "keep_local") return "none";
      return "unresolved";
    case "mine_deleted_theirs_edited":
      if (chosen === "restore_theirs") return "insert";
      if (chosen === "keep_local") return "none";
      return "unresolved";
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Loc {
  parent: DocNode;
  index: number;
}

function locate(root: DocNode, id: string): Loc | null {
  const walk = (node: DocNode): Loc | null => {
    const kids = node.content;
    if (!Array.isArray(kids)) return null;
    for (let i = 0; i < kids.length; i++) {
      if (blockIdOf(kids[i]) === id) return { parent: node, index: i };
      const deeper = walk(kids[i]);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(root);
}

function nodeAt(loc: Loc): DocNode {
  return (loc.parent.content as DocNode[])[loc.index];
}

function idsInContent(content: string | undefined): string[] {
  if (!content) return [];
  return [...content.matchAll(/"blockId":"([^"]+)"/g)].map((m) => m[1]);
}

/** Node for `id` from theirs' tree, falling back to the item's stored snapshot. */
function theirsNodeFor(theirsDoc: DocNode, item: ApplyItem): DocNode | null {
  const loc = locate(theirsDoc, item.blockId);
  if (loc) return clone(nodeAt(loc));
  if (item.theirs) {
    try {
      return JSON.parse(item.theirs.content) as DocNode;
    } catch {
      return null;
    }
  }
  return null;
}

export function applyReconcile(mineDoc: DocNode, theirsDoc: DocNode, items: ApplyItem[]): ApplyResult {
  const dups = [...findDuplicateBlockIds(mineDoc), ...findDuplicateBlockIds(theirsDoc)];
  if (dups.length > 0) return { ok: false, reason: "duplicate_block_ids", detail: dups };

  const ops = items.map((item) => ({ item, op: operationFor(item) }));
  const unresolved = ops.filter((o) => o.op === "unresolved").map((o) => o.item.blockId);
  if (unresolved.length > 0) return { ok: false, reason: "unresolved_item", detail: unresolved };

  const merged = clone(mineDoc);
  const notes: string[] = [];
  const counts = { replaced: 0, inserted: 0, removed: 0 };

  // 1. Replacements and removals, located by id in the merged tree.
  for (const { item, op } of ops) {
    if (op !== "replace" && op !== "remove") continue;
    const loc = locate(merged, item.blockId);
    if (!loc) return { ok: false, reason: "item_not_found", detail: [item.blockId] };
    const kids = loc.parent.content as DocNode[];
    if (op === "remove") {
      kids.splice(loc.index, 1);
      counts.removed++;
    } else {
      const replacement = theirsNodeFor(theirsDoc, item);
      if (!replacement) return { ok: false, reason: "item_not_found", detail: [item.blockId] };
      kids[loc.index] = replacement;
      counts.replaced++;
    }
  }

  // 2. Insertions, in theirs' document order so consecutive new blocks keep
  //    their order (a later one can anchor on an earlier one).
  const theirsOrder = new Map<string, number>();
  collectBlockIds(theirsDoc).forEach((id, i) => theirsOrder.set(id, i));
  const inserts = ops
    .filter((o) => o.op === "insert")
    .sort(
      (a, b) =>
        (theirsOrder.get(a.item.blockId) ?? Number.MAX_SAFE_INTEGER) -
        (theirsOrder.get(b.item.blockId) ?? Number.MAX_SAFE_INTEGER)
    );

  for (const { item } of inserts) {
    const node = theirsNodeFor(theirsDoc, item);
    if (!node) return { ok: false, reason: "item_not_found", detail: [item.blockId] };
    const theirsLoc = locate(theirsDoc, item.blockId);
    let placed = false;

    if (theirsLoc) {
      const siblings = theirsLoc.parent.content as DocNode[];
      for (let j = theirsLoc.index - 1; j >= 0 && !placed; j--) {
        const sid = blockIdOf(siblings[j]);
        const anchor = sid ? locate(merged, sid) : null;
        if (anchor) {
          (anchor.parent.content as DocNode[]).splice(anchor.index + 1, 0, node);
          placed = true;
        }
      }
      for (let j = theirsLoc.index + 1; j < siblings.length && !placed; j++) {
        const sid = blockIdOf(siblings[j]);
        const anchor = sid ? locate(merged, sid) : null;
        if (anchor) {
          (anchor.parent.content as DocNode[]).splice(anchor.index, 0, node);
          placed = true;
        }
      }
      if (!placed && theirsLoc.parent === theirsDoc) {
        merged.content = [node, ...(merged.content ?? [])];
        placed = true;
      }
    }

    if (!placed) {
      merged.content = [...(merged.content ?? []), node];
      notes.push(`Block ${item.blockId} was added at the end of the note: its original position could not be found.`);
    }
    counts.inserted++;
  }

  // 3. Completeness: nothing from either side may vanish unless a decision removed it.
  const allowedAbsent = new Set<string>();
  for (const { item, op } of ops) {
    const leftOut = op === "remove" || (op === "none" && !item.mine);
    if (!leftOut) continue;
    allowedAbsent.add(item.blockId);
    for (const snap of [item.mine, item.theirs, item.base]) {
      for (const id of idsInContent(snap?.content)) allowedAbsent.add(id);
    }
  }
  const present = new Set(collectBlockIds(merged));
  const everything = new Set([...collectBlockIds(mineDoc), ...collectBlockIds(theirsDoc)]);
  const missing = [...everything].filter((id) => !present.has(id) && !allowedAbsent.has(id));
  if (missing.length > 0) return { ok: false, reason: "missing_blocks", detail: missing };

  return { ok: true, doc: merged, notes, counts };
}

/** JSON-string wrapper for callers that hold note content as stored. */
export function applyReconcileJson(
  mineContent: string,
  theirsContent: string,
  items: ApplyItem[]
): ApplyResult & { content?: string } {
  let mine: DocNode;
  let theirs: DocNode;
  try {
    mine = JSON.parse(mineContent) as DocNode;
    theirs = JSON.parse(theirsContent) as DocNode;
  } catch {
    return { ok: false, reason: "unparseable", detail: [] };
  }
  const result = applyReconcile(mine, theirs, items);
  return result.ok ? { ...result, content: JSON.stringify(result.doc) } : result;
}
