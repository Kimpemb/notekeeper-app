// src/features/notes/components/Sidebar/TagsPanel.tsx
import { useMemo } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

function parseTagsFromNote(tags: string | null): string[] {
  if (!tags) return [];
  try { return JSON.parse(tags) as string[]; }
  catch { return []; }
}

export function TagsPanel() {
  const notes        = useNoteStore((s) => s.notes);
  const activeTag    = useUIStore((s) => s.activeTag);
  const setActiveTag = useUIStore((s) => s.setActiveTag);
  const toggleSidebarPanel = useUIStore((s) => s.toggleSidebarPanel);

  // Build a sorted map of tag → note count
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of parseTagsFromNote(note.tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes]);

  function handleTagClick(tag: string) {
    if (activeTag === tag) {
      setActiveTag(null);
    } else {
      setActiveTag(tag);
      // Switch to notes panel so the tag-filtered NoteTree is visible
      toggleSidebarPanel("notes");
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-idemora-bg-secondary">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted shrink-0">
            <path d="M2 3h9M2 6h6M2 9h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">
            Tags
          </span>
          {tagCounts.length > 0 && (
            <span className="text-xs text-idemora-text-faint tabular-nums">{tagCounts.length}</span>
          )}
        </div>
      </div>

      <div className="mx-3 border-t border-idemora-border shrink-0" />

      <div className="flex-1 overflow-y-auto py-2 min-h-0">
        {tagCounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
              <path d="M7 7h10v10H7zM4 4h16v16H4z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <p className="text-xs text-idemora-text-muted">No tags yet</p>
            <p className="text-xs text-idemora-text-faint">Add tags to notes to see them here</p>
          </div>
        ) : (
          <ul className="px-2 space-y-0.5">
            {tagCounts.map(([tag, count]) => {
              const isActive = activeTag === tag;
              return (
                <li key={tag}>
                  <button
                    onClick={() => handleTagClick(tag)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all duration-150 ${
                      isActive
                        ? "bg-blue-500/10 text-blue-400 font-medium"
                        : "text-idemora-text-muted hover:bg-black/6 dark:hover:bg-white/7"
                    }`}
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0 opacity-50">
                      <path d="M1 1h4.5l5.5 5.5-4.5 4.5L1 5.5V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                      <circle cx="3.5" cy="3.5" r="0.8" fill="currentColor"/>
                    </svg>
                    <span className={`flex-1 text-left truncate ${isActive ? "text-blue-400" : "text-idemora-text-normal"}`}>
                      #{tag}
                    </span>
                    <span className="shrink-0 text-[10px] text-idemora-text-faint tabular-nums">
                      {count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}