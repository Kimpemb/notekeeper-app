// src/features/sync/components/BlockMergeReview.tsx
//
// Stage 4d.3, step 13 (stage 3) — the block-merge review, shown inside the review list
// dialog for notes whose review mode is "block" (individual blocks to decide, or only
// automatic changes) or "identical" (both sides already match). Presentational: the
// content and wording come from blockMergeView.ts and outcomeText.ts (both pure and
// tested); the commit is commitBlockMergeReview in wholeNoteReviewLive.ts, which runs
// the same commitNoteReview every earlier live run used (own backup, lock and
// compare-and-swap). Nothing is written until the user presses Apply.

import { useMemo, useState } from "react";
import {
  buildBlockMergeView,
  itemsForCommit,
  type DecisionCard,
} from "@/features/sync/lib/blockMergeView";
import {
  commitBlockMergeReview,
  type SyncReviewData,
} from "@/features/sync/lib/wholeNoteReviewLive";
import { describeOutcome, type OutcomeLike, type OutcomeText } from "@/features/sync/lib/outcomeText";
import { saveBlockPick } from "@/features/sync/lib/reviewPicksLive";
import { CloseNoteButton } from "@/features/sync/components/CloseNoteButton";
import { CopyDiagnosticsButton } from "@/features/sync/components/CopyDiagnosticsButton";
import { ErrorDetails } from "@/features/sync/components/ErrorDetails";
import { classifyError } from "@/features/sync/lib/classifyError";
import type { MetaRowInput } from "@/features/sync/lib/wholeNoteView";
import type { ReconcileAction } from "@/features/notes/lib/reconcileSession";
import type { CloseText } from "@/features/sync/lib/closeNoteText";

interface Props {
  noteId: string;
  title: string;
  review: SyncReviewData;
  metaRows: MetaRowInput[];
  parentTitles: ReadonlyMap<string, string>;
  /** changed: something may have been written, so the list should refresh. */
  onBack: (changed: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

const TONE_CLASS: Record<OutcomeText["tone"], string> = {
  success: "text-green-600",
  info: "text-idemora-text-normal",
  warning: "text-amber-600",
  error: "text-red-500",
};

const BADGE_CLASS: Record<DecisionCard["kind"], string> = {
  conflict: "bg-red-500/15 text-red-500",
  removed_here: "bg-amber-500/15 text-amber-600",
  removed_there: "bg-amber-500/15 text-amber-600",
};

function Preview({ label, lines }: { label: string; lines: string[] | null }) {
  if (!lines) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-idemora-text-muted">{label}</p>
      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-idemora-border p-2 text-xs text-idemora-text-normal">
        {lines.join("\n")}
      </pre>
    </div>
  );
}

export function BlockMergeReview({ noteId, title, review, metaRows, parentTitles, onBack, onBusyChange }: Props) {
  const [choices, setChoices] = useState<Record<string, ReconcileAction>>({});
  const [metaChoices, setMetaChoices] = useState<Record<string, "mine" | "theirs">>(() =>
    Object.fromEntries(metaRows.map((r) => [r.field, r.choice]))
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OutcomeText | null>(null);
  const [closeMsg, setCloseMsg] = useState<CloseText | null>(null);
  const [rawOutcome, setRawOutcome] = useState<OutcomeLike | null>(null);

  const view = useMemo(
    () =>
      buildBlockMergeView({
        mode: review.mode === "identical" ? "identical" : "block",
        baseKind: review.baseKind,
        items: review.items,
        choices,
        mineContent: review.mineContent,
        theirsContent: review.theirsContent,
        metaRows,
        parentTitles,
      }),
    [review, choices, metaRows, parentTitles]
  );

  const back = (
    <button
      onClick={() => onBack(result?.changed ?? false)}
      disabled={running}
      className="underline text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-50"
    >
      Back to the list
    </button>
  );
  const heading = <h3 className="font-medium text-idemora-text-normal truncate">{title}</h3>;

  function pick(blockId: string, action: ReconcileAction) {
    setChoices((prev) => ({ ...prev, [blockId]: action }));
    const item = review.items.find((i) => i.blockId === blockId);
    if (item) void saveBlockPick(noteId, item, action);
  }

  async function apply() {
    if (!view.canApply) return;
    setRunning(true);
    onBusyChange(true);
    try {
      const outcome = await commitBlockMergeReview(noteId, review, itemsForCommit(review.items, choices), metaChoices);
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
          <CopyDiagnosticsButton noteId={noteId} review={review} outcome={rawOutcome} />
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
      <p className="mt-2 text-xs text-idemora-text-muted">{view.summary}</p>

      {view.banners.map((b) => (
        <p key={b} className="mt-2 rounded border border-idemora-border px-2 py-1 text-xs text-idemora-text-muted">
          {b}
        </p>
      ))}

      {view.mediaNotice && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-idemora-text-normal">
          {view.mediaNotice}
        </p>
      )}

      {view.cards.length > 0 && (
        <ul className="mt-3 space-y-3">
          {view.cards.map((card) => (
            <li key={card.blockId} className="rounded border border-idemora-border p-2">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${BADGE_CLASS[card.kind]}`}>{card.badge}</span>
                <span className="text-sm text-idemora-text-normal">{card.heading}</span>
              </div>
              <p className="mt-1 text-xs text-idemora-text-muted">{card.explanation}</p>

              <div className={`mt-2 grid gap-2 ${card.base ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <Preview label="Before either change" lines={card.base} />
                <Preview label="Mine (this device)" lines={card.mine} />
                <Preview label="Theirs (the other device)" lines={card.theirs} />
              </div>

              <ul className="mt-2 space-y-1">
                {card.options.map((o) => (
                  <li key={o.action}>
                    <label className="flex items-start gap-2">
                      <input
                        type="radio"
                        name={`card-${card.blockId}`}
                        className="mt-1"
                        checked={card.selected === o.action}
                        onChange={() => pick(card.blockId, o.action)}
                      />
                      <span>
                        <span className="text-xs text-idemora-text-normal">
                          {o.label}
                          {o.isDefault ? " (recommended)" : ""}
                        </span>
                        <span className="block text-xs text-idemora-text-muted">{o.description}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {view.autoLines.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-idemora-text-muted">
            {view.autoLines.length} {view.autoLines.length === 1 ? "change merges" : "changes merge"} by itself
          </summary>
          <ul className="mt-1 divide-y divide-idemora-border">
            {view.autoLines.map((l) => (
              <li key={l.blockId} className="py-1">
                <span className="block text-xs text-idemora-text-muted">{l.label}</span>
                <span className="block break-words text-xs text-idemora-text-normal">{l.excerpt}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {view.metaRows.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-idemora-text-muted">These also differ</p>
          <ul className="mt-1 divide-y divide-idemora-border">
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

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void apply()}
          disabled={running || !view.canApply}
          className="px-2 py-1 rounded bg-blue-500 text-white disabled:opacity-50"
        >
          {running ? "Applying…" : view.applyLabel}
        </button>
        {!view.canApply && (
          <span className="text-xs text-idemora-text-muted">
            Decide {view.counts.pending} more {view.counts.pending === 1 ? "block" : "blocks"} to apply.
          </span>
        )}
        <CopyDiagnosticsButton noteId={noteId} review={review} />
      </div>
    </div>
  );
}
