// src/features/editor/components/Editor/SubPagesSection.tsx
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

interface Props {
  noteId: string;
  paneId: 1 | 2;
}

export function SubPagesSection({ noteId, paneId }: Props) {
  const notes       = useNoteStore((s) => s.notes);
  const createChild = useNoteStore((s) => s.createChildNote);
  const setActive   = useNoteStore((s) => s.setActiveNote);
  const openTab     = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const expandNode  = useUIStore((s) => s.expandNode);

  const children = notes.filter((n) => n.parent_id === noteId && !n.deleted_at);

  if (children.length === 0) return null;

  function handleOpen(childId: string) {
  if (paneId === 2) {
    openTabInPane2(childId);
  } else {
    setActive(childId);
    openTab(childId);
  }
}
  async function handleAddSubPage() {
  const child = await createChild(noteId);
  expandNode(noteId);
  if (paneId === 2) {
    openTabInPane2(child.id);
  } else {
    setActive(child.id);
    openTab(child.id);
  }
}

  return (
    <div className="w-full mx-auto px-8 pb-10 max-w-2xl xl:max-w-3xl 2xl:max-w-4xl">
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
            Sub-pages
          </span>
          <button
            onClick={handleAddSubPage}
            className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors duration-100"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Add sub-page
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {children.map((child) => {
            const isUntitled = /^Untitled-\d+$/.test(child.title);
            const snippet    = child.plaintext?.slice(0, 80) ?? "";
            return (
              <button
                key={child.id}
                onClick={() => handleOpen(child.id)}
                className="group text-left rounded-lg border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-white dark:hover:bg-zinc-800 hover:shadow-sm transition-all duration-150 p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="text-zinc-400 dark:text-zinc-500 shrink-0">
                    <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <span className={`text-sm font-medium truncate ${isUntitled ? "text-zinc-400 dark:text-zinc-600 italic" : "text-zinc-700 dark:text-zinc-200 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"} transition-colors duration-100`}>
                    {isUntitled ? "Untitled" : child.title}
                  </span>
                </div>
                {snippet && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate leading-relaxed">
                    {snippet}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}