// src/features/notes/components/Sidebar/index.tsx
import { useEffect, useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { cancelSidebarCollapse, scheduleSidebarCollapse } from "@/lib/sidebarTimer";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";
import { getAllTags } from "@/features/notes/db/queries";
import { NoteTree } from "./NoteTree";
import { SearchBar } from "./SearchBar";

function daysLeft(deletedAt: number): number {
  const msLeft = deletedAt + 30 * 24 * 60 * 60 * 1000 - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

const CONFIRM_CLOSED: ConfirmState = {
  open: false, title: "", message: "", confirmLabel: "", onConfirm: () => {},
};

export function Sidebar() {
  const loadNotes             = useNoteStore((s) => s.loadNotes);
  const loadTrashedNotes      = useNoteStore((s) => s.loadTrashedNotes);
  const createNote            = useNoteStore((s) => s.createNote);
  const trashedNotes          = useNoteStore((s) => s.trashedNotes);
  const notes                 = useNoteStore((s) => s.notes);
  const restoreNote           = useNoteStore((s) => s.restoreNote);
  const permanentlyDeleteNote = useNoteStore((s) => s.permanentlyDeleteNote);
  const emptyTrash            = useNoteStore((s) => s.emptyTrash);

  const sidebarState    = useUIStore((s) => s.sidebarState);
  const setSidebarState = useUIStore((s) => s.setSidebarState);
  const activeTag       = useUIStore((s) => s.activeTag);
  const setActiveTag    = useUIStore((s) => s.setActiveTag);

  const [trashOpen, setTrashOpen]   = useState(false);
  const [tagsOpen, setTagsOpen]     = useState(false);
  const [confirm, setConfirm]       = useState<ConfirmState>(CONFIRM_CLOSED);
  const [allTags, setAllTags]       = useState<string[]>([]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  useEffect(() => {
    if (trashOpen) loadTrashedNotes();
  }, [trashOpen, loadTrashedNotes]);

  // Reload tags whenever notes change
  useEffect(() => {
    getAllTags().then(setAllTags).catch(console.error);
  }, [notes]);

  const isOpen    = sidebarState === "open";
  const isPeek    = sidebarState === "peek";
  const isVisible = isOpen || isPeek;

  function collapse() { if (useUIStore.getState().sidebarState === "peek") setSidebarState("closed"); }
  function lock()     { cancelSidebarCollapse(); setSidebarState("open"); }
  function close()    { cancelSidebarCollapse(); setSidebarState("closed"); }

  function askConfirm(opts: Omit<ConfirmState, "open">) {
    setConfirm({ open: true, ...opts });
  }

  function handleEmptyTrash() {
    askConfirm({
      title: "Empty Trash",
      message: `Permanently delete all ${trashedNotes.length} trashed note${trashedNotes.length !== 1 ? "s" : ""}? This cannot be undone.`,
      confirmLabel: "Empty Trash",
      onConfirm: async () => {
        setConfirm(CONFIRM_CLOSED);
        await emptyTrash();
      },
    });
  }

  function handlePermanentlyDelete(id: string, title: string) {
    askConfirm({
      title: "Delete Permanently",
      message: `"${title}" will be deleted forever and cannot be recovered.`,
      confirmLabel: "Delete Forever",
      onConfirm: async () => {
        setConfirm(CONFIRM_CLOSED);
        await permanentlyDeleteNote(id);
      },
    });
  }

  // Count notes per tag
  function tagCount(tag: string): number {
    return notes.filter((n) => {
      if (!n.tags) return false;
      try { return (JSON.parse(n.tags) as string[]).includes(tag); }
      catch { return false; }
    }).length;
  }

  return (
    <>
      <aside
        id="sidebar-panel"
        onMouseEnter={() => cancelSidebarCollapse()}
        onMouseLeave={() => { if (useUIStore.getState().sidebarState === "peek") scheduleSidebarCollapse(collapse); }}
        style={{ width: isVisible ? "288px" : "0px", opacity: isVisible ? 1 : 0 }}
        className={`flex flex-col h-full shrink-0 bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 overflow-hidden transition-[width,opacity] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isPeek ? "absolute left-0 top-0 z-40 shadow-2xl" : "relative"}`}
      >
        {/* Top bar */}
        <div className="flex items-center justify-end gap-1 px-3 pt-4 pb-3 shrink-0">
          {isPeek && (
            <button onClick={lock} title="Lock sidebar open" className="w-7 h-7 flex flex-col items-center justify-center gap-[4.5px] rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 mr-auto transition-colors duration-150">
              <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
              <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
              <span className="w-3.5 h-[1.5px] bg-current rounded-full" />
            </button>
          )}
          {isOpen && <div className="flex-1" />}
          {isOpen && (
            <button onClick={close} title="Close sidebar (Ctrl+\)" className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5 2L0 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
              </svg>
            </button>
          )}
          <button onClick={() => createNote()} title="New note (Ctrl+N)" className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M9.5 2.5L12.5 5.5M2 13l1-4L10.5 1.5a1.414 1.414 0 012 2L5 11l-3 1z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-3 shrink-0"><SearchBar /></div>
        <div className="mx-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />

        {/* Note tree */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
          <NoteTree />
        </div>

        {/* ── Tags section ──────────────────────────────────────────────────── */}
        {allTags.length > 0 && (
          <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setTagsOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-zinc-400 shrink-0">
                <path d="M1.5 1.5h4l5.5 5.5-4 4L1.5 5.5v-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                <circle cx="4" cy="4" r="0.8" fill="currentColor"/>
              </svg>
              <span className="flex-1 text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">Tags</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-600 tabular-nums">{allTags.length}</span>
              <svg
                width="10" height="10" viewBox="0 0 10 10" fill="none"
                className={`text-zinc-400 shrink-0 transition-transform duration-200 ${tagsOpen ? "rotate-180" : ""}`}
              >
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {tagsOpen && (
              <div className="max-h-48 overflow-y-auto pb-1">
                <div className="flex flex-wrap gap-1.5 px-3 py-2">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors duration-100 ${
                        activeTag === tag
                          ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-800 dark:border-zinc-100"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
                      }`}
                    >
                      <span className="opacity-60">#</span>{tag}
                      <span className={`tabular-nums ${activeTag === tag ? "opacity-60" : "opacity-40"}`}>
                        {tagCount(tag)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Trash section ─────────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setTrashOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-100 group"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-zinc-400 shrink-0">
              <path d="M2 3h9M5 3V2h3v1M3.5 3l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="flex-1 text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">Trash</span>
            {trashedNotes.length > 0 && (
              <span className="text-xs text-zinc-400 dark:text-zinc-600 tabular-nums">{trashedNotes.length}</span>
            )}
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`text-zinc-400 shrink-0 transition-transform duration-200 ${trashOpen ? "rotate-180" : ""}`}
            >
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {trashOpen && (
            <div className="max-h-56 overflow-y-auto">
              {trashedNotes.length === 0 ? (
                <p className="px-4 py-3 text-xs text-zinc-400 dark:text-zinc-600">Trash is empty.</p>
              ) : (
                <>
                  <div className="flex items-center justify-end px-3 pb-1">
                    <button
                      onClick={handleEmptyTrash}
                      className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-400 transition-colors duration-100"
                    >
                      Empty Trash
                    </button>
                  </div>
                  <ul className="pb-1">
                    {trashedNotes.map((note) => (
                      <li key={note.id} className="group flex items-center gap-1.5 px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-75">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-300 dark:text-zinc-600 shrink-0">
                          <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                          <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate line-through">{note.title}</p>
                          {note.deleted_at && (
                            <p className="text-[10px] text-zinc-300 dark:text-zinc-700 tabular-nums">
                              {daysLeft(note.deleted_at)}d left
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-100 shrink-0">
                          <button
                            onClick={() => restoreNote(note.id)}
                            title="Restore"
                            className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-colors duration-75"
                          >
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                              <path d="M1.5 5.5A4 4 0 109.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                              <path d="M1.5 2.5v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => handlePermanentlyDelete(note.id, note.title)}
                            title="Delete permanently"
                            className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors duration-75"
                          >
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                              <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {sidebarState === "closed" && (
        <div
          onMouseEnter={() => { cancelSidebarCollapse(); setSidebarState("peek"); }}
          className="absolute left-0 top-0 w-6 h-full z-50"
        />
      )}

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        danger
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm(CONFIRM_CLOSED)}
      />
    </>
  );
}