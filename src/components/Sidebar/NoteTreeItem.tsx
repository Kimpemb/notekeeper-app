// src/components/Sidebar/NoteTreeItem.tsx
import { useState, useRef, useEffect } from "react";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import type { Note } from "@/types";

interface Props {
  noteId: string;
  depth: number;
}

interface ContextMenuPos {
  x: number;
  y: number;
  flip: boolean; // true = open upward
}

export function NoteTreeItem({ noteId, depth }: Props) {
  const notes        = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const setActive    = useNoteStore((s) => s.setActiveNote);
  const createChild  = useNoteStore((s) => s.createChildNote);
  const deleteNote   = useNoteStore((s) => s.deleteNote);
  const updateNote   = useNoteStore((s) => s.updateNote);

  const expandedNodes = useUIStore((s) => s.expandedNodes);
  const toggleNode    = useUIStore((s) => s.toggleNode);

  const [contextMenu, setContextMenu] = useState<ContextMenuPos | null>(null);
  const [renaming, setRenaming]       = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const menuRef   = useRef<HTMLDivElement>(null);

  const note      = notes.find((n) => n.id === noteId);
  const children  = notes.filter((n) => n.parent_id === noteId);
  const isActive  = activeNoteId === noteId;
  const isExpanded = expandedNodes.has(noteId);
  const hasChildren = children.length > 0;

  useEffect(() => {
    if (!contextMenu) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [contextMenu]);

  useEffect(() => {
    if (renaming) renameRef.current?.select();
  }, [renaming]);

  if (!note) return null;

  const MENU_HEIGHT = 110; // approximate height of context menu in px
  const indentPx = depth * 14;

  function handleClick() {
    setActive(noteId);
    if (hasChildren) toggleNode(noteId);
  }

  function handleChevronClick(e: React.MouseEvent) {
    e.stopPropagation();
    toggleNode(noteId);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    // Detect if menu would go off screen bottom — if so, flip upward
    const spaceBelow = window.innerHeight - e.clientY;
    const flip = spaceBelow < MENU_HEIGHT + 16;
    setContextMenu({ x: e.clientX, y: e.clientY, flip });
  }

  async function handleNewChild(e: React.MouseEvent) {
    e.stopPropagation();
    setContextMenu(null);
    await createChild(noteId);
    if (!isExpanded) toggleNode(noteId);
  }

  function handleRename(e: React.MouseEvent) {
    e.stopPropagation();
    setContextMenu(null);
    setRenameValue(note!.title);
    setRenaming(true);
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== note!.title) {
      await updateNote(noteId, { title: trimmed });
    }
    setRenaming(false);
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setContextMenu(null);
    if (hasChildren) {
      const confirmed = window.confirm(
        `"${note!.title}" has sub-notes. Delete everything inside?`
      );
      if (!confirmed) return;
    }
    await deleteNote(noteId);
  }

  return (
    <li className="select-none">
      {/* Row */}
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${indentPx + 10}px` }}
        className={`
          group flex items-center gap-1.5 h-10 pr-2 rounded-md cursor-pointer
          transition-colors duration-100
          ${isActive
            ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
          }
        `}
      >
        {/* Chevron */}
        <span
          onClick={handleChevronClick}
          className={`
            shrink-0 w-4 h-4 flex items-center justify-center
            transition-transform duration-150
            ${hasChildren ? "opacity-50 hover:opacity-100" : "opacity-0 pointer-events-none"}
            ${isExpanded ? "rotate-90" : ""}
          `}
        >
          <svg width="9" height="9" viewBox="0 0 8 8" fill="none">
            <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>

        {/* Page icon */}
        <span className="shrink-0 opacity-40">
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
            <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
        </span>

        {/* Title / rename input */}
        {renaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="
              flex-1 bg-white dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100
              text-base px-1 rounded outline-none border border-zinc-300 dark:border-zinc-500
              min-w-0
            "
          />
        ) : (
          <span className="flex-1 truncate text-base leading-none">
            {note.title}
          </span>
        )}

        {/* Inline + button */}
        {!renaming && (
          <button
            onClick={handleNewChild}
            title="New sub-note"
            className="
              shrink-0 w-5 h-5 flex items-center justify-center rounded
              opacity-0 group-hover:opacity-60 hover:!opacity-100
              transition-opacity duration-100
            "
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Context menu — flips upward if near bottom of screen */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: contextMenu.x,
            ...(contextMenu.flip
              ? { bottom: window.innerHeight - contextMenu.y }
              : { top: contextMenu.y }),
          }}
          className="
            z-50 min-w-[180px] py-1 rounded-lg shadow-xl
            bg-white dark:bg-zinc-800
            border border-zinc-200 dark:border-zinc-700
            text-base text-zinc-700 dark:text-zinc-300
          "
        >
          <ContextItem label="New sub-note" onClick={handleNewChild} />
          <ContextItem label="Rename" onClick={handleRename} />
          <div className="my-1 border-t border-zinc-100 dark:border-zinc-700" />
          <ContextItem label="Delete" onClick={handleDelete} danger />
        </div>
      )}

      {/* Children */}
      {hasChildren && isExpanded && (
        <ul className="space-y-0.5 mt-0.5">
          {children.map((child: Note) => (
            <NoteTreeItem key={child.id} noteId={child.id} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ContextItem({
  label, onClick, danger = false,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left px-4 py-2.5 text-base transition-colors duration-75
        ${danger
          ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-700"
        }
      `}
    >
      {label}
    </button>
  );
}