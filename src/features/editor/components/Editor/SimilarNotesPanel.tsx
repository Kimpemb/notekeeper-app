// src/features/editor/components/Editor/SimilarNotesPanel.tsx

import { useEffect, useState, useCallback, useRef } from "react";
import {
  getSimilarNotes,
  recordSuggestionFeedback,
  type SimilarNote,
} from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

interface Props { noteId: string; paneId: 1 | 2; }

export function SimilarNotesPanel({ noteId, paneId }: Props) {
  const [results, setResults]   = useState<SimilarNote[]>([]);
  const [loading, setLoading]   = useState(true);
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [linking, setLinking]   = useState<string | null>(null);

  // ── Dismissed IDs survive store-triggered re-loads ────────────────────────
  // When "Link →" is clicked the editor autosaves → notes store updates →
  // load() re-runs before syncBacklinks has written the new backlink to the DB.
  // Without this ref the card reappears on that intermediate reload.
  const dismissedRef = useRef<Set<string>>(new Set());

  const notes         = useNoteStore((s) => s.notes);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const closeSimilar  = useUIStore((s) => s.closeSimilar);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const similar = await getSimilarNotes(noteId, notes);
      // Filter out anything already dismissed this session
      setResults(similar.filter((r) => !dismissedRef.current.has(r.id)));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [noteId, notes]);

  useEffect(() => { load(); }, [load]);

  // Reset dismissed set when switching notes
  useEffect(() => {
    dismissedRef.current = new Set();
  }, [noteId]);

  async function handleLink(note: SimilarNote) {
    setLinking(note.id);
    try {
      // Dispatch insert-link event — Editor/index.tsx handles insertion.
      // Passes noteId + noteTitle so the editor can insert a proper noteLink
      // node rather than raw [[text]].
      window.dispatchEvent(
        new CustomEvent("idemora:insert-link", {
          detail: { noteId: note.id, noteTitle: note.title },
        })
      );
      await recordSuggestionFeedback(noteId, note.id, "accepted");
      // Mark dismissed before the DB write triggers a store reload
      dismissedRef.current.add(note.id);
      setResults((prev) => prev.filter((r) => r.id !== note.id));
    } catch (err) { console.error(err); }
    finally { setLinking(null); }
  }

  async function handleIgnore(note: SimilarNote) {
    setIgnoring(note.id);
    try {
      await recordSuggestionFeedback(noteId, note.id, "ignored");
      dismissedRef.current.add(note.id);
      setResults((prev) => prev.filter((r) => r.id !== note.id));
    } catch (err) { console.error(err); }
    finally { setIgnoring(null); }
  }

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-indigo-500 dark:text-indigo-400">
              <circle cx="3" cy="10" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="10" cy="10" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="6.5" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4.6 8.8L5.8 4.6M8.4 8.8L7.2 4.6M4.7 10h3.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Similar</span>
          {!loading && results.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 tabular-nums">
              {results.length}
            </span>
          )}
        </div>
        <button
          onClick={() => closeSimilar(paneId)}
          className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto pt-6">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-xs text-zinc-400 animate-pulse">Loading…</span>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-zinc-300 dark:text-zinc-600">
                <circle cx="6" cy="17" r="3" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="17" cy="17" r="3" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="11" cy="5" r="3" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M9 7.5L7.2 14.5M13 7.5L14.8 14.5M8.5 17h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No similar notes</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 leading-relaxed">
                Add tags or expand your note's title to surface connections.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-2">
            {results.some((r) => r.confidence === "Strong") && (
              <div>
                <SectionLabel
                  label="Strong"
                  count={results.filter((r) => r.confidence === "Strong").length}
                />
                <div className="px-3 pb-2 space-y-1.5">
                  {results
                    .filter((r) => r.confidence === "Strong")
                    .map((note) => (
                      <SimilarNoteCard
                        key={note.id}
                        note={note}
                        linking={linking === note.id}
                        ignoring={ignoring === note.id}
                        onNavigate={() => setActiveNote(note.id)}
                        onLink={() => handleLink(note)}
                        onIgnore={() => handleIgnore(note)}
                      />
                    ))}
                </div>
              </div>
            )}

            {results.some((r) => r.confidence === "Strong") &&
              results.some((r) => r.confidence === "Possible") && (
              <div className="mx-4 border-t border-zinc-100 dark:border-zinc-800 my-1" />
            )}

            {results.some((r) => r.confidence === "Possible") && (
              <div>
                <SectionLabel
                  label="Possible"
                  count={results.filter((r) => r.confidence === "Possible").length}
                />
                <div className="px-3 pb-2 space-y-1.5">
                  {results
                    .filter((r) => r.confidence === "Possible")
                    .map((note) => (
                      <SimilarNoteCard
                        key={note.id}
                        note={note}
                        linking={linking === note.id}
                        ignoring={ignoring === note.id}
                        onNavigate={() => setActiveNote(note.id)}
                        onLink={() => handleLink(note)}
                        onIgnore={() => handleIgnore(note)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
        {label}
      </span>
      <span className="text-[10px] text-zinc-300 dark:text-zinc-700 tabular-nums">{count}</span>
    </div>
  );
}

function SimilarNoteCard({
  note, linking, ignoring, onNavigate, onLink, onIgnore,
}: {
  note: SimilarNote;
  linking: boolean;
  ignoring: boolean;
  onNavigate: () => void;
  onLink: () => void;
  onIgnore: () => void;
}) {
  const busy = linking || ignoring;

  return (
    <div className="rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <button
        onClick={onNavigate}
        className="w-full flex items-center gap-2.5 px-3 pt-2.5 pb-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100 group"
      >
        <div className="w-6 h-6 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center shrink-0 group-hover:border-indigo-200 dark:group-hover:border-indigo-800 transition-colors duration-150">
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none" className="text-zinc-400 dark:text-zinc-500 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors duration-150">
            <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M4 6h5M4 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate flex-1 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors duration-150">
          {note.title}
        </p>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-300 dark:text-zinc-700 group-hover:text-indigo-400 shrink-0 transition-all duration-150 group-hover:translate-x-0.5">
          <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {note.sharedTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-1.5">
          {note.sharedTags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {note.sharedKeywords.length > 0 && (
        <p className="px-3 pb-2 text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
          {note.sharedKeywords.join(", ")}
        </p>
      )}

      <div className="flex items-center gap-1.5 px-3 pb-2.5">
        <button
          onClick={onLink}
          disabled={busy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {linking ? (
            <span className="animate-pulse">Linking…</span>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M6 1h3v3M9 1L5.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Link →
            </>
          )}
        </button>

        <button
          onClick={onIgnore}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ignoring ? (
            <span className="animate-pulse">…</span>
          ) : (
            <>
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              Ignore
            </>
          )}
        </button>
      </div>
    </div>
  );
}