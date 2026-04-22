// src/features/ui/components/MoveBlockModal.tsx
//
// Lets the user pick a destination note for a block that was cut from the editor.
// Opened via the "idemora:move-block" custom event fired from useBlockMenu.
// App.tsx listens for that event, stashes the detail, and renders this modal.

import { useState, useRef, useEffect, useCallback } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

interface Props {
  open: boolean;
  onClose: () => void;
  // Called with the chosen note id once the user confirms.
  // The caller (App.tsx) owns the actual block cut + append logic.
  onConfirm: (destNoteId: string) => void;
}

export function MoveBlockModal({ open, onClose, onConfirm }: Props) {
  const notes = useNoteStore((s) => s.notes);

  const [query, setQuery]             = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const inputRef       = useRef<HTMLInputElement>(null);
  const listRef        = useRef<HTMLUListElement>(null);
  const selectedIdxRef = useRef(0);
  const onCloseRef     = useRef(onClose);
  const onConfirmRef   = useRef(onConfirm);

  useEffect(() => { onCloseRef.current   = onClose;   }, [onClose]);
  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

  const getCandidates = useCallback(() => {
    return notes
      .filter((n) => !n.deleted_at && !n.is_canvas)
      .map((n) => {
        // Build breadcrumb
        const parts: string[] = [];
        let cur = n;
        while (cur.parent_id) {
          const parent = notes.find((p) => p.id === cur.parent_id);
          if (!parent) break;
          parts.unshift(parent.title);
          cur = parent;
        }
        return { id: n.id, title: n.title, breadcrumb: parts.join(" / ") };
      });
  }, [notes]);

  const getFiltered = useCallback(() => {
    const q = query.trim().toLowerCase();
    const all = getCandidates();
    if (!q) return all;

    return all
      .map((c) => {
        const t = c.title.toLowerCase();
        const b = c.breadcrumb.toLowerCase();
        let score = 999;
        if (t === q)                                      score = 1;
        else if (t.startsWith(q))                         score = 2;
        else if (t.includes(` ${q}`) || t.startsWith(`${q} `)) score = 3;
        else if (t.includes(q))                           score = 4;
        else if (b.includes(q))                           score = 5;
        return { ...c, score };
      })
      .filter((c) => c.score < 999)
      .sort((a, b) => a.score - b.score || a.title.length - b.title.length || a.title.localeCompare(b.title))
      .map(({ id, title, breadcrumb }) => ({ id, title, breadcrumb }));
  }, [getCandidates, query]);

  const items      = getFiltered();
  const filteredRef = useRef(items);
  useEffect(() => { filteredRef.current = items; }, [items]);

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
        if (item) confirm(item.id);
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  function confirm(noteId: string) {
    onConfirmRef.current(noteId);
    onCloseRef.current();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl bg-idemora-bg-secondary border border-idemora-border shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "60vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-idemora-border shrink-0">
          <svg className="shrink-0 text-idemora-text-muted" width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Move block to…"
            className="flex-1 bg-transparent outline-none text-base text-idemora-text-normal placeholder-idemora-text-faint"
          />
          <kbd className="text-xs text-idemora-text-faint bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Note list */}
        <ul ref={listRef} className="overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-4 py-6 text-base text-idemora-text-muted text-center">No notes found</li>
          )}
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => confirm(item.id)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors duration-100 ${
                  i === selectedIdx
                    ? "bg-blue-500/10"
                    : "hover:bg-black/6 dark:hover:bg-white/7"
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-idemora-text-muted">
                  <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                  <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                </svg>
                <div className="flex-1 min-w-0">
                  <p className={`text-base truncate ${i === selectedIdx ? "text-blue-400" : "text-idemora-text-normal"}`}>
                    {item.title}
                  </p>
                  {item.breadcrumb && (
                    <p className="text-xs text-idemora-text-muted truncate">{item.breadcrumb}</p>
                  )}
                </div>
                {i === selectedIdx && (
                  <kbd className="text-xs text-idemora-text-faint bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono shrink-0">↵</kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}