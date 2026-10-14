// src/features/notes/lib/threeWayDiff.ts
//
// Three-way block diff: base (common ancestor) / theirs (source's current
// state) / mine (local or fork's current state) → per-block classification.
//
// Pure, synchronous, no DB access — see Custom Sync Engine — Core Design §4
// and the companion design doc (three-way-diff-design.md) for the full
// rationale, worked example, and the two product decisions flagged for
// confirmation (§4.2, §4.3 in that doc).
//
// Input is intentionally a flat Map per side, not a tree — the caller
// (a loader in blockRevisioning.ts or, later, a Stage 4 network payload)
// only has flat block_revision_snapshots rows to hand over. Parent/child
// relationships between blockId'd nodes are reconstructed here from each
// node's own stored content: because computeBlockSnapshots() serializes a
// node's FULL subtree (JSON.stringify(node), including nested children),
// a descendant's "blockId":"<id>" string is always embedded inside every
// ancestor's content string. Substring matching on that is reliable here
// because blockIds are crypto.randomUUID()s — collision-proof in practice.

export type BlockHash = string; // sha-256 hex, per hashBlockContent() in blockRevisioning.ts

export interface BlockSnapshot {
  blockId: string;
  content: string; // raw JSON.stringify(node), as stored in block_revision_snapshots
  hash:    BlockHash;
}

export type BlockMap = Map<string /* blockId */, BlockSnapshot>;

export type DiffClassification =
  | "unchanged"
  | "pulled_theirs"
  | "kept_mine"
  | "added"
  | "conflict"
  | "source_deleted"
  | "mine_deleted_theirs_edited";

export interface BlockDiffResult {
  blockId:        string;
  classification: DiffClassification;
  base?:          BlockSnapshot;
  theirs?:        BlockSnapshot;
  mine?:          BlockSnapshot;
  defaultAction?: "restore_theirs" | "keep_local";
}

type NodeVerdict = "skip" | "recurse" | BlockDiffResult;

/**
 * Pure, synchronous. `base === null` means no usable base snapshot exists
 * (pruned by the Stage 0 retention trigger, or predates any snapshot) —
 * the caller is responsible for distinguishing that from a genuinely empty
 * note before calling in (see design doc §4.3). When base is null, this
 * function falls back to a direct theirs-vs-mine comparison per block.
 */
export function diffNoteRevisions(
  base: BlockMap | null,
  theirs: BlockMap,
  mine: BlockMap
): BlockDiffResult[] {
  const allIds = new Set<string>([
    ...theirs.keys(),
    ...mine.keys(),
    ...(base ? base.keys() : []),
  ]);

  // ── Reconstruct hierarchy from flat maps (see file header) ──────────────

  function representativeContent(id: string): string | undefined {
    return theirs.get(id)?.content ?? mine.get(id)?.content ?? base?.get(id)?.content;
  }

  function contains(parentId: string, childId: string): boolean {
    if (parentId === childId) return false;
    const content = representativeContent(parentId);
    if (!content) return false;
    return content.includes(`"blockId":"${childId}"`);
  }

  // Direct children only — ids contained by `parentId` but not also
  // contained by one of parentId's other descendants (which would make
  // them grandchildren, already owned by that nearer ancestor).
  const directChildrenCache = new Map<string, string[]>();
  function directChildren(parentId: string): string[] {
    const cached = directChildrenCache.get(parentId);
    if (cached) return cached;
    const containedIds = [...allIds].filter((id) => contains(parentId, id));
    const direct = containedIds.filter(
      (id) => !containedIds.some((other) => other !== id && contains(other, id))
    );
    directChildrenCache.set(parentId, direct);
    return direct;
  }

  // Roots — ids not contained by any other known id. Acceptable O(n²) here:
  // note-sized documents have at most low hundreds of blockId'd nodes.
  const roots = [...allIds].filter(
    (id) => ![...allIds].some((other) => other !== id && contains(other, id))
  );

  function hasChildren(id: string): boolean {
    return directChildren(id).length > 0;
  }

  // ── Per-node classification ──────────────────────────────────────────────

  function classifyNode(id: string): NodeVerdict {
    const t = theirs.get(id);
    const m = mine.get(id);

    if (base === null) return classifyNoBase(id, t, m);

    const b = base.get(id);
    const inBase = !!b;
    const inTheirs = !!t;
    const inMine = !!m;

    // Wholly new on exactly one side — whole subtree is new, don't recurse.
    if (!inBase && inTheirs && !inMine) {
      return { blockId: id, classification: "added", theirs: t };
    }
    if (!inBase && !inTheirs && inMine) {
      return { blockId: id, classification: "added", mine: m };
    }
    // Same blockId newly present on both sides without a base — should not
    // happen (blockIds are randomUUID()s, independently generated), but
    // handled defensively rather than left to throw.
    if (!inBase && inTheirs && inMine) {
      if (t!.hash === m!.hash) return "skip";
      return { blockId: id, classification: "conflict", theirs: t, mine: m };
    }

    // Existed in base, gone from one side entirely — whole subtree
    // deleted, don't recurse.
    if (inBase && !inTheirs && inMine) {
      // source_deleted: doc's existing decision — default to keep locally.
      return {
        blockId: id,
        classification: "source_deleted",
        base: b,
        mine: m,
        defaultAction: "keep_local",
      };
    }
    if (inBase && inTheirs && !inMine) {
      if (b!.hash === t!.hash) {
        // theirs never touched it — mine's deletion is a plain, mechanical
        // change with nothing to reconcile against.
        return { blockId: id, classification: "kept_mine", base: b };
      }
      // theirs edited a block mine deliberately deleted. Reconsidered from
      // an initial restore_theirs default — this case isn't a true mirror
      // of source_deleted (there, the deletion happened without the local
      // user's involvement; here, they explicitly chose to delete it). The
      // upstream edit isn't lost either way — it's always surfaced in
      // review (§3.3) — so the user's own deliberate action wins the
      // *default* selection. See design doc §4.2.
      return {
        blockId: id,
        classification: "mine_deleted_theirs_edited",
        base: b,
        theirs: t,
        defaultAction: "keep_local",
      };
    }
    if (inBase && !inTheirs && !inMine) {
      // Both sides agree it's gone — nothing to do.
      return "skip";
    }

    // inBase && inTheirs && inMine — the common case.
    const hb = b!.hash, ht = t!.hash, hm = m!.hash;

    if (hb === ht && ht === hm) return "skip"; // fully unchanged subtree

    if (hasChildren(id)) return "recurse"; // let descendants carry the classification

    // Leaf-level classification.
    if (hb === ht && hb !== hm) {
      return { blockId: id, classification: "kept_mine", base: b, mine: m };
    }
    if (hb === hm && hb !== ht) {
      return { blockId: id, classification: "pulled_theirs", base: b, theirs: t };
    }
    if (ht === hm && hb !== ht) {
      // Both sides independently converged on the same edit — nothing
      // left to reconcile, mine already matches theirs.
      return "skip";
    }
    // hb, ht, hm all pairwise different — genuine conflict.
    return { blockId: id, classification: "conflict", base: b, theirs: t, mine: m };
  }

  // Fallback used when base is unavailable (pruned) — direct comparison
  // only, per design doc §4.3. Presence-only-on-one-side is reported as
  // `added` since, without a base, deletion-vs-never-existed can't be
  // distinguished — documented simplification, not a hidden assumption.
  function classifyNoBase(
    id: string,
    t: BlockSnapshot | undefined,
    m: BlockSnapshot | undefined
  ): NodeVerdict {
    if (t && !m) return { blockId: id, classification: "added", theirs: t };
    if (!t && m) return { blockId: id, classification: "added", mine: m };
    if (!t && !m) return "skip"; // shouldn't happen — id came from somewhere
    if (t!.hash === m!.hash) return "skip";
    if (hasChildren(id)) return "recurse";
    return { blockId: id, classification: "conflict", theirs: t, mine: m };
  }

  // ── Walk from roots, only recursing where the verdict says to ───────────

  const results: BlockDiffResult[] = [];
  function walk(id: string): void {
    const verdict = classifyNode(id);
    if (verdict === "skip") return;
    if (verdict === "recurse") {
      for (const childId of directChildren(id)) walk(childId);
      return;
    }
    results.push(verdict);
  }
  for (const rootId of roots) walk(rootId);

  return results;
}