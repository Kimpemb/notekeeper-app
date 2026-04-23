// src/features/notes/components/Sidebar/TrashPanel.tsx
import { useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

const PURGE_DAYS = 30;

function daysLeft(deletedAt: number): number {
  const elapsed = Math.floor((Date.now() - deletedAt) / (1000 * 60 * 60 * 24));
  return Math.max(0, PURGE_DAYS - elapsed);
}

export function TrashPanel() {
  const trashedNotes          = useNoteStore((s) => s.trashedNotes);
  const loadTrashedNotes      = useNoteStore((s) => s.loadTrashedNotes);
  const restoreNote           = useNoteStore((s) => s.restoreNote);
  const permanentlyDeleteNote = useNoteStore((s) => s.permanentlyDeleteNote);
  const emptyTrash            = useNoteStore((s) => s.emptyTrash);
  const setActiveNote         = useNoteStore((s) => s.setActiveNote);
  const replaceTab            = useUIStore((s) => s.replaceTab);
  const activePaneId          = useUIStore((s) => s.activePaneId);
  const replacePane2Tab       = useUIStore((s) => s.replacePane2Tab);

  useEffect(() => {
    loadTrashedNotes().catch(console.error);
  }, [loadTrashedNotes]);

  const btnClass = "w-8 h-8 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/6 dark:hover:bg-white/7 transition-colors duration-150";

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header — centered like NotesPanel/BookmarksPanel */}
      <div className="flex items-center justify-center gap-2 px-2 pt-2 pb-2 shrink-0">
        <button
          onClick={() => emptyTrash().catch(console.error)}
          title="Empty trash"
          disabled={trashedNotes.length === 0}
          className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed hover:text-red-400`}
        >
          <svg width="18" height="18" viewBox="0 0 640 640" fill="none">
            <path d="M216.3 124C262.5 44 378 44 424.2 124L461.5 188.6L489.2 172.6C497.6 167.7 508.1 168.4 515.8 174.3C523.5 180.2 526.9 190.2 524.4 199.6L500.9 287C497.5 299.8 484.3 307.4 471.5 304L384.1 280.6C374.7 278.1 367.8 270.2 366.5 260.6C365.2 251 369.9 241.5 378.3 236.7L406 220.7L368.7 156.1C347.1 118.8 293.3 118.8 271.7 156.1L266.4 165.2C257.6 180.5 238 185.7 222.7 176.9C207.4 168.1 202.2 148.5 211 133.1L216.3 124zM513.7 343.1C529 334.3 548.6 339.5 557.4 354.8L562.7 363.9C608.9 443.9 551.2 543.9 458.8 543.9L384.2 543.9L384.2 575.9C384.2 585.6 378.4 594.4 369.4 598.1C360.4 601.8 350.1 599.8 343.2 592.9L279.2 528.9C269.8 519.5 269.8 504.3 279.2 495L343.2 431C350.1 424.1 360.4 422.1 369.4 425.8C378.4 429.5 384.2 438.3 384.2 448L384.2 480L458.8 480C501.9 480 528.9 433.3 507.3 396L502 386.9C493.2 371.6 498.4 352 513.7 343.2zM115 299.4L87.3 283.4C78.9 278.5 74.2 269.1 75.5 259.5C76.8 249.9 83.7 242 93.1 239.5L180.5 216C193.3 212.6 206.5 220.2 209.9 233L233.3 320.4C235.8 329.8 232.4 339.7 224.7 345.7C217 351.7 206.5 352.3 198.1 347.4L170.4 331.4L133.1 396C111.5 433.3 138.5 480 181.6 480L192.2 480C209.9 480 224.2 494.3 224.2 512C224.2 529.7 209.9 544 192.2 544L181.6 544C89.3 544 31.6 444 77.8 364L115 299.4z" fill="currentColor"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        {trashedNotes.length === 0 ? (
          <p className="px-4 py-6 text-xs text-idemora-text-muted text-center select-none">
            Trash is empty
          </p>
        ) : (
          <ul className="px-2 space-y-0.5">
            {trashedNotes.map((note) => {
              const remaining = note.deleted_at ? daysLeft(note.deleted_at) : PURGE_DAYS;
              return (
                <li key={note.id}>
                  <div
                    className="group flex items-center gap-2 px-2 py-2 rounded-md hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 cursor-pointer"
                    onClick={() => {
                      if (activePaneId === 2) {
                        replacePane2Tab(note.id);
                      } else {
                        setActiveNote(note.id);
                        replaceTab(note.id);
                      }
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-idemora-text-muted">
                      <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <span className="flex-1 text-sm text-idemora-text-normal truncate min-w-0">
                      {note.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-idemora-text-faint tabular-nums">
                      {remaining}d
                    </span>
                    {/* Restore */}
                    <button
                      onClick={(e) => { e.stopPropagation(); restoreNote(note.id).catch(console.error); }}
                      title="Restore"
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-idemora-text-muted hover:text-blue-400 hover:bg-blue-500/10 transition-all duration-100"
                    >
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                        <path d="M2 7a5 5 0 105-5H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        <path d="M2 4v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    {/* Permanently delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); permanentlyDeleteNote(note.id).catch(console.error); }}
                      title="Delete permanently"
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-idemora-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all duration-100"
                    >
                      <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                        <path d="M2 3h9M5 3V2h3v1M3.5 3l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}