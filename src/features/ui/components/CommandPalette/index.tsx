// src/features/ui/components/CommandPalette/index.tsx
import { useEffect, useRef, useState, useMemo } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { Note } from "@/types";

// ── Breadcrumb builder ────────────────────────────────────────────────────────
function buildBreadcrumb(noteId: string, notes: Note[]): string {
  const map = new Map(notes.map((n) => [n.id, n]));
  const parts: string[] = [];
  let current = map.get(noteId);
  while (current?.parent_id) {
    const parent = map.get(current.parent_id);
    if (!parent) break;
    parts.unshift(parent.title);
    current = parent;
  }
  if (parts.length === 0) return "";
  if (parts.length <= 2) return parts.join(" / ");
  return `${parts[0]} / … / ${parts[parts.length - 1]}`;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const NoteIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-zinc-400">
    <rect x="1.5" y="1" width="9" height="10" rx="1" stroke="currentColor" strokeWidth="1.1"/>
    <path d="M3.5 4h5M3.5 6.5h5M3.5 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
  </svg>
);

const ActionIcon = ({ id }: { id: string }) => {
  if (id === "new-note") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
  if (id === "toggle-theme") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <circle cx="6.5" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M6.5 1v1.5M6.5 10.5V12M1 6.5h1.5M10.5 6.5H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
  if (id === "toggle-backlinks") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <path d="M9 4H5a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M7 2h4v4M11 2L7.5 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (id === "toggle-outline") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <path d="M2 3.5h9M2 6.5h6M2 9.5h7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
  return null;
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface NoteItem   { kind: "note";   id: string; title: string; breadcrumb: string; }
interface ActionItem { kind: "action"; id: string; label: string; hint: string; action: () => void; }
type Item = NoteItem | ActionItem;

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <li className="px-4 pt-4 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 select-none">
        {label}
      </span>
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function CommandPalette() {
  const paletteOpen     = useUIStore((s) => s.paletteOpen);
  const closePalette    = useUIStore((s) => s.closePalette);
  const toggleTheme     = useUIStore((s) => s.toggleTheme);
  const theme           = useUIStore((s) => s.theme);
  const toggleBacklinks = useUIStore((s) => s.toggleBacklinks);
  const toggleOutline   = useUIStore((s) => s.toggleOutline);
  const notes           = useNoteStore((s) => s.notes);
  const visitedNoteIds  = useNoteStore((s) => s.visitedNoteIds);
  const createNote      = useNoteStore((s) => s.createNote);
  const setActiveNote   = useNoteStore((s) => s.setActiveNote);

  const [query, setQuery]       = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (paletteOpen) { setQuery(""); setSelected(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [paletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closePalette();
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [paletteOpen, closePalette]);

  useEffect(() => {
    if (!paletteOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePalette(); }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [paletteOpen, closePalette]);

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const actions: ActionItem[] = useMemo(() => [
    {
      kind: "action", id: "new-note", label: "New Note", hint: "Create a blank note",
      action: async () => { await createNote(); closePalette(); },
    },
    {
      kind: "action", id: "toggle-theme",
      label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      hint: "Toggle app theme",
      action: () => { toggleTheme(); closePalette(); },
    },
    {
      kind: "action", id: "toggle-backlinks", label: "Toggle Backlinks Panel", hint: "Ctrl+Shift+B",
      action: () => { toggleBacklinks(); closePalette(); },
    },
    {
      kind: "action", id: "toggle-outline", label: "Toggle Outline Panel", hint: "Ctrl+Shift+O",
      action: () => { toggleOutline(); closePalette(); },
    },
  ], [theme, createNote, closePalette, toggleTheme, toggleBacklinks, toggleOutline]);

  // ── Build flat items list ───────────────────────────────────────────────────
  const { items, sectionBreaks } = useMemo(() => {
    const items: Item[] = [];
    const sectionBreaks = new Map<number, string>();
    const trimmed = query.trim().toLowerCase();

    if (!trimmed) {
      const recentNotes = visitedNoteIds
        .map((id) => notes.find((n) => n.id === id))
        .filter((n): n is Note => !!n && !n.deleted_at)
        .slice(0, 8);

      if (recentNotes.length > 0) {
        sectionBreaks.set(0, "Recent");
        recentNotes.forEach((n) =>
          items.push({ kind: "note", id: n.id, title: n.title, breadcrumb: buildBreadcrumb(n.id, notes) })
        );
      }

      sectionBreaks.set(items.length, "Actions");
      actions.forEach((a) => items.push(a));

    } else {
      const matchedNotes = notes
        .filter((n) => !n.deleted_at && n.title.toLowerCase().includes(trimmed))
        .sort((a, b) => {
          const aT = a.title.toLowerCase();
          const bT = b.title.toLowerCase();
          if (aT === trimmed && bT !== trimmed) return -1;
          if (bT === trimmed && aT !== trimmed) return 1;
          if (aT.startsWith(trimmed) && !bT.startsWith(trimmed)) return -1;
          if (bT.startsWith(trimmed) && !aT.startsWith(trimmed)) return 1;
          return b.updated_at - a.updated_at;
        })
        .slice(0, 20);

      if (matchedNotes.length > 0) {
        sectionBreaks.set(0, "Notes");
        matchedNotes.forEach((n) =>
          items.push({ kind: "note", id: n.id, title: n.title, breadcrumb: buildBreadcrumb(n.id, notes) })
        );
      }

      const matchedActions = actions.filter((a) =>
        a.label.toLowerCase().includes(trimmed) || a.hint.toLowerCase().includes(trimmed)
      );
      if (matchedActions.length > 0) {
        sectionBreaks.set(items.length, "Actions");
        matchedActions.forEach((a) => items.push(a));
      }
    }

    return { items, sectionBreaks };
  }, [query, notes, visitedNoteIds, actions]);

  // ── Keyboard nav ────────────────────────────────────────────────────────────
  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown")       { e.preventDefault(); setSelected((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp")    { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter")      { e.preventDefault(); const item = items[selected]; if (!item) return; if (item.kind === "note") { setActiveNote(item.id); closePalette(); } else item.action(); }
  }

  // ── Highlight matching chars ──────────────────────────────────────────────
  function highlightMatch(text: string, q: string) {
    if (!q.trim()) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return <span>{text}</span>;
    return (
      <span>
        {text.slice(0, idx)}
        <span className="text-blue-500 dark:text-blue-400 font-semibold">{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </span>
    );
  }

  if (!paletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 sm:px-6 lg:px-0">
      <div
        ref={panelRef}
        className="relative w-full max-w-5xl h-[85vh] rounded-t-xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 border-b-0 shadow-2xl flex flex-col"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex-shrink-0">
          <svg className="shrink-0 text-zinc-400" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search notes or run a command…"
            className="flex-1 bg-transparent outline-none text-base text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setSelected(0); inputRef.current?.focus(); }}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-75"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          <kbd className="text-sm text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <ul className="flex-1 overflow-y-auto py-1.5">
          {items.length === 0 && (
            <li className="px-4 py-6 text-base text-zinc-400 dark:text-zinc-500 text-center">
              No results for "<span className="text-zinc-500 dark:text-zinc-400">{query}</span>"
            </li>
          )}
          {items.map((item, i) => {
            const isSelected   = i === selected;
            const sectionLabel = sectionBreaks.get(i);
            return (
              <div key={item.kind === "note" ? `note-${item.id}` : `action-${item.id}-${i}`}>
                {sectionLabel && <SectionLabel label={sectionLabel} />}
                <li
                  ref={(el) => { itemRefs.current[i] = el; }}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => {
                    if (item.kind === "note") { setActiveNote(item.id); closePalette(); }
                    else item.action();
                  }}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-75 ${
                    isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  {item.kind === "note" ? <NoteIcon /> : <ActionIcon id={item.id} />}

                  <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    <span className="text-base text-zinc-800 dark:text-zinc-200 truncate shrink-0">
                      {item.kind === "note" ? highlightMatch(item.title, query) : item.label}
                    </span>
                    {item.kind === "note" && item.breadcrumb && (
                      <span className="text-sm text-zinc-400 dark:text-zinc-600 truncate">— {item.breadcrumb}</span>
                    )}
                    {item.kind === "action" && (
                      <span className="text-sm text-zinc-400 dark:text-zinc-600 truncate">{item.hint}</span>
                    )}
                  </div>

                  {isSelected && (
                    <kbd className="text-base text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-2 py-0.5 rounded font-mono shrink-0 leading-snug">↵</kbd>
                  )}
                </li>
              </div>
            );
          })}
        </ul>

        {/* Keyboard hints — bottom right, very muted */}
        <div className="flex-shrink-0 flex justify-end items-center gap-4 px-4 py-2">
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">↑↓</kbd> navigate
          </span>
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">↵</kbd> open
          </span>
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">ESC</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}