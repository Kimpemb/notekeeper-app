// src/features/ui/store/useAppSettings.ts
//
// Single source of truth for AppSettings at runtime.
// Components subscribe here; SettingsModal writes here (and to SQLite).
//
// Usage:
//   const { settings, updateSetting } = useAppSettings();

import { create } from "zustand";
import { loadAppSettings, saveAppSettings, DEFAULT_SETTINGS } from "@/features/ui/components/SettingsModal";
import type { AppSettings } from "@/features/ui/components/SettingsModal";

interface AppSettingsStore {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const useAppSettings = create<AppSettingsStore>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,

  load: async () => {
    const settings = await loadAppSettings();
    set({ settings, loaded: true });
    applySettingsToDOM(settings);
  },

  updateSetting: (key, value) => {
    const next = { ...get().settings, [key]: value };
    set({ settings: next });
    applySettingsToDOM(next);
    // Debounced persistence is still handled in SettingsModal,
    // but we also persist here so callers outside the modal work.
    saveAppSettings(next).catch(console.error);
  },
}));

// ─── DOM application ──────────────────────────────────────────────────────────
// Writes CSS custom properties to :root so the editor picks them up without
// React re-renders on every keystroke.

const FONT_MAP: Record<AppSettings["fontFamily"], string> = {
  default: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
  serif:   "Georgia, 'Times New Roman', serif",
  mono:    "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
};

const FONT_SIZE_MAP: Record<AppSettings["fontSize"], string> = {
  sm: "14px",
  md: "16px",
  lg: "18px",
};

const LINE_HEIGHT_MAP: Record<AppSettings["lineHeight"], string> = {
  compact:  "1.5",
  normal:   "1.75",
  relaxed:  "2.0",
};

export function applySettingsToDOM(settings: AppSettings) {
  const root = document.documentElement;
  root.style.setProperty("--editor-font-family", FONT_MAP[settings.fontFamily]);
  root.style.setProperty("--editor-font-size",   FONT_SIZE_MAP[settings.fontSize]);
  root.style.setProperty("--editor-line-height", LINE_HEIGHT_MAP[settings.lineHeight]);
}