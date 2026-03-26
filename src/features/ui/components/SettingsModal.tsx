// src/features/ui/components/SettingsModal.tsx

import { useEffect, useState, useRef } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import { getSetting, setSetting } from "@/features/notes/db/queries";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppSettings {
  theme: "light" | "dark";
  fontFamily: "default" | "serif" | "mono";
  fontSize: "sm" | "md" | "lg";
  lineHeight: "compact" | "normal" | "relaxed";
  spellCheck: boolean;
  autosaveDelay: number;
  defaultView: "editor" | "split";
  showWordCount: boolean;
  autoPurgeTrash: boolean;
  hasCompletedOnboarding: boolean;
  hasInsertedSampleNotes: boolean; // ← ADD THIS
}

const SETTINGS_KEY = "app_settings_v1";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  fontFamily: "default",
  fontSize: "md",
  lineHeight: "normal",
  spellCheck: true,
  autosaveDelay: 1000,
  defaultView: "editor",
  showWordCount: true,
  autoPurgeTrash: true,
  hasCompletedOnboarding: false,
  hasInsertedSampleNotes: false, // ← ADD THIS
};

export async function loadAppSettings(): Promise<AppSettings> {
  const raw = await getSetting(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await setSetting(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mb-3 mt-6 first:mt-0">
      {children}
    </p>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm text-zinc-800 dark:text-zinc-200 leading-snug">{label}</span>
        {description && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500 leading-snug">{description}</span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
        checked ? "bg-blue-500" : "bg-zinc-200 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Sidebar nav tabs ─────────────────────────────────────────────────────────

type Section = "appearance" | "editor" | "keybindings" | "data";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
      </svg>
    ),
  },
  {
    id: "editor",
    label: "Editor",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "keybindings",
    label: "Keybindings",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 7h1M7 7h1M9.5 7h1M4 9h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "data",
    label: "Data",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <ellipse cx="7" cy="4" rx="4.5" ry="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 4v3c0 .83 2.015 1.5 4.5 1.5S11.5 7.83 11.5 7V4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 7v3c0 .83 2.015 1.5 4.5 1.5S11.5 10.83 11.5 10V7" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

// ─── Keybindings reference ────────────────────────────────────────────────────

const KEYBINDINGS: { category: string; shortcuts: { keys: string[]; action: string }[] }[] = [
  {
    category: "Navigation",
    shortcuts: [
      { keys: ["Ctrl", "K"], action: "Command palette" },
      { keys: ["Ctrl", "\\"], action: "Toggle sidebar" },
      { keys: ["Ctrl", "["], action: "Go back" },
      { keys: ["Ctrl", "]"], action: "Go forward" },
      { keys: ["Ctrl", "F"], action: "Focus sidebar search" },
    ],
  },
  {
    category: "Notes",
    shortcuts: [
      { keys: ["Ctrl", "N"], action: "New note" },
      { keys: ["Ctrl", "Shift", "N"], action: "New note in new tab" },
      { keys: ["Ctrl", "W"], action: "Close tab" },
      { keys: ["Ctrl", "Tab"], action: "Next tab" },
      { keys: ["Ctrl", "Shift", "T"], action: "Reopen closed tab" },
    ],
  },
  {
    category: "Panels",
    shortcuts: [
      { keys: ["Ctrl", ";"], action: "Toggle backlinks" },
      { keys: ["Ctrl", "'"], action: "Toggle outline" },
      { keys: ["Ctrl", "T"], action: "Toggle file tree" },
      { keys: ["Ctrl", "Shift", "G"], action: "Toggle graph view" },
    ],
  },
  {
    category: "Editor",
    shortcuts: [
      { keys: ["Ctrl", "H"], action: "Find & replace" },
      { keys: ["Ctrl", "B"], action: "Bold" },
      { keys: ["Ctrl", "I"], action: "Italic" },
      { keys: ["Ctrl", "Shift", "S"], action: "Strikethrough" },
      { keys: ["Ctrl", "`"], action: "Inline code" },
    ],
  },
  {
    category: "App",
    shortcuts: [
      { keys: ["Ctrl", ","], action: "Settings" },
      { keys: ["Ctrl", "Shift", "?"], action: "Keyboard shortcuts" },
      { keys: ["Ctrl", "Shift", "L"], action: "Reload notes" },
      { keys: ["Ctrl", "Shift", "E"], action: "Toggle tips" },
    ],
  },
];

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 leading-none">
      {children}
    </kbd>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function SettingsModal() {
  const settingsOpen  = useUIStore((s) => s.settingsOpen);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const theme         = useUIStore((s) => s.theme);
  const setTheme      = useUIStore((s) => s.setTheme);

  // Read settings from the store — single source of truth shared with the
  // editor, status bar, and autosave hook.
  const settings     = useAppSettings((s) => s.settings);
  const storeUpdate  = useAppSettings((s) => s.updateSetting);

  const [section, setSection] = useState<Section>("appearance");
  const [saved, setSaved]     = useState(false);
  const saveTimer             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef            = useRef<HTMLDivElement>(null);

  // Flash "Saved" indicator after each change
  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    storeUpdate(key, value); // writes to store → DOM (CSS vars) → SQLite
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }, 400);
  }

  // Close on Escape
  useEffect(() => {
    if (!settingsOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeSettings(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, closeSettings]);

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) closeSettings();
  }

  if (!settingsOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
    >
      <div className="relative flex w-[720px] max-w-[95vw] h-[520px] max-h-[90vh] rounded-xl shadow-2xl overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">

        {/* Sidebar */}
        <aside className="w-44 shrink-0 bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col py-4 gap-0.5 px-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500 px-2 mb-2">
            Settings
          </p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-colors duration-100 w-full ${
                section === s.id
                  ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              }`}
            >
              <span className="shrink-0">{s.icon}</span>
              {s.label}
            </button>
          ))}

          <div className="mt-auto px-2">
            <p className={`text-[11px] text-green-500 transition-opacity duration-300 ${saved ? "opacity-100" : "opacity-0"}`}>
              ✓ Saved
            </p>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Close button */}
          <button
            onClick={closeSettings}
            className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>

          {/* ── Appearance ────────────────────────────────────────── */}
          {section === "appearance" && (
            <div>
              <SectionTitle>Theme</SectionTitle>
              <Row label="Color theme" description="Controls the overall light or dark appearance">
                <Select
                  value={theme}
                  onChange={(v) => {
                    setTheme(v as "light" | "dark");
                    updateSetting("theme", v as "light" | "dark");
                  }}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </Row>

              <SectionTitle>Onboarding</SectionTitle>
<Row 
  label="Show welcome tour" 
  description="View the onboarding guide again"
>
  <button
    onClick={() => {
      updateSetting("hasCompletedOnboarding", false);
      closeSettings();
    }}
    className="px-4 py-1.5 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:opacity-80 transition-opacity"
  >
    Restart tour
  </button>
</Row>

              <SectionTitle>Typography</SectionTitle>
              <Row label="Editor font" description="Font used in the note editor">
                <Select
                  value={settings.fontFamily}
                  onChange={(v) => updateSetting("fontFamily", v)}
                  options={[
                    { value: "default", label: "Default (sans-serif)" },
                    { value: "serif", label: "Serif" },
                    { value: "mono", label: "Monospace" },
                  ]}
                />
              </Row>
              <Row label="Font size" description="Base font size in the editor">
                <Select
                  value={settings.fontSize}
                  onChange={(v) => updateSetting("fontSize", v)}
                  options={[
                    { value: "sm", label: "Small" },
                    { value: "md", label: "Medium" },
                    { value: "lg", label: "Large" },
                  ]}
                />
              </Row>
              <Row label="Line height" description="Spacing between lines in the editor">
                <Select
                  value={settings.lineHeight}
                  onChange={(v) => updateSetting("lineHeight", v)}
                  options={[
                    { value: "compact", label: "Compact" },
                    { value: "normal", label: "Normal" },
                    { value: "relaxed", label: "Relaxed" },
                  ]}
                />
              </Row>
            </div>
          )}

          {/* ── Editor ───────────────────────────────────────────── */}
          {section === "editor" && (
            <div>
              <SectionTitle>Behaviour</SectionTitle>
              <Row label="Spell check" description="Underline misspelled words in the editor">
                <Toggle
                  checked={settings.spellCheck}
                  onChange={(v) => updateSetting("spellCheck", v)}
                />
              </Row>
              <Row label="Show word count" description="Display word and character count in the status bar">
                <Toggle
                  checked={settings.showWordCount}
                  onChange={(v) => updateSetting("showWordCount", v)}
                />
              </Row>

              <SectionTitle>Autosave</SectionTitle>
              <Row label="Autosave delay" description="How long after you stop typing before the note saves">
                <Select
                  value={String(settings.autosaveDelay)}
                  onChange={(v) => updateSetting("autosaveDelay", Number(v))}
                  options={[
                    { value: "500",  label: "0.5 seconds" },
                    { value: "1000", label: "1 second" },
                    { value: "2000", label: "2 seconds" },
                    { value: "5000", label: "5 seconds" },
                  ]}
                />
              </Row>

              <SectionTitle>Layout</SectionTitle>
              <Row label="Default view" description="How new sessions open">
                <Select
                  value={settings.defaultView}
                  onChange={(v) => updateSetting("defaultView", v)}
                  options={[
                    { value: "editor", label: "Single pane" },
                    { value: "split",  label: "Split pane" },
                  ]}
                />
              </Row>
            </div>
          )}

          {/* ── Keybindings ───────────────────────────────────────── */}
          {section === "keybindings" && (
            <div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-4">
                Keybindings are fixed in this version. Custom bindings are coming in a future release.
              </p>
              {KEYBINDINGS.map((group) => (
                <div key={group.category}>
                  <SectionTitle>{group.category}</SectionTitle>
                  <div className="rounded-lg border border-zinc-100 dark:border-zinc-800 overflow-hidden mb-4">
                    {group.shortcuts.map((shortcut, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0 bg-white dark:bg-zinc-900"
                      >
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {shortcut.action}
                        </span>
                        <div className="flex items-center gap-1">
                          {shortcut.keys.map((key, j) => (
                            <KeyChip key={j}>{key}</KeyChip>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Data ─────────────────────────────────────────────── */}
          {section === "data" && (
            <div>
              <SectionTitle>Storage</SectionTitle>
              <Row
                label="Auto-purge trash"
                description="Permanently delete trashed notes after 30 days"
              >
                <Toggle
                  checked={settings.autoPurgeTrash}
                  onChange={(v) => updateSetting("autoPurgeTrash", v)}
                />
              </Row>

              <SectionTitle>About</SectionTitle>
              <div className="rounded-lg border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">App</span>
                  <span className="text-sm text-zinc-400 dark:text-zinc-500 font-mono">Notekeeper</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">Version</span>
                  <span className="text-sm text-zinc-400 dark:text-zinc-500 font-mono">1.0.0</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-zinc-900">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">Storage</span>
                  <span className="text-sm text-zinc-400 dark:text-zinc-500 font-mono">Local SQLite</span>
                </div>
              </div>

              <div className="mt-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
                <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
                  All data is stored locally on your machine. No cloud sync, no accounts.
                  Use Export from the command palette to back up your notes.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}