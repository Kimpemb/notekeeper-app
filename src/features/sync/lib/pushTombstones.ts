// src/features/sync/lib/pushTombstones.ts
//
// Stage 4d tombstones, step 4 — push notes permanently deleted on this device
// to the server as purges. Runs in the drain after the push phase.
//
// Per tombstone: list the hosted row, ask decideDeleteAction what to do, then
//   push_purge     -> rpc purge_note (compare-and-swap on the recorded revision)
//   park_conflict  -> mark the tombstone 'conflict' (nothing written to hosted)
//   clear_tombstone-> delete the tombstone (nothing written to hosted)
//   noop           -> leave it
// A purge that loses the compare-and-swap leaves the tombstone pending; the next
// drain sees the newer hosted revision and parks it (row D), so there is no
// second decision path here.

import { getDb } from "@/features/notes/db/client";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { describeDeleteDecision, type HostedRowInfo } from "@/features/sync/lib/deleteDecision";
import { planTombstoneWork, type TombstoneRow } from "@/features/sync/lib/tombstonePlan";

const CHUNK = 100;

 

export interface TombstoneSummary {
  purged: number;
  parked: number;
  cleared: number;
  missed: number; // lost the compare-and-swap; re-evaluated next drain
  failed: number;
}

const chunks = <T,>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

async function fetchHostedStates(ownerId: string, ids: string[]): Promise<Map<string, HostedRowInfo>> {
  const map = new Map<string, HostedRowInfo>();
  for (const part of chunks(ids)) {
    const { data, error } = await supabase
      .from("notes")
      .select("id, revision, deleted_at, purged_at")
      .eq("owner_id", ownerId)
      .in("id", part);
    if (error) throw new Error(`tombstone listing failed (${error.code ?? "?"}): ${error.message}`);
    for (const r of (data ?? []) as Array<{
      id: string;
      revision: number;
      deleted_at: string | null;
      purged_at: string | null;
    }>) {
      map.set(r.id, {
        revision: r.revision,
        state: r.purged_at != null ? "purged" : r.deleted_at != null ? "trashed" : "live",
      });
    }
  }
  return map;
}

async function fetchLocalIds(ids: string[]): Promise<Set<string>> {
  const db = await getDb();
  const found = new Set<string>();
  for (const part of chunks(ids)) {
    const placeholders = part.map((_, i) => `$${i + 1}`).join(",");
    const rows = await db.select<Array<{ id: string }>>(`SELECT id FROM notes WHERE id IN (${placeholders})`, part);
    for (const r of rows) found.add(r.id);
  }
  return found;
}

export async function pushTombstones(): Promise<TombstoneSummary> {
  const summary: TombstoneSummary = { purged: 0, parked: 0, cleared: 0, missed: 0, failed: 0 };
  const session = useSyncStore.getState().session;
  if (!session) return summary;

  const db = await getDb();
  const rows = await db.select<Array<{ note_id: string; synced_server_revision: number; state: string }>>(
    `SELECT note_id, synced_server_revision, state FROM note_tombstones`
  );
  if (rows.length === 0) return summary;

  const tombstones: TombstoneRow[] = rows.map((r) => ({
    noteId: r.note_id,
    serverRevision: r.synced_server_revision,
    state: r.state === "conflict" ? "conflict" : "pending",
  }));
  const ids = tombstones.map((t) => t.noteId);

  const [hosted, localIds] = await Promise.all([fetchHostedStates(session.user.id, ids), fetchLocalIds(ids)]);
  const plan = planTombstoneWork(tombstones, localIds, hosted);

  for (const { noteId, decision } of plan) {
    if (!useSyncStore.getState().session) break; // signed out mid-drain
    try {
      switch (decision.action) {
        case "push_purge": {
          const { data, error } = await supabase.rpc("purge_note", {
            p_id: noteId,
            p_expected_revision: decision.expectedServerRevision,
          });
          if (error) throw new Error(`purge_note failed (${error.code ?? "?"}): ${error.message}`);
          if (data == null) {
            summary.missed++;
            console.info(`[sync] purge of ${noteId} not applied (revision moved); re-checking next drain`);
          } else {
            await db.execute(`DELETE FROM note_tombstones WHERE note_id = $1`, [noteId]);
            summary.purged++;
          }
          break;
        }
        case "park_conflict":
          await db.execute(`UPDATE note_tombstones SET state = 'conflict' WHERE note_id = $1`, [noteId]);
          summary.parked++;
          console.warn(`[sync] delete of ${noteId} parked: ${describeDeleteDecision(decision)}`);
          break;
        case "clear_tombstone":
          await db.execute(`DELETE FROM note_tombstones WHERE note_id = $1`, [noteId]);
          summary.cleared++;
          break;
        default:
          break; // noop, or a decision that belongs to the pull (later steps)
      }
    } catch (err) {
      summary.failed++;
      console.warn(`[sync] tombstone ${noteId} failed:`, err);
    }
  }

  if (summary.purged + summary.parked + summary.cleared + summary.missed + summary.failed > 0) {
    console.info(
      `[sync] tombstones: ${summary.purged} purged, ${summary.parked} parked, ` +
        `${summary.cleared} cleared, ${summary.missed} missed, ${summary.failed} failed`
    );
  }
  return summary;
}
