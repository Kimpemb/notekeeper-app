// src/features/notes/components/Sidebar/NoteTreeItem.tsx
import { useState, useRef, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";
import { MoveNoteModal } from "@/features/ui/components/MoveNoteModal";
import type { Note } from "@/types";

type SortOrder = 
  | "alpha-asc" 
  | "alpha-desc" 
  | "modified-desc" 
  | "modified-asc" 
  | "created-desc" 
  | "created-asc";

type ContextItemId =
  | "new-sub-note"
  | "open-in-new-tab"
  | "open-in-split"
  | "open-in-local-graph"
  | "rename"
  | "pin"
  | "move"
  | "trash";

interface Props {
  noteId: string;
  depth: number;
  flatOrderedIds: string[];
  lastSelectedIdRef: React.MutableRefObject<string | null>;
  focusedNoteId: string | null;
  setFocusedNoteId: (id: string | null) => void;
  sortOrder: SortOrder;
}

interface ContextMenuPos { x: number; y: number; flip: boolean; }

export function NoteTreeItem({
  noteId, depth, flatOrderedIds, lastSelectedIdRef, focusedNoteId, setFocusedNoteId, sortOrder,
}: Props) {
  const notes        = useNoteStore((s) => s.notes);
  const activeNoteId   = useNoteStore((s) => s.activeNoteId);
  const activePaneId   = useUIStore((s) => s.activePaneId);
  const setActive    = useNoteStore((s) => s.setActiveNote);
  const createChild  = useNoteStore((s) => s.createChildNote);
  const deleteNote   = useNoteStore((s) => s.deleteNote);
  const updateNote   = useNoteStore((s) => s.updateNote);
  const pinNote      = useNoteStore((s) => s.pinNote);
  const unpinNote    = useNoteStore((s) => s.unpinNote);
  const isPinned     = useNoteStore((s) => s.isPinned(noteId));

  const expandedNodes        = useUIStore((s) => s.expandedNodes);
  const toggleNode           = useUIStore((s) => s.toggleNode);
  const replaceTab           = useUIStore((s) => s.replaceTab);
  const replacePane2Tab = useUIStore((s) => s.replacePane2Tab);
  const openTab              = useUIStore((s) => s.openTab);
  const openInSplit          = useUIStore((s) => s.openInSplit);
  const openGraphForNote     = useUIStore((s) => s.openGraphForNote);
  const isSelected           = useUIStore((s) => s.isNoteSelected(noteId));
  const toggleNoteSelection  = useUIStore((s) => s.toggleNoteSelection);
  const selectNoteRange      = useUIStore((s) => s.selectNoteRange);
  const clearSelection       = useUIStore((s) => s.clearSelection);
  const selectedNoteIds      = useUIStore((s) => s.selectedNoteIds);

  const [contextMenu, setContextMenu] = useState<ContextMenuPos | null>(null);
  const [renaming, setRenaming]       = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [moveOpen, setMoveOpen]       = useState(false);
  const [focusedItem, setFocusedItem] = useState<ContextItemId>("new-sub-note");

  const renameRef      = useRef<HTMLInputElement>(null);
  const menuRef        = useRef<HTMLDivElement>(null);
  const focusedItemRef = useRef<ContextItemId>("new-sub-note");

  useEffect(() => { focusedItemRef.current = focusedItem; }, [focusedItem]);

  // ── Sort notes function ─────────────────────────────────────────────────────
  const sortNotes = (notesArray: Note[]): Note[] => {
    return [...notesArray].sort((a, b) => {
      switch (sortOrder) {
        case "alpha-asc":
          return a.title.localeCompare(b.title);
        case "alpha-desc":
          return b.title.localeCompare(a.title);
        case "modified-desc":
          return b.updated_at - a.updated_at;
        case "modified-asc":
          return a.updated_at - b.updated_at;
        case "created-desc":
          return b.created_at - a.created_at;
        case "created-asc":
          return a.created_at - b.created_at;
        default:
          return b.updated_at - a.updated_at;
      }
    });
  };

  const note        = notes.find((n) => n.id === noteId);
  const children    = sortNotes(notes.filter((n) => n.parent_id === noteId));
  const isActive    = activeNoteId === noteId;
  const isExpanded  = expandedNodes.has(noteId);
  const hasChildren = children.length > 0;
  const isRoot      = note?.parent_id === null;
  const isFocused   = focusedNoteId === noteId;

  const navItems: ContextItemId[] = isRoot
    ? ["new-sub-note", "open-in-new-tab", "open-in-split", "open-in-local-graph", "rename", "pin", "move", "trash"]
    : ["new-sub-note", "open-in-new-tab", "open-in-split", "open-in-local-graph", "rename", "move", "trash"];

  useEffect(() => {
    if (!contextMenu) return;
    setFocusedItem("new-sub-note");

    function handleMouse(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setContextMenu(null); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedItem((cur) => { const idx = navItems.indexOf(cur); return navItems[Math.min(idx + 1, navItems.length - 1)]; });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedItem((cur) => { const idx = navItems.indexOf(cur); return navItems[Math.max(idx - 1, 0)]; });
      }
      if (e.key === "Enter") { e.preventDefault(); triggerItem(focusedItemRef.current); }
    }

    document.addEventListener("mousedown", handleMouse);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouse);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  function triggerItem(item: ContextItemId) {
    switch (item) {
      case "new-sub-note":
        setContextMenu(null);
        createChild(noteId).then(() => { if (!isExpanded) toggleNode(noteId); }).catch(console.error);
        break;
      case "open-in-new-tab":
        setContextMenu(null);
        openTab(noteId);
        setActive(noteId, true);
        break;
      case "open-in-split":
        setContextMenu(null);
        openInSplit(noteId);
        break;
      case "open-in-local-graph":
        setContextMenu(null);
        openGraphForNote(noteId);
        break;
      case "rename":
        setContextMenu(null);
        setRenameValue(note!.title);
        setRenaming(true);
        break;
      case "pin":
        setContextMenu(null);
        isPinned ? unpinNote(noteId).catch(console.error) : pinNote(noteId).catch(console.error);
        break;
      case "move":
        setContextMenu(null);
        setMoveOpen(true);
        break;
      case "trash":
        setContextMenu(null);
        setConfirmOpen(true);
        break;
    }
  }

  useEffect(() => { if (renaming) renameRef.current?.select(); }, [renaming]);

  useEffect(() => {
    if (!isActive) return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (useUIStore.getState().selectedNoteIds.size > 0) return;
      if (e.key === "Delete") { e.preventDefault(); setConfirmOpen(true); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActive]);

  if (!note) return null;
  const indentPx = depth * 14;

  function handleClick(e: React.MouseEvent) {
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;

    if (isCtrl) {
      e.preventDefault();
      toggleNoteSelection(noteId);
      lastSelectedIdRef.current = noteId;
      setFocusedNoteId(noteId);
      return;
    }

    if (e.shiftKey && lastSelectedIdRef.current && flatOrderedIds.length > 0) {
      e.preventDefault();
      selectNoteRange(lastSelectedIdRef.current, noteId, flatOrderedIds);
      setFocusedNoteId(noteId);
      return;
    }

    if (selectedNoteIds.size > 0) clearSelection();
    setFocusedNoteId(noteId);

    if (isActive) {
      if (hasChildren) toggleNode(noteId);
    } else {
      if (activePaneId === 2) {
        replacePane2Tab(noteId);
      } else {
        setActive(noteId);
        replaceTab(noteId);
      }
      lastSelectedIdRef.current = noteId;
    }
  }

  function handleChevronClick(e: React.MouseEvent) {
    e.stopPropagation();
    toggleNode(noteId);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, flip: window.innerHeight - e.clientY < 220 });
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== note!.title) await updateNote(noteId, { title: trimmed });
    setRenaming(false);
  }

  const rowClass = isSelected
    ? "bg-blue-500/10 text-blue-400"
    : isActive
      ? "bg-blue-500/10 text-blue-400 font-medium"
      : isFocused
        ? "bg-black/[0.06] dark:bg-white/[0.07] text-idemora-text-normal ring-1 ring-inset ring-idemora-border"
        : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]";

  return (
    <div className="select-none">
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${indentPx + 10}px` }}
        className={`group flex items-center gap-1.5 h-10 pr-2 rounded-md cursor-pointer transition-all duration-150 ${rowClass}`}
      >
        <span
          onClick={handleChevronClick}
          className={`shrink-0 w-4 h-4 flex items-center justify-center transition-transform duration-150 ${
            hasChildren ? "opacity-40" : "opacity-0 pointer-events-none"
          } ${isExpanded ? "rotate-90" : ""}`}
        >
          <svg width="9" height="9" viewBox="0 0 8 8" fill="none">
            <path d="M2 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span className="shrink-0 opacity-40">
          {hasChildren ? (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M1 3a1 1 0 011-1h2.5l1 1.5H10a1 1 0 011 1V9a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          )}
        </span>
        {renaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-idemora-bg-primary text-idemora-text-normal text-base px-1 rounded outline-none border border-idemora-border focus:border-blue-500/50 min-w-0"
          />
        ) : (
          <span
            className={`flex-1 text-base leading-none flex items-center gap-1.5 overflow-hidden whitespace-nowrap transition-colors duration-150 ${
              isSelected || isActive ? "text-blue-400" : "text-idemora-text-normal"
            }`}
            style={{ maskImage: "linear-gradient(to right, black 75%, transparent 100%)", WebkitMaskImage: "linear-gradient(to right, black 75%, transparent 100%)" }}
          >
            {note.title}
            {isPinned && (
              <span className="shrink-0 opacity-40">
                <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
                  <path d="M5 0L6.2 3.8H10L7 6.2L8.1 10L5 7.8L1.9 10L3 6.2L0 3.8H3.8L5 0Z"/>
                </svg>
              </span>
            )}
          </span>
        )}
        {!renaming && (
          <button
            onClick={(e) => { e.stopPropagation(); triggerItem("new-sub-note"); }}
            title="New sub-note"
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity duration-100 text-idemora-text-muted hover:text-idemora-text-normal"
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

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
          className="z-50 min-w-[180px] py-1 rounded-lg shadow-xl bg-idemora-bg-secondary border border-idemora-border max-h-56 overflow-y-auto"
        >
          <CtxItem label="New sub-note"        id="new-sub-note"         focused={focusedItem === "new-sub-note"}         onHover={() => setFocusedItem("new-sub-note")}         onClick={() => triggerItem("new-sub-note")} />
          <CtxItem label="Open in new tab"     id="open-in-new-tab"      focused={focusedItem === "open-in-new-tab"}      onHover={() => setFocusedItem("open-in-new-tab")}      onClick={() => triggerItem("open-in-new-tab")} />
          <CtxItem label="Open in split"       id="open-in-split"        focused={focusedItem === "open-in-split"}        onHover={() => setFocusedItem("open-in-split")}        onClick={() => triggerItem("open-in-split")} />
          <CtxItem label="Open in local graph" id="open-in-local-graph"  focused={focusedItem === "open-in-local-graph"}  onHover={() => setFocusedItem("open-in-local-graph")}  onClick={() => triggerItem("open-in-local-graph")} />
          <div className="my-1 border-t border-idemora-border" />
          <CtxItem label="Rename"              id="rename"               focused={focusedItem === "rename"}               onHover={() => setFocusedItem("rename")}               onClick={() => triggerItem("rename")} />
          {isRoot && (
            <CtxItem label={isPinned ? "Unpin" : "Pin to top"} id="pin" focused={focusedItem === "pin"} onHover={() => setFocusedItem("pin")} onClick={() => triggerItem("pin")} />
          )}
          <div className="my-1 border-t border-idemora-border" />
          <CtxItem label="Move"                id="move"                 focused={focusedItem === "move"}                 onHover={() => setFocusedItem("move")}                 onClick={() => triggerItem("move")} suffix="›" />
          <div className="my-1 border-t border-idemora-border" />
          <CtxItem label="Move to Trash"       id="trash"                focused={focusedItem === "trash"}                onHover={() => setFocusedItem("trash")}                onClick={() => triggerItem("trash")} danger />
        </div>
      )}

      {moveOpen && (
        <MoveNoteModal open={moveOpen} noteId={noteId} onClose={() => setMoveOpen(false)} />
      )}

      {hasChildren && isExpanded && (
        <ul className="space-y-0.5 mt-0.5">
          {children.map((child: Note) => (
            <NoteTreeItem
              key={child.id}
              noteId={child.id}
              depth={depth + 1}
              flatOrderedIds={flatOrderedIds}
              lastSelectedIdRef={lastSelectedIdRef}
              focusedNoteId={focusedNoteId}
              setFocusedNoteId={setFocusedNoteId}
              sortOrder={sortOrder}
            />
          ))}
        </ul>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="Move to Trash"
        message={
          hasChildren
            ? `"${note.title}" has sub-notes. Move everything to trash?`
            : `"${note.title}" will be moved to trash. You can restore it within 30 days.`
        }
        confirmLabel="Move to Trash"
        danger
        onConfirm={async () => { setConfirmOpen(false); await deleteNote(noteId); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function CtxItem({ label, focused, onHover, onClick, danger = false, suffix }: {
  label: string;
  id: ContextItemId;
  focused: boolean;
  onHover: () => void;
  onClick: () => void;
  danger?: boolean;
  suffix?: string;
}) {
  return (
    <button
      onMouseEnter={onHover}
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors duration-100 ${
        danger
          ? focused ? "bg-red-500/10 text-red-400" : "text-red-400 hover:bg-red-500/10"
          : focused ? "bg-blue-500/10 text-blue-400" : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
      }`}
    >
      {label}
      {suffix && <span className="text-idemora-text-faint ml-3 text-base leading-none">{suffix}</span>}
    </button>
  );
}