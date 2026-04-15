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
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2 pt-2 pb-1.5 shrink-0">
        <span className="px-2 text-[10px] font-semibold tracking-widest uppercase text-idemora-text-muted  select-none">
          Tags
        </span>
      </div>

      <div className="mx-2 border-t border-idemora-border shrink-0" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        {tagCounts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-idemora-text-muted text-center select-none">
            No tags yet
          </p>
        ) : (
          <ul className="px-2 space-y-0.5">
            {tagCounts.map(([tag, count]) => {
              const isActive = activeTag === tag;
              return (
                <li key={tag}>
                  <button
                    onClick={() => handleTagClick(tag)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors duration-100 ${
                      isActive
                        ? "bg-idemora-bg-primary  text-idemora-text-normal font-medium"
                        : "text-idemora-text-normal text-idemora-text-muted    "
                    }`}
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0 opacity-50">
                      <path d="M1 1h4.5l5.5 5.5-4.5 4.5L1 5.5V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                      <circle cx="3.5" cy="3.5" r="0.8" fill="currentColor"/>
                    </svg>
                    <span className="flex-1 text-left truncate">#{tag}</span>
                    <span className="shrink-0 text-[10px] text-idemora-text-muted  tabular-nums">
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