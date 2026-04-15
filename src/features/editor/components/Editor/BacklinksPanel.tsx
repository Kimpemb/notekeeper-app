import { useEffect, useState, useCallback } from "react";
import {
  getBacklinksForNote,
  getUnlinkedMentions,
  linkFirstMention,
  getNoteById,
  syncBacklinks,
  type UnlinkedMention,
} from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { Note } from "@/types";

interface Props { noteId: string; paneId: 1 | 2; }

function extractNoteLinkIds(content: string): string[] {
  try {
    const doc = JSON.parse(content);
    const ids: string[] = [];
    function walk(nodes: any[]) {
      for (const n of nodes) {
        if (n.type === "noteLink" && n.attrs?.id) ids.push(n.attrs.id);
        if (n.content) walk(n.content);
      }
    }
    walk(doc.content ?? []);
    return [...new Set(ids)];
  } catch { return []; }
}

function highlightMention(snippet: string, targetTitle: string): React.ReactNode {
  const escapedTitle = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedTitle})`, "gi");
  const parts = snippet.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-blue-500/20 text-blue-400 rounded px-0.5 not-italic font-medium">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function BacklinksPanel({ noteId, paneId }: Props) {
  const [backlinks, setBacklinks] = useState<Note[]>([]);
  const [mentions, setMentions]   = useState<UnlinkedMention[]>([]);
  const [loading, setLoading]     = useState(true);
  const [linking, setLinking]     = useState<string | null>(null);

  const notes         = useNoteStore((s) => s.notes);
  const refreshNote   = useNoteStore((s) => s.refreshNote);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const closeBacklinks = useUIStore((s) => s.closeBacklinks);

  const activeNote = notes.find((n) => n.id === noteId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bl, um] = await Promise.all([
        getBacklinksForNote(noteId),
        getUnlinkedMentions(noteId, activeNote?.title ?? ""),
      ]);
      setBacklinks(bl);
      setMentions(um);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [noteId, activeNote?.title]);

  useEffect(() => { load(); }, [load]);

  async function handleLinkIt(mention: UnlinkedMention) {
    if (!activeNote) return;
    setLinking(mention.note.id);
    try {
      await linkFirstMention(mention.note.id, noteId, activeNote.title);
      const updated = await getNoteById(mention.note.id);
      if (updated?.content) {
        const ids = extractNoteLinkIds(updated.content);
        await syncBacklinks(mention.note.id, ids);
      }
      await refreshNote(mention.note.id);
      await load();
    } catch (err) { console.error(err); }
    finally { setLinking(null); }
  }

  const totalCount = backlinks.length + mentions.length;

  return (
    <div className="flex flex-col h-full w-72 shrink-0 border-l border-idemora-border bg-idemora-bg-secondary">
      <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted shrink-0">
            <path d="M9 4H5a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M7 2h4v4M11 2L6.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">Backlinks</span>
          {!loading && totalCount > 0 && (
            <span className="text-xs text-idemora-text-faint tabular-nums">{totalCount}</span>
          )}
        </div>
        <button
          onClick={() => closeBacklinks(paneId)}
          className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted
            hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
            transition-colors duration-100"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-xs text-idemora-text-muted animate-pulse">Loading…</span>
          </div>
        ) : totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
              <path d="M16 7H6a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2v-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M13 2h7v7M20 2l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-xs text-idemora-text-muted">No backlinks yet</p>
            <p className="text-xs text-idemora-text-faint">
              Type{" "}
              <kbd className="font-mono px-1.5 py-0.5 rounded-md bg-idemora-bg-primary text-idemora-text-muted text-[10px]">
                [[
              </kbd>{" "}
              in any note to link here.
            </p>
          </div>
        ) : (
          <div>
            {backlinks.length > 0 && (
              <div>
                <SectionLabel label="Linked" count={backlinks.length} />
                <div className="px-3 pb-2 space-y-1.5">
                  {backlinks.map((note) => (
                    <BacklinkCard key={note.id} note={note} onNavigate={() => setActiveNote(note.id)} />
                  ))}
                </div>
              </div>
            )}
            {backlinks.length > 0 && mentions.length > 0 && (
              <div className="mx-4 border-t border-idemora-border my-1" />
            )}
            {mentions.length > 0 && (
              <div>
                <SectionLabel label="Unlinked mentions" count={mentions.length} />
                <div className="px-3 pb-2 space-y-1.5">
                  {mentions.map((mention) => (
                    <UnlinkedMentionCard
                      key={mention.note.id}
                      mention={mention}
                      targetTitle={activeNote?.title ?? ""}
                      linking={linking === mention.note.id}
                      onNavigate={() => setActiveNote(mention.note.id)}
                      onLinkIt={() => handleLinkIt(mention)}
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

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-idemora-text-muted">
        {label}
      </span>
      <span className="text-[10px] text-idemora-text-faint tabular-nums">{count}</span>
    </div>
  );
}

function BacklinkCard({ note, onNavigate }: { note: Note; onNavigate: () => void }) {
  return (
    <button
      onClick={onNavigate}
      className="w-full text-left rounded-lg border border-idemora-border bg-idemora-bg-primary hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-all duration-150 group overflow-hidden"
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className="w-6 h-6 rounded-md bg-idemora-bg-secondary border border-idemora-border flex items-center justify-center shrink-0 mt-0.5 transition-colors duration-150">
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted group-hover:text-blue-400 transition-colors duration-150">
            <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M4 6h5M4 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-idemora-text-normal truncate group-hover:text-blue-400 transition-colors duration-150">
            {note.title}
          </p>
          {note.plaintext && (
            <p className="text-xs text-idemora-text-muted truncate mt-0.5 leading-relaxed">
              {note.plaintext.slice(0, 80)}
            </p>
          )}
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-idemora-text-muted group-hover:text-blue-400 shrink-0 mt-1 transition-all duration-150 group-hover:translate-x-0.5">
          <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </button>
  );
}

function UnlinkedMentionCard({ mention, targetTitle, linking, onNavigate, onLinkIt }: {
  mention: UnlinkedMention; targetTitle: string; linking: boolean; onNavigate: () => void; onLinkIt: () => void;
}) {
  return (
    <div className="rounded-lg border border-idemora-border bg-idemora-bg-primary overflow-hidden hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-150">
      <button
        onClick={onNavigate}
        className="w-full flex items-center gap-2.5 px-3 pt-2.5 pb-1.5 text-left transition-colors duration-100 group"
      >
        <div className="w-6 h-6 rounded-md bg-idemora-bg-secondary border border-idemora-border flex items-center justify-center shrink-0 transition-colors duration-150">
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted group-hover:text-blue-400 transition-colors duration-150">
            <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M4 6h5M4 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-idemora-text-normal truncate group-hover:text-blue-400 transition-colors duration-150">
            {mention.note.title}
          </p>
        </div>
        {mention.occurrences > 1 && (
          <span className="text-[10px] text-idemora-text-faint tabular-nums shrink-0">{mention.occurrences}×</span>
        )}
      </button>
      <p className="px-3 pb-2 text-xs text-idemora-text-muted leading-relaxed overflow-y-auto max-h-16">
        {highlightMention(mention.snippet, targetTitle)}
      </p>
      <div className="px-3 pb-2.5">
        <button
          onClick={onLinkIt}
          disabled={linking}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {linking ? (
            <span className="animate-pulse">Linking…</span>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M6 1h3v3M9 1L5.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Link it
            </>
          )}
        </button>
      </div>
    </div>
  );
}