// src/features/sync/components/SignInPanel.tsx
import { useEffect, useRef, useState } from "react";
import { useSyncStore } from "@/features/sync/store/useSyncStore";
import { backfillVault, type BackfillSummary } from "@/features/sync/lib/backfillVault";
import { getQueueCounts, requeueParked, type PushQueueCounts } from "@/features/sync/lib/pushQueue";
import { drainPushQueue } from "@/features/sync/lib/drainPushQueue";

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

export function SignInPanel() {
  const signIn = useSyncStore((s) => s.signIn);
  const signOut = useSyncStore((s) => s.signOut);
  const session = useSyncStore((s) => s.session);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 4c: surface retry-queue state so failed pushes aren't silent.
  const [queue, setQueue] = useState<PushQueueCounts | null>(null);
  useEffect(() => {
    if (!session) return;
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
    try {
      const summary = await backfillVault({
        signal: controller.signal,
        onProgress: (done, total) => setBackfillStatus(`Uploading ${done} / ${total}…`),
      });
      setBackfillStatus(formatSummary(summary));
    } catch (err) {
      setBackfillStatus(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBackfilling(false);
      abortRef.current = null;
    }
  }

  if (session) {
    return (
      <div className="p-3 text-sm">
        <p>Signed in as {session.user.email}</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={handleBackfill}
            disabled={backfilling}
            className="px-2 py-1 rounded bg-blue-500 text-white disabled:opacity-50"
          >
            {backfilling ? "Uploading…" : "Upload vault"}
          </button>
          {backfilling && (
            <button
              onClick={() => abortRef.current?.abort()}
              className="text-idemora-text-muted hover:text-idemora-text-normal"
            >
              Cancel
            </button>
          )}
        </div>
        {backfillStatus && (
          <p className="mt-2 text-xs text-idemora-text-muted max-w-64">{backfillStatus}</p>
        )}
        {queue && (
          <p className="mt-2 text-xs text-idemora-text-muted max-w-64">
            Sync queue: {queue.pending} retrying · {queue.parked} parked · {queue.remoteAhead} newer on server
            {queue.parked > 0 && (
              <button onClick={handleRetryParked} className="ml-2 underline">
                Retry parked
              </button>
            )}
          </p>
        )}
        <button onClick={signOut} className="mt-2 text-idemora-text-muted hover:text-idemora-text-normal">
          Sign out
        </button>
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
    <form onSubmit={handleSubmit} className="p-3 flex flex-col gap-2 text-sm">
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="px-2 py-1 rounded border border-idemora-border bg-idemora-bg-secondary"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="px-2 py-1 rounded border border-idemora-border bg-idemora-bg-secondary"
      />
      {error && <p className="text-red-500 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="px-2 py-1 rounded bg-blue-500 text-white disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}