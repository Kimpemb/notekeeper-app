// src/features/ui/components/MoveNoteModal.tsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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

  const [query, setQuery]             = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const inputRef       = useRef<HTMLInputElement>(null);
  const listRef        = useRef<HTMLUListElement>(null);
  const selectedIdxRef = useRef(0);
  const onCloseRef     = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

  const getCandidates = useCallback(() => {
    if (!open) return [];

    const noteMap = new Map(notes.map((n) => [n.id, n]));
    const note = noteMap.get(noteId);
    if (!note) return [];

    const childrenByParent = new Map<string, Note[]>();
    for (const n of notes) {
      if (n.parent_id) {
        const siblings = childrenByParent.get(n.parent_id);
        if (siblings) siblings.push(n);
        else childrenByParent.set(n.parent_id, [n]);
      }
    }

    function descendants(id: string): Set<string> {
      const result = new Set<string>();
      const queue = [id];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const n of childrenByParent.get(cur) ?? []) {
          result.add(n.id);
          queue.push(n.id);
        }
      }
      return result;
    }

    const excluded = new Set([noteId, ...descendants(noteId)]);

    function breadcrumb(n: Note): string {
      const parts: string[] = [];
      let cur: Note | undefined = n;
      while (cur?.parent_id) {
        const parent = noteMap.get(cur.parent_id);
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
  }, [notes, noteId, open]);

  // ── Improved search ranking ────────────────────────────────────────────────
  const getFiltered = useCallback(() => {
    if (!open) return [];

    const q = query.trim().toLowerCase();
    const all = getCandidates();
    
    if (!q) return all;

    // Score each candidate: lower score = better match
    const scored = all.map((candidate) => {
      const titleLower = candidate.title.toLowerCase();
      const breadcrumbLower = candidate.breadcrumb.toLowerCase();
      
      let score = 0;
      
      // Exact title match (highest priority)
      if (titleLower === q) {
        score = 1;
      }
      // Title starts with query
      else if (titleLower.startsWith(q)) {
        score = 2;
      }
      // Title contains query as whole word
      else if (titleLower.includes(` ${q}`) || titleLower.startsWith(`${q} `)) {
        score = 3;
      }
      // Title contains query anywhere
      else if (titleLower.includes(q)) {
        score = 4;
      }
      // Breadcrumb contains query
      else if (breadcrumbLower.includes(q)) {
        score = 5;
      }
      // No match
      else {
        score = 999;
      }
      
      return { ...candidate, score };
    });
    
    // Sort by score, then by title length (shorter titles first for ties), then alphabetically
    return scored
      .filter((c) => c.score < 999)
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.title.length !== b.title.length) return a.title.length - b.title.length;
        return a.title.localeCompare(b.title);
      })
      .map(({ id, title, breadcrumb }) => ({ id, title, breadcrumb }));
  }, [getCandidates, query, open]);

  const items = useMemo(() => getFiltered(), [getFiltered]);
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
        if (item) confirmMove(item.id);
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open]);

  async function confirmMove(targetId: string) {
    const newParent = targetId === "__root__" ? null : targetId;
    try { await moveNote(noteId, newParent); } catch { /* circular guard */ }
    onCloseRef.current();
  }

  if (!open) return null;

  return (
    <div
      data-overlay-sentinel
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl bg-idemora-bg-secondary border border-idemora-border shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "60vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-idemora-border shrink-0">
          <svg className="shrink-0 text-idemora-text-muted" width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Move to…"
            className="flex-1 bg-transparent outline-none text-base text-idemora-text-normal placeholder-idemora-text-faint"
          />
          <kbd className="text-xs text-idemora-text-faint bg-idemora-bg-primary px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* List */}
        <ul ref={listRef} className="overflow-y-auto py-1 list-none p-0 m-0" style={{ listStyle: 'none' }}>
          {items.length === 0 && (
            <li className="px-4 py-6 text-base text-idemora-text-muted text-center">No notes found</li>
          )}
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => confirmMove(item.id)}
               className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors duration-100 ${
  i === selectedIdx ? "bg-blue-500/10" : ""
}`}
              >
                {item.id === "__root__" ? (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-idemora-text-muted">
                    <path d="M1 10L6 2l5 8H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-idemora-text-muted">
                    <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M3.5 4h5M3.5 6.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                )}
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