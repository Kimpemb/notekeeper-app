// src/features/editor/components/Editor/BlockRefNodeView.tsx

import { useEffect, useRef, useState, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { listen } from "@tauri-apps/api/event";
import { getNoteById } from "@/features/notes/db/queries";
import { useUIStore } from "@/features/ui/store/useUIStore";

interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
}

function extractPlaintext(node: TipTapNode): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(extractPlaintext).join(" ").trim();
}

function findBlockById(node: TipTapNode, blockId: string): TipTapNode | null {
  if (!node.content) return null;
  for (const child of node.content) {
    if (child.attrs?.blockId === blockId) return child;
    const found = findBlockById(child, blockId);
    if (found) return found;
  }
  return null;
}

export function BlockRefNodeView({ node, deleteNode }: NodeViewProps) {
  const { sourceNoteId, blockId, snapshot } = node.attrs as {
    sourceNoteId: string;
    blockId: string;
    snapshot: string;
  };

  // Snapshot is the source of truth — always display it, only upgrade if blockId resolves
  const [text, setText]         = useState<string>(snapshot || "");
  const [sourceTitle, setTitle] = useState<string>("");
  const [missing, setMissing]   = useState(false);
  const [hovered, setHovered]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const wrapRef                 = useRef<HTMLDivElement>(null);

  const openTab        = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const note = await getNoteById(sourceNoteId);
      if (!note) {
        setMissing(true);
        // Keep snapshot — don't overwrite with anything worse
        setLoading(false);
        return;
      }

      setTitle(note.title);
      setMissing(false);

      // Only try to refine the text if we have a blockId to look up.
      // If found, use the live block text. If not found, keep snapshot as-is.
      if (blockId && !blockId.includes("-fts")) {
        try {
          const doc: TipTapNode = JSON.parse(note.content);
          const byId = findBlockById(doc, blockId);
          if (byId) {
            const t = extractPlaintext(byId).trim();
            if (t) setText(t);
          }
          // No match — snapshot stays, which is correct
        } catch { /* JSON parse failed — snapshot stays */ }
      }
      // blockId is a fts fallback key like "noteId-fts" — snapshot is already correct
    } catch {
      // Network/DB error — snapshot stays
    } finally {
      setLoading(false);
    }
  }, [sourceNoteId, blockId, snapshot]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ blockId: string; plaintext: string }>("block-updated", (event) => {
      if (event.payload.blockId === blockId) setText(event.payload.plaintext);
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [blockId]);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (missing) return;
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;
    useUIStore.getState().setPendingScrollQuery(`blockId:${blockId}`);
    if (isCtrl) { openTabInPane2(sourceNoteId); } else { openTab(sourceNoteId); }
  }

  return (
    <NodeViewWrapper>
      <div
        ref={wrapRef}
        data-block-ref-id={blockId}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleClick}
        title={missing ? "Source deleted" : `From: ${sourceTitle} · Click to open · Ctrl+click for new tab`}
        className={[
          "group relative my-1.5 px-3 py-2.5 rounded-lg border transition-all duration-100 cursor-pointer select-none",
          missing
            ? "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 opacity-60"
            : "border-indigo-100 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/30 hover:border-indigo-200 dark:hover:border-indigo-800 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/50",
        ].join(" ")}
      >
        {/* Left accent bar */}
        <div className={[
          "absolute left-0 top-2 bottom-2 w-0.5 rounded-full",
          missing ? "bg-zinc-300 dark:bg-zinc-600" : "bg-indigo-300 dark:bg-indigo-700",
        ].join(" ")} />

        {/* Content */}
        <div className="pl-2 pr-16">
          {loading ? (
            <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
          ) : (
            <p className={[
              "text-sm leading-relaxed line-clamp-3",
              missing
                ? "text-zinc-400 dark:text-zinc-500 italic"
                : "text-zinc-700 dark:text-zinc-300",
            ].join(" ")}>
              {text || snapshot || "(empty block)"}
            </p>
          )}
        </div>

        {/* Source label */}
        <div className={[
          "absolute right-7 top-1/2 -translate-y-1/2 flex items-center gap-1 transition-opacity duration-100",
          hovered ? "opacity-100" : "opacity-0",
        ].join(" ")}>
          {missing ? (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
              deleted
            </span>
          ) : (
            <>
              <span className="text-[10px] text-indigo-400 dark:text-indigo-500 max-w-24 truncate">
                {sourceTitle}
              </span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-indigo-400 dark:text-indigo-500 shrink-0">
                <path d="M2 8L8 2M8 2H4M8 2v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </>
          )}
        </div>

        {/* Delete button */}
        {hovered && (
          <button
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); deleteNode(); }}
            title="Remove block reference"
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 flex items-center justify-center shadow-sm transition-colors duration-75"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}