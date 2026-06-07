import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

export function PDFLinkNodeView({ node }: NodeViewProps) {
  const { noteId, title } = node.attrs as { noteId: string; title: string };

  const notes      = useNoteStore((s) => s.notes);
  const openTab    = useUIStore((s) => s.openTab);
  const replaceTab = useUIStore((s) => s.replaceTab);
  const setActive  = useNoteStore((s) => s.setActiveNote);

  const liveTitle = notes.find((n) => n.id === noteId)?.title ?? title;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!noteId) return;
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (isCtrl) {
      openTab(noteId);
    } else {
      setActive(noteId);
      replaceTab(noteId);
    }
  }

  return (
    <NodeViewWrapper className="pdf-link-node-wrapper my-0.5">
      <div
        onClick={handleClick}
        className="group flex items-center gap-2.5 px-1 py-1.5 rounded-md w-full cursor-pointer transition-colors duration-100 hover:bg-red-500/5"
        title="Click to open · Ctrl+click for new tab"
      >
        {/* Red PDF icon */}
        <span className="shrink-0 text-red-400">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
              stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
          </svg>
        </span>

        {/* Title */}
        <span className="flex-1 text-base text-idemora-text-normal select-none group-hover:text-red-400 transition-colors duration-150">
          {liveTitle}
        </span>

        {/* PDF badge */}
        <span className="shrink-0 text-[9px] font-semibold tracking-wide text-red-400 opacity-60 mr-1">
          PDF
        </span>
      </div>
    </NodeViewWrapper>
  );
}