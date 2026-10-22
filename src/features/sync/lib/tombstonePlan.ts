// src/features/sync/lib/tombstonePlan.ts
//
// Stage 4d tombstones, step 4 — pure planning half of pushTombstones.ts. No DB,
// no network, no Supabase import, so it can be unit-tested in the node
// environment.

import { decideDeleteAction, type DeleteDecision, type HostedRowInfo } from "@/features/sync/lib/deleteDecision";

export interface TombstoneRow {
  noteId: string;
  serverRevision: number;
  state: "pending" | "conflict";
}

export interface TombstonePlanItem {
  noteId: string;
  decision: DeleteDecision;
}

/** One decision per tombstone. */
export function planTombstoneWork(
  tombstones: TombstoneRow[],
  localIds: Set<string>,
  hosted: Map<string, HostedRowInfo>
): TombstonePlanItem[] {
  return tombstones.map((t) => ({
    noteId: t.noteId,
    decision: decideDeleteAction({
      localPresent: localIds.has(t.noteId),
      tombstone: { state: t.state, serverRevision: t.serverRevision },
      hasSyncState: false, // only read for a local note with no tombstone
      localChanged: false,
      hosted: hosted.get(t.noteId) ?? null,
    }),
  }));
}
