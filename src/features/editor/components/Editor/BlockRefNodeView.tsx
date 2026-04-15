// src/features/editor/components/Editor/BlockRefNodeView.tsx

import { useEffect, useRef, useState, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { listen } from "@tauri-apps/api/event";
import { getNoteById } from "@/features/notes/db/queries";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

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

// ── Block type icon ───────────────────────────────────────────────────────────
function BlockTypeIcon({ blockType, verified }: { blockType: string; verified: boolean }) {
  const cls = verified
    ? "text-indigo-400"
    : "text-amber-400";

  if (blockType.startsWith("heading")) {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={cls}>
        <path d="M1.5 2v7M1.5 5.5h8M9.5 2v7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    );
  }
  if (blockType === "bulletList" || blockType === "listItem") {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={cls}>
        <circle cx="2" cy="3.5" r="0.9" fill="currentColor"/>
        <circle cx="2" cy="7.5" r="0.9" fill="currentColor"/>
        <path d="M4 3.5h5.5M4 7.5h5.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      </svg>
    );
  }
  if (blockType === "codeBlock") {
    return (
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={cls}>
        <path d="M3.5 3L1 5.5l2.5 2.5M7.5 3L10 5.5 7.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className={cls}>
      <path d="M1.5 3h8M1.5 5.5h8M1.5 8h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

export function BlockRefNodeView({ node, deleteNode }: NodeViewProps) {
  const { sourceNoteId, blockId, snapshot } = node.attrs as {
    sourceNoteId: string;
    blockId: string;
    snapshot: string;
  };

  const isFtsKey = blockId?.includes("-fts");

  const [text, setText]           = useState<string>(snapshot || "");
  const [sourceTitle, setTitle]   = useState<string>("");
  const [blockType, setBlockType] = useState<string>("paragraph");
  const [missing, setMissing]     = useState(false);
  const [verified, setVerified]   = useState(!isFtsKey);
  const [hovered, setHovered]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const wrapRef                   = useRef<HTMLDivElement>(null);

  const openTab        = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const note = await getNoteById(sourceNoteId);
      if (!note) {
        setMissing(true);
        setVerified(false);
        setLoading(false);
        return;
      }

      setTitle(note.title);
      setMissing(false);

      if (!isFtsKey) {
        try {
          const doc: TipTapNode = JSON.parse(note.content);
          const byId = findBlockById(doc, blockId);
          if (byId) {
            const t = extractPlaintext(byId).trim();
            if (t) { setText(t); setVerified(true); setBlockType(byId.type); }
            else setVerified(false);
          } else {
            setText(snapshot);
            setVerified(false);
          }
        } catch {
          setText(snapshot);
          setVerified(false);
        }
      } else {
        setText(snapshot);
        setVerified(false);
      }
    } catch {
      setText(snapshot);
    } finally {
      setLoading(false);
    }
  }, [sourceNoteId, blockId, isFtsKey, snapshot]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{
      noteId: string;
      blocks: { blockId: string; plaintext: string }[];
    }>("blocks-updated", (event) => {
      const match = event.payload.blocks.find((b) => b.blockId === blockId);
      if (match) {
        setText(match.plaintext);
        setVerified(true);
      }
    }).then((fn) => { unlisten = fn; }).catch(() => {});

    return () => { unlisten?.(); };
  }, [blockId]);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (missing) return;
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;
    const inStore = useNoteStore.getState().notes.some((n) => n.id === sourceNoteId);
    if (!inStore) { setMissing(true); return; }
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
        title={
          missing
            ? "Source note deleted"
            : !verified
            ? `From: ${sourceTitle} · Approximate match · Click to open`
            : `From: ${sourceTitle} · Click to open · Ctrl+click for new tab`
        }
        className={[
          "group relative my-1.5 px-3 py-1.5 rounded-lg border transition-all duration-100 cursor-pointer select-none",
          missing
            ? "border-idemora-border bg-idemora-bg-primary opacity-60"
            : "border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 dark:bg-indigo-950/30 dark:hover:bg-indigo-950/50",
        ].join(" ")}
      >
        {/* Left accent bar — dashed when unverified */}
        <div
          className={[
            "absolute left-0 top-2 bottom-2 w-0.5 rounded-full",
            missing
              ? "bg-idemora-border"
              : verified
              ? "bg-indigo-400"
              : "bg-indigo-500/50",
          ].join(" ")}
          style={!verified && !missing ? { backgroundImage: "repeating-linear-gradient(to bottom, currentColor 0px, currentColor 3px, transparent 3px, transparent 6px)" } : undefined}
        />

        {/* Content row — block type icon + text */}
        <div className="pl-2 pr-4 flex items-start gap-2">
          {!loading && !missing && (
            <span className="mt-0.5 shrink-0">
              <BlockTypeIcon blockType={blockType} verified={verified} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="h-4 w-32 rounded bg-idemora-bg-secondary animate-pulse" />
            ) : (
              <>
                <p className={[
                  "text-sm leading-relaxed line-clamp-3",
                  missing
                    ? "text-idemora-text-muted italic"
                    : "text-idemora-text-normal",
                ].join(" ")}>
                  {text || snapshot || "(empty block)"}
                </p>
                {!missing && sourceTitle && (
                  <p className="mt-1 flex items-center gap-1">
                    <span className={[
                      "text-[10px] truncate max-w-40",
                      verified
                        ? "text-indigo-400/70"
                        : "text-amber-400/70",
                    ].join(" ")}>
                      {sourceTitle}
                    </span>
                    {!verified && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-px rounded">
                        ~approx
                      </span>
                    )}
                  </p>
                )}
                {missing && (
                  <p className="mt-1 text-[10px] text-idemora-text-faint italic">
                    source deleted
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Hover arrow */}
        <div className={[
          "absolute right-3 top-1/2 -translate-y-1/2 transition-opacity duration-100",
          hovered && !missing ? "opacity-100" : "opacity-0",
        ].join(" ")}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-indigo-400">
            <path d="M2 8L8 2M8 2H4M8 2v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Delete button */}
        <button
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); deleteNode(); }}
          title="Remove block reference"
          className={[
            "absolute top-1.5 right-1.5 w-4 h-4 rounded flex items-center justify-center transition-all duration-100",
            "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary",
            hovered ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </NodeViewWrapper>
  );
}