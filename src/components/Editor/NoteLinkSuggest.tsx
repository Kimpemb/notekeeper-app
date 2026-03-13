// src/components/Editor/NoteLinkSuggest.tsx
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useNoteStore } from "@/store/useNoteStore";
import type { Note } from "@/types";

interface Props {
  position: { top: number; left: number };
  editor: Editor;
  query: string;
  bracketStart: number; // doc position of the opening '[['
  onClose: () => void;
}

export function NoteLinkSuggest({ position, editor, query, bracketStart, onClose }: Props) {
  const menuRef  = useRef<HTMLDivElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const notes         = useNoteStore((s) => s.notes);
  const activeNoteId  = useNoteStore((s) => s.activeNoteId);
  const [selected, setSelected] = useState(0);

  // Filter out the active note (can't link to yourself) and apply query
  const filtered: Note[] = notes
    .filter((n) => n.id !== activeNoteId)
    .filter((n) => !query.trim() || n.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  // Keyboard navigation — capture phase so editor doesn't consume these
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault(); e.stopPropagation();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        const note = filtered[selected];
        if (note) insertLink(note);
      } else if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [filtered, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  function insertLink(note: Note) {
    // Delete everything from [[ up to current cursor position, then insert the node
    const to = editor.state.selection.from;
    editor
      .chain()
      .focus()
      .deleteRange({ from: bracketStart, to })
      .insertNoteLink(note.id, note.title)
      .run();
    onClose();
  }

  const MENU_MAX_H = 300;
  const flip = position.top + MENU_MAX_H > window.innerHeight;

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: Math.min(position.left, window.innerWidth - 260),
        ...(flip
          ? { bottom: window.innerHeight - position.top + 4 }
          : { top: position.top + 4 }),
        zIndex: 50,
      }}
      className="
        w-64 rounded-xl overflow-hidden
        bg-white dark:bg-zinc-900
        border border-zinc-200 dark:border-zinc-700
        shadow-2xl
      "
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-1.5">
        <svg width="11" height="11" viewBox="0 0 10 10" fill="none" className="text-zinc-400 shrink-0">
          <path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          <path d="M6 1h3v3M9 1L5.5 4.5"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-xs text-zinc-400">
          Link to note
          {query && <span className="ml-1 text-zinc-500 font-medium">"{query}"</span>}
        </span>
      </div>

      <ul ref={listRef} className="py-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 && (
          <li className="px-4 py-4 text-sm text-zinc-400 text-center">
            {notes.length <= 1 ? "No other notes yet" : "No notes match"}
          </li>
        )}
        {filtered.map((note, i) => (
          <li
            key={note.id}
            ref={(el) => { itemRefs.current[i] = el; }}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => { e.preventDefault(); insertLink(note); }}
            className={`
              flex items-center gap-2.5 px-3 py-2 cursor-pointer
              transition-colors duration-75
              ${i === selected
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              }
            `}
          >
            {/* Note icon */}
            <span className="
              w-7 h-7 flex items-center justify-center rounded-md shrink-0
              bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500
            ">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                <path d="M4 6h5M4 8h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {note.title}
              </p>
              {note.plaintext && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                  {note.plaintext.slice(0, 60)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}