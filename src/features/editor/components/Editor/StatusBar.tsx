// src/features/editor/components/Editor/StatusBar.tsx

import { useEffect } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor | null;
  paneId: 1 | 2;
}

/**
 * Physics-based timestamp formatter
 */
function formatEdited(updatedAt: number | string | null | undefined): string {
  if (updatedAt == null) return "";

  const date = new Date(updatedAt);
  const now = new Date();

  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "Edited just now";
  if (diffMins < 60) return `Edited ${diffMins} min ago`;

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date >= today) return `Edited today at ${time}`;
  if (date >= yesterday) return `Edited yesterday at ${time}`;

  const diffDays = Math.floor(
    (today.getTime() - date.getTime()) / 86_400_000
  );

  if (diffDays < 7) return `Edited ${diffDays} day(s) ago at ${time}`;

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Dual-layer trajectory (dark + light trail)
 */
function Trajectory({
  direction,
  color,
  glow,
}: {
  direction: "left" | "right";
  color: string;
  glow: string;
}) {
  const d =
    direction === "left"
      ? "M0 8 C 45 8, 70 8, 100 28"
      : "M0 28 C 30 8, 55 8, 100 8";

  return (
    <>
      {/* LIGHT TRAIL (energy / motion blur) */}
      <svg
        className="absolute left-0 bottom-0 w-full h-6 pointer-events-none opacity-60"
        preserveAspectRatio="none"
      >
        <path
          d={d}
          stroke={glow}
          strokeWidth="3"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* MAIN TRAJECTORY (solid physics line) */}
      <svg
        className="absolute left-0 bottom-0 w-full h-6 pointer-events-none"
        preserveAspectRatio="none"
      >
        <path
          d={d}
          stroke={color}
          strokeWidth="1"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </>
  );
}

export function StatusBar({ editor, paneId }: Props) {
  const saveStatus = useUIStore((s) => s.saveStatus);
  const refreshStatus = useUIStore((s) => s.refreshStatus);
  const setRefreshStatus = useUIStore((s) => s.setRefreshStatus);

  const openVersionHistory = useUIStore((s) => s.openVersionHistory);
  const closeVersionHistory = useUIStore((s) => s.closeVersionHistory);
  const versionHistoryOpen = useUIStore((s) => s.versionHistoryOpen);

  const activeNote = useNoteStore((s) => s.activeNote());
  const showWordCount = useAppSettings((s) => s.settings.showWordCount);

  const wordCount = editor
    ? editor.getText().split(/\s+/).filter(Boolean).length
    : 0;

  const charCount = editor ? editor.getText().length : 0;

  const editedLabel = formatEdited(activeNote?.updated_at);
  const isVHOpen = versionHistoryOpen(paneId);

  useEffect(() => {
    if (refreshStatus !== "reloaded") return;
    const t = setTimeout(() => setRefreshStatus("idle"), 2000);
    return () => clearTimeout(t);
  }, [refreshStatus, setRefreshStatus]);

  const showRefresh = refreshStatus !== "idle";
  const showSave = saveStatus !== "idle" && !showRefresh;

  return (
    <div className="flex items-center justify-between px-6 py-1.5 shrink-0 text-[11px] text-idemora-text-muted select-none">

      {/* LEFT BLOCK */}
      <div className="relative flex items-center gap-3">
        <Trajectory
          direction="left"
          color="rgb(148 163 184)"      // border color
          glow="rgb(203 213 225)"       // lighter trail
        />

        <div className="relative z-10 flex items-center gap-3">
          {showWordCount && (
            <>
              <span>
                {wordCount} {wordCount === 1 ? "word" : "words"}
              </span>
              <span className="text-idemora-text-faint">·</span>
              <span>
                {charCount} {charCount === 1 ? "char" : "chars"}
              </span>
            </>
          )}

          {editedLabel && (
            <>
              {showWordCount && (
                <span className="text-idemora-text-faint">·</span>
              )}
              <span>{editedLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* GAP */}
      <div className="flex-1" />

      {/* RIGHT BLOCK */}
      <div className="relative flex items-center gap-4">
        <Trajectory
          direction="right"
          color="rgb(148 163 184)"
          glow="rgb(203 213 225)"
        />

        <span
          className={`relative z-10 flex items-center gap-1.5 transition-opacity duration-200 ${
            showRefresh || showSave ? "opacity-100" : "opacity-0"
          }`}
        >
          {showRefresh && refreshStatus === "reloading" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Reloading…
            </>
          )}

          {showRefresh && refreshStatus === "reloaded" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Reloaded
            </>
          )}

          {showSave && saveStatus === "saving" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Saving…
            </>
          )}

          {showSave && saveStatus === "saved" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Saved
            </>
          )}

          {showSave && saveStatus === "error" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Save failed
            </>
          )}
        </span>

        {activeNote && (
          <button
            onClick={() =>
              isVHOpen
                ? closeVersionHistory(paneId)
                : openVersionHistory(paneId)
            }
            className="relative z-10 hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] px-2 py-0.5 rounded transition-colors duration-100"
          >
            History
          </button>
        )}
      </div>
    </div>
  );
}