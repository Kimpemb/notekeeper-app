import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { createNote as dbCreateNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";

// Shape of what we read from editor.storage["subPage"]
interface SubPageStorage {
  parentNoteId: string;
  paneId: 1 | 2;
  setCreating: (v: boolean) => void;
}

// Shape of the custom event fired by useBlockMenu when Delete is clicked
// on a subPage node.
interface DeleteSubpageDetail {
  noteId:     string | null;
  nodePos:    number;
  deleteNode: () => void;
}

export function SubPageNodeView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const { noteId, title, mode } = node.attrs as {
    noteId: string | null;
    title: string;
    mode: "editing" | "display";
  };

  const storage = (editor.storage as unknown as Record<string, unknown>)["subPage"] as
    SubPageStorage | undefined;

  const [inputValue, setInputValue] = useState(title);
  const inputRef      = useRef<HTMLInputElement>(null);
  const committedRef  = useRef(false);

  // ── Confirm dialog state (block menu delete) ──────────────────────────────
  const [confirmOpen,       setConfirmOpen]       = useState(false);
  const pendingDeleteRef = useRef<(() => void) | null>(null);

  const notes          = useNoteStore((s) => s.notes);
  const setActive      = useNoteStore((s) => s.setActiveNote);
  const trashNote      = useNoteStore((s) => s.deleteNote);
  const expandNode     = useUIStore((s) => s.expandNode);
  const openTab        = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const replaceTab     = useUIStore((s) => s.replaceTab);

  const graphMode     = (editor.storage as any)?.graphMode === true;
  const graphNavigate = (editor.storage as any)?.graphNavigate as ((nodeId: string) => void) | undefined;

  // Get source_type from the store for the icon
  const noteSourceType = useNoteStore((s) =>
    noteId ? (s.notes.find((n) => n.id === noteId)?.source_type ?? "note") : "note"
  )

  useEffect(() => {
    if (mode !== "editing") return;
    const el = inputRef.current;
    if (!el) return;
    setTimeout(() => { el.focus(); el.select(); }, 30);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  

  // ── Listen for block menu delete requests targeting this node ─────────────
  // useBlockMenu fires "idemora:request-delete-subpage" with { noteId, deleteNode }.
  // We match on noteId (or nodePos as fallback for unsaved nodes) and show the
  // confirm dialog. On confirm we trash the DB record then call their deleteNode
  // callback (which dispatches the PM transaction) so the editor stays in sync.
  useEffect(() => {
    function handleDeleteRequest(e: Event) {
      const detail = (e as CustomEvent<DeleteSubpageDetail>).detail;

      // Match this node: by noteId when saved, or by the absence of a noteId
      // when the block is still in "editing" mode (noteId === null).
      const isMatch = detail.noteId !== null
        ? detail.noteId === noteId
        : noteId === null;

      if (!isMatch) return;

      // Store the PM delete callback for after confirmation
      pendingDeleteRef.current = detail.deleteNode;
      setConfirmOpen(true);
    }

    window.addEventListener("idemora:request-delete-subpage", handleDeleteRequest);
    return () => window.removeEventListener("idemora:request-delete-subpage", handleDeleteRequest);
  }, [noteId]);

  // ── Confirm dialog handlers ───────────────────────────────────────────────

  async function handleConfirmDelete() {
    setConfirmOpen(false);
    const pmDelete = pendingDeleteRef.current;
    pendingDeleteRef.current = null;

    storage?.setCreating(true); // block reconciler while trash op is in flight

    if (noteId) {
      await trashNote(noteId);
    }

    // Remove the node from the editor via the callback from useBlockMenu
    pmDelete?.();

    setTimeout(() => storage?.setCreating(false), 300);
  }

  function handleCancelDelete() {
    setConfirmOpen(false);
    pendingDeleteRef.current = null;
  }

  // ── commit: called on Enter or blur in editing mode ──────────────────────
  async function commit(rawTitle: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    storage?.setCreating(true);                          // block reconciler
    const parentNoteId = storage?.parentNoteId ?? "";
    const finalTitle   = rawTitle.trim() || title;
    const note = await dbCreateNote({ parent_id: parentNoteId, title: finalTitle });
    useNoteStore.setState((s) => ({ notes: [...s.notes, note] }));
    expandNode(parentNoteId);
    updateAttributes({ noteId: note.id, title: finalTitle, mode: "display" });
    // Force autosave to flush immediately so the graph editor reads correct attrs
    window.dispatchEvent(new CustomEvent("idemora:force-save"));
    // Release guard after autosave has had time to complete
    setTimeout(() => storage?.setCreating(false), 500);
  }

  function cancel() {
    if (committedRef.current) return;
    committedRef.current = true;
    storage?.setCreating(false);
    deleteNode();
    setTimeout(() => editor.commands.focus(), 0);
  }

 
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter")  { e.preventDefault(); commit(inputValue); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  }

  
  function navigate(e: React.MouseEvent) {
    if (!noteId) return;

    if (graphMode && graphNavigate) {
      graphNavigate(noteId);
      return;
    }

    const paneId = storage?.paneId ?? 1;
    const isMac  = navigator.platform.toUpperCase().includes("MAC");
    const isCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (isCtrl) {
      paneId === 2 ? openTabInPane2(noteId) : openTab(noteId);
    } else {
      if (paneId === 2) {
        useUIStore.setState((s) => ({
          pane2Tabs: s.pane2Tabs.map((t) =>
            t.id === s.pane2ActiveTabId ? { ...t, noteId } : t
          ),
        }));
      } else {
        setActive(noteId);
        replaceTab(noteId);
      }
    }
  }

  function handleClick(e: React.MouseEvent) {
  e.stopPropagation();
  navigate(e);
}

  const liveTitle = noteId
    ? (notes.find((n) => n.id === noteId)?.title ?? title)
    : title;

  return (
    <NodeViewWrapper
      className="subpage-node-wrapper my-0.5"
      data-note-id={mode === "display" && noteId ? noteId : undefined}
    >
      {mode === "editing" ? (
        <div className="flex items-center gap-2.5 px-1 py-1.5 rounded-md">
          <PageIcon className="text-idemora-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => commit(inputValue)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Untitled"
            className="flex-1 bg-transparent outline-none border-none text-base text-idemora-text-normal placeholder-idemora-text-faint caret-idemora-text-normal"
          />
        </div>
      ) : (
        <div
          className={`group flex items-center gap-2.5 px-1 py-1.5 rounded-md w-full transition-colors duration-100 ${
            graphMode
              ? "cursor-pointer hover:bg-blue-500/10"
              : "cursor-default"
          }`}
          onClick={handleClick}
          title={graphMode ? "Click to open in graph" : "Click to open · Ctrl+click for new tab"}
        >
          <NoteIcon
            sourceType={noteSourceType}
            className="shrink-0 transition-colors duration-150"
          />
          <span className="flex-1 text-base text-idemora-text-normal select-none group-hover:text-blue-400 transition-colors duration-150">
            {liveTitle}
          </span>
          {(noteSourceType === "docx" || noteSourceType === "pptx") && (
            <span className={`shrink-0 text-[9px] font-semibold tracking-wide opacity-60 mr-1 ${
              noteSourceType === "docx" ? "text-blue-400" : "text-orange-400"
            }`}>
              {noteSourceType === "docx" ? "DOCX" : "PPTX"}
            </span>
          )}
        </div>
      )}

      {/* Confirm dialog — rendered inside the NodeView so it has access to
          trashNote and the correct noteId closure. Portal would also work but
          this keeps the logic co-located with the data it needs. */}
      <ConfirmModal
        open={confirmOpen}
        title="Delete page"
        message={`"${liveTitle}" will be moved to the trash. This cannot be undone from the editor.`}
        confirmLabel="Move to trash"
        danger
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </NodeViewWrapper>
  );
}

function PageIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
      />
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

function NoteIcon({ sourceType, className = "" }: { sourceType: string; className?: string }) {
  if (sourceType === "pdf") {
    return (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className={`text-red-400 ${className}`}>
        <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
          stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      </svg>
    )
  }
  if (sourceType === "docx") {
    return (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className={`text-blue-400 ${className}`}>
        <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
          stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        <path d="M5.5 7.5h5M5.5 9.5h5M5.5 11.5h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      </svg>
    )
  }
  if (sourceType === "pptx") {
    return (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className={`text-orange-400 ${className}`}>
        <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M6 7h4M6 9.5h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
        <circle cx="4.5" cy="7" r="0.8" fill="currentColor"/>
        <circle cx="4.5" cy="9.5" r="0.8" fill="currentColor"/>
      </svg>
    )
  }
  // default note icon
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className={`text-idemora-text-muted ${className}`}>
      <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6 8h4M6 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}