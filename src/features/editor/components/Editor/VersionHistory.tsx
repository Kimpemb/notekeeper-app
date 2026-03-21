import { useEffect, useState, useRef } from "react";
import { getNoteVersions, restoreNoteVersion } from "@/features/notes/db/queries";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { NoteVersion } from "@/types";

interface Props { noteId: string; paneId: 1 | 2; }

export function VersionHistory({ noteId, paneId }: Props) {
  const closeVersionHistory = useUIStore((s) => s.closeVersionHistory);
  const refreshNote         = useNoteStore((s) => s.refreshNote);

  const [versions, setVersions]           = useState<NoteVersion[]>([]);
  const [loading, setLoading]             = useState(true);
  const [restoring, setRestoring]         = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview]             = useState<NoteVersion | null>(null);

  const containerRef  = useRef<HTMLDivElement>(null);
  const itemRefs      = useRef<(HTMLDivElement | null)[]>([]);
  const isScrolling   = useRef(false);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLoading(true);
    getNoteVersions(noteId).then(setVersions).finally(() => setLoading(false));
  }, [noteId]);

  useEffect(() => { setSelectedIndex(0); setPreview(null); }, [versions]);

  useEffect(() => {
    if (selectedIndex >= 0 && versions.length > 0) {
      isScrolling.current = true;
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setTimeout(() => { isScrolling.current = false; }, 200);
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!versions.length) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape")    { e.preventDefault(); closeVersionHistory(paneId); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((p) => Math.min(p + 1, versions.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSelectedIndex((p) => Math.max(p - 1, 0)); }
      if (e.key === "Enter" && selectedIndex >= 0) { e.preventDefault(); handleRestore(versions[selectedIndex]); }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [versions, selectedIndex, closeVersionHistory, paneId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRestore(version: NoteVersion) {
    const confirmed = window.confirm("Restore this version? Your current content will be saved as a new version first.");
    if (!confirmed) return;
    setRestoring(version.id);
    try {
      await restoreNoteVersion(noteId, version.id);
      await refreshNote(noteId);
      closeVersionHistory(paneId);
    } catch (err) { console.error("[VersionHistory] restore failed:", err); }
    finally { setRestoring(null); }
  }

  const handleScroll = () => {
    isScrolling.current = true;
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => { isScrolling.current = false; }, 150);
  };

  const handleMouseEnter = (version: NoteVersion, idx: number) => {
    if (!isScrolling.current) { setSelectedIndex(idx); setPreview(version); }
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-xl z-20">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Version History</span>
        <div className="flex items-center gap-2">
          <kbd className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
          <button onClick={() => closeVersionHistory(paneId)} className="text-zinc-400 border border-transparent rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors duration-150 p-1">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 1.5l11 11M12.5 1.5l-11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto py-1.5" onScroll={handleScroll}>
        {loading && <div className="px-4 py-6 text-sm text-zinc-400 text-center">Loading versions…</div>}
        {!loading && versions.length === 0 && (
          <div className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500 text-center">No versions yet. Versions are saved automatically as you write.</div>
        )}
        {!loading && versions.map((version, idx) => (
          <div
            key={version.id}
            ref={(el) => { itemRefs.current[idx] = el; }}
            onMouseEnter={() => handleMouseEnter(version, idx)}
            onMouseLeave={() => setPreview(null)}
            onClick={() => handleRestore(version)}
            className={`px-4 py-3 cursor-pointer transition-colors duration-75 ${selectedIndex === idx ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{formatDate(version.created_at)}</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{formatTime(version.created_at)}</p>
                {(selectedIndex === idx || preview?.id === version.id) && version.plaintext && (
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed border-t border-zinc-100 dark:border-zinc-800 pt-2">
                    {version.plaintext.slice(0, 120)}{version.plaintext.length > 120 && "…"}
                  </p>
                )}
              </div>
              {selectedIndex === idx && (
                <kbd className="text-xs text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded font-mono shrink-0 mt-1">↵</kbd>
              )}
            </div>
            {(selectedIndex === idx || preview?.id === version.id) && (
              <div className="mt-2 flex justify-end">
                <button
                  onClick={(e) => { e.stopPropagation(); handleRestore(version); }}
                  disabled={restoring === version.id}
                  className="text-xs px-2 py-1 rounded-md bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors duration-75"
                >
                  {restoring === version.id ? "Restoring…" : "Restore this version"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}