// src/features/editor/components/Editor/NoteLinkView.tsx
import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { NoteLinkPreview } from "./NoteLinkPreview";

interface ContextMenuPos { x: number; y: number; flip: boolean; }

export function NoteLinkView({ node, editor, getPos }: NodeViewProps) {
  const { id, label } = node.attrs as { id: string; label: string };
  const notes         = useNoteStore((s) => s.notes);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const setPendingScrollHeading = useUIStore((s) => s.setPendingScrollHeading);

  const note      = notes.find((n) => n.id === id);
  const liveTitle = note?.title ?? label;
  const exists    = !!note;

  const [preview, setPreview]         = useState<DOMRect | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuPos | null>(null);
  const hoverTimer                    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer                    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pillRef                       = useRef<HTMLSpanElement>(null);
  const menuRef                       = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

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

  const handleLeave = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    leaveTimer.current = setTimeout(() => setPreview(null), 150);
  }, []);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (exists) {
      setPendingScrollHeading(null);
      setActiveNote(id);
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    // Close hover preview if open
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setPreview(null);
    const flip = window.innerHeight - e.clientY < 80;
    setContextMenu({ x: e.clientX, y: e.clientY, flip });
  }

  function handleUnlink() {
  setContextMenu(null);
  if (typeof getPos !== "function") return;
  const pos = getPos();
  if (pos === undefined) return;
  const nodeSize = node.nodeSize;
  editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + nodeSize })
    .insertContentAt(pos, { type: "text", text: liveTitle })
    .run();
}

  function handleNavigate() {
    setContextMenu(null);
    if (exists) {
      setPendingScrollHeading(null);
      setActiveNote(id);
    }
  }

  return (
    <NodeViewWrapper as="span" className="inline" contentEditable={false}>
      <span
        ref={pillRef}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
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

      {/* Hover preview */}
      {preview && note && (
        <NoteLinkPreview
          noteId={id}
          title={liveTitle}
          content={note.content ?? null}
          plaintext={note.plaintext ?? null}
          anchorRect={preview}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: contextMenu.x,
            ...(contextMenu.flip
              ? { bottom: window.innerHeight - contextMenu.y }
              : { top: contextMenu.y }),
            zIndex: 9999,
            minWidth: 180,
          }}
          className="py-1 rounded-lg shadow-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        >
          {/* Navigate */}
          {exists && (
            <button
              onMouseDown={(e) => { e.preventDefault(); handleNavigate(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors duration-75"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
                <path d="M9 4H5a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M7 2h4v4M11 2L6.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Open note
            </button>
          )}

          {exists && <div className="mx-3 border-t border-zinc-100 dark:border-zinc-700" />}

          {/* Unlink */}
          <button
            onMouseDown={(e) => { e.preventDefault(); handleUnlink(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors duration-75"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0">
              <path d="M5 8l-3 3M8 5l3-3M4.5 4.5l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M2.5 6.5A2.5 2.5 0 016 3l1-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M10.5 6.5A2.5 2.5 0 017 10l-1 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Unlink
          </button>
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}