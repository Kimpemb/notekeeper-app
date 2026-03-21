import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { Editor } from "@tiptap/react";

interface Props { editor: Editor | null; paneId: 1 | 2; }

function formatEdited(updatedAt: number | string | null | undefined): string {
  if (updatedAt == null) return "";
  const date = new Date(updatedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Edited just now";
  if (diffMins < 60) return `Edited ${diffMins} min ago`;
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  if (date >= todayStart) return `Edited today at ${time}`;
  if (date >= yesterdayStart) return `Edited yesterday at ${time}`;
  const diffDays = Math.floor((todayStart.getTime() - date.getTime()) / 86_400_000);
  if (diffDays < 7) return `Edited ${diffDays} day(s) ago at ${time}`;
  return `Edited ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export function StatusBar({ editor, paneId }: Props) {
  const saveStatus          = useUIStore((s) => s.saveStatus);
  const openVersionHistory  = useUIStore((s) => s.openVersionHistory);
  const closeVersionHistory = useUIStore((s) => s.closeVersionHistory);
  const versionHistoryOpen  = useUIStore((s) => s.versionHistoryOpen);
  const activeNote          = useNoteStore((s) => s.activeNote());

  const wordCount  = editor ? editor.getText().split(/\s+/).filter((w) => w.length > 0).length : 0;
  const charCount  = editor ? editor.getText().length : 0;
  const editedLabel = formatEdited(activeNote?.updated_at);
  const isVHOpen   = versionHistoryOpen(paneId);

  return (
    <div className="flex items-center justify-between px-6 py-1.5 shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-[11px] text-zinc-400 dark:text-zinc-500 select-none">
      <div className="flex items-center gap-3">
        <span>{wordCount} {wordCount === 1 ? "word" : "words"}</span>
        <span className="text-zinc-300 dark:text-zinc-700">·</span>
        <span>{charCount} {charCount === 1 ? "char" : "chars"}</span>
        {editedLabel && (
          <>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>{editedLabel}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className={`flex items-center gap-1.5 transition-opacity duration-200 ${saveStatus === "idle" ? "opacity-0" : "opacity-100"}`}>
          {saveStatus === "saving" && (<><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Saving…</>)}
          {saveStatus === "saved"  && (<><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Saved</>)}
          {saveStatus === "error"  && (<><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Save failed</>)}
        </span>
        {activeNote && (
          <button
            onClick={() => isVHOpen ? closeVersionHistory(paneId) : openVersionHistory(paneId)}
            className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-100"
            title="Version history"
          >
            History
          </button>
        )}
      </div>
    </div>
  );
}