// src/features/editor/components/Editor/BlockRefSuggest.tsx

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { searchBlocks, type BlockSearchResult } from "@/features/notes/db/queries";

interface Props {
  position: { top: number; left: number };
  editor: Editor;
  query: string;
  triggerStart: number;
  onClose: () => void;
}

const VISIBLE_COUNT = 6;

export function BlockRefSuggest({ position, editor, query, triggerStart, onClose }: Props) {
  const menuRef  = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const notes        = useNoteStore((s) => s.notes);

  const [results,  setResults]  = useState<BlockSearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // ── Search ───────────────────────────────────────────────────────────────

  useEffect(() => {
    setSelected(0);
    setExpanded(false);

    if (!query.trim()) {
      // No query — walk note JSON directly from store, no blockId required
      const recent: BlockSearchResult[] = [];
      for (const note of notes) {
        if (note.id === activeNoteId) continue;
        if (!note.content) continue;
        try {
          const doc = JSON.parse(note.content);
          walkBlocks(doc, note.id, note.title, recent);
        } catch { /**/ }
        if (recent.length >= 20) break;
      }
      setResults(recent.slice(0, 20));
      return;
    }

    // Query — search via SQLite FTS, results already have correct matched line as plaintext
    searchBlocks(query, activeNoteId ?? "").then(setResults).catch(() => setResults([]));
  }, [query, activeNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible   = expanded ? results : results.slice(0, VISIBLE_COUNT);
  const remaining = results.length - VISIBLE_COUNT;
  const hasMore   = !expanded && remaining > 0;

  // ── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setSelected((s) => Math.min(s + 1, visible.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); e.stopPropagation(); setSelected((s) => Math.max(s - 1, 0)); return; }
      if (e.key === "Enter")     { e.preventDefault(); e.stopPropagation(); if (visible[selected]) insert(visible[selected]); return; }
      if (e.key === "Escape")    { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [visible, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // ── Insert ───────────────────────────────────────────────────────────────

  function insert(result: BlockSearchResult) {
    const to = editor.state.selection.from;
    editor
      .chain()
      .focus()
      .deleteRange({ from: triggerStart, to })
      .insertContent({
        type: "blockRef",
        attrs: {
          sourceNoteId: result.noteId,
          blockId:      result.blockId,
          snapshot:     result.plaintext.slice(0, 300),
        },
      })
      .run();
    onClose();
  }

  const flip = position.top + 340 > window.innerHeight;

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: Math.min(position.left, window.innerWidth - 300),
        ...(flip
          ? { bottom: window.innerHeight - position.top + 4 }
          : { top: position.top + 4 }),
        zIndex: 50,
      }}
      className="w-[300px] rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl"
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
        <BlockIcon className="text-indigo-400 shrink-0" />
        <span className="text-xs text-zinc-400">
          Embed block{query && <span className="ml-1 text-zinc-500 font-medium">"{query}"</span>}
        </span>
      </div>

      {/* List */}
      <ul className="py-1 max-h-72 overflow-y-auto">
        {visible.length === 0 && (
          <li className="px-4 py-4 text-sm text-zinc-400 text-center">
            {query ? "No matching blocks" : "No blocks found"}
          </li>
        )}
        {visible.map((result, i) => (
          <li
            key={`${result.noteId}-${result.blockId}`}
            ref={(el) => { itemRefs.current[i] = el; }}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => { e.preventDefault(); insert(result); }}
            className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors duration-75 ${
              i === selected
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            }`}
          >
            <span className="mt-0.5 w-6 h-6 flex items-center justify-center rounded shrink-0 bg-indigo-50 dark:bg-indigo-950 text-indigo-400 dark:text-indigo-500">
              <BlockTypeIcon type={result.blockType} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-800 dark:text-zinc-200 line-clamp-2 leading-snug">
                {result.plaintext || <span className="italic text-zinc-400">(empty)</span>}
              </p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5 truncate">
                {result.noteTitle}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {hasMore && (
        <button
          onMouseDown={(e) => { e.preventDefault(); setExpanded(true); }}
          className="w-full px-3 py-2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-800 transition-colors duration-75 text-left"
        >
          ··· {remaining} more {remaining === 1 ? "block" : "blocks"}
        </button>
      )}
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function BlockIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={className}>
      <rect x="1" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M3 4h5M3 6.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

function BlockTypeIcon({ type }: { type: string }) {
  if (type.startsWith("heading")) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 3v6M2 6h8M10 3v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    );
  }
  if (type === "bulletList" || type === "listItem") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="2.5" cy="4" r="1" fill="currentColor"/>
        <circle cx="2.5" cy="8" r="1" fill="currentColor"/>
        <path d="M5 4h5M5 8h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    );
  }
  if (type === "codeBlock") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M4 3L1 6l3 3M8 3l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

interface TipTapNode { type: string; attrs?: Record<string, unknown>; content?: TipTapNode[]; text?: string; }

function walkBlocks(doc: TipTapNode, noteId: string, noteTitle: string, out: BlockSearchResult[]) {
  if (!doc.content) return;
  for (const node of doc.content) {
    const plaintext = extractText(node);
    if (!plaintext.trim()) continue;
    const blockId = (node.attrs?.blockId as string | undefined) ?? `${noteId}-${out.length}`;
    out.push({ noteId, noteTitle, blockId, blockType: node.type, plaintext });
  }
}

function extractText(node: TipTapNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(extractText).join("");
}