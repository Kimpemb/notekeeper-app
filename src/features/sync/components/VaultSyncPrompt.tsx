// src/features/sync/components/VaultSyncPrompt.tsx
//
// Stage 4d.5 UI — the new-device download prompt. Presentational: all state and
// actions come from useVaultSync (owned by SignInPanel so it can also disable
// Upload vault while the gate is closed).
//
// Step 5 (UI/UX refactor), slice 1: restyled as notice cards. Logic and wording of the
// actions are unchanged.

import { useState } from "react";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";
import { formatDownloadSummary } from "@/features/sync/lib/formatDownloadSummary";
import type { VaultSync } from "@/features/sync/hooks/useVaultSync";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/features/sync/components/SyncRow";

const LIMITATIONS = "Attachments, images, settings, pins and bookmarks aren't included. Notes in the server trash arrive in your Trash.";

const CARD = "mt-3 rounded-lg border p-3";
const NOTICE = `${CARD} border-amber-500/40 bg-amber-500/5`;
const PLAIN = `${CARD} border-idemora-border`;

export function VaultSyncPrompt({ vault }: { vault: VaultSync }) {
  const { phase, running, progress, result, error, download, cancel, startFresh, dismissResult } = vault;
  const [confirmingFresh, setConfirmingFresh] = useState(false);

  const formatted = result ? formatDownloadSummary(result) : null;

  if (running) {
    const pct =
      progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
    return (
      <div className={PLAIN}>
        <p className="text-sm text-idemora-text-normal">
          {progress ? `Downloading ${progress.done} / ${progress.total}…` : "Preparing…"}
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-idemora-border">
          <div className="h-full bg-blue-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-idemora-text-muted">
          Keep the app open and don't open notes until it finishes.
        </p>
        <button onClick={cancel} className={`mt-3 ${BTN_SECONDARY}`}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <>
      {phase === "needs_choice" && (
        <div className={NOTICE}>
          <p className="text-sm font-medium text-idemora-text-normal">Your hosted vault already has notes</p>
          <p className="mt-1 text-xs text-idemora-text-muted">
            Download it to this device, or start fresh. Syncing stays paused until you choose.
          </p>
          <p className="mt-1 text-xs text-idemora-text-muted">{LIMITATIONS} Open notes will be closed.</p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={download} className={BTN_PRIMARY}>
              Download vault
            </button>
            <button onClick={() => setConfirmingFresh(true)} className={BTN_SECONDARY}>
              Start fresh
            </button>
          </div>
        </div>
      )}

      {phase === "interrupted" && (
        <div className={NOTICE}>
          <p className="text-sm font-medium text-idemora-text-normal">Vault download not finished</p>
          <p className="mt-1 text-xs text-idemora-text-muted">
            Syncing stays paused until the download completes. Already-downloaded notes are kept.
          </p>
          <div className="mt-3">
            <button onClick={download} className={BTN_PRIMARY}>
              Resume download
            </button>
          </div>
        </div>
      )}

      {formatted && (
        <div className={PLAIN}>
          <p className={`text-sm ${formatted.ok ? "text-idemora-text-normal" : "text-amber-500"}`}>
            {formatted.headline}
          </p>
          {formatted.details.map((d) => (
            <p key={d} className="mt-0.5 text-xs text-idemora-text-muted">{d}</p>
          ))}
          <button onClick={dismissResult} className={`mt-3 ${BTN_SECONDARY}`}>
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className={`${CARD} border-red-500/40 bg-red-500/5`}>
          <p className="text-sm text-red-500">The download did not finish.</p>
          <p className="mt-1 text-xs text-idemora-text-muted break-words">
            {error} You can try again; notes already downloaded are kept and the rest will be fetched.
          </p>
        </div>
      )}

      <ConfirmModal
        open={confirmingFresh}
        danger
        title="Start fresh on this device?"
        message="Your hosted vault already has notes. If you start fresh, this device's own notes (including any starter notes) will be uploaded as new notes next to the existing ones, under different IDs. That means duplicates. To get your existing notes instead, cancel and choose Download vault."
        confirmLabel="Start fresh"
        onCancel={() => setConfirmingFresh(false)}
        onConfirm={() => {
          setConfirmingFresh(false);
          void startFresh();
        }}
      />
    </>
  );
}
