// src/components/Editor/NoteLinkView.tsx
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useNoteStore } from "@/store/useNoteStore";

export function NoteLinkView({ node }: NodeViewProps) {
  const { id, label } = node.attrs as { id: string; label: string };
  const notes         = useNoteStore((s) => s.notes);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  // Always show the live title from the store — stays accurate if the note is renamed
  const liveTitle = notes.find((n) => n.id === id)?.title ?? label;
  const exists    = notes.some((n) => n.id === id);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (exists) setActiveNote(id);
  }

  return (
    <NodeViewWrapper
      as="span"
      className="inline"
      contentEditable={false}
    >
      <span
        onClick={handleClick}
        title={exists ? `Go to: ${liveTitle}` : "Note not found"}
        className={`
          inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded
          text-xs font-medium cursor-pointer select-none
          transition-colors duration-100
          ${exists
            ? `bg-blue-50 text-blue-700 hover:bg-blue-100
               dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900
               border border-blue-200 dark:border-blue-800`
            : `bg-zinc-100 text-zinc-400 hover:bg-zinc-200
               dark:bg-zinc-800 dark:text-zinc-500
               border border-zinc-200 dark:border-zinc-700
               line-through`
          }
        `}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 opacity-70">
          <path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M6 1h3v3M9 1L5.5 4.5"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {liveTitle}
      </span>
    </NodeViewWrapper>
  );
}