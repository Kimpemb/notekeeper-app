// src/features/notes/components/Sidebar/TagsPanel.tsx
import { useEffect, useRef, useState } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { getAllTags, renameTag, deleteTag } from "@/features/notes/db/queries";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";

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

interface TagMenu {
  tag: string;
  x: number;
  y: number;
}

export function TagsPanel() {
  const notes      = useNoteStore((s) => s.notes);
  const activeTag  = useUIStore((s) => s.activeTag);
  const setActiveTag = useUIStore((s) => s.setActiveTag);

  const [allTags, setAllTags]             = useState<string[]>([]);
  const [confirm, setConfirm]             = useState<ConfirmState>(CONFIRM_CLOSED);
  const [tagMenu, setTagMenu]             = useState<TagMenu | null>(null);
  const [menuPos, setMenuPos]             = useState<{ x: number; y: number } | null>(null);
  const [renamingTag, setRenamingTag]     = useState<string | null>(null);
  const [renameValue, setRenameValue]     = useState("");
  const renameInputRef                    = useRef<HTMLInputElement>(null);
  const menuRef                           = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAllTags().then(setAllTags).catch(console.error);
  }, [notes]);

  // Close tag menu on outside click
  useEffect(() => {
    if (!tagMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTagMenu(null);
        setMenuPos(null);
      }
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [tagMenu]);

  // Smart tag menu positioning
  useEffect(() => {
    if (!tagMenu || !menuRef.current) return;
    const menu = menuRef.current;
    const { width, height } = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const MARGIN = 8;
    let x = tagMenu.x;
    let y = tagMenu.y;
    if (x + width + MARGIN > vw) x = vw - width - MARGIN;
    if (y + height + MARGIN > vh) y = tagMenu.y - height;
    if (y < MARGIN) y = MARGIN;
    setMenuPos({ x, y });
  }, [tagMenu]);

  // Focus rename input
  useEffect(() => {
    if (renamingTag) setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [renamingTag]);

  function tagCount(tag: string): number {
    return notes.filter((n) => {
      if (!n.tags) return false;
      try { return (JSON.parse(n.tags) as string[]).includes(tag); }
      catch { return false; }
    }).length;
  }

  function handleTagContextMenu(e: React.MouseEvent, tag: string) {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos(null);
    setTagMenu({ tag, x: e.clientX, y: e.clientY });
  }

  function startRename(tag: string) {
    setTagMenu(null);
    setMenuPos(null);
    setRenamingTag(tag);
    setRenameValue(tag);
  }

  async function commitRename() {
    if (!renamingTag) return;
    const trimmed = renameValue.trim().toLowerCase().replace(/\s+/g, "-");
    if (trimmed && trimmed !== renamingTag) {
      await renameTag(renamingTag, trimmed);
      if (activeTag === renamingTag) setActiveTag(trimmed);
      const updated = await getAllTags();
      setAllTags(updated);
    }
    setRenamingTag(null);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { setRenamingTag(null); }
  }

  function handleDeleteTag(tag: string) {
    setTagMenu(null);
    setMenuPos(null);
    const count = tagCount(tag);
    setConfirm({
      open: true,
      title: "Delete Tag",
      message: `Remove "#${tag}" from ${count} note${count !== 1 ? "s" : ""}? The notes will not be deleted.`,
      confirmLabel: "Delete Tag",
      onConfirm: async () => {
        setConfirm(CONFIRM_CLOSED);
        await deleteTag(tag);
        if (activeTag === tag) setActiveTag(null);
        const updated = await getAllTags();
        setAllTags(updated);
      },
    });
  }

  return (
    <>
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
            Tags
          </span>
          <span className="text-xs text-zinc-400 dark:text-zinc-600 tabular-nums">{allTags.length}</span>
        </div>
        <div className="mx-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0" />

        {allTags.length === 0 ? (
          <p className="px-4 py-3 text-xs text-zinc-400 dark:text-zinc-600">No tags yet.</p>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) =>
                renamingTag === tag ? (
                  <input
                    key={tag}
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={commitRename}
                    className="h-5 px-2 rounded-full text-xs border border-blue-400 dark:border-blue-500 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 outline-none w-28"
                  />
                ) : (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    onContextMenu={(e) => handleTagContextMenu(e, tag)}
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
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tag context menu */}
      {tagMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: menuPos?.x ?? tagMenu.x,
            top: menuPos?.y ?? tagMenu.y,
            zIndex: 9999,
            opacity: menuPos ? 1 : 0,
            transition: "opacity 80ms ease",
          }}
          className="py-1 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 min-w-[140px]"
        >
          <button
            onClick={() => startRename(tagMenu.tag)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-75"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8.5 1.5l2 2-6 6H2.5v-2l6-6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
            Rename
          </button>
          <div className="mx-2 my-1 border-t border-zinc-100 dark:border-zinc-800" />
          <button
            onClick={() => handleDeleteTag(tagMenu.tag)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors duration-75"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 3h8M4.5 3V2h3v1M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Delete tag
          </button>
        </div>
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