// src/features/notes/components/Sidebar/TrashPanel.tsx
import { useEffect } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

export function TrashPanel() {
  const trashedNotes        = useNoteStore((s) => s.trashedNotes);
  const loadTrashedNotes    = useNoteStore((s) => s.loadTrashedNotes);
  const restoreNote         = useNoteStore((s) => s.restoreNote);
  const permanentlyDeleteNote = useNoteStore((s) => s.permanentlyDeleteNote);
  const emptyTrash          = useNoteStore((s) => s.emptyTrash);
  const openImport          = useUIStore((s) => s.openImport);

  // Load trashed notes when panel mounts
  useEffect(() => {
    loadTrashedNotes().catch(console.error);
  }, [loadTrashedNotes]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 pt-2 pb-1.5 shrink-0">
        <span className="flex-1 px-1 text-[10px] font-semibold tracking-widest uppercase text-idemora-text-muted  select-none">
          Trash
        </span>
        {trashedNotes.length > 0 && (
          <button
            onClick={() => emptyTrash().catch(console.error)}
            title="Empty trash"
            className="flex items-center gap-1 px-2 h-6 rounded text-[11px] text-red-400  :text-red-400  :bg-red-950/40 transition-colors duration-100"
          >
            Empty
          </button>
        )}
      </div>

      <div className="mx-2 border-t border-idemora-border shrink-0" />

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 min-h-0">
        {trashedNotes.length === 0 ? (
          <p className="px-4 py-6 text-xs text-idemora-text-muted text-center select-none">
            Trash is empty
          </p>
        ) : (
          <ul className="px-2 space-y-0.5">
            {trashedNotes.map((note) => (
              <li key={note.id}>
                <div className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md   transition-colors duration-100">
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0 text-idemora-text-normal ">
                    <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <span className="flex-1 text-xs text-idemora-text-muted truncate min-w-0">
                    {note.title}
                  </span>
                  {/* Restore */}
                  <button
                    onClick={() => restoreNote(note.id).catch(console.error)}
                    title="Restore"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded opacity-0 group- text-idemora-text-muted     transition-all duration-100"
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                      <path d="M2 7a5 5 0 105-5H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      <path d="M2 4v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {/* Permanently delete */}
                  <button
                    onClick={() => permanentlyDeleteNote(note.id).catch(console.error)}
                    title="Delete permanently"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded opacity-0 group- text-idemora-text-muted   :bg-red-950/40 transition-all duration-100"
                  >
                    <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                      <path d="M2 3h9M5 3V2h3v1M3.5 3l.5 8h5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Import link at the bottom */}
      <div className="px-3 py-2 shrink-0 border-t border-idemora-border">
        <button
          onClick={openImport}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-idemora-text-muted     transition-colors duration-100"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 10v2h10v-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Import notes
        </button>
      </div>
    </div>
  );
}