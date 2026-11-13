// src/features/sync/components/WholeNoteReview.tsx
//
// Stage 4d.3, step 13 (stage 1) — the whole-note review, shown inside the review
// list dialog. Presentational: the content and wording come from wholeNoteView.ts
// and outcomeText.ts (both pure and tested); the commit is wholeNoteReviewLive.ts.
// Other kinds of review (block merge, deleted notes) show a short placeholder until
// their screens exist; bulk actions still work for them from the list.

import { useEffect, useState } from "react";
import {
  commitWholeNoteReview,
  loadWholeNoteReview,
  type LoadedReview,
} from "@/features/sync/lib/wholeNoteReviewLive";
import { describeOutcome, type OutcomeLike, type OutcomeText } from "@/features/sync/lib/outcomeText";
import { BlockMergeReview } from "@/features/sync/components/BlockMergeReview";
import type { WholeNoteChoiceId } from "@/features/sync/lib/wholeNoteView";
import type { CandidateKind } from "@/features/sync/lib/reviewCandidates";
import { CloseNoteButton } from "@/features/sync/components/CloseNoteButton";
import { CopyDiagnosticsButton } from "@/features/sync/components/CopyDiagnosticsButton";
import { ErrorDetails } from "@/features/sync/components/ErrorDetails";
import { classifyError } from "@/features/sync/lib/classifyError";
import { BTN_PRIMARY, ROW_HOVER, StickyFooter } from "@/features/sync/components/SyncRow";
import type { CloseText } from "@/features/sync/lib/closeNoteText";


interface Props {
  noteId: string;
  kind: CandidateKind;
  /** changed: something may have been written, so the list should refresh. */
  onBack: (changed: boolean, resolved?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  /** Reports the result of an apply, so the page header's back button can act like "Done". */
  onOutcome?: (changed: boolean, resolved: boolean) => void;
}

const TONE_CLASS: Record<OutcomeText["tone"], string> = {
  success: "text-green-600",
  info: "text-idemora-text-normal",
  warning: "text-amber-600",
  error: "text-red-500",
};

export function WholeNoteReview({ noteId, kind, onBack, onBusyChange, onOutcome }: Props) {
  const [loaded, setLoaded] = useState<LoadedReview | null>(null);
  const [choice, setChoice] = useState<WholeNoteChoiceId>("keep_mine");
  const [metaChoices, setMetaChoices] = useState<Record<string, "mine" | "theirs">>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OutcomeText | null>(null);
  const [closeMsg, setCloseMsg] = useState<CloseText | null>(null);
  const [rawOutcome, setRawOutcome] = useState<OutcomeLike | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Tell the page what happened, so its header back button can behave like "Done".
  useEffect(() => {
    if (result) onOutcome?.(result.changed, result.tone === "success");
  }, [result, onOutcome]);

  useEffect(() => {
    if (kind !== "content_conflict") return;
    let cancelled = false;
    setLoaded(null);
    void loadWholeNoteReview(noteId).then((r) => {
      if (cancelled) return;
      setLoaded(r);
      if (r.ok && r.kind === "whole_note") {
        setChoice("keep_mine");
        setMetaChoices(Object.fromEntries(r.view.metaRows.map((row) => [row.field, row.preselected])));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, kind, attempt]);

  // Shown on the result screen (the page header's back button does the same).
  const done = (
    <button
      onClick={() => onBack(result?.changed ?? false, result?.tone === "success")}
      disabled={running}
      className={BTN_PRIMARY}
    >
      {result?.tone === "success" ? "Done" : "Back to the list"}
    </button>
  );

  if (kind !== "content_conflict") {
    const unchecked = kind === "unchecked";
    return (
      <div>
        <p className="text-idemora-text-muted">
          {unchecked
            ? "The server could not be reached to check this note, so it cannot be reviewed right now. Check your connection, then check again."
            : "This note was not found on the server, so there is nothing to compare it with. Nothing was changed."}
        </p>
        {unchecked && (
          <div className="mt-3">
            <button onClick={() => onBack(true)} className={BTN_PRIMARY}>
              Check again
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!loaded) {
    return (
      <div>
        <p className="text-idemora-text-muted">Loading both versions…</p>
      </div>
    );
  }

  if (!loaded.ok) {
    return (
      <div>
        <p className="text-red-500">{loaded.message}</p>
        {loaded.details && <ErrorDetails details={loaded.details} />}
        {loaded.retryable && (
          <div className="mt-3">
            <button onClick={() => setAttempt((a) => a + 1)} className={BTN_PRIMARY}>
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  if (loaded.kind === "block_merge") {
    return (
      <BlockMergeReview
        noteId={noteId}
        review={loaded.review}
        metaRows={loaded.metaRows}
        parentTitles={loaded.parentTitles}
        onBack={onBack}
        onOutcome={onOutcome}
        onBusyChange={onBusyChange}
      />
    );
  }

  const { view, review } = loaded;

  async function apply() {
    const picked = view.choices.find((c) => c.id === choice);
    if (!picked) return;
    setRunning(true);
    onBusyChange(true);
    try {
      const outcome = await commitWholeNoteReview(noteId, review, picked.variant, metaChoices);
      setRawOutcome(outcome);
      setResult(describeOutcome(outcome));
    } catch (err) {
      const f = classifyError(err, "apply");
      setResult({ text: f.text, tone: "error", changed: true, details: f.details });
    } finally {
      setRunning(false);
      onBusyChange(false);
    }
  }

  if (result) {
    return (
      <div>
        <p className={TONE_CLASS[closeMsg ? closeMsg.tone : result.tone]}>
          {closeMsg ? closeMsg.text : result.text}
        </p>
        {result.details && !closeMsg && <ErrorDetails details={result.details} />}
        {result.closeNote && !closeMsg && (
          <CloseNoteButton noteId={noteId} context="review" onClosed={setCloseMsg} onBusyChange={onBusyChange} />
        )}
        <StickyFooter>
          {done}
          <CopyDiagnosticsButton noteId={noteId} review={review} outcome={rawOutcome} />
        </StickyFooter>
      </div>
    );
  }

  const picked = view.choices.find((c) => c.id === choice);

  return (
    <div>
      {view.mediaNotice && (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-idemora-text-normal">
          {view.mediaNotice}
        </p>
      )}
      {view.sameText && (
        <p className="mt-2 text-xs text-idemora-text-muted">
          The text is the same on both sides. Only formatting or non-text parts differ.
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3">
        {([
          ["Mine (this device)", view.mine.lines],
          ["Theirs (the other device)", view.theirs.lines],
        ] as const).map(([label, lines]) => (
          <div key={label} className="min-w-0">
            <p className="text-xs font-medium text-idemora-text-muted">{label}</p>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-idemora-border bg-idemora-bg-primary/40 px-3 py-2 text-xs text-idemora-text-normal">
              {lines.join("\n")}
            </pre>
          </div>
        ))}
      </div>

      {view.metaRows.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-idemora-text-muted">These also differ</p>
          <ul className="mt-1 divide-y divide-idemora-border rounded-lg border border-idemora-border px-3">
            {view.metaRows.map((row) => (
              <li key={row.field} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                <span className="w-24 text-xs text-idemora-text-muted">{row.label}</span>
                {(["mine", "theirs"] as const).map((side) => (
                  <label key={side} className={`flex items-center gap-1 text-xs ${side === "theirs" && !row.canTakeTheirs ? "opacity-50" : ""}`}>
                    <input
                      type="radio"
                      name={`meta-${row.field}`}
                      checked={metaChoices[row.field] === side}
                      disabled={side === "theirs" && !row.canTakeTheirs}
                      onChange={() => setMetaChoices({ ...metaChoices, [row.field]: side })}
                    />
                    {side === "mine" ? "Mine" : "Theirs"}: {side === "mine" ? row.mineLabel : row.theirsLabel}
                  </label>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <p className="text-xs font-medium text-idemora-text-muted">What should happen?</p>
        <ul className="mt-1 space-y-2">
          {view.choices.map((c) => (
            <li key={c.id}>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors duration-150 ${
                  choice === c.id ? "border-blue-500 bg-blue-500/5" : `border-idemora-border ${ROW_HOVER}`
                }`}
              >
                <input type="radio" name="choice" className="mt-1" checked={choice === c.id} onChange={() => setChoice(c.id)} />
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

      <StickyFooter>
        <button onClick={() => void apply()} disabled={running || !picked} className={BTN_PRIMARY}>
          {running ? "Applying…" : `Apply: ${picked?.label ?? ""}`}
        </button>
        <CopyDiagnosticsButton noteId={noteId} review={review} />
      </StickyFooter>
    </div>
  );
}
