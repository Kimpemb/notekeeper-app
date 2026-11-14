// src/features/sync/components/VaultSyncGate.tsx
//
// Stage 4d.3, step 5, slice 6b. Shows the new-device vault prompt as a modal over the whole app,
// so a fresh device does not have to find Settings > Sync. The same prompt still lives in the Sync
// screen. "Not now" hides this modal for the session (an offline device must never be trapped).

import { useState } from "react";
import { useVaultSync } from "@/features/sync/hooks/useVaultSync";
import { VaultSyncPrompt } from "@/features/sync/components/VaultSyncPrompt";
import { BTN_GHOST } from "@/features/sync/components/SyncRow";

export function VaultSyncGate() {
  const vault = useVaultSync();
  const [dismissed, setDismissed] = useState(false);

  const asking = vault.phase !== "hidden";
  const busyOrResult = vault.running || vault.result !== null || vault.error !== null;
  const open = busyOrResult || (asking && !dismissed);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-idemora-border bg-idemora-bg-primary p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-idemora-text-normal">Set up this device</h2>
        <VaultSyncPrompt vault={vault} />
        {!vault.running && vault.phase !== "hidden" && (
          <div className="mt-3 flex justify-end">
            <button onClick={() => setDismissed(true)} className={BTN_GHOST}>
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}