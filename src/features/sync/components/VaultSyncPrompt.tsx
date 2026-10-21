// src/features/sync/components/VaultSyncPrompt.tsx
//
// Stage 4d.5 UI — the new-device download prompt. Presentational: all state and
// actions come from useVaultSync (owned by SignInPanel so it can also disable
// Upload vault while the gate is closed).

import { useState } from "react";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";
import { formatDownloadSummary } from "@/features/sync/lib/formatDownloadSummary";
import type { VaultSync } from "@/features/sync/hooks/useVaultSync";

const LIMITATIONS = "Attachments, images, settings, pins and bookmarks aren't included. Notes in the server trash are skipped.";

export function VaultSyncPrompt({ vault }: { vault: VaultSync }) {
  const { phase, running, progress, result, error, download, cancel, startFresh, dismissResult } = vault;
  const [confirmingFresh, setConfirmingFresh] = useState(false);

  const formatted = result ? formatDownloadSummary(result) : null;

  if (running) {
    const pct =
      progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
    return (
      <div className="mt-2 max-w-64 text-xs">
        <p className="text-idemora-text-normal">
          {progress ? `Downloading ${progress.done} / ${progress.total}…` : "Preparing…"}
        </p>
        <div className="mt-1 h-1.5 w-full rounded bg-idemora-border overflow-hidden">
          <div className="h-full bg-blue-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-idemora-text-muted">Keep the app open and don't open notes until it finishes.</p>
        <button
          onClick={cancel}
          className="mt-1 text-idemora-text-muted hover:text-idemora-text-normal underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <>
      {phase === "needs_choice" && (
        <div className="mt-2 max-w-64 rounded border border-idemora-border p-2 text-xs">
          <p className="text-idemora-text-normal font-medium">Your hosted vault already has notes</p>
          <p className="mt-1 text-idemora-text-muted">
            Download it to this device, or start fresh. Syncing stays paused until you choose.
          </p>
          <p className="mt-1 text-idemora-text-muted">
            {LIMITATIONS} Open notes will be closed.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={download} className="px-2 py-1 rounded bg-blue-500 text-white">
              Download vault
            </button>
            <button
              onClick={() => setConfirmingFresh(true)}
              className="text-idemora-text-muted hover:text-idemora-text-normal underline"
            >
              Start fresh
            </button>
          </div>
        </div>
      )}

      {phase === "interrupted" && (
        <div className="mt-2 max-w-64 rounded border border-idemora-border p-2 text-xs">
          <p className="text-idemora-text-normal font-medium">Vault download not finished</p>
          <p className="mt-1 text-idemora-text-muted">
            Syncing stays paused until the download completes. Already-downloaded notes are kept.
          </p>
          <div className="mt-2">
            <button onClick={download} className="px-2 py-1 rounded bg-blue-500 text-white">
              Resume download
            </button>
          </div>
        </div>
      )}

      {formatted && (
        <div className="mt-2 max-w-64 text-xs">
          <p className={formatted.ok ? "text-idemora-text-normal" : "text-amber-500"}>{formatted.headline}</p>
          {formatted.details.map((d) => (
            <p key={d} className="text-idemora-text-muted">{d}</p>
          ))}
          <button
            onClick={dismissResult}
            className="mt-1 text-idemora-text-muted hover:text-idemora-text-normal underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && <p className="mt-2 max-w-64 text-xs text-red-500">Download failed: {error}</p>}

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
