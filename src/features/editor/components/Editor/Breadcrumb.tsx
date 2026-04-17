import { memo, useCallback } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { Note } from "@/types";

function getAncestors(noteId: string, notes: Note[]): Note[] {
  const noteMap = new Map(notes.map((n) => [n.id, n]));
  const ancestors: Note[] = [];
  let currentId = noteId;

  while (currentId) {
    const note = noteMap.get(currentId);
    if (!note) break;

    const parentId = note.parent_id;
    if (!parentId) break;

    const parent = noteMap.get(parentId);
    if (!parent) break;

    ancestors.unshift(parent);
    currentId = parentId;
  }

  return ancestors;
}

interface Props {
  noteId: string;
  paneId?: 1 | 2;
}

export const Breadcrumb = memo(({ noteId, paneId = 1 }: Props) => {
  const notes = useNoteStore((s) => s.notes);
  const setActive = useNoteStore((s) => s.setActiveNote);
  const replaceTab = useUIStore((s) => s.replaceTab);
  const replacePane2Tab = useUIStore((s) => s.replacePane2Tab);
  const expandNode = useUIStore((s) => s.expandNode);
  const activeSidebarPanel = useUIStore((s) => s.activeSidebarPanel);
  const setActiveSidebarPanel = useUIStore((s) => s.setActiveSidebarPanel);

  const ancestors = getAncestors(noteId, notes);

  const handleClick = useCallback(
    (id: string) => {
      setActive(id);

      if (paneId === 2) {
        replacePane2Tab(id);
      } else {
        replaceTab(id);
      }

      expandNode(id);

      if (!activeSidebarPanel) {
        setActiveSidebarPanel("notes");
      }
    },
    [
      paneId,
      setActive,
      replaceTab,
      replacePane2Tab,
      expandNode,
      activeSidebarPanel,
      setActiveSidebarPanel,
    ]
  );

  if (ancestors.length === 0) return null;

  return (
    <nav
      className="flex items-center overflow-hidden"
      style={{ maxWidth: 400 }}
      aria-label="Breadcrumb"
    >
      {ancestors.map((ancestor, i) => (
        <div key={ancestor.id} className="flex items-center min-w-0">
          <button
            onClick={() => handleClick(ancestor.id)}
            title={ancestor.title}
            className="text-base text-idemora-text-faint hover:text-idemora-text-muted transition-colors duration-100 truncate max-w-[140px]"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            {ancestor.title}
          </button>

          {i < ancestors.length - 1 && (
            <span className="mx-2 text-idemora-text-faint shrink-0">
              /
            </span>
          )}
        </div>
      ))}

      {/* trailing slash */}
      <span className="ml-2 text-idemora-text-faint shrink-0">/</span>
    </nav>
  );
});

Breadcrumb.displayName = "Breadcrumb";