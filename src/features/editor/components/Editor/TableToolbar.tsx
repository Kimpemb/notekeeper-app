// src/features/editor/components/Editor/TableToolbar.tsx
//
// Floating toolbar that appears when the cursor is inside a table.
// Provides: add/delete row, add/delete column, merge/split cells, delete table.
// Positioned fixed just above the current table using the table DOM element's
// bounding rect — similar approach to the bubble menu in index.tsx.

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Props {
  editor: Editor;
}

interface ToolbarPos {
  top: number;
  left: number;
}

export function TableToolbar({ editor }: Props) {
  const [pos, setPos]               = useState<ToolbarPos | null>(null);
  const [canMerge, setCanMerge]     = useState(false);
  const [canSplit, setCanSplit]      = useState(false);
  const toolbarRef                   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function update() {
      const { state, view } = editor;
      const { $from } = state.selection;

      // Check if cursor is inside a table
      let insideTable = false;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "table") { insideTable = true; break; }
      }

      if (!insideTable) { setPos(null); return; }

      // Find the table DOM element and position toolbar above it
      // Walk up from the cursor's DOM node to find the table element
      const domAtPos = view.domAtPos($from.pos);
      let el = domAtPos.node as HTMLElement;
      while (el && el.tagName !== "TABLE") {
        el = el.parentElement as HTMLElement;
      }

      if (!el) { setPos(null); return; }

      const rect = el.getBoundingClientRect();
      setPos({ top: rect.top - 40, left: rect.left });

      // Update merge/split state
      setCanMerge(editor.can().mergeCells());
      setCanSplit(editor.can().splitCell());
    }

    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

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
          ? "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 cursor-pointer"
      }`}
    >
      {children}
    </button>
  );

  return (
    <div
      ref={toolbarRef}
      style={{
        position: "fixed",
        top: Math.max(8, pos.top),
        left: pos.left,
        zIndex: 40,
      }}
      className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl"
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

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

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

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

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

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />

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