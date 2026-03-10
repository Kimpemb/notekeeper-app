// src/components/CommandPalette/index.tsx
import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/store/useUIStore";
import { useNoteStore } from "@/store/useNoteStore";

type CommandItem = {
  id: string;
  label: string;
  description?: string;
  action: () => void;
};

export function CommandPalette() {
  const paletteOpen  = useUIStore((s) => s.paletteOpen);
  const closePalette = useUIStore((s) => s.closePalette);
  const toggleTheme  = useUIStore((s) => s.toggleTheme);
  const theme        = useUIStore((s) => s.theme);

  const notes       = useNoteStore((s) => s.notes);
  const createNote  = useNoteStore((s) => s.createNote);
  const setActive   = useNoteStore((s) => s.setActiveNote);

  const [query, setQuery]     = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when palette opens
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [paletteOpen]);

  // Build command list
  const staticCommands: CommandItem[] = [
    {
      id: "new-note",
      label: "New Note",
      description: "Create a blank note",
      action: async () => { await createNote(); closePalette(); },
    },
    {
      id: "toggle-theme",
      label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      description: "Toggle theme",
      action: () => { toggleTheme(); closePalette(); },
    },
  ];

  const noteCommands: CommandItem[] = notes.slice(0, 50).map((n) => ({
    id: `note-${n.id}`,
    label: n.title,
    description: n.plaintext.slice(0, 60) || "Empty note",
    action: () => { setActive(n.id); closePalette(); },
  }));

  const allCommands = [...staticCommands, ...noteCommands];

  const filtered = query.trim()
    ? allCommands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.description?.toLowerCase().includes(query.toLowerCase())
      )
    : allCommands;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[selected]?.action();
    } else if (e.key === "Escape") {
      closePalette();
    }
  }

  if (!paletteOpen) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closePalette(); }}
    >
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div className="
        relative w-full max-w-lg mx-4 rounded-xl overflow-hidden
        bg-white dark:bg-zinc-900
        border border-zinc-200 dark:border-zinc-700
        shadow-2xl
      ">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <svg className="shrink-0 text-zinc-400" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search notes or commands…"
            className="
              flex-1 bg-transparent outline-none text-sm
              text-zinc-800 dark:text-zinc-200
              placeholder:text-zinc-400 dark:placeholder:text-zinc-600
            "
          />
          <kbd className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <ul className="max-h-72 overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-sm text-zinc-400 text-center">
              No results for "{query}"
            </li>
          )}
          {filtered.map((item, i) => (
            <li
              key={item.id}
              onMouseEnter={() => setSelected(i)}
              onClick={() => item.action()}
              className={`
                flex items-center gap-3 px-4 py-2.5 cursor-pointer
                transition-colors duration-75
                ${i === selected
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }
              `}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                  {item.label}
                </p>
                {item.description && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                    {item.description}
                  </p>
                )}
              </div>
              {i === selected && (
                <kbd className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono shrink-0">
                  ↵
                </kbd>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}