// src/components/FileTree/FileTreePanel.tsx
// Slide-in panel showing the full note hierarchy.
// Structured to accept drag-to-reparent and unlinked mentions later.

import { useState } from "react";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import type { Note } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileTreeNodeProps {
  note: Note;
  depth: number;
  allNotes: Note[];
  activeNoteId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}

// ─── Recursive node ───────────────────────────────────────────────────────────

function FileTreeNode({
  note,
  depth,
  allNotes,
  activeNoteId,
  expandedIds,
  onToggle,
}: FileTreeNodeProps) {
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const closeFileTree = useUIStore((s) => s.closeFileTree);

  const children   = allNotes.filter((n) => n.parent_id === note.id)
                              .sort((a, b) => b.updated_at - a.updated_at);
  const hasChildren = children.length > 0;
  const isExpanded  = expandedIds.has(note.id);
  const isActive    = activeNoteId === note.id;

  function handleClick() {
    setActiveNote(note.id);
    closeFileTree();
  }

  function handleChevron(e: React.MouseEvent) {
    e.stopPropagation();
    onToggle(note.id);
  }

  return (
    <li>
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={`
          group flex items-center gap-1.5 h-8 pr-2 rounded-md cursor-pointer
          transition-colors duration-75
          ${isActive
            ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-medium"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
          }
        `}
      >
        {/* Chevron */}
        <span
          onClick={handleChevron}
          className={`
            shrink-0 w-4 h-4 flex items-center justify-center
            transition-transform duration-150
            ${hasChildren ? "opacity-40 hover:opacity-100" : "opacity-0 pointer-events-none"}
            ${isExpanded ? "rotate-90" : ""}
          `}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>

        {/* Icon */}
        <span className="shrink-0 opacity-40">
          {hasChildren ? (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <path d="M1 3a1 1 0 011-1h2.5l1 1.5H10a1 1 0 011 1V9a1 1 0 01-1 1H2a1 1 0 01-1-1V3z"
                stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          )}
        </span>

        {/* Title */}
        <span className="flex-1 truncate text-sm leading-none">
          {note.title}
        </span>

        {/* Child count badge */}
        {hasChildren && (
          <span className="
            shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full
            bg-zinc-100 dark:bg-zinc-800
            text-zinc-400 dark:text-zinc-500
            opacity-0 group-hover:opacity-100 transition-opacity duration-100
          ">
            {children.length}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <ul>
          {children.map((child) => (
            <FileTreeNode
              key={child.id}
              note={child}
              depth={depth + 1}
              allNotes={allNotes}
              activeNoteId={activeNoteId}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function FileTreePanel() {
  const notes        = useNoteStore((s) => s.notes);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const closeFileTree = useUIStore((s) => s.closeFileTree);

  // Local expand state — independent of sidebar's expandedNodes
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Pre-expand ancestors of the active note so it's visible on open
    if (!activeNoteId) return new Set();
    const ancestors = new Set<string>();
    let current = notes.find((n) => n.id === activeNoteId);
    while (current?.parent_id) {
      ancestors.add(current.parent_id);
      current = notes.find((n) => n.id === current!.parent_id);
    }
    return ancestors;
  });

  const [search, setSearch] = useState("");

  const rootNotes = notes
    .filter((n) => n.parent_id === null)
    .sort((a, b) => b.updated_at - a.updated_at);

  // Search mode — flat list matching title or plaintext
  const searchResults = search.trim()
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(search.toLowerCase()) ||
          n.plaintext.toLowerCase().includes(search.toLowerCase())
      ).sort((a, b) => b.updated_at - a.updated_at)
    : null;

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpandedIds(new Set(notes.filter((n) => n.parent_id !== null || notes.some((c) => c.parent_id === n.id)).map((n) => n.id)));
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  const totalNotes = notes.length;

  return (
    <div className="
      flex flex-col h-full w-64 shrink-0
      border-l border-zinc-200 dark:border-zinc-800
      bg-zinc-50 dark:bg-zinc-900
    ">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-zinc-400 shrink-0">
            <path d="M1 3.5a1 1 0 011-1h3l1 1.5h5a1 1 0 011 1V10a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z"
              stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          </svg>
          <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
            File Tree
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-600 tabular-nums">
            {totalNotes}
          </span>
        </div>
        <button
          onClick={closeFileTree}
          className="
            w-6 h-6 flex items-center justify-center rounded-md
            text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200
            hover:bg-zinc-200 dark:hover:bg-zinc-700
            transition-colors duration-100
          "
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="relative">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
            <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter notes…"
            className="
              w-full pl-7 pr-3 py-1.5 text-xs rounded-md
              bg-zinc-100 dark:bg-zinc-800
              text-zinc-700 dark:text-zinc-300
              placeholder:text-zinc-400 dark:placeholder:text-zinc-600
              outline-none border border-transparent
              focus:border-zinc-300 dark:focus:border-zinc-600
              transition-colors duration-100
            "
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Expand / Collapse all — only shown in tree mode */}
      {!searchResults && notes.some((n) => notes.some((c) => c.parent_id === n.id)) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <button
            onClick={expandAll}
            className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            Expand all
          </button>
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <button
            onClick={collapseAll}
            className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          >
            Collapse all
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {searchResults ? (
          // ── Search results ──
          searchResults.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-8">No notes match</p>
          ) : (
            <ul className="space-y-0.5">
              {searchResults.map((note) => (
                <FileTreeNode
                  key={note.id}
                  note={note}
                  depth={0}
                  allNotes={notes}
                  activeNoteId={activeNoteId}
                  expandedIds={expandedIds}
                  onToggle={toggleExpanded}
                />
              ))}
            </ul>
          )
        ) : rootNotes.length === 0 ? (
          // ── Empty state ──
          <p className="text-xs text-zinc-400 text-center py-8">No notes yet</p>
        ) : (
          // ── Full tree ──
          <ul className="space-y-0.5">
            {rootNotes.map((note) => (
              <FileTreeNode
                key={note.id}
                note={note}
                depth={0}
                allNotes={notes}
                activeNoteId={activeNoteId}
                expandedIds={expandedIds}
                onToggle={toggleExpanded}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer — placeholder for drag-to-reparent hint later */}
      <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
        <p className="text-[10px] text-zinc-300 dark:text-zinc-700 text-center select-none">
          {totalNotes} {totalNotes === 1 ? "note" : "notes"}
        </p>
      </div>
    </div>
  );
}