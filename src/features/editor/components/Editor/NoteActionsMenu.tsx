// src/features/editor/components/Editor/NoteActionsMenu.tsx
//
// Sits at the right of the editor's top bar, after "Local Graph": a bookmark toggle and a "⋯"
// menu holding the things people otherwise have to find through the command palette or settings
// (export, version history, outline, backlinks, similar notes).
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark, Ellipsis, FileText, FileType, FileDown, Braces,
  History, ListTree, Link2, Sparkles,
} from "lucide-react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

const MENU_W = 232;

interface Props {
  noteId: string;
  paneId: 1 | 2;
}

type Entry =
  | { kind: "item"; id: string; label: string; icon: React.ReactNode; onSelect: () => void; hint?: string }
  | { kind: "divider"; id: string }
  | { kind: "heading"; id: string; label: string };

const ICON = 15;

export const NoteActionsMenu = memo(({ noteId, paneId }: Props) => {
  const bookmark = useNoteStore((s) =>
    s.bookmarks.find((b) => b.kind === "note" && b.noteId === noteId) ?? null
  );
  const addBookmark = useNoteStore((s) => s.addBookmark);
  const removeBookmark = useNoteStore((s) => s.removeBookmark);
  const bookmarked = bookmark !== null;

  const exportHandlers = useUIStore((s) => s.exportHandlers);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleBookmark = useCallback(() => {
    if (bookmark) void removeBookmark(bookmark.id);
    else void addBookmark(noteId);
  }, [bookmark, addBookmark, removeBookmark, noteId]);

  // Panels are per pane; toggle the one for this editor's pane.
  const togglePanel = useCallback(
    (which: "history" | "outline" | "backlinks" | "similar") => {
      const ui = useUIStore.getState();
      const map = {
        history:   [ui.versionHistoryOpen, ui.openVersionHistory, ui.closeVersionHistory],
        outline:   [ui.outlineOpen, ui.openOutline, ui.closeOutline],
        backlinks: [ui.backlinksOpen, ui.openBacklinks, ui.closeBacklinks],
        similar:   [ui.similarOpen, ui.openSimilar, ui.closeSimilar],
      } as const;
      const [isOpen, openFn, closeFn] = map[which];
      if (isOpen(paneId)) closeFn(paneId);
      else openFn(paneId);
    },
    [paneId]
  );

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    setPos({ top: r.bottom + 6, left });
  }, []);

  function toggleMenu() {
    if (!open) place();
    setOpen((v) => !v);
  }

  useEffect(() => { setOpen(false); }, [noteId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const run = (fn: () => void | Promise<void>) => () => {
    setOpen(false);
    void fn();
  };

  const entries: Entry[] = [
    { kind: "heading", id: "h-export", label: "Export" },
    {
      kind: "item", id: "md", label: "Markdown", icon: <FileText size={ICON} />,
      onSelect: run(() => exportHandlers?.exportNoteMarkdown(noteId)),
    },
    {
      kind: "item", id: "pdf", label: "PDF", icon: <FileDown size={ICON} />,
      onSelect: run(() => exportHandlers?.exportNotePdf(noteId)),
    },
    {
      kind: "item", id: "docx", label: "Word document", icon: <FileType size={ICON} />,
      onSelect: run(() => exportHandlers?.exportNoteDocx(noteId)),
    },
    {
      kind: "item", id: "json", label: "JSON", icon: <Braces size={ICON} />,
      onSelect: run(() => exportHandlers?.exportNoteJson(noteId)),
    },
    { kind: "divider", id: "d2" },
    {
      kind: "item", id: "history", label: "Version history", icon: <History size={ICON} />,
      onSelect: run(() => togglePanel("history")),
    },
    {
      kind: "item", id: "outline", label: "Outline", icon: <ListTree size={ICON} />,
      onSelect: run(() => togglePanel("outline")),
    },
    {
      kind: "item", id: "backlinks", label: "Backlinks", icon: <Link2 size={ICON} />,
      onSelect: run(() => togglePanel("backlinks")),
    },
    {
      kind: "item", id: "similar", label: "Similar notes", icon: <Sparkles size={ICON} />,
      onSelect: run(() => togglePanel("similar")),
    },
  ];

  const iconBtn =
    "shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 " +
    "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary";

  return (
    <>
      <button
        onClick={toggleBookmark}
        title={bookmarked ? "Remove bookmark" : "Bookmark this note"}
        aria-pressed={bookmarked}
        className={`${iconBtn} ${bookmarked ? "text-idemora-text-normal" : ""}`}
      >
        <Bookmark size={16} fill={bookmarked ? "currentColor" : "none"} />
      </button>

      <button
        ref={btnRef}
        onClick={toggleMenu}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${iconBtn} ${open ? "bg-idemora-bg-secondary text-idemora-text-normal" : ""}`}
      >
        <Ellipsis size={18} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[100] rounded-xl border border-idemora-border bg-idemora-bg-primary shadow-xl py-1.5 px-1.5"
          style={{ top: pos.top, left: pos.left, width: MENU_W }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {entries.map((e) => {
            if (e.kind === "divider") {
              return <div key={e.id} className="my-1.5 h-px bg-idemora-border" />;
            }
            if (e.kind === "heading") {
              return (
                <div
                  key={e.id}
                  className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-idemora-text-faint"
                >
                  {e.label}
                </div>
              );
            }
            return (
              <button
                key={e.id}
                role="menuitem"
                onClick={e.onSelect}
                className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-sm text-left text-idemora-text-normal hover:bg-idemora-bg-secondary transition-colors duration-100"
              >
                <span className="shrink-0 text-idemora-text-muted">{e.icon}</span>
                <span className="flex-1 truncate">{e.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
});

NoteActionsMenu.displayName = "NoteActionsMenu";
