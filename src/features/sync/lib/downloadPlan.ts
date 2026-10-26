// src/features/sync/lib/downloadPlan.ts
//
// Stage 4d.5 — the pure parts of new-device download: what to download and in
// what order, whether this device is allowed to download at all, how to size
// batches, and which half-downloaded notes can be adopted on a rerun.
// No DB, no network, no async — unit-tested in downloadPlan.test.ts.

export const INITIAL_BATCH = 50;
export const MIN_BATCH = 5;
const MAX_DEPTH = 50;

// ── Ordering ────────────────────────────────────────────────────────────────

export interface RemoteTreeRow {
  id: string;
  parentId: string | null;
  revision: number;
  updatedAt: number; // ms
  deletedAt: number | null;
}

export interface PlannedNote {
  id: string;
  /** The parent to insert with. null when the hosted parent can't be satisfied. */
  parentId: string | null;
  /** True when the hosted parent_id was dropped (missing, deleted, or a cycle). */
  reparented: boolean;
  depth: number;
}

export interface DownloadPlan {
  /** Shallowest first, ties broken by id, so parents always precede children. */
  notes: PlannedNote[];
  trashed: number;        // planned notes that are in the server trash (inserted as trashed, T6)
  alreadyLocal: number;   // hosted ids that already have a local row
}

/**
 * Decide what to download. `localIds` is every note id already in the local DB
 * (including trashed), so a rerun after an interrupted download skips what's in.
 */
export function planDownload(rows: RemoteTreeRow[], localIds: Set<string>): DownloadPlan {
  let trashed = 0;
  let alreadyLocal = 0;
  const wanted = new Map<string, RemoteTreeRow>();
  for (const r of rows) {
    if (localIds.has(r.id)) {
      alreadyLocal++;
    } else {
      wanted.set(r.id, r);
      if (r.deletedAt != null) trashed++; // T6: arrives trashed, not skipped
    }
  }

  // A parent is usable if it is being downloaded now or is already local.
  const usable = (id: string) => wanted.has(id) || localIds.has(id);

  // Effective parent: drop references to unusable parents. Cycles are broken
  // below by walking each chain once.
  const effectiveParent = new Map<string, string | null>();
  const reparented = new Set<string>();
  for (const r of wanted.values()) {
    if (r.parentId && r.parentId !== r.id && usable(r.parentId)) {
      effectiveParent.set(r.id, r.parentId);
    } else {
      effectiveParent.set(r.id, null);
      if (r.parentId) reparented.add(r.id);
    }
  }

  // Depth counts only edges to notes in this download; a parent that is already
  // local is depth 0 for ordering purposes.
  const depthCache = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;

    const chain: string[] = [];
    const onChain = new Set<string>();
    let cur: string | null = id;
    let base = 0;
    while (cur !== null) {
      const known = depthCache.get(cur);
      if (known !== undefined) {
        base = known + 1;
        break;
      }
      if (onChain.has(cur) || chain.length >= MAX_DEPTH) {
        // Cycle (or absurd depth): cut the link at the note that closes it.
        const closing = chain[chain.length - 1];
        effectiveParent.set(closing, null);
        reparented.add(closing);
        base = 0;
        break;
      }
      onChain.add(cur);
      chain.push(cur);
      const p: string | null = effectiveParent.get(cur) ?? null;
      cur = p !== null && wanted.has(p) ? p : null;
    }

    // chain[0] is `id`, the last element is the topmost note reached.
    for (let i = chain.length - 1, d = base; i >= 0; i--, d++) {
      depthCache.set(chain[i], d);
    }
    return depthCache.get(id) ?? 0;
  };

  const notes: PlannedNote[] = [];
  for (const r of wanted.values()) {
    const depth = depthOf(r.id);
    notes.push({
      id: r.id,
      parentId: effectiveParent.get(r.id) ?? null,
      reparented: reparented.has(r.id),
      depth,
    });
  }
  notes.sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { notes, trashed, alreadyLocal };
}

// ── Preconditions ───────────────────────────────────────────────────────────

export interface LocalNoteFacts {
  id: string;
  title: string;
  revision: number;
  isCanvas: boolean;
}

export interface PreconditionInput {
  syncConfigured: boolean;
  signedIn: boolean;
  syncStateCount: number;
  /** Every local note, including trashed ones. */
  localNotes: LocalNoteFacts[];
  /** Titles of the onboarding sample notes. */
  starterTitles: string[];
  openTabCount: number;
  /**
   * True when a previous download was interrupted (persisted in-progress marker).
   * The device then legitimately has sync state and downloaded notes, so the
   * fresh-vault checks are skipped; sign-in and open-tab checks still apply.
   */
  resuming: boolean;
}

export type PreconditionResult =
  | { ok: true; starterIdsToRemove: string[] }
  | { ok: false; reason: string };

/**
 * A fresh vault is one where the only local notes are untouched starter notes:
 * title matches a sample note and revision is 0 (content never edited).
 * Metadata may differ (moved or trashed) — those are deleted anyway.
 */
export function checkDownloadPreconditions(i: PreconditionInput): PreconditionResult {
  if (!i.syncConfigured) return { ok: false, reason: "Sync isn't configured in this build." };
  if (!i.signedIn) return { ok: false, reason: "Sign in first." };
  if (i.openTabCount > 0) {
    return { ok: false, reason: "Close all open notes before downloading." };
  }
  if (i.resuming) return { ok: true, starterIdsToRemove: [] };
  if (i.syncStateCount > 0) {
    return {
      ok: false,
      reason: "This device has already synced. Download only runs on a fresh install.",
    };
  }
  const starters = new Set(i.starterTitles);
  const removable: string[] = [];
  for (const n of i.localNotes) {
    if (!n.isCanvas && n.revision === 0 && starters.has(n.title)) {
      removable.push(n.id);
    } else {
      return {
        ok: false,
        reason:
          "This device already has notes of its own. Download only runs on a fresh vault " +
          "(merging with existing notes isn't supported yet).",
      };
    }
  }
  return { ok: true, starterIdsToRemove: removable };
}

// ── Batch sizing ────────────────────────────────────────────────────────────

/** Halve after a failed batch (timeout or error), never below MIN_BATCH. */
export function nextBatchSize(current: number, lastBatchFailed: boolean): number {
  if (!lastBatchFailed) return current;
  return Math.max(MIN_BATCH, Math.floor(current / 2));
}

/** Split ids into consecutive batches of at most `size`. */
export function takeBatch<T>(items: T[], from: number, size: number): T[] {
  return items.slice(from, from + Math.max(1, size));
}

// ── Recovery (crash between insert and recordSynced) ────────────────────────

export interface RecoverFacts {
  hasSyncState: boolean;
  localUpdatedAt: number;
  localContent: string;
  remoteUpdatedAt: number;
  remoteContent: string;
}

/**
 * A local note with no sync state whose hosted copy has equal updated_at AND
 * byte-equal content is a download that was interrupted before recordSynced.
 * (Revision equality can't be used: downloaded notes are inserted at local
 * revision 1, which differs from the hosted revision by design.)
 */
export function isInterruptedDownload(f: RecoverFacts): boolean {
  return (
    !f.hasSyncState &&
    f.localUpdatedAt === f.remoteUpdatedAt &&
    f.localContent === f.remoteContent
  );
}
