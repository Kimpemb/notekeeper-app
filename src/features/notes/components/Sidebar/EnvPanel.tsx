// src/features/notes/components/Sidebar/EnvPanel.tsx
import React from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

export function EnvPanel() {
  const notes         = useNoteStore((s) => s.notes);
  const setRagExcluded = useNoteStore((s) => s.setRagExcluded);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const replaceTab    = useUIStore((s) => s.replaceTab);
  const replacePane2Tab = useUIStore((s) => s.replacePane2Tab);
  const activePaneId  = useUIStore((s) => s.activePaneId);

  const excluded = notes.filter((n) => n.rag_excluded === 1 && !n.deleted_at);

  function computeBreadcrumb(noteId: string): string {
    const MAX_DEPTH = 20;
    const parts: string[] = [];
    let current = notes.find((n) => n.id === noteId);
    let depth = 0;
    while (current?.parent_id && depth < MAX_DEPTH) {
      const parent = notes.find((n) => n.id === current!.parent_id);
      if (!parent) break;
      parts.unshift(parent.title);
      current = parent;
      depth++;
    }
    return parts.join(" / ");
  }

  function handleOpen(noteId: string) {
    if (activePaneId === 2) {
      replacePane2Tab(noteId);
    } else {
      setActiveNote(noteId);
      replaceTab(noteId);
    }
  }

  function handleRemove(e: React.MouseEvent, noteId: string) {
    e.stopPropagation();
    setRagExcluded(noteId, false).catch(console.error);
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-center gap-2 px-2 pt-0 pb-0 shrink-0">
        <p className="text-[11px] text-idemora-text-faint select-none py-2">
          Notes excluded from search
        </p>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 min-h-0">
        {excluded.length === 0 ? (
          <p className="px-4 py-6 text-xs text-idemora-text-muted text-center select-none leading-relaxed">
            No notes excluded from search.{" "}
            <span className="text-idemora-text-faint">
              Right-click any note and select &lsquo;Exclude from search&rsquo; to add it here.
            </span>
          </p>
        ) : (
          <ul className="px-2 space-y-0.5">
            {excluded.map((note) => {
              const breadcrumb = computeBreadcrumb(note.id);
              return (
                <li key={note.id}>
                  <div
                    className="group flex items-start gap-2 px-2 py-2.5 rounded-md hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 cursor-pointer"
                    onClick={() => handleOpen(note.id)}
                  >
                    {/* Lock icon */}
                    <svg
                      width="14" height="14" viewBox="0 0 14 14" fill="none"
                      className="shrink-0 text-idemora-text-muted mt-0.5"
                    >
                      <rect x="2.5" y="6" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                    </svg>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-idemora-text-normal truncate leading-snug">
                        {note.title}
                      </p>
                      {breadcrumb && (
                        <p className="text-[10px] mt-0.5 text-idemora-text-faint truncate">
                          {breadcrumb}
                        </p>
                      )}
                    </div>

                    {/* Remove button — hover only */}
                    <button
                      onClick={(e) => handleRemove(e, note.id)}
                      title="Remove from .env"
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-100 w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] shrink-0"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}