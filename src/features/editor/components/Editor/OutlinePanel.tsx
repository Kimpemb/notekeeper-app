// src/features/editor/components/Editor/OutlinePanel.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { revealPosition } from "./editorUtils";

interface HeadingItem {
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

interface Props {
  editor: Editor | null; // Made nullable for safety
  paneId: 1 | 2;
  noteId: string; // forces refresh on note switch even when setContent is called without emitUpdate: true
}

function extractHeadings(editor: Editor | null): HeadingItem[] {
  // CRITICAL FIX: Guard against null editor or unitialized state
  if (!editor || !editor.state || !editor.state.doc) return [];

  const headings: HeadingItem[] = [];
  try {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.attrs.level <= 3) {
        headings.push({ level: node.attrs.level as 1 | 2 | 3, text: node.textContent, pos });
      }
    });
  } catch (e) {
    console.error("OutlinePanel: Failed to extract headings", e);
  }
  return headings;
}

function getScrollContainer(editor: Editor | null): HTMLElement | null {
  if (!editor || !editor.view || !editor.view.dom) return null;
  
  let el: HTMLElement | null = editor.view.dom as HTMLElement;
  while (el) {
    const overflow = window.getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

function scrollToHeading(editor: Editor | null, pos: number) {
  if (!editor || !editor.view) return;

  // Open any closed toggle that contains this heading first
  // (same helper Find and vault search use).
  const revealed = revealPosition(editor, pos + 1);

  editor.commands.setTextSelection(pos + 1);

  const doScroll = () => {
    if (!editor || !editor.view) return;
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
  };

  // If a toggle was just opened, give it a beat to render before measuring.
  if (revealed) setTimeout(doScroll, 60); else doScroll();
}

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

// An H1 and the H2/H3 headings under it. `h1` is null for any headings that
// appear before the first H1 (they are shown flat, with no arrow).
interface HeadingGroup {
  h1: HeadingItem | null;
  h1Index: number; // ordinal among H1s; -1 for the leading group
  children: HeadingItem[];
}

function groupHeadings(headings: HeadingItem[]): HeadingGroup[] {
  const groups: HeadingGroup[] = [];
  let h1Count = 0;
  for (const h of headings) {
    if (h.level === 1) {
      groups.push({ h1: h, h1Index: h1Count++, children: [] });
    } else {
      if (groups.length === 0) groups.push({ h1: null, h1Index: -1, children: [] });
      groups[groups.length - 1].children.push(h);
    }
  }
  return groups;
}

interface RowProps {
  h: HeadingItem;
  isActive: boolean;
  paddingLeft: number;
  onJump: () => void;
  lead: ReactNode;
  trailing?: ReactNode;
  focusable?: boolean;
}

function HeadingRow({ h, isActive, paddingLeft, onJump, lead, trailing, focusable = true }: RowProps) {
  return (
    <div
      className={[
        "flex items-center gap-1.5 pr-2 rounded-r-lg transition-colors duration-150",
        isActive
          ? "bg-blue-500/10 text-blue-400"
          : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]",
      ].join(" ")}
      style={{ paddingLeft }}
    >
      {lead}
      <button
        onClick={onJump}
        tabIndex={focusable ? 0 : -1}
        className="flex-1 min-w-0 py-1.5 text-left"
      >
        <span
          className={[
            "block truncate leading-snug",
            levelStyle[h.level],
            isActive ? "text-blue-400" : "text-idemora-text-muted",
          ].join(" ")}
        >
          {h.text || <span className="italic text-idemora-text-faint">Untitled</span>}
        </span>
      </button>
      {trailing}
    </div>
  );
}

function DotSlot({ level, isActive }: { level: 1 | 2 | 3; isActive: boolean }) {
  return (
    <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center">
      <span
        className={[
          dotSize[level],
          "rounded-full shrink-0",
          isActive
            ? "bg-blue-400"
            : level === 1
            ? "bg-idemora-text-normal"
            : level === 2
            ? "bg-idemora-text-muted"
            : "bg-idemora-text-faint",
        ].join(" ")}
      />
    </span>
  );
}

export function OutlinePanel({ editor, paneId, noteId }: Props) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
  // Collapsed H1 sections, by H1 ordinal. Kept in memory; resets per note.
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const closeOutline = useUIStore((s) => s.closeOutline);

  const refresh = useCallback(() => {
    if (editor) setHeadings(extractHeadings(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    refresh();
    editor.on("update", refresh);
    return () => { editor.off("update", refresh); };
  }, [editor, refresh, noteId]);

  useEffect(() => {
    setCollapsed(new Set());
  }, [noteId]);

  useEffect(() => {
    if (!editor || headings.length === 0) return;

    const scrollContainer = getScrollContainer(editor);
    if (!scrollContainer) return;

    function onScroll() {
      if (!editor || !scrollContainer) return;
      const containerRect = scrollContainer.getBoundingClientRect();
      let best: number | null = null;

      for (const h of headings) {
        const domNode = editor.view.nodeDOM(h.pos);
        const el = domNode instanceof HTMLElement ? domNode : (domNode as Node)?.parentElement;
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        // Hidden heading (e.g. inside a closed toggle): it has no position to compare.
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.top - containerRect.top <= 120) best = h.pos;
      }
      setActivePos(best);
    }

    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scrollContainer.removeEventListener("scroll", onScroll);
  }, [editor, headings]);

  const groups = useMemo(() => groupHeadings(headings), [headings]);
  const collapsibleIdx = useMemo(
    () => groups.filter((g) => g.h1 && g.children.length > 0).map((g) => g.h1Index),
    [groups],
  );
  const anyOpen = collapsibleIdx.some((i) => !collapsed.has(i));

  function toggleGroup(idx: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function toggleAll() {
    setCollapsed(anyOpen ? new Set(collapsibleIdx) : new Set());
  }

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
            <span className="text-xs text-idemora-text-faint tabular-nums ml-1">({headings.length})</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {collapsibleIdx.length > 0 && (
            <button
              onClick={toggleAll}
              title={anyOpen ? "Collapse all" : "Expand all"}
              aria-label={anyOpen ? "Collapse all sections" : "Expand all sections"}
              className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                {anyOpen ? (
                  <path d="M2.5 6.5L6 3l3.5 3.5M2.5 10.5L6 7l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M2.5 3.5L6 7l3.5-3.5M2.5 7.5L6 11l3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
          )}
          {/* Close button ONLY calls closeOutline - does NOT touch rightPanelOpen */}
          <button
            onClick={() => closeOutline(paneId)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2">
        {!editor || headings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
              <path d="M4 6h16M4 10h10M4 14h12M4 18h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <p className="text-xs text-idemora-text-muted">No headings found.</p>
          </div>
        ) : (
          <ul>
            {groups.map((g) => {
              // Headings before the first H1: flat rows, no arrow.
              if (!g.h1) {
                return g.children.map((c) => (
                  <li key={c.pos}>
                    <HeadingRow
                      h={c}
                      isActive={c.pos === activePos}
                      paddingLeft={c.level === 3 ? 22 : 10}
                      onJump={() => scrollToHeading(editor, c.pos)}
                      lead={<DotSlot level={c.level} isActive={c.pos === activePos} />}
                    />
                  </li>
                ));
              }

              const h1 = g.h1;
              const hasKids = g.children.length > 0;
              const isCollapsed = hasKids && collapsed.has(g.h1Index);
              const activeInside = g.children.some((c) => c.pos === activePos);
              const h1Active = h1.pos === activePos || (isCollapsed && activeInside);

              return (
                <li key={h1.pos}>
                  <HeadingRow
                    h={h1}
                    isActive={h1Active}
                    paddingLeft={10}
                    onJump={() => scrollToHeading(editor, h1.pos)}
                    lead={
                      hasKids ? (
                        <button
                          onClick={() => toggleGroup(g.h1Index)}
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? "Expand section" : "Collapse section"}
                          className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded text-idemora-text-faint hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
                        >
                          <svg
                            width="10" height="10" viewBox="0 0 10 10" fill="none"
                            className={`transition-transform duration-150 motion-reduce:transition-none ${isCollapsed ? "" : "rotate-90"}`}
                          >
                            <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : (
                        <DotSlot level={1} isActive={h1Active} />
                      )
                    }
                    trailing={
                      hasKids ? (
                        <span
                          aria-hidden={!isCollapsed}
                          className={[
                            "shrink-0 text-[11px] leading-[18px] px-1.5 rounded-full tabular-nums transition-opacity duration-150 motion-reduce:transition-none",
                            h1Active ? "text-blue-400" : "text-idemora-text-muted bg-black/[0.06] dark:bg-white/[0.07]",
                            isCollapsed ? "opacity-100" : "opacity-0",
                          ].join(" ")}
                        >
                          {g.children.length}
                        </span>
                      ) : null
                    }
                  />
                  {hasKids && (
                    <div
                      aria-hidden={isCollapsed}
                      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
                        isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                      }`}
                    >
                      <div className="overflow-hidden min-h-0">
                        <div className="ml-[19px] border-l border-idemora-border">
                          {g.children.map((c) => (
                            <HeadingRow
                              key={c.pos}
                              h={c}
                              isActive={c.pos === activePos}
                              paddingLeft={c.level === 3 ? 20 : 8}
                              focusable={!isCollapsed}
                              onJump={() => scrollToHeading(editor, c.pos)}
                              lead={<DotSlot level={c.level} isActive={c.pos === activePos} />}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
