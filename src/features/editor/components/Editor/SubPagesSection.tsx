// src/features/editor/components/Editor/SubPagesSection.tsx
import { useState, useRef, useEffect } from "react";
import { createNote as dbCreateNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { MoveNoteModal } from "@/features/ui/components/MoveNoteModal";
import type { Editor } from "@tiptap/react";

interface Props {
  noteId: string;
  paneId: 1 | 2;
  editor: Editor | null;
}

export function SubPagesSection({ noteId, paneId, editor }: Props) {
  const notes      = useNoteStore((s) => s.notes);
  const setActive  = useNoteStore((s) => s.setActiveNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const expandNode = useUIStore((s) => s.expandNode);
  const openTab    = useUIStore((s) => s.openTab);
  const replaceTab = useUIStore((s) => s.replaceTab);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [moveId, setMoveId]       = useState<string | null>(null);
  const [isAdding, setIsAdding]   = useState(false);
  const [newTitle, setNewTitle]   = useState("");
  const [expanded, setExpanded]   = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);

  const children = notes.filter((n) => n.parent_id === noteId && !n.deleted_at);
  const PREVIEW_COUNT = 4;
  const hasMore = children.length > PREVIEW_COUNT;
  const visibleChildren = expanded ? children : children.slice(0, PREVIEW_COUNT);

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  useEffect(() => {
    setExpanded(false);
  }, [noteId]);

  function openInSameTab(childId: string) {
    if (paneId === 2) {
      useUIStore.setState((s) => ({
        pane2Tabs: s.pane2Tabs.map((t) =>
          t.id === s.pane2ActiveTabId ? { ...t, noteId: childId } : t
        ),
      }));
    } else {
      setActive(childId);
      replaceTab(childId);
    }
  }

  function openInNewTab(childId: string) {
    if (paneId === 2) {
      useUIStore.getState().openTabInPane2(childId);
    } else {
      openTab(childId);
    }
  }

  function handleOpen(childId: string, e: React.MouseEvent) {
    if (confirmId === childId) return;
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (isCtrl) { openInNewTab(childId); } else { openInSameTab(childId); }
  }

  async function handleConfirmDelete(childId: string) {
    await deleteNote(childId);
    setConfirmId(null);
  }

  function handleAddClick() {
    setNewTitle("");
    setIsAdding(true);
  }

  async function handleCreateNote() {
    if (!isAdding) return;
    setIsAdding(false);

    const title = newTitle.trim() ||
      `Untitled-${notes.filter((n) => /^Untitled-\d+$/.test(n.title)).length + 1}`;
    setNewTitle("");

    const note = await dbCreateNote({ parent_id: noteId, title });
    useNoteStore.setState((s) => ({ notes: [...s.notes, note] }));
    expandNode(noteId);

    if (editor && !editor.isDestroyed) {
      const { doc } = editor.state;
      const last = doc.lastChild;
      const lastIsEmptyPara = last?.type.name === "paragraph" && last.content.size === 0;
      const insertPos = lastIsEmptyPara
        ? doc.content.size - last.nodeSize
        : doc.content.size;
      editor
        .chain()
        .insertContentAt(insertPos, {
          type: "subPage",
          attrs: { noteId: note.id, title, mode: "display" },
        })
        .run();
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  { e.preventDefault(); handleCreateNote(); }
    if (e.key === "Escape") { setIsAdding(false); setNewTitle(""); }
  }

  if (children.length === 0 && !isAdding) return null;

  return (
    <div className="w-full mx-auto px-8 pb-10 max-w-2xl xl:max-w-3xl 2xl:max-w-4xl">
      <div className="border-t border-idemora-border pt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-idemora-text-muted">
            Sub-pages
          </span>
          {!isAdding && (
            <button
              onClick={handleAddClick}
              className="flex items-center gap-1 text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Add sub-page
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleChildren.map((child) => {
            const isUntitled   = /^Untitled-\d+$/.test(child.title);
            const snippet      = child.plaintext?.slice(0, 80) ?? "";
            const isConfirming = confirmId === child.id;
            const isMoving     = moveId === child.id;

            return (
              <div
                key={child.id}
                className="relative group rounded-lg bg-idemora-bg-primary hover-card transition-all duration-150"
              >
                <button
                  onClick={(e) => handleOpen(child.id, e)}
                  title="Click to open · Ctrl+click for new tab"
                  className="w-full text-left p-3 bg-transparent"
                >
                <div className="flex items-center gap-2 mb-1">
                {child.source_type === "pdf" ? (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="text-red-400 shrink-0">
                    <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M7.5 1.5V4H10" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                  </svg>
                ) : child.source_type === "docx" ? (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="text-blue-400 shrink-0">
                    <path d="M2 1.5h5.5L10 4v6.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-9a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M7.5 1.5V4H10" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M4 6.5h4M4 8.5h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="text-idemora-text-muted shrink-0">
                      <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                  )}
                  <span className={`text-sm font-medium truncate pr-12 ${
                    child.source_type === "pdf"  ? "text-red-400"  :
                    child.source_type === "docx" ? "text-blue-400" :
                    isUntitled ? "text-idemora-text-muted italic" : "text-idemora-text-normal"
                  }`}>
                    {isUntitled && !["pdf","docx"].includes(child.source_type ?? "") ? "Untitled" : child.title}
                  </span>
                  {child.source_type === "pdf" && (
                    <span className="text-[9px] font-semibold tracking-wide text-red-400 opacity-60 shrink-0">PDF</span>
                  )}
                  {child.source_type === "docx" && (
                    <span className="text-[9px] font-semibold tracking-wide text-blue-400 opacity-60 shrink-0">DOC</span>
                  )}
                </div>
                  {snippet && (
                    <p className="text-xs text-idemora-text-muted truncate leading-relaxed">
                      {snippet}
                    </p>
                  )}
                </button>

                {!isConfirming && !isMoving && (
                  <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMoveId(child.id); }}
                      title="Move to another page"
                      className="w-5 h-5 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal transition-all duration-100"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M6 1.5L8 3 6 4.5M2 3h6M4 6.5L2 8 4 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M2 8h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmId(child.id); }}
                      title="Move to trash"
                      className="w-5 h-5 flex items-center justify-center rounded text-idemora-text-muted hover:text-red-400 transition-all duration-100"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 2.5h7M4 2.5V1.5h2V2.5M3 2.5v6a.5.5 0 00.5.5h3a.5.5 0 00.5-.5v-6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                )}

                {isConfirming && (
                  <div className="absolute inset-0 rounded-lg bg-idemora-bg-primary flex items-center justify-between px-3 gap-2">
                    <span className="text-xs text-idemora-text-muted truncate">
                      Move to trash?
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleConfirmDelete(child.id)}
                        className="px-2 py-0.5 rounded text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors duration-100"
                      >
                        Trash
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="px-2 py-0.5 rounded text-xs font-medium text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isMoving && (
                  <MoveNoteModal
                    open={isMoving}
                    noteId={child.id}
                    onClose={() => setMoveId(null)}
                  />
                )}
              </div>
            );
          })}

          {isAdding && (
            <div className="rounded-lg bg-idemora-bg-primary p-3 flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="text-idemora-text-muted shrink-0">
                <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Note title…"
                className="flex-1 text-sm bg-transparent outline-none text-idemora-text-normal placeholder-idemora-text-faint"
              />
              <button
                onClick={handleCreateNote}
                className="text-xs text-blue-500 hover:text-blue-400 font-medium transition-colors duration-100"
              >
                Create
              </button>
              <button
                onClick={() => { setIsAdding(false); setNewTitle(""); }}
                className="text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {hasMore && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="mt-3 flex items-center gap-1.5 text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
          >
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            >
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {expanded ? "Show less" : `Show all ${children.length} sub-pages`}
          </button>
        )}
      </div>
    </div>
  );
}