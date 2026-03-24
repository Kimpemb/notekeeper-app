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

// ── Time helpers ──────────────────────────────────────────────────────────────
function getTodayStart(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}
function getYesterdayStart(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1); return d.getTime();
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
  if (id === "new-note-new-tab") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M10 1h2v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (id === "open-in-new-tab") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <rect x="1" y="3" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 1h7v7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (id === "toggle-theme") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <circle cx="6.5" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M6.5 1v1.5M6.5 10.5V12M1 6.5h1.5M10.5 6.5H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
  if (id === "toggle-graph") return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-zinc-400">
      <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
      <circle cx="2.5" cy="4" r="1.5" fill="currentColor"/>
      <circle cx="11.5" cy="4" r="1.5" fill="currentColor"/>
      <circle cx="2.5" cy="10" r="1.5" fill="currentColor"/>
      <circle cx="11.5" cy="10" r="1.5" fill="currentColor"/>
      <path d="M7 7L2.5 4M7 7l4.5-3M7 7l-4.5 3M7 7l4.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
  if (id === "toggle-sidebar") return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-zinc-400">
      <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 1v12" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
  if (id === "daily-note") return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-zinc-400">
      <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M4.5 1.5v2M9.5 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  );
  if (id === "reload-notes") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <path d="M1.5 6.5A5 5 0 1011.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M1.5 3.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
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
  if (id === "toggle-file-tree") return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-zinc-400">
      <path d="M1 3.5a1 1 0 011-1h3l1 1.5h6a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M4 8.5h3M4 6.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
  if (id === "toggle-tips") return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-zinc-400">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="7" cy="4.5" r="0.7" fill="currentColor"/>
    </svg>
  );
  if (id === "open-shortcuts") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <rect x="1" y="2.5" width="4" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.1"/>
      <rect x="7" y="2.5" width="5" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.1"/>
      <rect x="1" y="7.5" width="5" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.1"/>
      <rect x="8" y="7.5" width="4" height="3" rx="0.8" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  );
  if (id === "export-all") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <rect x="1" y="1" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M4 6.5h5M4 4.5h5M4 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
  if (id === "export-json" || id === "export-md" || id === "export-pdf") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6.5 5.5v4M4.5 7.5l2 2 2-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  if (id === "import") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="shrink-0 text-zinc-400">
      <path d="M2 1h6l3 3v8H2V1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6.5 9.5v-4M4.5 7.5l2-2 2 2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  return null;
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface ActionItem { kind: "action"; id: string; label: string; hint: string; action: () => void; }

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-4 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600 select-none">
      {label}
    </p>
  );
}

// ── Highlight matching chars ──────────────────────────────────────────────────
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

// ── Note row ──────────────────────────────────────────────────────────────────
function NoteRow({
  note, isSelected, query, notes, onClick, onMouseEnter, refCallback,
}: {
  note: Note; index: number; isSelected: boolean; query: string;
  notes: Note[]; onClick: () => void; onMouseEnter: () => void;
  refCallback: (el: HTMLLIElement | null) => void;
}) {
  return (
    <li
      ref={refCallback}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-75 ${
        isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
      }`}
    >
      <NoteIcon />
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <span className="text-base text-zinc-800 dark:text-zinc-200 truncate shrink-0">
          {highlightMatch(note.title, query)}
        </span>
        {buildBreadcrumb(note.id, notes) && (
          <span className="text-sm text-zinc-400 dark:text-zinc-600 truncate">
            — {buildBreadcrumb(note.id, notes)}
          </span>
        )}
      </div>
      {isSelected && (
        <kbd className="text-sm text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded font-mono shrink-0">↵</kbd>
      )}
    </li>
  );
}

// ── Shortcuts reference (shown in right panel) ────────────────────────────────
const SHORTCUTS = [
  { label: "Command palette",       keys: ["Ctrl", "K"] },
  { label: "New note",              keys: ["Ctrl", "N"] },
  { label: "New note in new tab",   keys: ["Ctrl", "Shift", "N"] },
  { label: "Close tab",             keys: ["Ctrl", "W"] },
  { label: "Reopen closed tab",     keys: ["Ctrl", "Shift", "T"] },
  { label: "Next tab",              keys: ["Ctrl", "Tab"] },
  { label: "Previous tab",          keys: ["Ctrl", "Shift", "Tab"] },
  { label: "Toggle sidebar",        keys: ["Ctrl", "\\"] },
  { label: "Search notes",          keys: ["Ctrl", "F"] },
  { label: "Toggle file tree",      keys: ["Ctrl", "T"] },
  { label: "Toggle graph",          keys: ["Ctrl", "Shift", "G"] },
  { label: "Toggle tips",           keys: ["Ctrl", "Shift", "E"] },
  { label: "Reload notes",          keys: ["Ctrl", "Shift", "L"] },
  { label: "Go back",               keys: ["Ctrl", "["] },
  { label: "Go forward",            keys: ["Ctrl", "]"] },
  { label: "Find & replace",        keys: ["Ctrl", "H"] },
  { label: "Toggle backlinks",      keys: ["Ctrl", ";"] },
  { label: "Toggle outline",        keys: ["Ctrl", "'"] },
  { label: "Keyboard shortcuts",    keys: ["Ctrl", "Shift", "?"] },
  { label: "Voice typing",          keys: ["Win+H", "Fn twice"] },
];

// ── Main component ────────────────────────────────────────────────────────────
export function CommandPalette() {
  const paletteOpen        = useUIStore((s) => s.paletteOpen);
  const closePalette       = useUIStore((s) => s.closePalette);
  const toggleTheme        = useUIStore((s) => s.toggleTheme);
  const theme              = useUIStore((s) => s.theme);
  const toggleBacklinks    = useUIStore((s) => s.toggleBacklinks);
  const toggleOutline      = useUIStore((s) => s.toggleOutline);
  const toggleFileTree     = useUIStore((s) => s.toggleFileTree);
  const toggleSidebar      = useUIStore((s) => s.toggleSidebar);
  const toggleTips         = useUIStore((s) => s.toggleTips);
  const openShortcuts      = useUIStore((s) => s.openShortcuts);
  const openImport         = useUIStore((s) => s.openImport);
  const openTemplatePicker = useUIStore((s) => s.openTemplatePicker);
  const exportHandlers     = useUIStore((s) => s.exportHandlers);
  const graphOpen          = useUIStore((s) => s.graphOpen);
  const openGraph          = useUIStore((s) => s.openGraph);
  const closeGraph         = useUIStore((s) => s.closeGraph);
  const activeNoteId       = useNoteStore((s) => s.activeNoteId);
  const notes              = useNoteStore((s) => s.notes);
  const visitedNoteIds     = useNoteStore((s) => s.visitedNoteIds);
  const setActiveNote      = useNoteStore((s) => s.setActiveNote);
  const loadNotes          = useNoteStore((s) => s.loadNotes);
  const createOrOpenDailyNote = useNoteStore((s) => s.createOrOpenDailyNote);

  const [query, setQuery]                   = useState("");
  const [selectedNote, setSelectedNote]     = useState(0);
  const [selectedAction, setSelectedAction] = useState(0);
  const [activeSide, setActiveSide]         = useState<"notes" | "actions">("notes");

  const inputRef       = useRef<HTMLInputElement>(null);
  const panelRef       = useRef<HTMLDivElement>(null);
  const noteItemRefs   = useRef<(HTMLLIElement | null)[]>([]);
  const actionItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery(""); setSelectedNote(0); setSelectedAction(0); setActiveSide("notes");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
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
    noteItemRefs.current[selectedNote]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedNote]);

  useEffect(() => {
    actionItemRefs.current[selectedAction]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedAction]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const actions: ActionItem[] = useMemo(() => [
    {
      kind: "action", id: "new-note", label: "New Note", hint: "Ctrl+N",
      action: () => { closePalette(); openTemplatePicker(); },
    },
    {
      kind: "action", id: "new-note-new-tab", label: "New Note in New Tab", hint: "Ctrl+Shift+N",
      action: () => {
        closePalette();
        window.dispatchEvent(new CustomEvent("notekeeper:new-note-new-tab"));
      },
    },
    {
      kind: "action", id: "open-in-new-tab", label: "Open Current Note in New Tab", hint: "",
      action: () => {
        if (activeNoteId) useUIStore.getState().openTab(activeNoteId);
        closePalette();
      },
    },
    {
      kind: "action", id: "daily-note", label: "Open Today's Note", hint: "Daily",
      action: async () => { closePalette(); await createOrOpenDailyNote(); },
    },
    {
      kind: "action", id: "toggle-graph", label: graphOpen ? "Close Graph View" : "Open Graph View", hint: "Ctrl+Shift+G",
      action: () => { graphOpen ? closeGraph() : openGraph(); closePalette(); },
    },
    {
      kind: "action", id: "toggle-sidebar", label: "Toggle Sidebar", hint: "Ctrl+\\",
      action: () => { toggleSidebar(); closePalette(); },
    },
    {
      kind: "action", id: "toggle-tips", label: "Toggle Tips Panel", hint: "Ctrl+Shift+E",
      action: () => { toggleTips(); closePalette(); },
    },
    {
      kind: "action", id: "reload-notes", label: "Reload Notes", hint: "Ctrl+Shift+L",
      action: async () => {
        closePalette();
        useUIStore.getState().setRefreshStatus("reloading");
        await loadNotes();
        useUIStore.getState().setRefreshStatus("reloaded");
      },
    },
    {
      kind: "action", id: "toggle-theme", label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode", hint: "",
      action: () => { toggleTheme(); closePalette(); },
    },
    {
      kind: "action", id: "toggle-backlinks", label: "Toggle Backlinks", hint: "Ctrl+;",
      action: () => { toggleBacklinks(useUIStore.getState().activePaneId); closePalette(); },
    },
    {
      kind: "action", id: "toggle-outline", label: "Toggle Outline", hint: "Ctrl+'",
      action: () => { toggleOutline(useUIStore.getState().activePaneId); closePalette(); },
    },
    {
      kind: "action", id: "toggle-file-tree", label: "Toggle File Tree", hint: "Ctrl+T",
      action: () => { toggleFileTree(useUIStore.getState().activePaneId); closePalette(); },
    },
    {
      kind: "action", id: "open-shortcuts", label: "Keyboard Shortcuts", hint: "Ctrl+Shift+?",
      action: () => { openShortcuts(); closePalette(); },
    },
    {
      kind: "action", id: "export-all",  label: "Export All Notes",    hint: "JSON",
      action: async () => { await exportHandlers?.exportAll(); closePalette(); },
    },
    {
      kind: "action", id: "export-json", label: "Export Current Note", hint: "JSON",
      action: async () => { await exportHandlers?.exportNoteJson(); closePalette(); },
    },
    {
  kind: "action", id: "import", label: "Import Notes", hint: "JSON file",
  action: () => { openImport(); closePalette(); },
},
// ── Voice typing ─────────────────────────────────────────────────────────────
{
  kind: "action", id: "voice-typing", label: "Voice Typing", hint: "Win+H / Fn twice",
  action: () => {
    closePalette();
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const shortcut = isMac ? "Press Fn twice" : "Press Win+H";
    alert(`${shortcut} to start dictation`);
  },
},
    {
      kind: "action", id: "export-md",   label: "Export Current Note", hint: "Markdown",
      action: async () => { await exportHandlers?.exportNoteMarkdown(); closePalette(); },
    },
    {
      kind: "action", id: "export-pdf",  label: "Export Current Note", hint: "PDF",
      action: async () => { await exportHandlers?.exportNotePdf(); closePalette(); },
    },
    {
      kind: "action", id: "import", label: "Import Notes", hint: "JSON file",
      action: () => { openImport(); closePalette(); },
    },
  ], [
    theme, closePalette, openTemplatePicker, toggleTheme, toggleBacklinks, toggleOutline,
    toggleFileTree, toggleSidebar, toggleTips, openShortcuts, openImport, exportHandlers, activeNoteId,
    graphOpen, openGraph, closeGraph, loadNotes, createOrOpenDailyNote,
  ]);

  // ── Recent notes split by Today / Yesterday ───────────────────────────────
  const { todayNotes, yesterdayNotes } = useMemo(() => {
    const todayStart     = getTodayStart();
    const yesterdayStart = getYesterdayStart();

    const visited = visitedNoteIds
      .map((id) => notes.find((n) => n.id === id))
      .filter((n): n is Note => !!n && !n.deleted_at);

    const seen = new Set<string>();
    const deduped = visited.filter((n) => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });

    return {
      todayNotes:     deduped.filter((n) => n.updated_at >= todayStart).slice(0, 8),
      yesterdayNotes: deduped.filter((n) => n.updated_at >= yesterdayStart && n.updated_at < todayStart).slice(0, 4),
    };
  }, [visitedNoteIds, notes]);

  const recentNotes = useMemo(() => [...todayNotes, ...yesterdayNotes], [todayNotes, yesterdayNotes]);

  // ── Search ────────────────────────────────────────────────────────────────
  const searchedNotes = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    return notes
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
  }, [query, notes]);

  const filteredActions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return actions;
    return actions.filter((a) =>
      a.label.toLowerCase().includes(trimmed) || a.hint.toLowerCase().includes(trimmed)
    );
  }, [query, actions]);

  const noteList = query.trim() ? searchedNotes : recentNotes;

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Tab") {
      e.preventDefault();
      setActiveSide((s) => s === "notes" ? "actions" : "notes");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (activeSide === "notes") setSelectedNote((s) => Math.min(s + 1, noteList.length - 1));
      else setSelectedAction((s) => Math.min(s + 1, filteredActions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (activeSide === "notes") setSelectedNote((s) => Math.max(s - 1, 0));
      else setSelectedAction((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeSide === "notes") {
        const note = noteList[selectedNote];
        if (note) { setActiveNote(note.id); closePalette(); }
      } else {
        filteredActions[selectedAction]?.action();
      }
    }
  }

  if (!paletteOpen) return null;

  const isSearching = !!query.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 sm:px-6 lg:px-0">
      <div
        ref={panelRef}
        className="relative w-full max-w-5xl h-[85vh] rounded-t-xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 border-b-0 shadow-2xl flex flex-col"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <svg className="shrink-0 text-zinc-400" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedNote(0); setSelectedAction(0); }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search notes or run a command…"
            className="flex-1 bg-transparent outline-none text-base text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setSelectedNote(0); setSelectedAction(0); inputRef.current?.focus(); }}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-75"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
          <kbd className="text-sm text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 divide-x divide-zinc-100 dark:divide-zinc-800">

          {/* LEFT: Notes */}
          <div
            className={`flex flex-col w-1/2 min-h-0 ${activeSide === "notes" ? "" : "opacity-60"}`}
            onMouseEnter={() => setActiveSide("notes")}
          >
            <div className="flex-1 overflow-y-auto">
              {isSearching ? (
                <>
                  <SectionLabel label="Notes" />
                  {searchedNotes.length === 0 && (
                    <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500 text-center">
                      No notes matching "{query}"
                    </p>
                  )}
                  <ul>
                    {searchedNotes.map((note, i) => (
                      <NoteRow
                        key={note.id} note={note} index={i} query={query} notes={notes}
                        isSelected={activeSide === "notes" && i === selectedNote}
                        onClick={() => { setActiveNote(note.id); closePalette(); }}
                        onMouseEnter={() => setSelectedNote(i)}
                        refCallback={(el) => { noteItemRefs.current[i] = el; }}
                      />
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  {todayNotes.length > 0 && (
                    <>
                      <SectionLabel label="Today" />
                      <ul>
                        {todayNotes.map((note, i) => (
                          <NoteRow
                            key={note.id} note={note} index={i} query="" notes={notes}
                            isSelected={activeSide === "notes" && i === selectedNote}
                            onClick={() => { setActiveNote(note.id); closePalette(); }}
                            onMouseEnter={() => setSelectedNote(i)}
                            refCallback={(el) => { noteItemRefs.current[i] = el; }}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  {yesterdayNotes.length > 0 && (
                    <>
                      <SectionLabel label="Yesterday" />
                      <ul>
                        {yesterdayNotes.map((note, i) => {
                          const globalIndex = todayNotes.length + i;
                          return (
                            <NoteRow
                              key={note.id} note={note} index={globalIndex} query="" notes={notes}
                              isSelected={activeSide === "notes" && globalIndex === selectedNote}
                              onClick={() => { setActiveNote(note.id); closePalette(); }}
                              onMouseEnter={() => setSelectedNote(globalIndex)}
                              refCallback={(el) => { noteItemRefs.current[globalIndex] = el; }}
                            />
                          );
                        })}
                      </ul>
                    </>
                  )}
                  {todayNotes.length === 0 && yesterdayNotes.length === 0 && (
                    <p className="px-4 py-6 text-sm text-zinc-400 dark:text-zinc-500 text-center">
                      No recent notes
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT: Actions + Shortcuts */}
          <div
            className={`flex flex-col w-1/2 min-h-0 ${activeSide === "actions" ? "" : "opacity-60"}`}
            onMouseEnter={() => setActiveSide("actions")}
          >
            <div className="border-b border-zinc-100 dark:border-zinc-800 overflow-y-auto" style={{ maxHeight: "55%" }}>
              <SectionLabel label="Commands" />
              <ul>
                {filteredActions.map((action, i) => {
                  const isSelected = activeSide === "actions" && i === selectedAction;
                  return (
                    <li key={action.id}>
                      <button
                        ref={(el) => { actionItemRefs.current[i] = el; }}
                        onMouseEnter={() => setSelectedAction(i)}
                        onClick={() => action.action()}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer transition-colors duration-75 ${
                          isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        }`}
                      >
                        <ActionIcon id={action.id} />
                        <span className="flex-1 text-base text-zinc-800 dark:text-zinc-200 truncate">{action.label}</span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-600 shrink-0">{action.hint}</span>
                        {isSelected && (
                          <kbd className="text-sm text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded font-mono shrink-0 ml-1">↵</kbd>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex-1 overflow-y-auto">
              <SectionLabel label="Shortcuts" />
              <ul className="pb-2">
                {SHORTCUTS.map((s) => (
                  <li key={s.label} className="flex items-center justify-between px-4 py-2">
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{s.label}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd key={k} className="text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">{k}</kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end items-center gap-4 px-4 py-2 border-t border-zinc-100 dark:border-zinc-800">
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">↑↓</kbd> navigate
          </span>
          <span className="text-[10px] text-zinc-300 dark:text-zinc-700 flex items-center gap-1">
            <kbd className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 px-1 py-0.5 rounded font-mono">Tab</kbd> switch side
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