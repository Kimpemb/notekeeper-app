// src/features/sync/lib/downloadVault.ts
//
// Stage 4d.5 — new-device download. Pulls the hosted vault into an empty local
// vault, seeding note_sync_state as it goes so the first drain pushes nothing
// back. Design: stage-4d5-new-device-download.md.
//
// Per note, under the per-note lock: INSERT OR IGNORE → read back and verify
// revision / meta_rev / updated_at → recordSynced → block snapshot → AI block
// sync (if enabled). Backlinks are written in a second pass once every note
// exists. Safe to rerun: a persisted in-progress marker switches the
// preconditions to "resuming", already-inserted notes are skipped, and a note
// whose recordSynced never ran is adopted by the recovery pass.

import { getDb } from "@/features/notes/db/client";
import {
  getSetting,
  setSetting,
  permanentlyDeleteNote,
  syncNoteBlocks,
  extractNoteLinkIdsFromJson,
} from "@/features/notes/db/queries";
import { writeBlockRevisionSnapshot } from "@/features/notes/lib/blockRevisioning";
import { isSyncConfigured, supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAIStore } from "@/features/ai/store/useAIStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import { SAMPLE_NOTES } from "@/features/onboarding/sampleNotes";
import { recordSynced } from "@/features/sync/lib/noteSyncState";
import { tryLockNote } from "@/features/sync/lib/noteLock";
import { fetchRemoteTree } from "@/features/sync/lib/remoteTree";
import {
  DOWNLOAD_STATE_KEY,
  resolveVaultGate,
  setDownloadInProgress,
} from "@/features/sync/lib/vaultGate";
import {
  INITIAL_BATCH,
  MIN_BATCH,
  checkDownloadPreconditions,
  isInterruptedDownload,
  nextBatchSize,
  planDownload,
  takeBatch,
  type PlannedNote,
  type RemoteTreeRow,
} from "@/features/sync/lib/downloadPlan";
import {
  DOWNLOAD_LOCAL_META_REV,
  DOWNLOAD_LOCAL_REVISION,
  INSERT_DOWNLOADED_NOTE_SQL,
  REMOTE_DOWNLOAD_COLUMNS,
  remoteRowToInsertParams,
  type RemoteDownloadRow,
} from "@/features/sync/lib/downloadRow";

// Defined in vaultGate.ts (the gate reads it too); re-exported for callers.
export { DOWNLOAD_STATE_KEY };
const MAX_CONSECUTIVE_BATCH_FAILURES = 3;

export interface DownloadSummary {
  listed: number;          // hosted notes seen
  planned: number;         // notes this run tried to download
  inserted: number;
  alreadyLocal: number;    // present before this run, or raced in
  trashed: number;         // downloaded notes that arrived in the Trash (T6)
  reparented: number;      // hosted parent missing/deleted/cyclic, inserted as root
  recovered: number;       // interrupted downloads adopted by the recovery pass
  starterRemoved: number;
  failed: number;
  stopped: null | "blocked" | "cancelled" | "too_many_failures";
  blockedReason?: string;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

function emptySummary(): DownloadSummary {
  return {
    listed: 0,
    planned: 0,
    inserted: 0,
    alreadyLocal: 0,
    trashed: 0,
    reparented: 0,
    recovered: 0,
    starterRemoved: 0,
    failed: 0,
    stopped: null,
  };
}

function countOpenNotes(): number {
  const ui = useUIStore.getState();
  const ids = new Set<string>();
  for (const t of [...ui.tabs, ...ui.pane2Tabs]) if (t.noteId) ids.add(t.noteId);
  const active = useNoteStore.getState().activeNoteId;
  if (active) ids.add(active);
  return ids.size;
}

async function fetchFullRows(ownerId: string, ids: string[]): Promise<Map<string, RemoteDownloadRow>> {
  const { data, error } = await supabase
    .from("notes")
    .select(REMOTE_DOWNLOAD_COLUMNS)
    .eq("owner_id", ownerId)
    .in("id", ids);
  if (error) {
    throw new Error(`remote notes fetch failed (${error.code ?? "?"}): ${error.message}`);
  }
  const rows = (data ?? []) as unknown as RemoteDownloadRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

interface LocalAfter {
  revision: number;
  meta_rev: number;
  updated_at: number;
}

// Everything after the local row exists: sync state, base snapshot, AI blocks.
// Returns the note's outgoing link targets for the backlinks pass.
export async function finishNote(
  noteId: string,
  title: string,
  content: string,
  serverRevision: number,
  local: LocalAfter,
  trashed = false
): Promise<string[]> {
  await recordSynced(noteId, {
    localRevision: local.revision,
    localUpdatedAt: local.updated_at,
    serverRevision,
    metaRev: local.meta_rev,
  });

  try {
    await writeBlockRevisionSnapshot(noteId, content);
  } catch (err) {
    console.warn("[sync] download: block snapshot failed:", noteId, err);
  }

  if (useAIStore.getState().enabled) {
    try {
      // Title chunk + blocks + embedding jobs. A trashed note gets no title chunk, as with trashNote.
      await syncNoteBlocks(noteId, content, "note", trashed ? undefined : title);
    } catch (err) {
      console.warn("[sync] download: block sync failed:", noteId, err);
    }
  }
  return extractNoteLinkIdsFromJson(content);
}

type InsertResult = "inserted" | "exists" | "failed";

async function insertOne(
  p: PlannedNote,
  r: RemoteDownloadRow,
  present: Set<string>,
  links: Map<string, string[]>
): Promise<InsertResult> {
  // The foreign key would reject a child whose parent never made it in.
  if (p.parentId && !present.has(p.parentId)) {
    console.warn(`[sync] download: ${p.id} skipped, parent ${p.parentId} is not available yet`);
    return "failed";
  }
  const release = tryLockNote(p.id, "pull");
  if (!release) return "failed";
  try {
    const db = await getDb();
    const res = await db.execute(
      INSERT_DOWNLOADED_NOTE_SQL,
      remoteRowToInsertParams(r, p.parentId, crypto.randomUUID())
    );
    if (res.rowsAffected === 0) {
      // OR IGNORE also swallows a UNIQUE (sync_id) collision, so confirm the row is really there.
      const there = await db.select<{ id: string }[]>(`SELECT id FROM notes WHERE id = $1`, [p.id]);
      if (there.length === 0) return "failed";
      present.add(p.id);
      return "exists";
    }

    const after = await db.select<LocalAfter[]>(
      `SELECT revision, meta_rev, updated_at FROM notes WHERE id = $1`,
      [p.id]
    );
    const a = after[0];
    const expectedUpdatedAt = Date.parse(r.updated_at);
    if (
      !a ||
      a.revision !== DOWNLOAD_LOCAL_REVISION ||
      a.meta_rev !== DOWNLOAD_LOCAL_META_REV ||
      a.updated_at !== expectedUpdatedAt
    ) {
      // Leave it unrecorded; a rerun's recovery pass adopts it if it matches hosted.
      console.warn(`[sync] download: ${p.id} read-back mismatch, sync state not recorded`, a);
      present.add(p.id);
      return "failed";
    }

    present.add(p.id);
    links.set(p.id, await finishNote(p.id, r.title, r.content, r.revision, a, r.deleted_at != null));
    return "inserted";
  } finally {
    release();
  }
}

// A crash between the insert and recordSynced leaves a note with no sync state.
// Adopt those that are provably identical to hosted (same updated_at and content).
async function recoverInterrupted(
  ownerId: string,
  tree: Map<string, RemoteTreeRow>,
  links: Map<string, string[]>
): Promise<number> {
  const db = await getDb();
  const stateless = await db.select<
    { id: string; title: string; content: string; updated_at: number; revision: number; meta_rev: number }[]
  >(
    `SELECT n.id, n.title, n.content, n.updated_at, n.revision, n.meta_rev
     FROM notes n
     LEFT JOIN note_sync_state s ON s.note_id = n.id
     WHERE s.note_id IS NULL AND n.is_canvas = 0`
  );
  // Cheap prefilter on the already-fetched tree before fetching any content.
  const candidates = stateless.filter((n) => {
    const t = tree.get(n.id);
    return t != null && t.updatedAt === n.updated_at;
  });

  let recovered = 0;
  let size = INITIAL_BATCH;
  for (let i = 0; i < candidates.length; ) {
    const slice = takeBatch(candidates, i, size);
    let remote: Map<string, RemoteDownloadRow>;
    try {
      remote = await fetchFullRows(ownerId, slice.map((n) => n.id));
    } catch (err) {
      if (size <= MIN_BATCH) throw err;
      size = nextBatchSize(size, true);
      continue;
    }
    for (const n of slice) {
      const r = remote.get(n.id);
      if (!r) continue;
      const ok = isInterruptedDownload({
        hasSyncState: false,
        localUpdatedAt: n.updated_at,
        localContent: n.content,
        remoteUpdatedAt: Date.parse(r.updated_at),
        remoteContent: r.content,
      });
      if (!ok) continue;
      const release = tryLockNote(n.id, "pull");
      if (!release) continue;
      try {
        links.set(
          n.id,
          await finishNote(n.id, n.title, n.content, r.revision, {
            revision: n.revision,
            meta_rev: n.meta_rev,
            updated_at: n.updated_at,
          })
        );
        recovered++;
      } finally {
        release();
      }
    }
    i += slice.length;
  }
  return recovered;
}

// Second pass: every note now exists, so targets can be checked in memory and
// written in one go (syncBacklinks per note would fire a UI event per note).
export async function writeBacklinks(links: Map<string, string[]>): Promise<void> {
  const db = await getDb();
  const known = new Set(
    (await db.select<{ id: string }[]>(`SELECT id FROM notes WHERE deleted_at IS NULL`)).map((r) => r.id)
  );
  for (const [source, targets] of links) {
    for (const target of new Set(targets)) {
      if (target === source || !known.has(target)) continue;
      try {
        await db.execute(`INSERT OR IGNORE INTO backlinks (source_id, target_id) VALUES ($1, $2)`, [
          source,
          target,
        ]);
      } catch (err) {
        console.warn("[sync] download: backlink failed:", source, target, err);
      }
    }
  }
  window.dispatchEvent(new CustomEvent("idemora:backlinks-updated", { detail: { source: "download" } }));
}

export async function downloadVault(opts: DownloadOptions = {}): Promise<DownloadSummary> {
  const summary = emptySummary();
  const block = (reason: string): DownloadSummary => {
    summary.stopped = "blocked";
    summary.blockedReason = reason;
    return summary;
  };

  const session = useSyncStore.getState().session;
  const db = await getDb();

  // ── Preconditions ────────────────────────────────────────────────────────
  const resuming = (await getSetting(DOWNLOAD_STATE_KEY)) === "in_progress";
  const stateRows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM note_sync_state`);
  const localNotes = (
    await db.select<{ id: string; title: string; revision: number; is_canvas: number }[]>(
      `SELECT id, title, revision, is_canvas FROM notes`
    )
  ).map((n) => ({ id: n.id, title: n.title, revision: n.revision, isCanvas: n.is_canvas === 1 }));

  const pre = checkDownloadPreconditions({
    syncConfigured: isSyncConfigured,
    signedIn: session != null,
    syncStateCount: stateRows[0]?.n ?? 0,
    localNotes,
    starterTitles: SAMPLE_NOTES.map((s) => s.title),
    openTabCount: countOpenNotes(),
    resuming,
  });
  if (!pre.ok) return block(pre.reason);
  if (!session) return block("Sign in first.");
  const ownerId = session.user.id;

  setDownloadInProgress(true); // the drain stands down while we own the vault
  try {
    // ── List first: nothing local is touched if hosted is unreachable ──────
    const tree = await fetchRemoteTree(ownerId);
    summary.listed = tree.length;

    // ── Mark in-progress, stop the starter notes coming back, remove them ──
    await setSetting(DOWNLOAD_STATE_KEY, "in_progress");
    await setSetting("hasInsertedSampleNotes", "true");
    useAppSettings.getState().updateSetting("hasInsertedSampleNotes", true);
    for (const id of pre.starterIdsToRemove) {
      await permanentlyDeleteNote(id);
      summary.starterRemoved++;
    }

    const links = new Map<string, string[]>();
    const treeById = new Map(tree.map((t) => [t.id, t]));

    // ── Recovery pass (only meaningful when resuming) ──────────────────────
    if (resuming) summary.recovered = await recoverInterrupted(ownerId, treeById, links);

    // ── Plan ───────────────────────────────────────────────────────────────
    const localIds = new Set(
      (await db.select<{ id: string }[]>(`SELECT id FROM notes`)).map((r) => r.id)
    );
    const plan = planDownload(tree, localIds);
    summary.planned = plan.notes.length;
    summary.alreadyLocal = plan.alreadyLocal;
    summary.trashed = plan.trashed;
    summary.reparented = plan.notes.filter((n) => n.reparented).length;

    // ── Download, shallowest first, in adaptive batches ────────────────────
    const present = new Set(localIds);
    let size = INITIAL_BATCH;
    let batchFailures = 0;
    let done = 0;
    for (let i = 0; i < plan.notes.length; ) {
      if (opts.signal?.aborted) {
        summary.stopped = "cancelled";
        break;
      }
      const slice = takeBatch(plan.notes, i, size);
      let rows: Map<string, RemoteDownloadRow>;
      try {
        rows = await fetchFullRows(ownerId, slice.map((n) => n.id));
        batchFailures = 0;
      } catch (err) {
        console.warn("[sync] download: batch fetch failed:", err);
        batchFailures++;
        if (batchFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
          summary.stopped = "too_many_failures";
          break;
        }
        size = nextBatchSize(size, true);
        continue; // retry the same slice, smaller
      }

      for (const p of slice) {
        const r = rows.get(p.id);
        if (!r) {
          summary.failed++; // vanished or filtered since listing
        } else {
          try {
            const res = await insertOne(p, r, present, links);
            if (res === "inserted") summary.inserted++;
            else if (res === "exists") summary.alreadyLocal++;
            else summary.failed++;
          } catch (err) {
            console.warn("[sync] download: insert failed:", p.id, err);
            summary.failed++;
          }
        }
        done++;
        opts.onProgress?.(done, plan.notes.length);
      }
      i += slice.length;
    }

    // ── Second pass and refresh ────────────────────────────────────────────
    await writeBacklinks(links);
    if (useAIStore.getState().enabled) nudgeIndexer(); // embeddings run in the background (D3)
    await useNoteStore.getState().loadNotes(); // no editors are open (precondition)
    await useNoteStore.getState().loadTrashedNotes(); // downloaded trashed notes (T6)

    // ── Completion: only a clean run opens the gate ────────────────────────
    if (summary.stopped === null && summary.failed === 0) {
      await setSetting(DOWNLOAD_STATE_KEY, "done");
      await resolveVaultGate();
    }
    return summary;
  } finally {
    setDownloadInProgress(false);
  }
}
