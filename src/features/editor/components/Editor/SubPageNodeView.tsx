// src/features/editor/components/Editor/SubPageNodeView.tsx
//
// EDITING MODE  — bare input, pre-selected, Enter/blur commits, Escape cancels
// DISPLAY MODE  — Notion-style block row
//   • First click  → TipTap NodeSelection (block highlight)
//   • Second click → navigate into the note (same tab)
//   • Ctrl+click   → navigate into the note (new tab)

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { createNote as dbCreateNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

export function SubPageNodeView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const { noteId, title, mode } = node.attrs as {
    noteId: string | null;
    title: string;
    mode: "editing" | "display";
  };

  const [inputValue, setInputValue] = useState(title);
  const inputRef       = useRef<HTMLInputElement>(null);
  const committedRef   = useRef(false);
  const selectedRef    = useRef(false);
  const resetTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subPageStorage = (editor.storage as unknown as Record<string, unknown>)["subPage"] as
    | { parentNoteId: string; paneId: 1 | 2 }
    | undefined;
  const parentNoteId: string = subPageStorage?.parentNoteId ?? "";
  const paneId: 1 | 2        = subPageStorage?.paneId ?? 1;

  const notes          = useNoteStore((s) => s.notes);
  const setActive      = useNoteStore((s) => s.setActiveNote);
  const expandNode     = useUIStore((s) => s.expandNode);
  const openTab        = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const replaceTab     = useUIStore((s) => s.replaceTab);

  useEffect(() => {
    if (mode !== "editing") return;
    const el = inputRef.current;
    if (!el) return;
    setTimeout(() => { el.focus(); el.select(); }, 30);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset selected state when clicking elsewhere in the editor
  useEffect(() => {
    function handleEditorClick(e: MouseEvent) {
      const wrapper = (e.target as HTMLElement).closest(".subpage-node-wrapper");
      if (!wrapper) {
        selectedRef.current = false;
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      }
    }
    document.addEventListener("mousedown", handleEditorClick);
    return () => document.removeEventListener("mousedown", handleEditorClick);
  }, []);

  async function commit(rawTitle: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    const finalTitle = rawTitle.trim() || title;
    const note = await dbCreateNote({ parent_id: parentNoteId, title: finalTitle });
    useNoteStore.setState((s) => ({ notes: [...s.notes, note] }));
    expandNode(parentNoteId);
    updateAttributes({ noteId: note.id, title: finalTitle, mode: "display" });
  }

  function cancel() {
    if (committedRef.current) return;
    committedRef.current = true;
    deleteNode();
    setTimeout(() => editor.commands.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  { e.preventDefault(); commit(inputValue); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  }

  function navigate(e: React.MouseEvent) {
    if (!noteId) return;
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (isCtrl) {
      paneId === 2 ? openTabInPane2(noteId) : openTab(noteId);
    } else {
      if (paneId === 2) {
        useUIStore.setState((s) => ({
          pane2Tabs: s.pane2Tabs.map((t) =>
            t.id === s.pane2ActiveTabId ? { ...t, noteId } : t
          ),
        }));
      } else {
        setActive(noteId);
        replaceTab(noteId);
      }
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;

    // Ctrl+click always navigates immediately (new tab)
    if (isCtrl) {
      selectedRef.current = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      navigate(e);
      return;
    }

    if (selectedRef.current) {
      // Second click — navigate
      selectedRef.current = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      navigate(e);
    } else {
      // First click — select
      selectedRef.current = true;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        selectedRef.current = false;
      }, 1500);
    }
  }

  const liveTitle = noteId
    ? (notes.find((n) => n.id === noteId)?.title ?? title)
    : title;

  return (
    <NodeViewWrapper className="subpage-node-wrapper my-0.5">
      {mode === "editing" ? (
        // ── EDITING ─────────────────────────────────────────────────────────
        <div className="flex items-center gap-2.5 px-1 py-1.5 rounded-md">
          <PageIcon className="text-zinc-400 dark:text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => commit(inputValue)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Untitled"
            className="flex-1 bg-transparent outline-none border-none text-base text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 caret-zinc-800 dark:caret-zinc-200"
          />
        </div>
      ) : (
        // ── DISPLAY ─────────────────────────────────────────────────────────
        <div
          className="group flex items-center gap-2.5 px-1 py-1.5 rounded-md w-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100 cursor-default"
          onClick={handleClick}
          title="Click to select · Click again to open · Ctrl+click for new tab"
        >
          <PageIcon className="text-zinc-400 dark:text-zinc-500 shrink-0" />
          <span className="flex-1 text-base text-zinc-700 dark:text-zinc-300 select-none">
            {liveTitle}
          </span>
        </div>
      )}
    </NodeViewWrapper>
  );
}

function PageIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
      />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}