// src/features/sync/components/ReviewListView.tsx
//
// Stage 4d.3, Step B (part 2): the review list as a PAGE inside Settings > Sync, replacing
// the stacked ReviewListModal. Levels: Sync > Needs review > one note (the review screens),
// plus the bulk confirm / running / done pages. One header (SubPageHeader) with the back
// button on the left named after the page it returns to; no Close of its own (Settings has
// its X). Esc means "back one level" and only closes Settings on the Sync screen.
// Logic is unchanged from the modal: the rules live in reviewList.ts (pure), the sequencing
// in reviewBulkRun.ts (pure), the commits in reviewBulkLive.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listReviewCandidates, type ReviewCandidateList } from "@/features/sync/lib/reviewCandidatesLive";
import { refreshReviewBadge } from "@/features/sync/lib/reviewBadgeLive";
import { countByKind, type CandidateKind } from "@/features/sync/lib/reviewCandidates";
import {
  DEFAULT_QUERY,
  bulkConfirmText,
  bulkOptionsFor,
  bulkSummaryText,
  filterAndSort,
  kindLabel,
  planBulk,
  skipReasonLabel,
  summarizeBulk,
  type BulkOption,
  type BulkPlan,
  type SortKey,
} from "@/features/sync/lib/reviewList";
import { runBulk, type BulkStopReason } from "@/features/sync/lib/reviewBulkRun";
import { commitOneFor, isNoteOpen, loadMediaIds, loadReviewModes } from "@/features/sync/lib/reviewBulkLive";
import { WholeNoteReview } from "@/features/sync/components/WholeNoteReview";
import { DeleteReview } from "@/features/sync/components/DeleteReview";
import { ErrorDetails } from "@/features/sync/components/ErrorDetails";
import { classifyError } from "@/features/sync/lib/classifyError";
import { useUIStore } from "@/features/ui/store/useUIStore";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT_COMPACT,
  ROW_HOVER,
  StickyFooter,
  SubPageHeader,
  scrollPaneToTop,
} from "@/features/sync/components/SyncRow";

type Phase =
  | { kind: "list" }
  | { kind: "preparing" }
  | { kind: "confirm"; option: BulkOption; plan: BulkPlan }
  | { kind: "running"; option: BulkOption; done: number; total: number }
  | { kind: "done"; text: string; problems: Array<{ noteId: string; title: string; status: string; reason?: string }> }
  | { kind: "error"; message: string; details?: string };

const KIND_ORDER: CandidateKind[] = ["content_conflict", "purged_elsewhere", "deleted_here", "hosted_missing", "unchecked"];

const STOP_TEXT: Record<Exclude<BulkStopReason, null>, string> = {
  signed_out: " Stopped: you were signed out.",
  network: " Stopped: the server could not be reached.",
  cancelled: " Stopped at your request.",
};

interface Props {
  /** Back to the Sync screen. */
  onBack: () => void;
}

export function ReviewListView({ onBack }: Props) {
  const [list, setList] = useState<ReviewCandidateList | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<{ text: string; details: string } | null>(null);

  const [text, setText] = useState(DEFAULT_QUERY.text);
  const [sort, setSort] = useState<SortKey>(DEFAULT_QUERY.sort);
  const [kinds, setKinds] = useState<ReadonlySet<CandidateKind> | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>({ kind: "list" });
  const cancelRef = useRef(false);
  const [reviewing, setReviewing] = useState<{ noteId: string; title: string; kind: CandidateKind } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // What the open review last reported, so the header back button can do what the review's
  // own "Done" does (refresh the list, drop a resolved row).
  const outcomeRef = useRef({ changed: false, resolved: false });
  const onOutcome = useCallback((changed: boolean, resolved: boolean) => {
    outcomeRef.current = { changed, resolved };
    // The apply is already committed: let the title-bar badge drop to the new count at once.
    void refreshReviewBadge();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listReviewCandidates();
      setList(result);
      void refreshReviewBadge();
      // Forget selections for notes that are no longer in the list.
      const present = new Set(result.candidates.map((c) => c.noteId));
      setSelected((prev) => new Set([...prev].filter((id) => present.has(id))));
    } catch (err) {
      const f = classifyError(err, "load");
      setLoadError({ text: f.text, details: f.details });
    } finally {
      setLoading(false);
    }
  }, []);

  // The page mounts when the person opens Needs review, so this is the "open" load.
  useEffect(() => {
    void load();
  }, [load]);

  const busy = phase.kind === "preparing" || phase.kind === "running";

  function leaveReview(changed: boolean, resolved = false) {
    const clearedId = reviewing?.noteId;
    setReviewing(null);
    if (resolved && clearedId) {
      setList((l) => (l ? { ...l, candidates: l.candidates.filter((c) => c.noteId !== clearedId) } : l));
    }
    if (changed) void load();
  }

  // Back one level: review to list, bulk page to list, list to the Sync screen.
  function goBack() {
    if (reviewing) leaveReview(outcomeRef.current.changed, outcomeRef.current.resolved);
    else if (phase.kind !== "list") setPhase({ kind: "list" });
    else onBack();
  }
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Keep Esc from also reaching the Settings modal (it listens on window).
      e.stopPropagation();
      if (busy || reviewBusy) return;
      e.preventDefault();
      goBackRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, reviewBusy]);

  // Tell Settings an operation is running so it will not close underneath it (decision 59).
  useEffect(() => {
    useUIStore.getState().setSyncBusy(busy || reviewBusy);
    return () => useUIStore.getState().setSyncBusy(false);
  }, [busy, reviewBusy]);

  // Entering or leaving a review: forget the previous review's outcome, and (because Settings
  // scrolls one pane for every page) start the new page at the top.
  useEffect(() => {
    outcomeRef.current = { changed: false, resolved: false };
    scrollPaneToTop(rootRef.current);
  }, [reviewing]);

  const candidates = useMemo(() => list?.candidates ?? [], [list]);
  const visible = useMemo(() => filterAndSort(candidates, { text, kinds, sort }), [candidates, text, kinds, sort]);
  const counts = useMemo(() => countByKind(candidates), [candidates]);
  const selectedVisible = useMemo(() => visible.filter((c) => selected.has(c.noteId)), [visible, selected]);
  const availability = useMemo(() => bulkOptionsFor(selectedVisible), [selectedVisible]);

  const toggleKind = (k: CandidateKind) => {
    const next = new Set(kinds ?? []);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next.size === 0 ? null : next);
  };

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.noteId));
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((c) => c.noteId)));

  async function startBulk(option: BulkOption) {
    setPhase({ kind: "preparing" });
    try {
      const rows = selectedVisible;
      const modes = option.needsWholeNote ? await loadReviewModes(rows) : new Map();
      const mediaIds = option.id === "whole_take_theirs" ? await loadMediaIds(rows) : new Set<string>();
      const openIds = new Set(rows.filter((r) => isNoteOpen(r.noteId)).map((r) => r.noteId));
      setPhase({ kind: "confirm", option, plan: planBulk(option, rows, modes, openIds, mediaIds) });
    } catch (err) {
      const f = classifyError(err, "load");
      setPhase({ kind: "error", message: f.text, details: f.details });
    }
  }

  async function confirmBulk(option: BulkOption, plan: BulkPlan) {
    try {
      await runConfirmed(option, plan);
    } catch (err) {
      const f = classifyError(err, "apply");
      setPhase({ kind: "error", message: f.text, details: f.details });
      void load();
    }
  }

  async function runConfirmed(option: BulkOption, plan: BulkPlan) {
    cancelRef.current = false;
    setPhase({ kind: "running", option, done: 0, total: plan.eligible.length });
    const result = await runBulk(plan.eligible, commitOneFor(option), {
      onProgress: (done, total) => setPhase({ kind: "running", option, done, total }),
      isCancelled: () => cancelRef.current,
    });

    const summary = summarizeBulk(
      result.outcomes.map((o) => o.outcome),
      plan.skipped.length,
      plan.eligible.length
    );
    const titleOf = (id: string) => candidates.find((c) => c.noteId === id)?.title ?? "Untitled";
    setPhase({
      kind: "done",
      text: bulkSummaryText(summary) + (result.stoppedBy ? STOP_TEXT[result.stoppedBy] : ""),
      problems: result.outcomes
        .filter((o) => o.outcome.status !== "committed")
        .map((o) => ({ noteId: o.noteId, title: titleOf(o.noteId), status: o.outcome.status, reason: o.outcome.reason })),
    });
    setSelected(new Set());
    void load();
  }

  const inReview = reviewing !== null;
  const inBulkPage = !inReview && phase.kind !== "list";
  const title = reviewing
    ? reviewing.title
    : inBulkPage
      ? "Selected notes"
      : `Needs review${list ? ` (${candidates.length})` : ""}`;
  const backLabel = inReview || inBulkPage ? "Needs review" : "Sync";

  return (
    <div ref={rootRef}>
      <SubPageHeader
        title={title}
        backLabel={backLabel}
        onBack={goBack}
        backDisabled={busy || reviewBusy}
        right={
          !inReview && phase.kind === "list" ? (
            <button onClick={() => void load()} disabled={loading} className={`shrink-0 ${BTN_GHOST}`}>
              {loading ? "Checking…" : "Refresh"}
            </button>
          ) : undefined
        }
      />

    {reviewing && (reviewing.kind === "deleted_here" || reviewing.kind === "purged_elsewhere") && (
      <DeleteReview
        noteId={reviewing.noteId}
        kind={reviewing.kind}
        onBusyChange={setReviewBusy}
        onOutcome={onOutcome}
        onBack={leaveReview}
      />
    )}
    {reviewing && reviewing.kind !== "deleted_here" && reviewing.kind !== "purged_elsewhere" && (
      <WholeNoteReview
        noteId={reviewing.noteId}
        kind={reviewing.kind}
        onBusyChange={setReviewBusy}
        onOutcome={onOutcome}
        onBack={leaveReview}
      />
    )}
    <div className={reviewing ? "hidden" : ""}>
    {loadError && (
      <div>
        <p className="text-red-500">Could not load the list. {loadError.text}</p>
        <ErrorDetails details={loadError.details} />
        <button onClick={() => void load()} className={`mt-2 ${BTN_PRIMARY}`}>
          Try again
        </button>
      </div>
    )}

    {list && !list.hostedChecked && (
      <p className="mb-2 text-xs text-idemora-text-muted">
        Could not reach the server, so some labels are unconfirmed. Bulk actions are off for those notes.
      </p>
    )}

    {phase.kind === "preparing" && <p className="text-idemora-text-muted">Checking the selected notes…</p>}

    {phase.kind === "running" && (
      <div>
        <p className="text-idemora-text-normal">
          Applying {phase.done} / {phase.total}…
        </p>
        <div className="mt-2 h-1.5 w-full rounded bg-idemora-border overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-[width] duration-200"
            style={{ width: `${phase.total ? Math.round((phase.done / phase.total) * 100) : 0}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-idemora-text-muted">Keep the app open. Each note is backed up before it changes.</p>
        <button
          onClick={() => (cancelRef.current = true)}
          className={`mt-3 ${BTN_SECONDARY}`}
        >
          Stop after this note
        </button>
      </div>
    )}

    {phase.kind === "confirm" && (
      <div>
        {phase.plan.eligible.length > 0 ? (
          <>
            <p className="font-medium text-idemora-text-normal">
              {bulkConfirmText(phase.option, phase.plan.eligible.length).title}
            </p>
            <p className="mt-1 text-idemora-text-muted">
              {bulkConfirmText(phase.option, phase.plan.eligible.length).body}
            </p>
          </>
        ) : (
          <p className="font-medium text-idemora-text-normal">Nothing in this selection can be applied in bulk.</p>
        )}

        {phase.plan.skipped.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-idemora-text-muted">{phase.plan.skipped.length} will be skipped:</p>
            <ul className="mt-1 text-xs text-idemora-text-muted list-disc pl-4">
              {phase.plan.skipped.map((s) => (
                <li key={s.noteId}>
                  {candidates.find((c) => c.noteId === s.noteId)?.title ?? "Untitled"}: {skipReasonLabel(s.reason)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          {phase.plan.eligible.length > 0 && (
            <button
              onClick={() => void confirmBulk(phase.option, phase.plan)}
              className={BTN_PRIMARY}
            >
              Apply to {phase.plan.eligible.length}
            </button>
          )}
          <button
            onClick={() => setPhase({ kind: "list" })}
            className={BTN_SECONDARY}
          >
            {phase.plan.eligible.length > 0 ? "Cancel" : "Back"}
          </button>
        </div>
      </div>
    )}

    {phase.kind === "error" && (
      <div>
        <p className="text-red-500">{phase.message}</p>
        {phase.details && <ErrorDetails details={phase.details} />}
        <p className="mt-1 text-xs text-idemora-text-muted">
          Check the list to see what changed before trying again.
        </p>
        <button
          onClick={() => setPhase({ kind: "list" })}
          className={`mt-3 ${BTN_PRIMARY}`}
        >
          Back to the list
        </button>
      </div>
    )}

    {phase.kind === "done" && (
      <div>
        <p className="text-idemora-text-normal">{phase.text}</p>
        {phase.problems.length > 0 && (
          <ul className="mt-2 text-xs text-idemora-text-muted list-disc pl-4">
            {phase.problems.map((p) => (
              <li key={p.noteId}>
                {p.title}: {p.status}
                {p.reason ? ` (${p.reason})` : ""}
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => setPhase({ kind: "list" })}
          className={`mt-3 ${BTN_PRIMARY}`}
        >
          Back to the list
        </button>
      </div>
    )}

    {phase.kind === "list" && (
      <>
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search by title"
            className={`flex-1 min-w-40 ${INPUT_COMPACT}`}
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={INPUT_COMPACT}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title</option>
          </select>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {KIND_ORDER.filter((k) => counts[k] > 0).map((k) => {
            const on = kinds?.has(k) ?? false;
            return (
              <button
                key={k}
                onClick={() => toggleKind(k)}
                className={`px-2 py-0.5 rounded-full border text-xs transition-colors duration-150 ${
                  on
                    ? "bg-blue-500 text-white border-blue-500 hover:bg-blue-600"
                    : `border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal ${ROW_HOVER}`
                }`}
              >
                {kindLabel(k)} · {counts[k]}
              </button>
            );
          })}
        </div>

        {/* Rows */}
        {loading && !list && <p className="mt-3 text-idemora-text-muted">Checking…</p>}
        {list && candidates.length === 0 && (
          <div className="mt-3 rounded-lg border border-idemora-border px-4 py-8 text-center">
            <p className="text-sm text-idemora-text-normal">All caught up.</p>
            <p className="mt-1 text-xs text-idemora-text-muted">Nothing needs review.</p>
            <button type="button" onClick={onBack} className={`mt-4 ${BTN_SECONDARY}`}>
                  Back to Sync
                </button>
          </div>
        )}
        {list && candidates.length > 0 && visible.length === 0 && (
          <p className="mt-3 text-idemora-text-muted">No notes match the filter.</p>
        )}

        {visible.length > 0 && (
          <div className="mt-3">
            <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-idemora-text-muted">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
              Select all shown ({selectedVisible.length} of {visible.length} selected)
            </label>
            <ul className="mt-2 space-y-2">
              {visible.map((c) => {
                const isSelected = selected.has(c.noteId);
                return (
                  <li
                    key={c.noteId}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150 ${ROW_HOVER} ${
                      isSelected ? "border-blue-500 bg-blue-500/5" : "border-idemora-border"
                    }`}
                  >
                    <label className="-m-1 flex shrink-0 cursor-pointer items-center p-1">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer"
                        checked={isSelected}
                        onChange={() => toggleRow(c.noteId)}
                        aria-label={`Select ${c.title ?? "Untitled"}`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setReviewing({ noteId: c.noteId, title: c.title ?? "Untitled", kind: c.kind })}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm leading-snug text-idemora-text-normal">
                          {c.title ?? "Untitled"}
                        </span>
                        <span className="block truncate text-xs leading-snug text-idemora-text-muted">
                          {kindLabel(c.kind)} · {new Date(c.detectedAt).toLocaleString()}
                        </span>
                      </span>
                      <span className="shrink-0 text-idemora-text-muted">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M4.5 2.5L8 6l-3.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </>
    )}
    </div>


      {/* Bulk bar: stays visible at the bottom while the list scrolls */}
      {phase.kind === "list" && !reviewing && selectedVisible.length > 0 && (
        <StickyFooter>
          <span className="text-xs text-idemora-text-muted">{selectedVisible.length} selected</span>
          {availability.options.length > 0 ? (
            availability.options.map((o) => (
              <button key={o.id} onClick={() => void startBulk(o)} className={BTN_PRIMARY}>
                {o.label}
              </button>
            ))
          ) : (
            <span className="text-xs text-idemora-text-muted">{availability.blockedReason}</span>
          )}
        </StickyFooter>
      )}
    </div>
  );
}
