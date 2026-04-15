// DONE
import { useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { Note } from "@/types";

interface FileTreeNodeProps {
  note: Note;
  depth: number;
  allNotes: Note[];
  activeNoteId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  paneId: 1 | 2;
}

function FileTreeNode({ note, depth, allNotes, activeNoteId, expandedIds, onToggle, paneId }: FileTreeNodeProps) {
  const setActiveNote  = useNoteStore((s) => s.setActiveNote);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const closeFileTree  = useUIStore((s) => s.closeFileTree);

  const children    = allNotes.filter((n) => n.parent_id === note.id).sort((a, b) => b.updated_at - a.updated_at);
  const hasChildren = children.length > 0;
  const isExpanded  = expandedIds.has(note.id);
  const isActive    = activeNoteId === note.id;

  function handleClick() {
    if (paneId === 2) { openTabInPane2(note.id); }
    else { setActiveNote(note.id); }
    closeFileTree(paneId);
  }
  function handleChevron(e: React.MouseEvent) { e.stopPropagation(); onToggle(note.id); }

  return (
    <li>
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={`group flex items-center gap-1.5 h-8 pr-2 rounded-md cursor-pointer transition-all duration-150 ${
          isActive 
            ? "bg-blue-500/10 text-blue-400 font-medium" 
            : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
        }`}
      >
        <span onClick={handleChevron} className={`shrink-0 w-4 h-4 flex items-center justify-center transition-transform duration-150 ${hasChildren ? "opacity-40" : "opacity-0 pointer-events-none"} ${isExpanded ? "rotate-90" : ""}`}>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
        <span className="shrink-0 opacity-40">
          {hasChildren ? (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M1 3a1 1 0 011-1h2.5l1 1.5H10a1 1 0 011 1V9a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/><path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
          )}
        </span>
        <span className={`flex-1 truncate text-sm leading-none transition-colors duration-150 ${isActive ? "text-blue-400" : "text-idemora-text-normal"}`}>
          {note.title}
        </span>
        {hasChildren && (
          <span className="shrink-0 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-idemora-bg-primary text-idemora-text-muted opacity-0 group-hover:opacity-100 transition-opacity duration-100">
            {children.length}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul>
          {children.map((child) => (
            <FileTreeNode key={child.id} note={child} depth={depth + 1} allNotes={allNotes} activeNoteId={activeNoteId} expandedIds={expandedIds} onToggle={onToggle} paneId={paneId} />
          ))}
        </ul>
      )}
    </li>
  );
}

interface FileTreePanelProps {
  paneId: 1 | 2;
}

export function FileTreePanel({ paneId }: FileTreePanelProps) {
  const notes        = useNoteStore((s) => s.notes);
  const activeNoteId = useUIStore((s) => s.paneActiveNoteId(paneId));
  const closeFileTree = useUIStore((s) => s.closeFileTree);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
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

  const rootNotes = notes.filter((n) => n.parent_id === null).sort((a, b) => b.updated_at - a.updated_at);
  const searchResults = search.trim()
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()) || n.plaintext.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updated_at - a.updated_at)
    : null;

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function expandAll()   { setExpandedIds(new Set(notes.filter((n) => notes.some((c) => c.parent_id === n.id)).map((n) => n.id))); }
  function collapseAll() { setExpandedIds(new Set()); }

  const totalNotes = notes.length;

  return (
    <div className="flex flex-col h-full w-64 shrink-0 border-l border-idemora-border bg-idemora-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-idemora-border shrink-0">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-idemora-text-muted shrink-0">
            <path d="M1 3.5a1 1 0 011-1h3l1 1.5h5a1 1 0 011 1V10a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          </svg>
          <span className="text-xs font-semibold text-idemora-text-muted uppercase tracking-wider">File Tree</span>
          <span className="text-xs text-idemora-text-faint tabular-nums">{totalNotes}</span>
        </div>
        <button 
          onClick={() => closeFileTree(paneId)} 
          className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-idemora-border shrink-0">
        <div className="relative">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-idemora-text-muted pointer-events-none">
            <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input 
            type="text" 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            placeholder="Filter notes…"
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md bg-idemora-bg-primary text-idemora-text-normal placeholder-idemora-text-faint outline-none border border-idemora-border focus:border-blue-500/50 transition-colors duration-100"
          />
          {search && (
            <button 
              onClick={() => setSearch("")} 
              className="absolute right-2 top-1/2 -translate-y-1/2 text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Expand/collapse buttons */}
      {!searchResults && notes.some((n) => notes.some((c) => c.parent_id === n.id)) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-idemora-border shrink-0">
          <button onClick={expandAll} className="text-[11px] text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100">Expand all</button>
          <span className="text-idemora-text-faint">·</span>
          <button onClick={collapseAll} className="text-[11px] text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100">Collapse all</button>
        </div>
      )}

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto py-2">
        {searchResults ? (
          searchResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
                <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M15 15L20 20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <p className="text-xs text-idemora-text-muted">No notes match</p>
            </div>
          ) : (
            <ul className="space-y-0.5 px-2">
              {searchResults.map((note) => <FileTreeNode key={note.id} note={note} depth={0} allNotes={notes} activeNoteId={activeNoteId} expandedIds={expandedIds} onToggle={toggleExpanded} paneId={paneId} />)}
            </ul>
          )
        ) : rootNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
              <path d="M4 4h16v16H4zM8 8h8M8 12h6M8 16h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <p className="text-xs text-idemora-text-muted">No notes yet</p>
            <p className="text-xs text-idemora-text-faint">Create your first note to get started</p>
          </div>
        ) : (
          <ul className="space-y-0.5 px-2">
            {rootNotes.map((note) => <FileTreeNode key={note.id} note={note} depth={0} allNotes={notes} activeNoteId={activeNoteId} expandedIds={expandedIds} onToggle={toggleExpanded} paneId={paneId} />)}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-idemora-border shrink-0">
        <p className="text-[10px] text-idemora-text-faint text-center select-none">{totalNotes} {totalNotes === 1 ? "note" : "notes"}</p>
      </div>
    </div>
  );
}