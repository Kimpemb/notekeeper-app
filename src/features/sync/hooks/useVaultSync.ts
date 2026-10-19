// src/features/sync/hooks/useVaultSync.ts
//
// Stage 4d.5 UI — state and actions for the new-device download flow.
//
// phase:
//   hidden        nothing to ask (gate open, signed out, or a finished download)
//   needs_choice  fresh device, hosted already has notes: Download vault or Start fresh
//   interrupted   a download was started and not finished: Resume
//
// The phase is derived from the same two sources the drain uses (the resume
// marker and isVaultGateOpen), so the UI and the drain can't disagree.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSetting } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { downloadVault, type DownloadSummary } from "@/features/sync/lib/downloadVault";
import { DOWNLOAD_STATE_KEY, isVaultGateOpen, resolveVaultGate } from "@/features/sync/lib/vaultGate";

export type VaultPhase = "hidden" | "needs_choice" | "interrupted";

export interface VaultProgress {
  done: number;
  total: number;
}

/**
 * downloadVault refuses while any note is open (its closing reload would blank
 * the editors). Close every tab in both panes and clear the active note.
 */
function closeAllNotes(): void {
  const ui = useUIStore.getState();
  const ids = new Set<string>();
  for (const t of [...ui.tabs, ...ui.pane2Tabs]) if (t.noteId) ids.add(t.noteId);
  if (ids.size > 0) ui.closeTabsForNotes(ids);
  useNoteStore.getState().setActiveNote(null, true);
}

export function useVaultSync() {
  const session = useSyncStore((s) => s.session);
  const [phase, setPhase] = useState<VaultPhase>("hidden");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<VaultProgress | null>(null);
  const [result, setResult] = useState<DownloadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!useSyncStore.getState().session) {
      setPhase("hidden");
      return;
    }
    try {
      if ((await getSetting(DOWNLOAD_STATE_KEY)) === "in_progress") {
        setPhase("interrupted");
        return;
      }
      setPhase((await isVaultGateOpen()) ? "hidden" : "needs_choice");
    } catch (err) {
      // Leave the phase as it was; the drain keeps its own gate either way.
      console.warn("[sync] vault gate check failed:", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [session, refresh]);

  const download = useCallback(async () => {
    if (abortRef.current) return; // already running
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      closeAllNotes();
      const summary = await downloadVault({
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      setRunning(false);
      await refresh();
    }
  }, [refresh]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Mark the vault resolved without downloading. The caller must have confirmed. */
  const startFresh = useCallback(async () => {
    setError(null);
    try {
      await resolveVaultGate();
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    await refresh();
  }, [refresh]);

  const dismissResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { phase, running, progress, result, error, download, cancel, startFresh, dismissResult };
}

export type VaultSync = ReturnType<typeof useVaultSync>;
