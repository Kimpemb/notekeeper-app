// src/features/editor/components/Editor/OutlinePanel.tsx
import { useEffect, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { useUIStore } from "@/features/ui/store/useUIStore";

interface HeadingItem {
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

interface Props {
  editor: Editor;
}

function extractHeadings(editor: Editor): HeadingItem[] {
  const headings: HeadingItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.attrs.level <= 3) {
      headings.push({
        level: node.attrs.level as 1 | 2 | 3,
        text: node.textContent,
        pos,
      });
    }
  });
  return headings;
}

function getScrollContainer(editor: Editor): HTMLElement | null {
  // Walk UP from the editor DOM root to find the first scrollable ancestor
  let el: HTMLElement | null = editor.view.dom as HTMLElement;
  while (el) {
    const overflow = window.getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

function scrollToHeading(editor: Editor, pos: number) {
  // Move cursor to heading so it registers as active
  editor.commands.setTextSelection(pos + 1);

  const domNode = editor.view.nodeDOM(pos);
  const el = domNode instanceof HTMLElement
    ? domNode
    : (domNode as Node)?.parentElement;
  if (!el) return;

  const scrollContainer = getScrollContainer(editor);
  if (!scrollContainer) return;

  // Calculate position of heading relative to the scroll container
  const containerRect = scrollContainer.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  // Current scroll + heading's offset from container top - 80px padding
  const targetScrollTop = scrollContainer.scrollTop + (elRect.top - containerRect.top) - 80;

  scrollContainer.scrollTo({ top: targetScrollTop, behavior: "smooth" });
}

const indentClass: Record<1 | 2 | 3, string> = {
  1: "pl-3",
  2: "pl-6",
  3: "pl-9",
};

const levelStyle: Record<1 | 2 | 3, string> = {
  1: "text-sm font-semibold text-zinc-700 dark:text-zinc-300",
  2: "text-xs font-medium text-zinc-600 dark:text-zinc-400",
  3: "text-xs font-normal text-zinc-500 dark:text-zinc-500",
};

const dotStyle: Record<1 | 2 | 3, string> = {
  1: "w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 shrink-0",
  2: "w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600 shrink-0",
  3: "w-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-700 shrink-0",
};

export function OutlinePanel({ editor }: Props) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
  const closeOutline = useUIStore((s) => s.closeOutline);

  const refresh = useCallback(() => {
    setHeadings(extractHeadings(editor));
  }, [editor]);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    editor.on("update", handler);
    return () => { editor.off("update", handler); };
  }, [editor, refresh]);

  // Track active heading based on scroll position
  useEffect(() => {
    const scrollContainer = getScrollContainer(editor);
    if (!scrollContainer) return;

    function onScroll() {
      const containerRect = scrollContainer!.getBoundingClientRect();
      let best: number | null = null;
      for (const h of headings) {
        const domNode = editor.view.nodeDOM(h.pos);
        const el = domNode instanceof HTMLElement
          ? domNode
          : (domNode as Node)?.parentElement;
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        // Heading is considered "active" once it's scrolled within 120px of the top
        if (rect.top - containerRect.top <= 120) {
          best = h.pos;
        }
      }
      setActivePos(best);
    }

    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [editor, headings]);

  return (
    <div className="flex flex-col h-full w-56 shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-zinc-400 shrink-0">
            <path d="M2 3h9M2 6h6M2 9h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">Outline</span>
          {headings.length > 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-600 tabular-nums">{headings.length}</span>
          )}
        </div>
        <button
          onClick={closeOutline}
          className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-100"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Heading list */}
      <div className="flex-1 overflow-y-auto py-2">
        {headings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-zinc-300 dark:text-zinc-700">
              <path d="M4 6h16M4 10h10M4 14h12M4 18h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">No headings yet.</p>
            <p className="text-xs text-zinc-300 dark:text-zinc-700">
              Type <kbd className="font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">/h1</kbd> to add one.
            </p>
          </div>
        ) : (
          <ul>
            {headings.map((h, i) => {
              const isActive = h.pos === activePos;
              return (
                <li key={`${h.pos}-${i}`}>
                  <button
                    onClick={() => scrollToHeading(editor, h.pos)}
                    className={`
                      w-full flex items-center gap-2 py-1.5 pr-3 text-left
                      transition-colors duration-75 group
                      ${indentClass[h.level]}
                      ${isActive
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }
                    `}
                  >
                    <span className={dotStyle[h.level]} />
                    <span className={`
                      truncate leading-snug
                      ${levelStyle[h.level]}
                      ${isActive ? "text-zinc-900 dark:text-zinc-100" : ""}
                      group-hover:text-zinc-900 dark:group-hover:text-zinc-100
                      transition-colors duration-75
                    `}>
                      {h.text || <span className="italic opacity-40">Untitled</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}