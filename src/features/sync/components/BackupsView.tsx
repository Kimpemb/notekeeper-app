// src/features/sync/components/BackupsView.tsx
//
// Stage 4d.3, step 5 (UI/UX refactor), Step B pilot. The Backups screen as a page INSIDE
// Settings > Sync (it replaces BackupsModal, which was a second modal stacked on Settings).
// Navigation: Sync > Backups > one note's backups. One header with a back button on the left;
// there is no Close of its own (Settings has its X). Behaviour is unchanged from BackupsModal:
// a list of notes that have a backup; picking a note shows its backups, newest first; picking
// a backup and one of its versions offers two actions:
//   Restore as a new note   the safe default (new id, nothing is overwritten)
//   Replace this note       overwrites title and text after saving a backup of the
//                           current version; needs a second click to confirm
// Presentational: wording comes from recoverView.ts (pure, tested); the reads and the commit
// are in backupsLive.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadBackupsOverview, runRecover, type BackupNote, type BackupsOverview } from "@/features/sync/lib/backupsLive";
import type { RecoverSide } from "@/features/sync/lib/recoverPlan";
import type { RecoverOutcomeText } from "@/features/sync/lib/recoverView";
import { CloseNoteButton } from "@/features/sync/components/CloseNoteButton";
import { ErrorDetails } from "@/features/sync/components/ErrorDetails";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT_COMPACT,
  ROW_HOVER,
  SubPageHeader,
  SyncIcons,
  SyncRow,
} from "@/features/sync/components/SyncRow";
import type { CloseText } from "@/features/sync/lib/closeNoteText";

type Overview = Extract<BackupsOverview, { ok: true }>;

const TONE_CLASS: Record<RecoverOutcomeText["tone"], string> = {
  success: "text-green-600",
  info: "text-idemora-text-normal",
  warning: "text-amber-600",
  error: "text-red-500",
};

interface Props {
  /** Go back to the main Sync screen. */
  onBack: () => void;
}

export function BackupsView({ onBack }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<{ message: string; details?: string; retryable?: boolean } | null>(null);
  const [text, setText] = useState("");

  const [noteId, setNoteId] = useState<string | null>(null);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [side, setSide] = useState<RecoverSide>("mine");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RecoverOutcomeText | null>(null);
  const [closeMsg, setCloseMsg] = useState<CloseText | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const r = await loadBackupsOverview();
    if (r.ok) setOverview(r);
    else setLoadError({ message: r.message, details: r.details, retryable: r.retryable });
    setLoading(false);
  }, []);

  // The view mounts when the person opens Backups, so this is the "open" load.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Keep Esc from also reaching the Settings modal (it listens on window): here Esc
      // means "back one level", and only on the Sync screen does it close Settings.
      e.stopPropagation();
      if (running) return;
      e.preventDefault();
      if (noteId) goBack();
      else onBack();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // goBack only touches state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, noteId, onBack]);

  const notes = useMemo(() => {
    const all = overview?.notes ?? [];
    const q = text.trim().toLowerCase();
    return q === "" ? all : all.filter((n) => n.title.toLowerCase().includes(q));
  }, [overview, text]);

  const note: BackupNote | undefined = overview?.notes.find((n) => n.noteId === noteId);

  function goBack() {
    const changed = result?.changed ?? false;
    setNoteId(null);
    setBackupId(null);
    setResult(null);
    setConfirming(false);
    setCloseMsg(null);
    if (changed) void load();
  }

  function afterClose(text: CloseText) {
    // Keep the same note and version selected; drop the refusal and reload the overview.
    setResult(null);
    setConfirming(false);
    setCloseMsg(text);
    void load();
  }

  function pickBackup(id: string, firstSide: RecoverSide) {
    setBackupId(id);
    setSide(firstSide);
    setConfirming(false);
  }

  async function run(choice: "as_new" | "replace") {
    if (!overview || !note || !backupId) return;
    setRunning(true);
    try {
      setResult(await runRecover(overview, note, backupId, side, choice));
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }

  const backup = note?.group.backups.find((b) => b.id === backupId);
  const sideView = backup?.sides.find((s) => s.side === side) ?? backup?.sides[0];

  return (
    <div>
      <SubPageHeader
        title={note ? note.title : "Backups"}
        backLabel={note ? "Backups" : "Sync"}
        onBack={note ? goBack : onBack}
        backDisabled={running}
        right={
          !note ? (
            <button onClick={() => void load()} disabled={loading} className={BTN_GHOST}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          ) : null
        }
      />

      {loadError && (
        <div>
          <p className="text-red-500">{loadError.message}</p>
          {loadError.details && <ErrorDetails details={loadError.details} />}
          {loadError.retryable && (
            <button onClick={() => void load()} className={`mt-2 ${BTN_PRIMARY}`}>
              Try again
            </button>
          )}
        </div>
      )}

      {/* Notes list */}
      {!note && !loadError && (
        <>
          <p className="text-xs text-idemora-text-muted">
            A backup is saved before a review changes a note or deletes one. The newest 10 per note are kept for 30 days.
          </p>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search by note title"
            className={`mt-3 w-full ${INPUT_COMPACT}`}
          />
          {loading && !overview && <p className="mt-3 text-idemora-text-muted">Loading…</p>}
          {overview && overview.notes.length === 0 && <p className="mt-3 text-idemora-text-muted">There are no backups yet.</p>}
          {overview && overview.notes.length > 0 && notes.length === 0 && (
            <p className="mt-3 text-idemora-text-muted">No notes match the search.</p>
          )}
          <ul className="mt-3 flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.noteId}>
                <SyncRow
                  icon={SyncIcons.backups}
                  title={n.title}
                  description={`${n.group.backups.length} ${n.group.backups.length === 1 ? "backup" : "backups"} · latest ${new Date(n.group.latest).toLocaleString()}${n.exists ? "" : " · note no longer on this device"}`}
                  chevron
                  onClick={() => setNoteId(n.noteId)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* One note's backups */}
      {note && !result && (
        <div>
          {closeMsg && <p className={`mb-2 ${TONE_CLASS[closeMsg.tone]}`}>{closeMsg.text}</p>}
          {!note.exists && (
            <p className="mb-2 text-xs text-idemora-text-muted">
              This note is no longer on this device, so a backup can only be restored as a new note.
            </p>
          )}

          <ul className="space-y-2">
            {note.group.backups.map((b) => {
              const picked = b.id === backupId;
              return (
                <li key={b.id} className={`rounded-lg border p-3 ${picked ? "border-blue-500 bg-blue-500/5" : "border-idemora-border"}`}>
                  <button
                    onClick={() => pickBackup(b.id, b.sides[0].side)}
                    disabled={running}
                    className={`block w-full rounded text-left transition-colors duration-150 ${ROW_HOVER}`}
                  >
                    <span className="text-idemora-text-normal">{b.kindLabel}</span>
                    <span className="block text-xs text-idemora-text-muted">{new Date(b.createdAt).toLocaleString()}</span>
                  </button>

                  {picked && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-idemora-text-muted">Which version?</p>
                      <ul className="mt-1 space-y-2">
                        {b.sides.map((s) => (
                          <li key={s.side}>
                            <label className="flex items-start gap-2">
                              <input
                                type="radio"
                                name="backup-side"
                                className="mt-1"
                                checked={side === s.side}
                                disabled={running}
                                onChange={() => {
                                  setSide(s.side);
                                  setConfirming(false);
                                }}
                              />
                              <span className="min-w-0">
                                <span className="text-idemora-text-normal">
                                  {s.label}: {s.title}
                                </span>
                                <span className="block text-xs text-idemora-text-muted break-words">{s.preview}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>

                      {sideView && sideView.mediaCount > 0 && (
                        <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-idemora-text-normal">
                          This version has {sideView.mediaCount} image or attachment{" "}
                          {sideView.mediaCount === 1 ? "node" : "nodes"}. Those files are not part of a backup, so they may show as broken.
                        </p>
                      )}
                      {sideView && !sideView.keptMetadata && (
                        <p className="mt-2 text-xs text-idemora-text-muted">
                          This older backup did not keep the note's folder, order or tags. A new note uses defaults.
                        </p>
                      )}

                      {confirming && (
                        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-idemora-text-normal">
                          This replaces the title and text of "{note.title}" with the chosen version. The current version is saved as a
                          backup first. The note's folder, order and tags are not changed.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button onClick={() => void run("as_new")} disabled={running} className={BTN_PRIMARY}>
                          {running ? "Working…" : "Restore as a new note"}
                        </button>
                        {note.exists && (
                          <button
                            onClick={() => (confirming ? void run("replace") : setConfirming(true))}
                            disabled={running}
                            className={
                              confirming
                                ? "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-red-700 disabled:opacity-50"
                                : BTN_SECONDARY
                            }
                          >
                            {confirming ? "Yes: replace this note" : "Replace this note's content"}
                          </button>
                        )}
                        {confirming && !running && (
                          <button onClick={() => setConfirming(false)} className={BTN_GHOST}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Result */}
      {note && result && (
        <div>
          <p className={TONE_CLASS[result.tone]}>{result.text}</p>
          {result.details && <ErrorDetails details={result.details} />}
          {result.notes.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs text-idemora-text-muted">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {result.closeNote && <CloseNoteButton noteId={note.noteId} context="backups" onClosed={afterClose} />}
          <div className="mt-4">
            <button onClick={goBack} className={BTN_SECONDARY}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
