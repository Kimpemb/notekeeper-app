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
  paneId: 1 | 2;
}

function extractHeadings(editor: Editor): HeadingItem[] {
  const headings: HeadingItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.attrs.level <= 3) {
      headings.push({ level: node.attrs.level as 1 | 2 | 3, text: node.textContent, pos });
    }
  });
  return headings;
}

function getScrollContainer(editor: Editor): HTMLElement | null {
  let el: HTMLElement | null = editor.view.dom as HTMLElement;
  while (el) {
    const overflow = window.getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

function scrollToHeading(editor: Editor, pos: number) {
  editor.commands.setTextSelection(pos + 1);
  const domNode = editor.view.nodeDOM(pos);
  const el = domNode instanceof HTMLElement ? domNode : (domNode as Node)?.parentElement;
  if (!el) return;
  const scrollContainer = getScrollContainer(editor);
  if (!scrollContainer) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  scrollContainer.scrollTo({
    top: scrollContainer.scrollTop + (elRect.top - containerRect.top) - 80,
    behavior: "smooth",
  });
}

const indentClass: Record<1 | 2 | 3, string> = { 1: "pl-3", 2: "pl-6", 3: "pl-9" };
const levelStyle: Record<1 | 2 | 3, string> = {
  1: "text-sm font-semibold",
  2: "text-xs font-medium",
  3: "text-xs font-normal",
};
const dotSize: Record<1 | 2 | 3, string> = {
  1: "w-1.5 h-1.5",
  2: "w-1 h-1",
  3: "w-1 h-1",
};

export function OutlinePanel({ editor, paneId }: Props) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
  const closeOutline = useUIStore((s) => s.closeOutline);

  const refresh = useCallback(() => setHeadings(extractHeadings(editor)), [editor]);

  useEffect(() => {
    refresh();
    editor.on("update", refresh);
    return () => { editor.off("update", refresh); };
  }, [editor, refresh]);

  useEffect(() => {
    const scrollContainer = getScrollContainer(editor);
    if (!scrollContainer) return;

    function onScroll() {
      const containerRect = scrollContainer!.getBoundingClientRect();
      let best: number | null = null;
      for (const h of headings) {
        const domNode = editor.view.nodeDOM(h.pos);
        const el = domNode instanceof HTMLElement ? domNode : (domNode as Node)?.parentElement;
        if (!el) continue;
        if (el.getBoundingClientRect().top - containerRect.top <= 120) best = h.pos;
      }
      setActivePos(best);
    }

    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [editor, headings]);

  return (
    <div className="flex flex-col h-full w-56 shrink-0 border-l border-idemora-border bg-idemora-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted shrink-0">
            <path d="M2 3h9M2 6h6M2 9h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">Outline</span>
          {headings.length > 0 && (
            <span className="text-xs text-idemora-text-faint tabular-nums">{headings.length}</span>
          )}
        </div>
        <button
          onClick={() => closeOutline(paneId)}
          className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted
            hover:bg-black/[0.06] dark:hover:bg-white/[0.07]
            transition-colors duration-100"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2">
        {headings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
              <path d="M4 6h16M4 10h10M4 14h12M4 18h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <p className="text-xs text-idemora-text-muted">No headings yet.</p>
            <p className="text-xs text-idemora-text-faint">
              Type{" "}
              <kbd className="font-mono px-1 py-0.5 rounded bg-idemora-bg-primary text-idemora-text-muted">
                /h1
              </kbd>{" "}
              to add one.
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
                    className={[
                      "w-full flex items-center gap-2 py-2 pr-3 text-left rounded-r-lg transition-colors duration-150",
                      indentClass[h.level],
                      isActive
                        ? "bg-blue-500/10 text-blue-400"
                        : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        dotSize[h.level],
                        "rounded-full shrink-0",
                        isActive
                          ? "bg-blue-400"
                          : h.level === 1
                          ? "bg-idemora-text-normal"
                          : h.level === 2
                          ? "bg-idemora-text-muted"
                          : "bg-idemora-text-faint",
                      ].join(" ")}
                    />
                    <span
                      className={[
                        "truncate leading-snug",
                        levelStyle[h.level],
                        isActive ? "text-blue-400" : "text-idemora-text-muted",
                      ].join(" ")}
                    >
                      {h.text || <span className="italic text-idemora-text-faint">Untitled</span>}
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