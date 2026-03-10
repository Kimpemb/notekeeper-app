// src/components/Editor/VersionHistory.tsx
import { useEffect, useState } from "react";
import { getNoteVersions, restoreNoteVersion } from "@/db/queries";
import { useUIStore } from "@/store/useUIStore";
import { useNoteStore } from "@/store/useNoteStore";
import type { NoteVersion } from "@/types";

interface Props {
  noteId: string;
}

export function VersionHistory({ noteId }: Props) {
  const closeVersionHistory = useUIStore((s) => s.closeVersionHistory);
  const refreshNote         = useNoteStore((s) => s.refreshNote);

  const [versions, setVersions]     = useState<NoteVersion[]>([]);
  const [loading, setLoading]       = useState(true);
  const [restoring, setRestoring]   = useState<string | null>(null);
  const [preview, setPreview]       = useState<NoteVersion | null>(null);

  useEffect(() => {
    setLoading(true);
    getNoteVersions(noteId)
      .then(setVersions)
      .finally(() => setLoading(false));
  }, [noteId]);

  async function handleRestore(version: NoteVersion) {
    const confirmed = window.confirm(
      "Restore this version? Your current content will be saved as a new version first."
    );
    if (!confirmed) return;

    setRestoring(version.id);
    try {
      await restoreNoteVersion(noteId, version.id);
      await refreshNote(noteId);
      closeVersionHistory();
    } catch (err) {
      console.error("[VersionHistory] restore failed:", err);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="
      absolute right-0 top-0 bottom-0 w-72
      flex flex-col
      bg-white dark:bg-zinc-900
      border-l border-zinc-200 dark:border-zinc-800
      shadow-xl z-20
    ">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Version History
        </span>
        <button
          onClick={closeVersionHistory}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1.5 1.5l11 11M12.5 1.5l-11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-xs text-zinc-400 text-center py-8">Loading…</p>
        )}

        {!loading && versions.length === 0 && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center py-8 px-4">
            No versions yet. Versions are saved automatically as you write.
          </p>
        )}

        {!loading && versions.map((v) => (
          <div
            key={v.id}
            onMouseEnter={() => setPreview(v)}
            onMouseLeave={() => setPreview(null)}
            className="
              px-4 py-3 border-b border-zinc-100 dark:border-zinc-800
              hover:bg-zinc-50 dark:hover:bg-zinc-800
              transition-colors duration-75 group
            "
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {formatDate(v.created_at)}
                </p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                  {formatTime(v.created_at)}
                </p>
              </div>

              <button
                onClick={() => handleRestore(v)}
                disabled={restoring === v.id}
                className="
                  text-[11px] px-2.5 py-1 rounded-md
                  bg-zinc-100 dark:bg-zinc-700
                  text-zinc-600 dark:text-zinc-300
                  hover:bg-zinc-200 dark:hover:bg-zinc-600
                  disabled:opacity-50
                  opacity-0 group-hover:opacity-100
                  transition-all duration-100
                "
              >
                {restoring === v.id ? "Restoring…" : "Restore"}
              </button>
            </div>

            {/* Plain text preview on hover */}
            {preview?.id === v.id && v.plaintext && (
              <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-3 leading-relaxed">
                {v.plaintext.slice(0, 200)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}