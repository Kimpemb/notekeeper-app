// src/features/graph/GraphSubPageNodeView.tsx
import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { createNote as dbCreateNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

// No custom props — ReactNodeViewRenderer only passes ReactNodeViewProps.
// The callbacks are read from editor.storage["subPage"] which is populated
// by createGraphSubPageNode's addStorage() when the extension is registered.
export function GraphSubPageNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
}: NodeViewProps) {
  const { noteId, title, mode } = node.attrs as {
    noteId: string | null;
    title: string;
    mode: "editing" | "display";
  };

  // Read callbacks from storage — set by createGraphSubPageNode's addStorage()
  const storage = (editor.storage as unknown as Record<string, unknown>)["subPage"] as {
    onOpenInEditor:   (noteId: string) => void;
    onNavigateToNode: (noteId: string) => void;
    parentNoteId: string;
    paneId: 1 | 2;
  } | undefined;

  const [inputValue, setInputValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);

  const notes      = useNoteStore((s) => s.notes);
  const expandNode = useUIStore((s) => s.expandNode);

  // Focus input when entering editing mode
  useEffect(() => {
    if (mode === "editing" && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [mode]);

  async function commit(rawTitle: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    const parentNoteId = storage?.parentNoteId ?? "";
    const finalTitle   = rawTitle.trim() || title;
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
    if (e.key === "Enter") { e.preventDefault(); commit(inputValue); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  }

  function handleClick(e: React.MouseEvent) {
    if (!noteId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) {
      storage?.onNavigateToNode(noteId);
    } else {
      storage?.onOpenInEditor(noteId);
    }
  }

  const liveTitle = noteId
    ? (notes.find((n) => n.id === noteId)?.title ?? title)
    : title;

  return (
    <NodeViewWrapper className="graph-subpage-node my-0.5">
      {mode === "editing" ? (
        <div className="flex items-center gap-2.5 px-1 py-1.5 rounded-md">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-zinc-400 shrink-0">
            <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => commit(inputValue)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Untitled"
            className="flex-1 bg-transparent outline-none text-sm text-zinc-200 placeholder-zinc-500"
          />
        </div>
      ) : (
        <div
          onClick={handleClick}
          className="flex items-center gap-2.5 px-1 py-1.5 rounded-md cursor-pointer hover:bg-indigo-500/10 transition-colors duration-100"
          title={noteId ? "Click to open in editor · Shift+Click to focus in graph" : ""}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-zinc-400 shrink-0">
            <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
          <span className="flex-1 text-sm text-zinc-300 select-none">
            {liveTitle}
          </span>
        </div>
      )}
    </NodeViewWrapper>
  );
}