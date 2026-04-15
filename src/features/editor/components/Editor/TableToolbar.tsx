// src/features/editor/components/Editor/TableToolbar.tsx
//
// Floating toolbar that appears when the cursor is inside a table.
// Provides: add/delete row, add/delete column, merge/split cells, delete table.
// Positioned fixed just above the current table using the table DOM element's
// bounding rect — recalculated on selection, transaction, AND scroll so it
// never drifts while the user scrolls.

import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor;
}

interface ToolbarPos {
  top: number;
  left: number;
}

export function TableToolbar({ editor }: Props) {
  const [pos, setPos]           = useState<ToolbarPos | null>(null);
  const [canMerge, setCanMerge] = useState(false);
  const [canSplit, setCanSplit] = useState(false);
  const toolbarRef              = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    const { state, view } = editor;
    const { $from } = state.selection;

    // Check if cursor is inside a table
    let insideTable = false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "table") { insideTable = true; break; }
    }

    if (!insideTable) { setPos(null); return; }

    // Walk up from the cursor's DOM node to find the <table> element
    const domAtPos = view.domAtPos($from.pos);
    let el = domAtPos.node as HTMLElement;
    while (el && el.tagName !== "TABLE") {
      el = el.parentElement as HTMLElement;
    }

    if (!el) { setPos(null); return; }

    const rect = el.getBoundingClientRect();
    setPos({ top: rect.top - 40, left: rect.left });
    setCanMerge(editor.can().mergeCells());
    setCanSplit(editor.can().splitCell());
  }, [editor]);

  useEffect(() => {
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor, update]);

  // Re-position on scroll so the toolbar doesn't drift
  useEffect(() => {
    // Find the scroll container — walk up from the editor DOM node
    function getScrollContainer(): HTMLElement | null {
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

    const container = getScrollContainer();
    if (!container) return;

    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [editor, update]);

  if (!pos) return null;

  const btn = (
    action: () => void,
    title: string,
    children: React.ReactNode,
    disabled = false
  ) => (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) action();
      }}
      title={title}
      disabled={disabled}
      className={`flex items-center justify-center w-7 h-7 rounded-md text-xs transition-colors duration-75 ${
        disabled
          ? "text-idemora-text-faint cursor-not-allowed opacity-40 pointer-events-none"
          : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] cursor-pointer"
      }`}
    >
      {children}
    </button>
  );

  const divider = <div className="w-px h-4 bg-idemora-border mx-0.5 shrink-0" />;

  return (
    <div
      ref={toolbarRef}
      style={{
        position: "fixed",
        top: Math.max(8, pos.top),
        left: pos.left,
        zIndex: 40,
      }}
      className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-idemora-bg-primary border border-idemora-border shadow-xl"
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Add column before */}
      {btn(() => editor.chain().focus().addColumnBefore().run(), "Add column before",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="7" y="1" width="5" height="11" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M3 4v6M1 7h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      )}
      {/* Add column after */}
      {btn(() => editor.chain().focus().addColumnAfter().run(), "Add column after",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="1" width="5" height="11" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M10 4v6M8 7h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      )}
      {/* Delete column */}
      {btn(() => editor.chain().focus().deleteColumn().run(), "Delete column",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="4" y="1" width="5" height="11" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M5 5l3 3M8 5l-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      )}

      {divider}

      {/* Add row before */}
      {btn(() => editor.chain().focus().addRowBefore().run(), "Add row before",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="7" width="11" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M4 3h6M7 1v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      )}
      {/* Add row after */}
      {btn(() => editor.chain().focus().addRowAfter().run(), "Add row after",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="1" width="11" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M4 10h6M7 8v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      )}
      {/* Delete row */}
      {btn(() => editor.chain().focus().deleteRow().run(), "Delete row",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="4" width="11" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M5 5.5l3 3M8 5.5l-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      )}

      {divider}

      {/* Merge cells */}
      {btn(() => editor.chain().focus().mergeCells().run(), "Merge cells",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="1" width="11" height="11" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M5 4L3 6.5L5 9M8 4l2 2.5L8 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>,
        !canMerge
      )}
      {/* Split cell */}
      {btn(() => editor.chain().focus().splitCell().run(), "Split cell",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="1" width="11" height="11" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M6.5 3v7M4 6.5L6.5 4L9 6.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>,
        !canSplit
      )}

      {divider}

      {/* Delete table */}
      {btn(() => editor.chain().focus().deleteTable().run(), "Delete table",
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="1" y="1" width="11" height="11" rx="1" stroke="currentColor" strokeWidth="1.1"/>
          <path d="M4 4l5 5M9 4l-5 5" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      )}
    </div>
  );
}