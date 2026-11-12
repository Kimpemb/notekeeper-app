// src/features/sync/components/SignInPanel.tsx
//
// The Sync screen (rendered under Settings > Sync). Step 5 (UI/UX refactor), slice 1:
// redesigned layout only. All behaviour is unchanged: sign in and out, the vault download
// prompt, Upload vault, the queue polling, Retry parked, the review list, Backups and
// Copy diagnostics. The status sentence comes from the pure syncStatus().

import { useEffect, useRef, useState } from "react";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { backfillVault, type BackfillSummary } from "@/features/sync/lib/backfillVault";
import { getQueueCounts, requeueParked, type PushQueueCounts } from "@/features/sync/lib/pushQueue";
import { drainPushQueue } from "@/features/sync/lib/drainPushQueue";
import { useVaultSync } from "@/features/sync/hooks/useVaultSync";
import { VaultSyncPrompt } from "@/features/sync/components/VaultSyncPrompt";
import { NeedReviewEntry, type ReviewCount } from "@/features/sync/components/NeedReviewEntry";
import { ReviewListModal } from "@/features/sync/components/ReviewListModal";
import { BackupsModal } from "@/features/sync/components/BackupsModal";
import { CopyDiagnosticsButton } from "@/features/sync/components/CopyDiagnosticsButton";
import { ErrorDetails } from "@/features/sync/components/ErrorDetails";
import { BTN_PRIMARY, BTN_SECONDARY, SyncIcons, SyncRow } from "@/features/sync/components/SyncRow";
import { classifyError } from "@/features/sync/lib/classifyError";
import { syncStatus, type StatusTone } from "@/features/sync/lib/syncStatus";

function formatSummary(s: BackfillSummary): string {
  const parts = [`${s.uploaded} uploaded`, `${s.upToDate} already up to date`];
  if (s.remoteAhead) parts.push(`${s.remoteAhead} newer on server (skipped)`);
  if (s.failed) parts.push(`${s.failed} failed`);
  const tail =
    s.stopped === "cancelled" ? " — cancelled"
    : s.stopped === "too_many_failures" ? " — stopped after repeated failures"
    : "";
  return parts.join(", ") + tail;
}

const DOT: Record<StatusTone, string> = {
  ok: "bg-green-500",
  info: "bg-blue-500",
  warn: "bg-amber-500",
};

// Same look as SettingsModal's SectionTitle (that one is not exported).
function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-widest text-idemora-text-muted first:mt-0">
      {children}
    </p>
  );
}

const INPUT =
  "w-full rounded-md border border-idemora-border bg-idemora-bg-secondary px-3 py-2 text-sm text-idemora-text-normal outline-none focus:border-blue-500";

export function SignInPanel() {
  const signIn = useSyncStore((s) => s.signIn);
  const signOut = useSyncStore((s) => s.signOut);
  const session = useSyncStore((s) => s.session);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [review, setReview] = useState<ReviewCount | null>(null);

  // 4d.5: new-device download. Owned here so Upload vault can be locked while the gate is closed.
  const vault = useVaultSync();
  const vaultBusy = vault.phase !== "hidden" || vault.running;

  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const [backfillDetails, setBackfillDetails] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 4c: surface retry-queue state so failed pushes aren't silent.
  const [queue, setQueue] = useState<PushQueueCounts | null>(null);
  useEffect(() => {
    if (!session) {
      setQueue(null);
      setReview(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      getQueueCounts()
        .then((c) => { if (!cancelled) setQueue(c); })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session]);

  async function handleRetryParked() {
    await requeueParked();
    await drainPushQueue();
    setQueue(await getQueueCounts());
  }

  async function handleBackfill() {
    const controller = new AbortController();
    abortRef.current = controller;
    setBackfilling(true);
    setBackfillStatus("Preparing…");
    setBackfillDetails(null);
    try {
      const summary = await backfillVault({
        signal: controller.signal,
        onProgress: (done, total) => setBackfillStatus(`Uploading ${done} / ${total}…`),
      });
      setBackfillStatus(formatSummary(summary));
    } catch (err) {
      const f = classifyError(err, "other");
      setBackfillStatus(`Upload did not finish. ${f.text}`);
      setBackfillDetails(f.details);
    } finally {
      setBackfilling(false);
      abortRef.current = null;
    }
  }

  if (session) {
    const status = syncStatus({ queue, review });
    return (
      <div className="text-sm">
        <Heading>Status</Heading>
        <div className="rounded-lg border border-idemora-border p-3">
          <div className="flex items-start gap-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[status.tone]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-idemora-text-normal">{status.text}</p>
              <p className="mt-0.5 truncate text-xs text-idemora-text-muted">Signed in as {session.user.email}</p>
            </div>
          </div>
          {queue && queue.parked > 0 && (
            <button onClick={handleRetryParked} className={`mt-3 ${BTN_SECONDARY}`}>
              Retry stuck changes
            </button>
          )}
        </div>

        <NeedReviewEntry
          variant="row"
          refreshKey={queue?.remoteAhead}
          onOpen={() => setReviewOpen(true)}
          onCount={setReview}
        />
        <ReviewListModal open={reviewOpen} onClose={() => setReviewOpen(false)} />

        <VaultSyncPrompt vault={vault} />

        <Heading>Vault</Heading>
        <div className="rounded-lg border border-idemora-border p-3">
          <p className="text-sm text-idemora-text-normal">Upload vault</p>
          <p className="mt-0.5 text-xs text-idemora-text-muted">
            Sends the notes on this device to your hosted vault. Notes that are already up to date, or newer on
            the server, are skipped.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleBackfill}
              disabled={backfilling || vaultBusy}
              title={vaultBusy ? "Resolve the vault download first" : undefined}
              className={BTN_PRIMARY}
            >
              {backfilling ? "Uploading…" : "Upload vault"}
            </button>
            {backfilling && (
              <button onClick={() => abortRef.current?.abort()} className={BTN_SECONDARY}>
                Cancel
              </button>
            )}
          </div>
          {backfillStatus && (
            <>
              <p className="mt-3 text-xs text-idemora-text-muted">{backfillStatus}</p>
              {backfillDetails && <ErrorDetails details={backfillDetails} />}
            </>
          )}
        </div>

        <Heading>Tools</Heading>
        <div className="flex flex-col gap-2">
          <SyncRow
            icon={SyncIcons.backups}
            title="Backups"
            description="Copies saved before sync changes, and how to restore them."
            chevron
            onClick={() => setBackupsOpen(true)}
          />
          <CopyDiagnosticsButton variant="row" />
        </div>
        <BackupsModal open={backupsOpen} onClose={() => setBackupsOpen(false)} />

        <div className="mt-6">
          <button onClick={signOut} className={BTN_SECONDARY}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) setError(error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3 text-sm">
      <Heading>Sign in</Heading>
      <p className="-mt-1 text-xs text-idemora-text-muted">
        Sign in to sync your notes with your hosted vault. Syncing stays off until you do.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-idemora-text-muted">Email</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-idemora-text-muted">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
        />
      </label>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button type="submit" disabled={loading} className={`${BTN_PRIMARY} w-full`}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
