// src/features/sync/lib/pullNewNotes.ts
//
// Stage 4d tombstones, step 6b — create local notes for hosted notes this device
// has never had (row A of the decision table). OFF unless the setting
// sync_new_note_pull is "true".
//
// Safety:
//   - candidates come from the listing the pull already fetched (no extra full
//     listing); only ids that are not local, not tombstoned and not known-purged
//     are fetched in full
//   - purged hosted rows are never created locally
//   - refuses to run when more than REFUSE_ABOVE notes would be created at once
//     (a mass resurrection, for example after restoring an old backup)
//   - at most MAX_PER_PASS notes per drain, parents first
//   - insert mirrors the 4d.5 download: INSERT OR IGNORE, read-back check, sync
//     state recorded, so the next drain pushes nothing back
//   - hosted-trashed notes are inserted as trashed (T6)

import { getDb } from "@/features/notes/db/client";
import { getSetting, getAllNotes, getTrashedNotes } from "@/features/notes/db/queries";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import { tryLockNote } from "@/features/sync/lib/noteLock";
import { planDownload, type RemoteTreeRow } from "@/features/sync/lib/downloadPlan";
import {
  DOWNLOAD_LOCAL_META_REV,
  DOWNLOAD_LOCAL_REVISION,
  INSERT_DOWNLOADED_NOTE_SQL,
  REMOTE_DOWNLOAD_COLUMNS,
  remoteRowToInsertParams,
  type RemoteDownloadRow,
} from "@/features/sync/lib/downloadRow";
import { finishNote, writeBacklinks } from "@/features/sync/lib/downloadVault";

export const NEW_NOTE_PULL_KEY = "sync_new_note_pull";
const MAX_PER_PASS = 25;
const REFUSE_ABOVE = 200;
const CHUNK = 100;

// Hosted rows seen as purged this session; skipped without refetching.
const knownPurged = new Set<string>();

type HostedRow = RemoteDownloadRow & { purged_at: string | null };

export interface NewNotesSummary {
  inserted: number;
  skipped: number;
  failed: number;
}

export async function pullNewNotes(remoteIds: string[]): Promise<NewNotesSummary> {
  const out: NewNotesSummary = { inserted: 0, skipped: 0, failed: 0 };
  const session = useSyncStore.getState().session;
  if (!session || remoteIds.length === 0) return out;
  if ((await getSetting(NEW_NOTE_PULL_KEY)) !== "true") return out;

  const db = await getDb();
  const local = new Set((await db.select<Array<{ id: string }>>(`SELECT id FROM notes`)).map((r) => r.id));
  const tombstoned = new Set(
    (await db.select<Array<{ note_id: string }>>(`SELECT note_id FROM note_tombstones`)).map((r) => r.note_id)
  );
  const candidates = remoteIds.filter((id) => !local.has(id) && !tombstoned.has(id) && !knownPurged.has(id));
  if (candidates.length === 0) return out;

  const rows: HostedRow[] = [];
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("notes")
      .select(`${REMOTE_DOWNLOAD_COLUMNS}, purged_at`)
      .eq("owner_id", session.user.id)
      .in("id", candidates.slice(i, i + CHUNK));
    if (error) throw new Error(`new-note fetch failed (${error.code ?? "?"}): ${error.message}`);
    for (const r of (data ?? []) as unknown as HostedRow[]) {
      if (r.purged_at != null) knownPurged.add(r.id);
      else rows.push(r);
    }
  }
  if (rows.length === 0) return out;

  if (rows.length > REFUSE_ABOVE) {
    console.warn(
      `[sync] new notes: ${rows.length} hosted notes are missing here (limit ${REFUSE_ABOVE}); not creating any. ` +
        `This looks like a restored backup or a mass change, so review it first.`
    );
    return out;
  }

  // planDownload skips rows with a deleted_at; trashed rows are wanted here (T6),
  // so the planner is told none are deleted. The real deleted_at is kept below.
  const tree: RemoteTreeRow[] = rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    revision: r.revision,
    updatedAt: Date.parse(r.updated_at),
    deletedAt: null,
  }));
  const plan = planDownload(tree, local);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const present = new Set(local);
  const links = new Map<string, string[]>();

  for (const p of plan.notes.slice(0, MAX_PER_PASS)) {
    if (!useSyncStore.getState().session) break;
    const r = byId.get(p.id);
    if (!r) continue;
    if (p.parentId && !present.has(p.parentId)) {
      out.failed++;
      continue;
    }
    const release = tryLockNote(p.id, "pull");
    if (!release) {
      out.skipped++;
      continue;
    }
    try {
      const params = remoteRowToInsertParams(r, p.parentId, crypto.randomUUID());
 
      const res = await db.execute(INSERT_DOWNLOADED_NOTE_SQL, params);
      if (res.rowsAffected === 0) {
        console.warn(`[sync] new notes: ${p.id} was not inserted (already exists or a unique clash)`);
        out.skipped++;
        continue;
      }
      const after = await db.select<Array<{ revision: number; meta_rev: number; updated_at: number }>>(
        `SELECT revision, meta_rev, updated_at FROM notes WHERE id = $1`,
        [p.id]
      );
      const a = after[0];
      if (
        !a ||
        a.revision !== DOWNLOAD_LOCAL_REVISION ||
        a.meta_rev !== DOWNLOAD_LOCAL_META_REV ||
        a.updated_at !== Date.parse(r.updated_at)
      ) {
        console.warn(`[sync] new notes: ${p.id} read-back mismatch, sync state not recorded`, a);
        present.add(p.id);
        out.failed++;
        continue;
      }
      present.add(p.id);
      links.set(p.id, await finishNote(p.id, r.title, r.content, r.revision, a, r.deleted_at != null));
      out.inserted++;
    } catch (err) {
      console.warn(`[sync] new notes: ${p.id} failed:`, err);
      out.failed++;
    } finally {
      release();
    }
  }

  if (out.inserted > 0) {
    try {
      await writeBacklinks(links);
    } catch (err) {
      console.warn("[sync] new notes: backlinks failed:", err);
    }
    if (useAIStore.getState().enabled) nudgeIndexer();
    try {
      // Includes content, so open editors are not blanked.
      const [notes, trashedNotes] = await Promise.all([getAllNotes(), getTrashedNotes()]);
      useNoteStore.setState({ notes, trashedNotes });
    } catch (err) {
      console.warn("[sync] new notes: list refresh failed:", err);
    }
  }

  if (out.inserted + out.skipped + out.failed > 0) {
    console.info(`[sync] new notes: ${out.inserted} inserted, ${out.skipped} skipped, ${out.failed} failed`);
  }
  return out;
}
