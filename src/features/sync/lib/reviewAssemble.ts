// src/features/sync/lib/reviewAssemble.ts
//
// Stage 4d.3, batch 3 — the PURE half of the review builder: given the three
// block maps and both contents, decide the review mode, run the gate and the
// diff, and count what needs a decision. No DB, no network, no Supabase import,
// so it is unit-tested in the node environment (syncReview.ts holds the impure
// wrapper).
//
// Modes:
//   identical   both sides hold the same blocks; nothing to decide
//   block       the gate passed: a block-by-block review (conflicts need a choice)
//   whole_note  the gate said no: the user picks one version, or keeps mine and
//               saves theirs as a separate note (design rev 2, section 5.2)

import { diffNoteRevisions, type BlockMap } from "@/features/notes/lib/threeWayDiff";
import { itemsFromDiff, type ApplyItem } from "@/features/notes/lib/applyReconcile";
import { evaluateGate, type GateOptions, type GateVerdict } from "@/features/notes/lib/reconcileGate";
import type { ReconcileAction } from "@/features/notes/lib/reconcileSession";

export type ReviewMode = "identical" | "block" | "whole_note";

export interface ReviewCore {
  mode: ReviewMode;
  gate: GateVerdict;
  items: ApplyItem[]; // every diffed block, "unchanged" included
  counts: { auto: number; pending: number; resolved: number; conflicts: number; unchanged: number };
  baseKind: "snapshot" | "none";
  mapSizes: { base: number | null; theirs: number; mine: number };
}

export interface AssembleInput {
  theirsContent: string;
  mineContent: string;
  base: BlockMap | null;
  theirsMap: BlockMap;
  mineMap: BlockMap;
  choices?: Record<string, ReconcileAction>;
  gate?: GateOptions;
}

export function assembleReview(input: AssembleInput): ReviewCore | { error: "unparseable" } {
  let theirsDoc: unknown;
  let mineDoc: unknown;
  try {
    theirsDoc = JSON.parse(input.theirsContent);
    mineDoc = JSON.parse(input.mineContent);
  } catch {
    return { error: "unparseable" };
  }

  const gate = evaluateGate(theirsDoc as never, mineDoc as never, input.gate);
  const results = diffNoteRevisions(input.base, input.theirsMap, input.mineMap);
  const items = itemsFromDiff(results, input.choices ?? {});

  const counts = {
    auto: items.filter((i) => i.status === "auto" && i.classification !== "unchanged").length,
    pending: items.filter((i) => i.status === "pending").length,
    resolved: items.filter((i) => i.status === "resolved").length,
    conflicts: items.filter((i) => i.classification === "conflict").length,
    unchanged: items.filter((i) => i.classification === "unchanged").length,
  };

  const allUnchanged = items.every((i) => i.classification === "unchanged");
  const mode: ReviewMode = gate.ok ? (allUnchanged ? "identical" : "block") : "whole_note";

  return {
    mode,
    gate,
    items,
    counts,
    baseKind: input.base ? "snapshot" : "none",
    mapSizes: { base: input.base ? input.base.size : null, theirs: input.theirsMap.size, mine: input.mineMap.size },
  };
}
