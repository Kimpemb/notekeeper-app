// src/features/ui/components/MoveNoteModal.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { Note } from "@/types";

interface Props {
  open: boolean;
  noteId: string;
  onClose: () => void;
}

export function MoveNoteModal({ open, noteId, onClose }: Props) {
  const notes    = useNoteStore((s) => s.notes);
  const moveNote = useNoteStore((s) => s.moveNote);

  const [query, setQuery]         = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const inputRef      = useRef<HTMLInputElement>(null);
  const listRef       = useRef<HTMLUListElement>(null);
  const selectedIdxRef = useRef(0);
  const onCloseRef    = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

  const getCandidates = useCallback(() => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return [];

    function descendants(id: string): Set<string> {
      const result = new Set<string>();
      const queue = [id];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const n of notes) {
          if (n.parent_id === cur) { result.add(n.id); queue.push(n.id); }
        }
      }
      return result;
    }

    const excluded = new Set([noteId, ...descendants(noteId)]);

    function breadcrumb(n: Note): string {
      const parts: string[] = [];
      let cur: Note | undefined = n;
      while (cur?.parent_id) {
        const parent = notes.find((p) => p.id === cur!.parent_id);
        if (!parent) break;
        parts.unshift(parent.title);
        cur = parent;
      }
      return parts.join(" / ");
    }

    const list = notes
      .filter((n) => !excluded.has(n.id) && !n.deleted_at)
      .map((n) => ({ id: n.id, title: n.title, breadcrumb: breadcrumb(n) }));

    const rootOption = note.parent_id !== null
      ? [{ id: "__root__", title: "Root level", breadcrumb: "Move to top level" }]
      : [];

    return [...rootOption, ...list];
  }, [notes, noteId]);

  const getFiltered = useCallback(() => {
    const q = query.trim().toLowerCase();
    const all = getCandidates();
    if (!q) return all;
    return all.filter(
      (n) => n.title.toLowerCase().includes(q) || n.breadcrumb.toLowerCase().includes(q)
    );
  }, [getCandidates, query]);

  // Keep a ref to filtered so the keydown handler can read it without stale closure
  const filteredRef = useRef(getFiltered());
  useEffect(() => { filteredRef.current = getFiltered(); }, [getFiltered]);

  const items = getFiltered();

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filteredRef.current.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filteredRef.current[selectedIdxRef.current];
        if (item) confirmMove(item.id);
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmMove(targetId: string) {
    const newParent = targetId === "__root__" ? null : targetId;
    try { await moveNote(noteId, newParent); } catch { /* circular guard */ }
    onCloseRef.current();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 dark:bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "60vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <svg className="shrink-0 text-zinc-400" width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Move to…"
            className="flex-1 bg-transparent outline-none text-base text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
          />
          <kbd className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* List */}
        <ul ref={listRef} className="overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-4 py-6 text-base text-zinc-400 text-center">No notes found</li>
          )}
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => confirmMove(item.id)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors duration-75 ${
                  i === selectedIdx
                    ? "bg-zinc-100 dark:bg-zinc-800"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                {item.id === "__root__" ? (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-zinc-400">
                    <path d="M1 10L6 2l5 8H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-zinc-400">
                    <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-base text-zinc-800 dark:text-zinc-200 truncate">{item.title}</p>
                  {item.breadcrumb && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-600 truncate">{item.breadcrumb}</p>
                  )}
                </div>
                {i === selectedIdx && (
                  <kbd className="text-xs text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded font-mono shrink-0">↵</kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}