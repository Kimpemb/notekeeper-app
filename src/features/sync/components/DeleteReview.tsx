// src/features/sync/components/DeleteReview.tsx
//
// Stage 4d.3, step 13 (stage 2) — the D1 and D2 review screens, shown inside the
// review list dialog. Presentational: wording comes from deleteReviewView.ts and
// outcomeText.ts (both pure and tested); the reads and the commit are in
// deleteReviewLive.ts. The destructive choice needs a second click on a confirmation.

import { useEffect, useState } from "react";
import { commitDeleteChoice, loadDeleteReview, type LoadedDeleteReview } from "@/features/sync/lib/deleteReviewLive";
import { describeOutcome, type OutcomeLike, type OutcomeText } from "@/features/sync/lib/outcomeText";
import { CloseNoteButton } from "@/features/sync/components/CloseNoteButton";
import { CopyDiagnosticsButton } from "@/features/sync/components/CopyDiagnosticsButton";
import { ErrorDetails } from "@/features/sync/components/ErrorDetails";
import { classifyError } from "@/features/sync/lib/classifyError";
import type { DeleteReviewChoiceId } from "@/features/sync/lib/deleteReviewView";
import type { CloseText } from "@/features/sync/lib/closeNoteText";

interface Props {
  noteId: string;
  title: string;
  kind: "deleted_here" | "purged_elsewhere";
  /** changed: something may have been written, so the list should refresh. */
  onBack: (changed: boolean, resolved?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

const TONE_CLASS: Record<OutcomeText["tone"], string> = {
  success: "text-green-600",
  info: "text-idemora-text-normal",
  warning: "text-amber-600",
  error: "text-red-500",
};

export function DeleteReview({ noteId, title, kind, onBack, onBusyChange }: Props) {
  const [loaded, setLoaded] = useState<LoadedDeleteReview | null>(null);
  const [choice, setChoice] = useState<DeleteReviewChoiceId>(kind === "deleted_here" ? "keep_it" : "keep_mine");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OutcomeText | null>(null);
  const [closeMsg, setCloseMsg] = useState<CloseText | null>(null);
  const [rawOutcome, setRawOutcome] = useState<OutcomeLike | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setConfirming(false);
    void loadDeleteReview(noteId, kind).then((r) => {
      if (!cancelled) setLoaded(r);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, kind, attempt]);

  const back = (
    <button
      onClick={() => onBack(result?.changed ?? false, result?.tone === "success")}
      disabled={running}
      className="underline text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-50"
    >
      Back to the list
    </button>
  );
  const heading = <h3 className="font-medium text-idemora-text-normal truncate">{title}</h3>;

  if (!loaded) {
    return (
      <div>
        {heading}
        <p className="mt-2 text-idemora-text-muted">Loading…</p>
      </div>
    );
  }

  if (!loaded.ok) {
    return (
      <div>
        {heading}
        <p className="mt-2 text-idemora-text-muted">{loaded.message}</p>
        {loaded.details && <ErrorDetails details={loaded.details} />}
        <div className="mt-3 flex items-center gap-4">
          {loaded.retryable && (
            <button onClick={() => setAttempt((a) => a + 1)} className="px-2 py-1 rounded bg-blue-500 text-white">
              Try again
            </button>
          )}
          {back}
        </div>
      </div>
    );
  }

  const { view } = loaded;
  const picked = view.choices.find((c) => c.id === choice);

  async function run() {
    if (!picked || !loaded || !loaded.ok) return;
    setRunning(true);
    onBusyChange(true);
    try {
      const outcome = await commitDeleteChoice(noteId, loaded, picked.id);
      setRawOutcome(outcome);
      setResult(describeOutcome(outcome));
    } catch (err) {
      const f = classifyError(err, "apply");
      setResult({ text: f.text, tone: "error", changed: true, details: f.details });
    } finally {
      setRunning(false);
      setConfirming(false);
      onBusyChange(false);
    }
  }

  function onApply() {
    if (picked?.requiresConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    void run();
  }

  if (result) {
    return (
      <div>
        {heading}
        <p className={`mt-2 ${TONE_CLASS[closeMsg ? closeMsg.tone : result.tone]}`}>
          {closeMsg ? closeMsg.text : result.text}
        </p>
        {result.details && !closeMsg && <ErrorDetails details={result.details} />}
        {result.closeNote && !closeMsg && (
          <CloseNoteButton noteId={noteId} context="review" onClosed={setCloseMsg} onBusyChange={onBusyChange} />
        )}
        <div className="mt-3 flex items-center gap-4">
          {back}
          <CopyDiagnosticsButton noteId={noteId} outcome={rawOutcome} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        {heading}
        {back}
      </div>
      <p className="mt-2 text-idemora-text-normal">{view.explanation}</p>

      {view.mediaNotice && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-idemora-text-normal">
          {view.mediaNotice}
        </p>
      )}

      <div className="mt-3 min-w-0">
        <p className="text-xs font-medium text-idemora-text-muted">{view.contentLabel}</p>
        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-idemora-border p-2 text-xs text-idemora-text-normal">
          {view.lines.join("\n")}
        </pre>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-idemora-text-muted">What should happen?</p>
        <ul className="mt-1 space-y-2">
          {view.choices.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="delete-choice"
                  className="mt-1"
                  checked={choice === c.id}
                  disabled={running}
                  onChange={() => {
                    setChoice(c.id);
                    setConfirming(false);
                  }}
                />
                <span>
                  <span className="text-idemora-text-normal">
                    {c.label}
                    {c.isDefault ? " (recommended)" : ""}
                  </span>
                  <span className="block text-xs text-idemora-text-muted">{c.description}</span>
                  {c.warning && <span className="block text-xs text-amber-600">{c.warning}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {confirming && picked?.confirmText && (
        <p className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-idemora-text-normal">
          {picked.confirmText}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onApply}
          disabled={running || !picked}
          className={`px-2 py-1 rounded text-white disabled:opacity-50 ${confirming ? "bg-red-600" : "bg-blue-500"}`}
        >
          {running ? "Applying…" : confirming ? `Yes: ${picked?.label ?? ""}` : `Apply: ${picked?.label ?? ""}`}
        </button>
        {confirming && !running && (
          <button onClick={() => setConfirming(false)} className="underline text-idemora-text-muted hover:text-idemora-text-normal">
            Cancel
          </button>
        )}
        <CopyDiagnosticsButton noteId={noteId} />
      </div>
    </div>
  );
}
