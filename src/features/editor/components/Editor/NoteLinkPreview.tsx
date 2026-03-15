// src/features/editor/components/Editor/NoteLinkPreview.tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

interface Heading {
  level: number;
  text: string;
}

interface Props {
  noteId: string;
  title: string;
  content: string | null;
  plaintext: string | null;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
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

export function NoteLinkPreview({
  noteId,
  title,
  content,
  plaintext,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const setActiveNote          = useNoteStore((s) => s.setActiveNote);
  const setPendingScrollHeading = useUIStore((s) => s.setPendingScrollHeading);

  const headings = content ? extractHeadings(content) : [];
  const snippet  = extractSnippet(plaintext);
  const isEmpty  = headings.length === 0 && !snippet;

  const panelWidth  = 280;
  const panelHeight = 220;
  const gap         = 8;

  useEffect(() => {
    const spaceRight = window.innerWidth - anchorRect.right;
    const spaceLeft  = anchorRect.left;

    let left: number;
    if (spaceRight >= panelWidth + gap) {
      left = anchorRect.right + gap;
    } else if (spaceLeft >= panelWidth + gap) {
      left = anchorRect.left - panelWidth - gap;
    } else {
      left = Math.min(anchorRect.right + gap, window.innerWidth - panelWidth - 12);
    }

    let top = anchorRect.top;
    if (top + panelHeight > window.innerHeight - 12) top = window.innerHeight - panelHeight - 12;
    if (top < 12) top = 12;

    setPos({ top, left });
  }, [anchorRect]);

  if (!pos) return null;

  function handleTitleClick() {
    setActiveNote(noteId);
  }

  function handleHeadingClick(headingText: string) {
    setPendingScrollHeading(headingText);
    setActiveNote(noteId);
  }

  return createPortal(
    <div
      ref={ref}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: panelWidth,
        maxHeight: panelHeight,
        zIndex: 9999,
        transformOrigin: "left center",
        animation: "notelink-preview-in 120ms cubic-bezier(0.4,0,0.2,1)",
      }}
      className="flex flex-col rounded-lg shadow-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 overflow-hidden"
    >
      <style>{`
        @keyframes notelink-preview-in {
          from { opacity: 0; transform: scale(0.96) translateX(-4px); }
          to   { opacity: 1; transform: scale(1) translateX(0); }
        }
      `}</style>

      {/* Header — clickable, navigates to note top */}
      <button
        onClick={handleTitleClick}
        className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 shrink-0 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors duration-100 group"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-100">
            {title}
          </p>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-zinc-300 dark:text-zinc-600 group-hover:text-blue-400 shrink-0 transition-colors duration-100">
            <path d="M2 5h6M5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {/* Body — scrollable, headings are clickable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isEmpty ? (
          <p className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-600 italic">No content yet.</p>
        ) : headings.length > 0 ? (
          <ul className="py-1">
            {headings.map((h, i) => (
              <li key={i}>
                <button
                  onClick={() => handleHeadingClick(h.text)}
                  style={{ paddingLeft: `${8 + (h.level - 1) * 10}px` }}
                  className="w-full flex items-center gap-1.5 py-1 pr-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors duration-75 group"
                >
                  <span className="shrink-0 text-[9px] font-bold text-zinc-300 dark:text-zinc-600 uppercase group-hover:text-blue-400 transition-colors duration-75">
                    H{h.level}
                  </span>
                  <span className={`truncate text-xs transition-colors duration-75 group-hover:text-blue-600 dark:group-hover:text-blue-400 ${
                    h.level === 1
                      ? "font-semibold text-zinc-700 dark:text-zinc-200"
                      : h.level === 2
                      ? "font-medium text-zinc-600 dark:text-zinc-300"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}>
                    {h.text}
                  </span>
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 ml-auto text-zinc-200 dark:text-zinc-700 group-hover:text-blue-400 transition-colors duration-75">
                    <path d="M1 4h6M4 1.5l2.5 2.5L4 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-4">
            {snippet}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
        <p className="text-[10px] text-zinc-300 dark:text-zinc-600">
          {headings.length > 0 ? "Click heading to jump there" : "Click title to open note"}
        </p>
      </div>
    </div>,
    document.body
  );
}