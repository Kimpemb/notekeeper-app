// src/features/editor/components/Editor/NoteLinkView.tsx
import { useState, useRef, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { NoteLinkPreview } from "./NoteLinkPreview";

export function NoteLinkView({ node }: NodeViewProps) {
  const { id, label } = node.attrs as { id: string; label: string };
  const notes         = useNoteStore((s) => s.notes);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  const note      = notes.find((n) => n.id === id);
  const liveTitle = note?.title ?? label;
  const exists    = !!note;

  const [preview, setPreview]   = useState<DOMRect | null>(null);
  const hoverTimer              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pillRef                 = useRef<HTMLSpanElement>(null);

  // Shared enter logic — cancels any pending leave, schedules show
  const handleEnter = useCallback(() => {
    if (!exists) return;
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    if (!preview) {
      hoverTimer.current = setTimeout(() => {
        const rect = pillRef.current?.getBoundingClientRect();
        if (rect) setPreview(rect);
      }, 400);
    }
  }, [exists, preview]);

  // Shared leave logic — cancels any pending show, schedules hide
  const handleLeave = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    leaveTimer.current = setTimeout(() => setPreview(null), 150);
  }, []);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (exists) setActiveNote(id);
  }

  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <span
        ref={pillRef}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        title={exists ? `Go to: ${liveTitle}` : "Note not found"}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded text-xs font-medium cursor-pointer select-none transition-colors duration-100 ${
          exists
            ? "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900 border border-blue-200 dark:border-blue-800"
            : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700 line-through"
        }`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 opacity-70">
          <path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M6 1h3v3M9 1L5.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {liveTitle}
      </span>

      {preview && note && (
        <NoteLinkPreview
          title={liveTitle}
          content={note.content ?? null}
          plaintext={note.plaintext ?? null}
          anchorRect={preview}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        />
      )}
    </NodeViewWrapper>
  );
}