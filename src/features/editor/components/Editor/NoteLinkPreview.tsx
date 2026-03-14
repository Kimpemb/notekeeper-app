// src/features/editor/components/Editor/NoteLinkPreview.tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Heading {
  level: number;
  text: string;
}

interface Props {
  title: string;
  content: string | null;
  plaintext: string | null;
  anchorRect: DOMRect;
}

function extractHeadings(content: string): Heading[] {
  try {
    const doc = JSON.parse(content);
    const headings: Heading[] = [];
    function walk(nodes: any[]) {
      if (!nodes) return;
      for (const node of nodes) {
        if (node.type === "heading" && node.attrs?.level) {
          const text = (node.content ?? [])
            .filter((n: any) => n.type === "text")
            .map((n: any) => n.text ?? "")
            .join("").trim();
          if (text) headings.push({ level: node.attrs.level, text });
        }
        if (node.content) walk(node.content);
      }
    }
    walk(doc.content ?? []);
    return headings;
  } catch {
    return [];
  }
}

function extractSnippet(plaintext: string | null): string {
  if (!plaintext) return "";
  const lines = plaintext.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 3).join(" ").slice(0, 160);
}

export function NoteLinkPreview({ title, content, plaintext, anchorRect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; flipUp: boolean } | null>(null);

  const headings = content ? extractHeadings(content) : [];
  const snippet  = extractSnippet(plaintext);
  const isEmpty  = headings.length === 0 && !snippet;

  useEffect(() => {
    const panelHeight = 220;
    const panelWidth  = 280;
    const gap         = 8;
    const spaceBelow  = window.innerHeight - anchorRect.bottom;
    const spaceAbove  = anchorRect.top;
    const flipUp      = spaceBelow < panelHeight + gap && spaceAbove > panelHeight + gap;

    let top  = flipUp ? anchorRect.top - panelHeight - gap : anchorRect.bottom + gap;
    let left = anchorRect.left;

    // Keep within horizontal bounds
    if (left + panelWidth > window.innerWidth - 12) {
      left = window.innerWidth - panelWidth - 12;
    }
    if (left < 12) left = 12;

    setPos({ top, left, flipUp });
  }, [anchorRect]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: 280,
        maxHeight: 220,
        zIndex: 9999,
        transformOrigin: pos.flipUp ? "bottom left" : "top left",
        animation: "notelink-preview-in 120ms cubic-bezier(0.4,0,0.2,1)",
      }}
      className="flex flex-col rounded-lg shadow-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 overflow-hidden"
    >
      <style>{`
        @keyframes notelink-preview-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate">{title}</p>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 min-h-0">
        {isEmpty ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-600 italic">No content yet.</p>
        ) : headings.length > 0 ? (
          headings.map((h, i) => (
            <div
              key={i}
              style={{ paddingLeft: `${(h.level - 1) * 10}px` }}
              className="flex items-center gap-1.5 min-w-0"
            >
              <span className="shrink-0 text-[9px] font-bold text-zinc-300 dark:text-zinc-600 uppercase">
                H{h.level}
              </span>
              <span className={`truncate text-xs ${h.level === 1 ? "font-semibold text-zinc-700 dark:text-zinc-200" : h.level === 2 ? "font-medium text-zinc-600 dark:text-zinc-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                {h.text}
              </span>
            </div>
          ))
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-4">
            {snippet}
          </p>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
        <p className="text-[10px] text-zinc-300 dark:text-zinc-600">Click to open note</p>
      </div>
    </div>,
    document.body
  );
}