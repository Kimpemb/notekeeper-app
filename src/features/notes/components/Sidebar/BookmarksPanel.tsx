// src/features/notes/components/Sidebar/BookmarksPanel.tsx
import { useState, useRef, useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { NoteBookmark, BookmarkGroup } from "@/types";
import { useUIStore } from "@/features/ui/store/useUIStore";

interface ContextMenuPos { x: number; y: number; flip: boolean; }

// Folder with plus icon (matches NotesPanel new note icon style)
const FolderPlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M2 5.5a1.5 1.5 0 011.5-1.5h3.5L9 6.5h5.5a1.5 1.5 0 011.5 1.5v5.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 012 13.5v-8z"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="9" y1="9.5" x2="9" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="7.5" y1="11" x2="10.5" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

export function BookmarksPanel() {
  const {
    bookmarks,
    notes,
    addBookmarkGroup,
    removeBookmark,
    removeBookmarkGroup,
    renameBookmarkGroup,
    toggleBookmarkGroupCollapsed,
    reorderBookmarks,
    setActiveNote,
    addBookmark,
    isBookmarked,
    getBookmarkForNote,
  } = useNoteStore();

  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const activeNote = notes.find((n) => n.id === activeNoteId);
  const replaceTab = useUIStore((s) => s.replaceTab);

  
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName]       = useState("");
  const [newGroupName, setNewGroupName]     = useState("");
  const [addingGroup, setAddingGroup]       = useState(false);
  const [draggingId, setDraggingId]         = useState<string | null>(null);
  const [contextMenu, setContextMenu]       = useState<{ id: string; kind: "group" | "note"; pos: ContextMenuPos } | null>(null);
  
  // Get all groups
  const allGroups = bookmarks.filter((b): b is BookmarkGroup => b.kind === "group");
  const allExpanded = allGroups.length > 0 && allGroups.every((g) => !g.collapsed);
  
  const expandAllGroups = () => {
    allGroups.forEach((group) => {
      if (group.collapsed) {
        toggleBookmarkGroupCollapsed(group.id);
      }
    });
  };
  
  const collapseAllGroups = () => {
    allGroups.forEach((group) => {
      if (!group.collapsed) {
        toggleBookmarkGroupCollapsed(group.id);
      }
    });
  };
  
  const toggleExpandCollapseAll = () => {
    if (allExpanded) {
      collapseAllGroups();
    } else {
      expandAllGroups();
    }
  };

  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  // Sort all items by sort_order
  const sorted = [...bookmarks].sort((a, b) => a.sort_order - b.sort_order);

  // Top-level items: groups and ungrouped note bookmarks
  const topLevel = sorted.filter(
    (b) => b.kind === "group" || (b.kind === "note" && b.groupId === null)
  );

  // Note bookmarks inside a group
  const groupChildren = (groupId: string): NoteBookmark[] =>
    sorted.filter(
      (b): b is NoteBookmark => b.kind === "note" && b.groupId === groupId
    );

  const noteTitle = (noteId: string) =>
    notes.find((n) => n.id === noteId)?.title ?? "Deleted note";

  // ── drag handlers ──────────────────────────────────────────────────────
  const handleDragStart = (id: string) => setDraggingId(id);
  const handleDrop = (targetId: string) => {
    if (draggingId && draggingId !== targetId) {
      reorderBookmarks(draggingId, targetId);
    }
    setDraggingId(null);
  };

  // ── context menu handlers ──────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent, id: string, kind: "group" | "note") => {
    e.preventDefault();
    const flip = window.innerHeight - e.clientY < 180;
    setContextMenu({ id, kind, pos: { x: e.clientX, y: e.clientY, flip } });
  };

  const handleRenameGroup = (groupId: string, currentName: string) => {
    setContextMenu(null);
    setEditingGroupId(groupId);
    setEditingName(currentName);
  };

  const handleDeleteGroup = (groupId: string) => {
    setContextMenu(null);
    removeBookmarkGroup(groupId);
  };

  const handleRemoveBookmark = (bookmarkId: string) => {
    setContextMenu(null);
    removeBookmark(bookmarkId);
  };

  const handleBookmarkActiveTab = () => {
    if (activeNoteId && activeNote) {
      if (isBookmarked(activeNoteId)) {
        const b = getBookmarkForNote(activeNoteId);
        if (b) removeBookmark(b.id);
      } else {
        addBookmark(activeNoteId);
      }
    }
  };

  // Get group name for context menu
  const getGroupName = (groupId: string): string => {
    const item = bookmarks.find(b => b.id === groupId);
    if (item && item.kind === "group") {
      return (item as BookmarkGroup).name;
    }
    return "";
  };

  // ── render a single note bookmark row ─────────────────────────────────
  const renderNoteBookmark = (b: NoteBookmark, indent = false) => {
  const title = b.label ?? noteTitle(b.noteId);
  const noteExists = notes.some((n) => n.id === b.noteId);
  return (
    <div
      key={b.id}
      draggable
      onDragStart={() => handleDragStart(b.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => handleDrop(b.id)}
      onContextMenu={(e) => handleContextMenu(e, b.id, "note")}
      className={`
        group flex items-center gap-2 px-3 py-1.5 cursor-pointer
        hover:bg-black/6 dark:hover:bg-white/7 rounded-md mx-1
        ${indent ? "pl-7" : ""}
        ${draggingId === b.id ? "opacity-40" : ""}
        ${!noteExists ? "opacity-50" : ""}
      `}
      onClick={() => {
        if (noteExists) {
          setActiveNote(b.noteId);
          replaceTab(b.noteId);
        }
      }}
    >
      <svg width="13" height="13" viewBox="0 0 11 11" fill="none"
        className="text-idemora-text-faint shrink-0">
        <path d="M2 1h7v9L5.5 7 2 10V1z"
          stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span className="text-sm text-idemora-text-normal truncate flex-1">
        {title}
      </span>
    </div>
  );
};

  // ── render a group ─────────────────────────────────────────────────────
  const renderGroup = (g: BookmarkGroup) => {
    const children = groupChildren(g.id);
    const isEditing = editingGroupId === g.id;
    return (
      <div key={g.id}
        draggable
        onDragStart={() => handleDragStart(g.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => handleDrop(g.id)}
        onContextMenu={(e) => handleContextMenu(e, g.id, "group")}
        className={draggingId === g.id ? "opacity-40" : ""}
      >
        <div className="group flex items-center gap-1.5 px-3 py-1.5
                        hover:bg-black/6 dark:hover:bg-white/7 rounded-md mx-1 cursor-pointer"
          onClick={() => toggleBookmarkGroupCollapsed(g.id)}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none"
            className="text-idemora-text-faint shrink-0 transition-transform"
            style={{ transform: g.collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          >
            <path d="M2 3l2.5 3L7 3"
              stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {isEditing ? (
            <input
              autoFocus
              className="flex-1 text-sm bg-transparent border-b border-idemora-border
                         outline-none text-idemora-text-normal"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameBookmarkGroup(g.id, editingName.trim() || g.name);
                  setEditingGroupId(null);
                }
                if (e.key === "Escape") setEditingGroupId(null);
              }}
              onBlur={() => {
                renameBookmarkGroup(g.id, editingName.trim() || g.name);
                setEditingGroupId(null);
              }}
            />
          ) : (
            <span className="flex-1 text-sm font-medium text-idemora-text-muted truncate">
              {g.name}
            </span>
          )}
          <span className="text-[10px] text-idemora-text-faint mr-1">
            {children.length}
          </span>
        </div>
        {!g.collapsed && children.map((b) => renderNoteBookmark(b, true))}
      </div>
    );
  };

  const btnClass = "w-8 h-8 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/6 dark:hover:bg-white/7 transition-colors duration-150";

  // Expand all icon (chevrons pointing away - both up)
  const ExpandAllIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 10l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  // Collapse all icon (chevrons pointing toward - down and up)
  const CollapseAllIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M4 3.5l4 2.5 4-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 12.5l4-2.5 4 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

  // ── empty state ────────────────────────────────────────────────────────
  if (bookmarks.length === 0 && !addingGroup) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-idemora-bg-secondary">
        <div className="flex items-center justify-center gap-1 px-2 pt-2 pb-2 shrink-0">
          <button onClick={handleBookmarkActiveTab} title="Bookmark current note" className={btnClass}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 2h10v12l-5-3-5 3V2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={() => setAddingGroup(true)} title="New group" className={btnClass}>
            <FolderPlusIcon />
          </button>
          <button onClick={toggleExpandCollapseAll} title={allExpanded ? "Collapse all" : "Expand all"} className={btnClass}>
            {allExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />}
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-idemora-text-faint">
            <path d="M5 3h14v18l-7-4-7 4V3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          <p className="text-xs text-idemora-text-muted">No bookmarks yet</p>
          <p className="text-xs text-idemora-text-faint">Click the bookmark icon to save current note</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-idemora-bg-secondary">
      <div className="flex items-center justify-center gap-1 px-2 pt-2 pb-2 shrink-0">
        <button onClick={handleBookmarkActiveTab} title="Bookmark current note" className={btnClass}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 2h10v12l-5-3-5 3V2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={() => setAddingGroup(true)} title="New group" className={btnClass}>
          <FolderPlusIcon />
        </button>
        <button onClick={toggleExpandCollapseAll} title={allExpanded ? "Collapse all" : "Expand all"} className={btnClass}>
          {allExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {addingGroup && (
          <div className="flex items-center gap-2 px-3 py-1.5 mx-1">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="text-idemora-text-faint shrink-0">
              <path d="M2 3l2.5 3L7 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              placeholder="Group name…"
              className="flex-1 text-sm bg-transparent border-b border-idemora-border outline-none text-idemora-text-normal placeholder-idemora-text-faint"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && newGroupName.trim()) {
                  await addBookmarkGroup(newGroupName.trim());
                  setNewGroupName("");
                  setAddingGroup(false);
                }
                if (e.key === "Escape") {
                  setNewGroupName("");
                  setAddingGroup(false);
                }
              }}
              onBlur={() => {
                if (newGroupName.trim()) {
                  addBookmarkGroup(newGroupName.trim());
                }
                setNewGroupName("");
                setAddingGroup(false);
              }}
            />
          </div>
        )}

        {topLevel.map((item) =>
          item.kind === "group"
            ? renderGroup(item as BookmarkGroup)
            : renderNoteBookmark(item as NoteBookmark)
        )}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: contextMenu.pos.x,
            ...(contextMenu.pos.flip
              ? { bottom: window.innerHeight - contextMenu.pos.y }
              : { top: contextMenu.pos.y }),
            zIndex: 9999,
            minWidth: 160,
          }}
          className="py-1 rounded-lg shadow-xl bg-idemora-bg-secondary border border-idemora-border"
        >
          {contextMenu.kind === "group" ? (
            <>
              <button
                onMouseDown={(e) => { e.preventDefault(); handleRenameGroup(contextMenu.id, getGroupName(contextMenu.id)); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7 transition-colors duration-100"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1.5 9l1-3.5L9 1.5 10.5 3 4 9.5 1.5 9z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                </svg>
                Rename group
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); handleDeleteGroup(contextMenu.id); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors duration-100"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 3h8M4.5 3V2h3v1M3.5 3l.5 7h4l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                Delete group
              </button>
            </>
          ) : (
            <button
              onMouseDown={(e) => { e.preventDefault(); handleRemoveBookmark(contextMenu.id); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors duration-100"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              Remove bookmark
            </button>
          )}
        </div>
      )}
    </div>
  );
}