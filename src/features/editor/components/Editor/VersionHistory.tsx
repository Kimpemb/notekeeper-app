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
  }, [versions, selectedIndex, closeVersionHistory, paneId]);

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
    <div className="absolute right-0 top-0 bottom-0 w-80 flex flex-col bg-idemora-bg-secondary border-l border-idemora-border shadow-xl z-20">
      {/* Header - matches OutlinePanel */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted shrink-0">
            <path d="M2 3h9M2 6h6M2 9h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">Version History</span>
          {!loading && versions.length > 0 && (
            <span className="text-xs text-idemora-text-faint tabular-nums">{versions.length}</span>
          )}
        </div>
        <button
          onClick={() => closeVersionHistory(paneId)}
          className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body - matches OutlinePanel list styling */}
      <div ref={containerRef} className="flex-1 overflow-y-auto py-2" onScroll={handleScroll}>
        {loading && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <p className="text-xs text-idemora-text-muted">Loading versions…</p>
          </div>
        )}
        {!loading && versions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
              <path d="M4 4h16v16H4zM8 8h8M8 12h6M8 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <p className="text-xs text-idemora-text-muted">No versions yet.</p>
            <p className="text-xs text-idemora-text-faint">Versions are saved automatically as you write.</p>
          </div>
        )}
        {!loading && versions.map((version, idx) => (
          <div
            key={version.id}
            ref={(el) => { itemRefs.current[idx] = el; }}
            onMouseEnter={() => handleMouseEnter(version, idx)}
            onMouseLeave={() => setPreview(null)}
            onClick={() => handleRestore(version)}
            className={`
  mx-2 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150
  ${selectedIndex === idx ? "bg-blue-500/10" : ""}
`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${selectedIndex === idx ? "text-blue-400" : "text-idemora-text-normal"}`}>
                  {formatDate(version.created_at)}
                </p>
                <p className="text-xs text-idemora-text-muted mt-0.5">{formatTime(version.created_at)}</p>
                {(selectedIndex === idx || preview?.id === version.id) && version.plaintext && (
                  <p className="mt-2 text-xs text-idemora-text-muted line-clamp-2 leading-relaxed pt-2 border-t border-idemora-border">
                    {version.plaintext.slice(0, 120)}{version.plaintext.length > 120 && "…"}
                  </p>
                )}
              </div>
              {selectedIndex === idx && (
                <kbd className="text-xs text-idemora-text-faint bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono shrink-0 mt-1">↵</kbd>
              )}
            </div>
            {(selectedIndex === idx || preview?.id === version.id) && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={(e) => { e.stopPropagation(); handleRestore(version); }}
                  disabled={restoring === version.id}
                  className="text-xs px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors duration-100"
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