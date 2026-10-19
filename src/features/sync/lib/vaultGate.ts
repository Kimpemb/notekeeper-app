// src/features/sync/lib/vaultGate.ts
//
// Stage 4d.5 — first-run drain pause. A fresh device with no sync state must not
// push anything while hosted already holds a vault: its starter notes would be
// uploaded as duplicates. The drain stays paused until the vault is resolved
// (Download vault, or Start fresh). Devices that already have sync state are
// treated as resolved, so existing installs behave exactly as before.
//
// Also holds the in-memory "download in progress" flag the drain checks.

import { getDb } from "@/features/notes/db/client";
import { getSetting, setSetting } from "@/features/notes/db/queries";
import { supabase } from "@/features/sync/db/supabaseClient";
import { useSyncStore } from "@/features/sync/store/useSyncStore";

export const VAULT_RESOLVED_KEY = "sync_vault_resolved";
/** Resume marker written by downloadVault: "in_progress" | "done". */
export const DOWNLOAD_STATE_KEY = "sync_vault_download";

export type GateDecision = "open" | "open_and_mark_resolved" | "paused";

export interface GateInputs {
  /** app_settings[sync_vault_resolved] === "true" */
  resolved: boolean;
  /** rows in local note_sync_state */
  syncStateCount: number;
  /** hosted note count for this owner, or null if it couldn't be determined */
  remoteCount: number | null;
  /** app_settings[sync_vault_download] === "in_progress": a download was started and not finished */
  downloadInterrupted?: boolean;
}

/**
 * Pure decision. Fails closed: if the device has no sync state and the hosted
 * count is unknown, stay paused (the drain couldn't push offline anyway).
 */
export function decideVaultGate(i: GateInputs): GateDecision {
  if (i.resolved) return "open";
  // An unfinished download leaves sync state behind, which would otherwise read as
  // "existing install" and open the gate. Stay paused until Resume completes it.
  if (i.downloadInterrupted) return "paused";
  if (i.syncStateCount > 0) return "open_and_mark_resolved";
  if (i.remoteCount === null) return "paused";
  if (i.remoteCount === 0) return "open";
  return "paused";
}

// ── I/O wrapper ─────────────────────────────────────────────────────────────

let gateOpen = false; // cached for the session once the gate has opened
let downloading = false;

export const isDownloadInProgress = () => downloading;
export const setDownloadInProgress = (v: boolean) => {
  downloading = v;
};

async function countRemoteNotes(): Promise<number | null> {
  const session = useSyncStore.getState().session;
  if (!session) return null;
  const { count, error } = await supabase
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", session.user.id);
  if (error || count == null) return null;
  return count;
}

async function countSyncStates(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM note_sync_state`);
  return rows[0]?.n ?? 0;
}

/** True when the drain may push/pull. Cheap after the first call that opens it. */
export async function isVaultGateOpen(): Promise<boolean> {
  if (gateOpen) return true;

  const resolved = (await getSetting(VAULT_RESOLVED_KEY)) === "true";
  const downloadInterrupted = !resolved && (await getSetting(DOWNLOAD_STATE_KEY)) === "in_progress";
  const syncStateCount = resolved ? 0 : await countSyncStates();
  const remoteCount =
    resolved || syncStateCount > 0 ? null : await countRemoteNotes().catch(() => null);

  const decision = decideVaultGate({ resolved, syncStateCount, remoteCount, downloadInterrupted });
  if (decision === "paused") return false;
  if (decision === "open_and_mark_resolved") await setSetting(VAULT_RESOLVED_KEY, "true");
  gateOpen = true;
  return true;
}

/** Called when the user picks Download vault (after it succeeds) or Start fresh. */
export async function resolveVaultGate(): Promise<void> {
  await setSetting(VAULT_RESOLVED_KEY, "true");
  gateOpen = true;
}
