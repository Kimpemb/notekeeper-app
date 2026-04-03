// src/features/ui/lib/keybindings.ts
//
// Single source of truth for all keyboard shortcuts.
// - KeyboardShortcuts.tsx  → renders SHORTCUT_GROUPS for the modal
// - SettingsModal.tsx      → renders SHORTCUT_GROUPS for the settings panel
// - App.tsx                → imports KB constants to keep handlers in sync

export interface Shortcut {
  key?: string        // ← optional: display-only shortcuts (graph, slash menu) omit this
  ctrl?: boolean;
  shift?: boolean;
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

// ─── Canonical shortcut definitions ──────────────────────────────────────────
// `keys` drives the UI chips. `ctrl` / `shift` / `key` drive App.tsx matching.
// Non-handler shortcuts (graph mouse actions, editor slash menu, etc.)
// have no `key` field — they're display-only.

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { ctrl: true,               key: "k",  keys: ["Ctrl", "K"],           label: "Open command palette" },
      { ctrl: true,               key: ",",  keys: ["Ctrl", ","],           label: "Settings" },
      { ctrl: true, shift: true,  key: "?",  keys: ["Ctrl", "Shift", "?"], label: "Show keyboard shortcuts" },
      { ctrl: true,               key: "\\", keys: ["Ctrl", "\\"],          label: "Toggle sidebar" },
      { ctrl: true,               key: "f",  keys: ["Ctrl", "F"],           label: "Search notes" },
      { ctrl: true, shift: true,  key: "l",  keys: ["Ctrl", "Shift", "L"], label: "Reload notes" },
      { ctrl: true, shift: true,  key: "i",  keys: ["Ctrl", "Shift", "I"], label: "Toggle tips panel" },
    ],
  },
  {
    title: "Notes",
    shortcuts: [
      { ctrl: true,               key: "n",  keys: ["Ctrl", "N"],           label: "New note" },
      { ctrl: true, shift: true,  key: "n",  keys: ["Ctrl", "Shift", "N"], label: "New note in new tab" },
      { ctrl: true,               key: "w",  keys: ["Ctrl", "W"],           label: "Close tab" },
      { ctrl: true,               key: "Tab",keys: ["Ctrl", "Tab"],         label: "Next tab" },
      { ctrl: true, shift: true,  key: "Tab",keys: ["Ctrl", "Shift", "Tab"],"label": "Previous tab" },
      { ctrl: true, shift: true,  key: "t",  keys: ["Ctrl", "Shift", "T"], label: "Reopen closed tab" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { ctrl: true, key: "[", keys: ["Ctrl", "["], label: "Go back" },
      { ctrl: true, key: "]", keys: ["Ctrl", "]"], label: "Go forward" },
    ],
  },
  {
  title: "Panels",
  shortcuts: [
    { ctrl: true,              key: "t",  keys: ["Ctrl", "T"],           label: "Toggle file tree" },
    { ctrl: true,              key: ";",  keys: ["Ctrl", ";"],           label: "Toggle backlinks" },
    { ctrl: true,              key: "'",  keys: ["Ctrl", "'"],           label: "Toggle outline" },
    { ctrl: true,              key: "g",  keys: ["Ctrl", "G"],           label: "Open local graph" },
    { ctrl: true, shift: true, key: "s",  keys: ["Ctrl", "Shift", "S"], label: "Toggle similar notes" },
    { ctrl: true, shift: true, key: "g",  keys: ["Ctrl", "Shift", "G"], label: "Toggle graph view" },
    { ctrl: true, shift: true, key: "a",  keys: ["Ctrl", "Shift", "A"], label: "Toggle AI chat panel" },
  ],
},
  {
    title: "Editor",
    shortcuts: [
      { ctrl: true,              key: "b",  keys: ["Ctrl", "B"],           label: "Bold" },
      { ctrl: true,              key: "i",  keys: ["Ctrl", "I"],           label: "Italic" },
      { ctrl: true, shift: true, key: "x",  keys: ["Ctrl", "Shift", "X"], label: "Strikethrough" },
      { ctrl: true,              key: "e",  keys: ["Ctrl", "E"],           label: "Inline code" },
      { ctrl: true,              key: "h",  keys: ["Ctrl", "H"],           label: "Find & replace" },
      { ctrl: true,              key: "z",  keys: ["Ctrl", "Z"],           label: "Undo" },
      { ctrl: true, shift: true, key: "z",  keys: ["Ctrl", "Shift", "Z"], label: "Redo" },
      {                                      keys: ["/"],                   label: "Open slash menu" },
      {                                      keys: ["[["],                  label: "Link to note" },
    ],
  },
  {
    title: "AI",
    shortcuts: [
      { ctrl: true, shift: true, key: "u", keys: ["Ctrl", "Shift", "U"], label: "Summarize note" },
      { ctrl: true, shift: true, key: "e", keys: ["Ctrl", "Shift", "E"], label: "Explain note" },
    ],
  },
  {
    title: "Graph",
    shortcuts: [
      { keys: ["Shift", "Click"], label: "Focus node in graph" },
      { keys: ["Ctrl", "Click"],  label: "Open node in new tab" },
      { keys: ["Enter"],          label: "Cycle through search matches" },
      { keys: ["Esc"],            label: "Exit focus / close graph" },
    ],
  },
];

// ─── Flat lookup helpers used by App.tsx ─────────────────────────────────────

/** All shortcuts that have an actual key handler (ctrl/shift/key defined) */
export const HANDLER_SHORTCUTS = SHORTCUT_GROUPS
  .flatMap((g) => g.shortcuts)
  .filter((s): s is Shortcut & { key: string } => !!s.key);

/** Quick matcher — pass a KeyboardEvent, get the matching shortcut or undefined */
export function matchShortcut(e: KeyboardEvent): (Shortcut & { key: string }) | undefined {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const key = e.key.toLowerCase();
  return HANDLER_SHORTCUTS.find(
    (s) =>
      !!s.ctrl === ctrl &&
      !!s.shift === shift &&
      s.key.toLowerCase() === key
  );
}