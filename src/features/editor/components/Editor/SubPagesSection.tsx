// src/features/editor/components/Editor/SubPagesSection.tsx
import { useState, useRef, useEffect } from "react";
import { createNote as dbCreateNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { MoveNoteModal } from "@/features/ui/components/MoveNoteModal";

interface Props {
  noteId: string;
  paneId: 1 | 2;
}

export function SubPagesSection({ noteId, paneId }: Props) {
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
  const inputRef                  = useRef<HTMLInputElement>(null);

  const children = notes.filter((n) => n.parent_id === noteId && !n.deleted_at);

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

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

    // Create directly via DB — bypasses setActiveNote in the store so we
    // stay on the current note. The card appears in the grid without navigation.
    const note = await dbCreateNote({ parent_id: noteId, title });
    useNoteStore.setState((s) => ({ notes: [...s.notes, note] }));
    expandNode(noteId);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  { e.preventDefault(); handleCreateNote(); }
    if (e.key === "Escape") { setIsAdding(false); setNewTitle(""); }
  }

  if (children.length === 0 && !isAdding) return null;

  return (
    <div className="w-full mx-auto px-8 pb-10 max-w-2xl xl:max-w-3xl 2xl:max-w-4xl">
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
            Sub-pages
          </span>
          {!isAdding && (
            <button
              onClick={handleAddClick}
              className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors duration-100"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Add sub-page
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {children.map((child) => {
            const isUntitled   = /^Untitled-\d+$/.test(child.title);
            const snippet      = child.plaintext?.slice(0, 80) ?? "";
            const isConfirming = confirmId === child.id;
            const isMoving     = moveId === child.id;

            return (
              <div key={child.id} className="relative group">
                <button
                  onClick={(e) => handleOpen(child.id, e)}
                  title="Click to open · Ctrl+click for new tab"
                  className="w-full text-left rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-white dark:hover:bg-zinc-800 hover:shadow-sm transition-all duration-150 p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="text-zinc-400 dark:text-zinc-500 shrink-0">
                      <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <span className={`text-sm font-medium truncate pr-12 ${isUntitled ? "text-zinc-400 dark:text-zinc-600 italic" : "text-zinc-700 dark:text-zinc-200 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"} transition-colors duration-100`}>
                      {isUntitled ? "Untitled" : child.title}
                    </span>
                  </div>
                  {snippet && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate leading-relaxed">
                      {snippet}
                    </p>
                  )}
                </button>

                {/* Action buttons container - only visible on hover */}
                {!isConfirming && !isMoving && (
                  <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); setMoveId(child.id); }}
                      title="Move to another page"
                      className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-all duration-100"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M6 1.5L8 3 6 4.5M2 3h6M4 6.5L2 8 4 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M2 8h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmId(child.id); }}
                      title="Move to trash"
                      className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-all duration-100"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 2.5h7M4 2.5V1.5h2V2.5M3 2.5v6a.5.5 0 00.5.5h3a.5.5 0 00.5-.5v-6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                )}

                {/* Delete confirmation overlay */}
                {isConfirming && (
                  <div className="absolute inset-0 rounded-lg bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900 flex items-center justify-between px-3 gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      Move to trash?
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleConfirmDelete(child.id)}
                        className="px-2 py-0.5 rounded text-xs font-medium bg-red-500 hover:bg-red-600 text-white transition-colors duration-100"
                      >
                        Trash
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="px-2 py-0.5 rounded text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Move modal for this sub-note */}
                <MoveNoteModal
                  open={isMoving}
                  noteId={child.id}
                  onClose={() => setMoveId(null)}
                />
              </div>
            );
          })}

          {/* Inline title input */}
          {isAdding && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-zinc-900 p-3 flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="text-zinc-400 dark:text-zinc-500 shrink-0">
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
                className="flex-1 text-sm bg-transparent outline-none text-zinc-700 dark:text-zinc-200 placeholder-zinc-300 dark:placeholder-zinc-600"
              />
              <button
                onClick={handleCreateNote}
                className="text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium transition-colors duration-100"
              >
                Create
              </button>
              <button
                onClick={() => { setIsAdding(false); setNewTitle(""); }}
                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}