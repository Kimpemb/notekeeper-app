// src/features/sync/components/ReviewListModal.tsx
//
// Stage 4d.3, step 12 — the review list. A modal over the app (the Sync panel is too
// narrow for a list). It shows every note that needs a decision, with search, kind
// filter, sort, selection and the safe bulk actions. Presentational: the rules live in
// reviewList.ts (pure), the sequencing in reviewBulkRun.ts (pure), the commits in
// reviewBulkLive.ts. Rows are read-only for now; the per-note review screens are step 13.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listReviewCandidates, type ReviewCandidateList } from "@/features/sync/lib/reviewCandidatesLive";
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
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT_COMPACT, ROW_HOVER } from "@/features/sync/components/SyncRow";

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
  open: boolean;
  onClose: () => void;
}

export function ReviewListModal({ open, onClose }: Props) {
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

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listReviewCandidates();
      setList(result);
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

  useEffect(() => {
    if (!open) return;
    setPhase({ kind: "list" });
    setReviewing(null);
    void load();
  }, [open, load]);

  const busy = phase.kind === "preparing" || phase.kind === "running";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Keep Esc from also reaching the Settings modal underneath (it listens on window).
      e.stopPropagation();
      if (busy || reviewBusy) return;
      e.preventDefault();
      if (reviewing) setReviewing(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, busy, reviewBusy, reviewing, onClose]);

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

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
      <div
        role="dialog"
        aria-label="Notes that need review"
        className={`flex flex-col ${reviewing ? "w-[920px]" : "w-[640px]"} max-w-[92vw] max-h-[80vh] rounded-lg border border-idemora-border bg-idemora-bg-secondary shadow-xl text-sm`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border">
          <h2 className="font-medium text-idemora-text-normal">
            Needs review{list ? ` (${candidates.length})` : ""}
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void load()}
              disabled={loading || busy}
              className={BTN_GHOST}
            >
              {loading ? "Checking…" : "Refresh"}
            </button>
            <button
              onClick={onClose}
              disabled={busy || reviewBusy}
              className={BTN_GHOST}
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {reviewing && (reviewing.kind === "deleted_here" || reviewing.kind === "purged_elsewhere") && (
            <DeleteReview
              noteId={reviewing.noteId}
              title={reviewing.title}
              kind={reviewing.kind}
              onBusyChange={setReviewBusy}
              onBack={(changed, resolved) => {
                const clearedId = reviewing.noteId;
                setReviewing(null);
                if (resolved) {
                  setList((l) => (l ? { ...l, candidates: l.candidates.filter((c) => c.noteId !== clearedId) } : l));
                }
                if (changed) void load();
              }}
            />
          )}
          {reviewing && reviewing.kind !== "deleted_here" && reviewing.kind !== "purged_elsewhere" && (
            <WholeNoteReview
              noteId={reviewing.noteId}
              title={reviewing.title}
              kind={reviewing.kind}
              onBusyChange={setReviewBusy}
              onBack={(changed, resolved) => {
                const clearedId = reviewing.noteId;
                setReviewing(null);
                if (resolved) {
                  setList((l) => (l ? { ...l, candidates: l.candidates.filter((c) => c.noteId !== clearedId) } : l));
                }
                if (changed) void load();
              }}
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
                  <button type="button" onClick={onClose} className={`mt-4 ${BTN_SECONDARY}`}>
                    Close
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
        </div>

        {/* Bulk bar */}
        {phase.kind === "list" && !reviewing && selectedVisible.length > 0 && (
          <div className="px-4 py-3 border-t border-idemora-border">
            <p className="text-xs text-idemora-text-muted">{selectedVisible.length} selected</p>
            {availability.options.length > 0 ? (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {availability.options.map((o) => (
                  <button key={o.id} onClick={() => void startBulk(o)} className={BTN_PRIMARY}>
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-idemora-text-muted">{availability.blockedReason}</p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
