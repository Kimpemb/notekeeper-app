// src/features/sync/components/BackupsModal.tsx
//
// Stage 4d.3, step 14.2c (part 3) — the Backups screen. A modal listing every note
// that has a backup; picking a note shows its backups, newest first; picking a
// backup and one of its versions offers two actions:
//   Restore as a new note   the safe default (new id, nothing is overwritten)
//   Replace this note       overwrites title and text after saving a backup of the
//                           current version; needs a second click to confirm
// Presentational: wording comes from recoverView.ts (pure, tested); the reads and
// the commit are in backupsLive.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { loadBackupsOverview, runRecover, type BackupNote, type BackupsOverview } from "@/features/sync/lib/backupsLive";
import type { RecoverSide } from "@/features/sync/lib/recoverPlan";
import type { RecoverOutcomeText } from "@/features/sync/lib/recoverView";
import { CloseNoteButton } from "@/features/sync/components/CloseNoteButton";
import type { CloseText } from "@/features/sync/lib/closeNoteText";

type Overview = Extract<BackupsOverview, { ok: true }>;

const TONE_CLASS: Record<RecoverOutcomeText["tone"], string> = {
  success: "text-green-600",
  info: "text-idemora-text-normal",
  warning: "text-amber-600",
  error: "text-red-500",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function BackupsModal({ open, onClose }: Props) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    else setLoadError(r.message);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setNoteId(null);
    setBackupId(null);
    setResult(null);
    setConfirming(false);
    setText("");
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || running) return;
      e.preventDefault();
      if (noteId) goBack();
      else onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // goBack only touches state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, running, noteId, onClose]);

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

  if (!open) return null;

  const backup = note?.group.backups.find((b) => b.id === backupId);
  const sideView = backup?.sides.find((s) => s.side === side) ?? backup?.sides[0];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
      <div
        role="dialog"
        aria-label="Backups"
        className="flex flex-col w-[640px] max-w-[92vw] max-h-[80vh] rounded-lg border border-idemora-border bg-idemora-bg-secondary shadow-xl text-sm"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border">
          <h2 className="font-medium text-idemora-text-normal">Backups</h2>
          <div className="flex items-center gap-3">
            {!note && (
              <button
                onClick={() => void load()}
                disabled={loading}
                className="text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-50"
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
            )}
            <button
              onClick={onClose}
              disabled={running}
              className="text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loadError && <p className="text-red-500">{loadError}</p>}

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
                className="mt-2 w-full px-2 py-1 rounded border border-idemora-border bg-idemora-bg-secondary"
              />
              {loading && !overview && <p className="mt-3 text-idemora-text-muted">Loading…</p>}
              {overview && overview.notes.length === 0 && <p className="mt-3 text-idemora-text-muted">There are no backups yet.</p>}
              {overview && overview.notes.length > 0 && notes.length === 0 && (
                <p className="mt-3 text-idemora-text-muted">No notes match the search.</p>
              )}
              <ul className="mt-2 divide-y divide-idemora-border">
                {notes.map((n) => (
                  <li key={n.noteId} className="py-2">
                    <button
                      onClick={() => setNoteId(n.noteId)}
                      className="block max-w-full truncate text-left text-idemora-text-normal hover:underline"
                    >
                      {n.title}
                    </button>
                    <p className="text-xs text-idemora-text-muted">
                      {n.group.backups.length} {n.group.backups.length === 1 ? "backup" : "backups"} · latest{" "}
                      {new Date(n.group.latest).toLocaleString()}
                      {n.exists ? "" : " · note no longer on this device"}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* One note's backups */}
          {note && !result && (
            <div>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-idemora-text-normal truncate">{note.title}</h3>
                <button
                  onClick={goBack}
                  disabled={running}
                  className="underline text-idemora-text-muted hover:text-idemora-text-normal disabled:opacity-50"
                >
                  Back to the list
                </button>
              </div>
              {closeMsg && <p className={`mt-2 ${TONE_CLASS[closeMsg.tone]}`}>{closeMsg.text}</p>}
              {!note.exists && (
                <p className="mt-2 text-xs text-idemora-text-muted">
                  This note is no longer on this device, so a backup can only be restored as a new note.
                </p>
              )}

              <ul className="mt-2 space-y-2">
                {note.group.backups.map((b) => {
                  const picked = b.id === backupId;
                  return (
                    <li key={b.id} className={`rounded border p-2 ${picked ? "border-blue-500" : "border-idemora-border"}`}>
                      <button
                        onClick={() => pickBackup(b.id, b.sides[0].side)}
                        disabled={running}
                        className="block w-full text-left"
                      >
                        <span className="text-idemora-text-normal">{b.kindLabel}</span>
                        <span className="block text-xs text-idemora-text-muted">{new Date(b.createdAt).toLocaleString()}</span>
                      </button>

                      {picked && (
                        <div className="mt-2">
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
                            <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-idemora-text-normal">
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
                            <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-idemora-text-normal">
                              This replaces the title and text of "{note.title}" with the chosen version. The current version is saved as a
                              backup first. The note's folder, order and tags are not changed.
                            </p>
                          )}

                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <button
                              onClick={() => void run("as_new")}
                              disabled={running}
                              className="px-2 py-1 rounded text-white bg-blue-500 disabled:opacity-50"
                            >
                              {running ? "Working…" : "Restore as a new note"}
                            </button>
                            {note.exists && (
                              <button
                                onClick={() => (confirming ? void run("replace") : setConfirming(true))}
                                disabled={running}
                                className={`px-2 py-1 rounded border disabled:opacity-50 ${
                                  confirming ? "bg-red-600 text-white border-red-600" : "border-idemora-border text-idemora-text-normal"
                                }`}
                              >
                                {confirming ? "Yes: replace this note" : "Replace this note's content"}
                              </button>
                            )}
                            {confirming && !running && (
                              <button
                                onClick={() => setConfirming(false)}
                                className="underline text-idemora-text-muted hover:text-idemora-text-normal"
                              >
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
              <h3 className="font-medium text-idemora-text-normal truncate">{note.title}</h3>
              <p className={`mt-2 ${TONE_CLASS[result.tone]}`}>{result.text}</p>
              {result.notes.length > 0 && (
                <ul className="mt-2 text-xs text-idemora-text-muted list-disc pl-4">
                  {result.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              {result.closeNote && (
                <CloseNoteButton noteId={note.noteId} context="backups" onClosed={afterClose} />
              )}
              <div className="mt-3">
                <button onClick={goBack} className="underline text-idemora-text-muted hover:text-idemora-text-normal">
                  Back to the list
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
