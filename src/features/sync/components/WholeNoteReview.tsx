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
import { describeOutcome, type OutcomeText } from "@/features/sync/lib/outcomeText";
import type { WholeNoteChoiceId } from "@/features/sync/lib/wholeNoteView";
import type { CandidateKind } from "@/features/sync/lib/reviewCandidates";

interface Props {
  noteId: string;
  title: string;
  kind: CandidateKind;
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

export function WholeNoteReview({ noteId, title, kind, onBack, onBusyChange }: Props) {
  const [loaded, setLoaded] = useState<LoadedReview | null>(null);
  const [choice, setChoice] = useState<WholeNoteChoiceId>("keep_mine");
  const [metaChoices, setMetaChoices] = useState<Record<string, "mine" | "theirs">>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OutcomeText | null>(null);

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
  }, [noteId, kind]);

  const back = (
    <button onClick={() => onBack(result?.changed ?? false)} disabled={running} className="underline text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-50">
      Back to the list
    </button>
  );

  const heading = <h3 className="font-medium text-idemora-text-normal truncate">{title}</h3>;

  if (kind !== "content_conflict") {
    return (
      <div>
        {heading}
        <p className="mt-2 text-idemora-text-muted">
          Reviewing this kind of note one by one is coming next. For now, use the bulk actions in the list.
        </p>
        <div className="mt-3">{back}</div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div>
        {heading}
        <p className="mt-2 text-idemora-text-muted">Loading both versions…</p>
      </div>
    );
  }

  if (!loaded.ok) {
    return (
      <div>
        {heading}
        <p className="mt-2 text-red-500">{loaded.message}</p>
        <div className="mt-3">{back}</div>
      </div>
    );
  }

  if (loaded.kind === "other_mode") {
    return (
      <div>
        {heading}
        <p className="mt-2 text-idemora-text-muted">
          {loaded.mode === "block"
            ? "This note has individual changes to decide, and that screen is coming next. It is skipped by bulk actions."
            : "Both versions of this note already match. Finishing it from here is coming next."}
        </p>
        <div className="mt-3">{back}</div>
      </div>
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
      setResult(describeOutcome(outcome));
    } catch (err) {
      setResult({ text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}. Check the note before trying again.`, tone: "error", changed: true });
    } finally {
      setRunning(false);
      onBusyChange(false);
    }
  }

  if (result) {
    return (
      <div>
        {heading}
        <p className={`mt-2 ${TONE_CLASS[result.tone]}`}>{result.text}</p>
        <div className="mt-3">{back}</div>
      </div>
    );
  }

  const picked = view.choices.find((c) => c.id === choice);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        {heading}
        {back}
      </div>

      {view.mediaNotice && (
        <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-idemora-text-normal">
          {view.mediaNotice}
        </p>
      )}
      {view.sameText && (
        <p className="mt-2 text-xs text-idemora-text-muted">
          The text is the same on both sides. Only formatting or non-text parts differ.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        {([
          ["Mine (this device)", view.mine.lines],
          ["Theirs (the other device)", view.theirs.lines],
        ] as const).map(([label, lines]) => (
          <div key={label} className="min-w-0">
            <p className="text-xs font-medium text-idemora-text-muted">{label}</p>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-idemora-border p-2 text-xs text-idemora-text-normal">
              {lines.join("\n")}
            </pre>
          </div>
        ))}
      </div>

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

      <div className="mt-3">
        <p className="text-xs font-medium text-idemora-text-muted">What should happen?</p>
        <ul className="mt-1 space-y-2">
          {view.choices.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-2">
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

      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => void apply()} disabled={running || !picked} className="px-2 py-1 rounded bg-blue-500 text-white disabled:opacity-50">
          {running ? "Applying…" : `Apply: ${picked?.label ?? ""}`}
        </button>
      </div>
    </div>
  );
}
