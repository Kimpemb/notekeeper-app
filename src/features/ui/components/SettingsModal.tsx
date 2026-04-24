// src/features/ui/components/SettingsModal.tsx
//
// Milestone 4 update: AI section restructured.
// - ProfileSelector at top
// - ProviderCards (Gemini first)
// - ProcessingModelCard
// - Embedding provider selector with DeepSeek data residency notice
// - RPDBudgetBar
// - Master AI toggle
// Everything else unchanged.

import { useEffect, useState, useRef } from "react";
import { useUIStore }     from "@/features/ui/store/useUIStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import { getSetting, setSetting } from "@/features/notes/db/queries";
import { useAIStore }     from "@/features/ai/store/useAIStore";
import { BackupModal }    from "@/features/backup/components/BackupModal";
import { SHORTCUT_GROUPS } from "@/lib/keybindings";
import type { ShortcutGroup, Shortcut } from "@/lib/keybindings";

// Milestone 4 components
import { ProfileSelector }      from "@/features/ai/components/ProfileSelector";
import { ProviderCard }         from "@/features/ai/components/ProviderCard";
import { ProcessingModelCard }  from "@/features/ai/components/ProcessingModelCard";
import { RPDBudgetBar }         from "@/features/ai/components/RPDBudgetBar";

// DeepSeek data residency
import {
  DEEPSEEK_DATA_RESIDENCY_NOTICE,
  DEEPSEEK_DATA_RESIDENCY_SETTING_KEY,
} from "@/features/ai/lib/providers/deepseek";
import { PROVIDER_META } from "@/features/ai/lib/provider";
import type { EmbeddingProvider, ProviderName } from "@/features/ai/store/useAIStore";

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
  hasInsertedSampleNotes: boolean;
  hasSeenAISetup: boolean;        // ← add this
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
  hasInsertedSampleNotes: false,
  hasSeenAISetup: false,          
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
    <p className="text-[11px] font-semibold uppercase tracking-widest text-idemora-text-muted mb-3 mt-6 first:mt-0">
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
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-idemora-border last:border-b-0">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm text-idemora-text-normal leading-snug">{label}</span>
        {description && (
          <span className="text-xs text-idemora-text-muted leading-snug">{description}</span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? "bg-blue-500" : "bg-idemora-bg-primary"}`}
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
      className="text-sm bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Provider order for cards ─────────────────────────────────────────────────
// Gemini first (recommended starting point), then the rest.

const PROVIDER_CARD_ORDER: ProviderName[] = [
  "gemini",
  "claude",
  "openai",
  "deepseek",
  "grok",
];

// ─── Embedding provider selector ──────────────────────────────────────────────

function EmbeddingProviderSelector() {
  const embeddingProvider     = useAIStore((s) => s.embeddingProvider);
  const setEmbeddingProvider  = useAIStore((s) => s.setEmbeddingProvider);
  const providers             = useAIStore((s) => s.providers);

  const [showResidencyNotice, setShowResidencyNotice] = useState(false);
  const [pendingProvider,     setPendingProvider]     = useState<EmbeddingProvider | null>(null);

  // Only providers that support embedding AND have a valid key
  const embeddingProviders: EmbeddingProvider[] = (["gemini", "openai", "deepseek"] as EmbeddingProvider[]).filter(
    (p) => providers[p].keys.some((k) => k.valid)
  );

  async function handleSelect(p: EmbeddingProvider) {
    if (p === embeddingProvider) return;

    if (p === "deepseek") {
      // Check if residency notice has been acknowledged
      const acked = await getSetting(DEEPSEEK_DATA_RESIDENCY_SETTING_KEY);
      if (!acked) {
        setPendingProvider("deepseek");
        setShowResidencyNotice(true);
        return;
      }
    }

    await setEmbeddingProvider(p);
  }

  async function handleResidencyAccept() {
    await setSetting(DEEPSEEK_DATA_RESIDENCY_SETTING_KEY, "1");
    setShowResidencyNotice(false);
    if (pendingProvider) {
      await setEmbeddingProvider(pendingProvider);
      setPendingProvider(null);
    }
  }

  function handleResidencyDecline() {
    setShowResidencyNotice(false);
    setPendingProvider(null);
  }

  if (embeddingProviders.length === 0) {
    return (
      <p className="text-xs text-idemora-text-muted">
        Connect at least one provider above to configure embeddings.
      </p>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {embeddingProviders.map((p) => (
          <button
            key={p}
            onClick={() => handleSelect(p)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              embeddingProvider === p
                ? "border-blue-500 bg-blue-500/10 text-blue-400"
                : "border-idemora-border bg-idemora-bg-primary text-idemora-text-muted hover:border-blue-400/50"
            }`}
          >
            {PROVIDER_META[p].label}
          </button>
        ))}
      </div>

      {/* DeepSeek data residency notice modal */}
      {showResidencyNotice && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 px-3 py-3 mb-3">
          <p className="text-xs font-semibold text-yellow-500 mb-1.5">Data Residency Notice</p>
          <p className="text-xs text-idemora-text-muted leading-relaxed mb-3">
            {DEEPSEEK_DATA_RESIDENCY_NOTICE}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleResidencyAccept}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-yellow-500/20 text-yellow-500 border border-yellow-500/40 hover:bg-yellow-500/30 transition-colors"
            >
              I understand, proceed
            </button>
            <button
              onClick={handleResidencyDecline}
              className="px-3 py-1.5 text-xs rounded-md border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-idemora-text-muted">
        Active model: <span className="font-mono">{PROVIDER_META[embeddingProvider]?.embeddingModelId ?? "—"}</span>
      </p>
    </div>
  );
}

// ─── Sidebar nav tabs ─────────────────────────────────────────────────────────

type Section = "appearance" | "editor" | "keybindings" | "data" | "ai" | "backup";

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
  {
    id: "ai",
    label: "AI",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="2.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="11.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7 5v2.5M7 7.5L2.5 10M7 7.5l4.5 2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "backup",
    label: "Backup",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 10v1.5A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
];

// ─── Keybindings reference ────────────────────────────────────────────────────

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-idemora-bg-primary text-idemora-text-muted border border-idemora-border leading-none">
      {children}
    </kbd>
  );
}

// ─── AI section ───────────────────────────────────────────────────────────────

function AISection() {
  const enabled        = useAIStore((s) => s.enabled);
  const setEnabled     = useAIStore((s) => s.setEnabled);
  const hasAnyValidKey = useAIStore((s) => s.hasAnyValidKey);

  return (
    <div>
      {/* 1. Profile selector */}
      <SectionTitle>Profile</SectionTitle>
      <ProfileSelector />

      {/* 2. Provider cards — Gemini first */}
      <SectionTitle>Providers</SectionTitle>
      {PROVIDER_CARD_ORDER.map((p) => (
        <ProviderCard key={p} provider={p} />
      ))}

      {/* 3. Processing model */}
      <SectionTitle>Processing Model</SectionTitle>
      <ProcessingModelCard />

      {/* 4. Embedding provider */}
      <SectionTitle>Embeddings</SectionTitle>
      <EmbeddingProviderSelector />

      {/* 5. RPD budget bar */}
      <div className="mt-3">
        <RPDBudgetBar />
      </div>

      {/* 6. Master toggle */}
      <SectionTitle>Master Switch</SectionTitle>
      <Row
        label="Enable AI features"
        description={
          hasAnyValidKey()
            ? "Turn AI chat, search, and indexing on or off"
            : "Add and validate an API key above to enable AI"
        }
      >
        <Toggle
          checked={enabled}
          onChange={(v) => setEnabled(v)}
          disabled={!hasAnyValidKey()}
        />
      </Row>

      {/* Info footer */}
      <div className="mt-4 p-3 rounded-lg bg-idemora-bg-primary border border-idemora-border">
        <p className="text-xs text-idemora-text-muted leading-relaxed">
          API keys are stored locally in the app database. All calls go directly from
          your device to the provider — never through Idemora's servers.
        </p>
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function SettingsModal() {
  const settingsOpen  = useUIStore((s) => s.settingsOpen);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const theme         = useUIStore((s) => s.theme);
  const setTheme      = useUIStore((s) => s.setTheme);

  const settings    = useAppSettings((s) => s.settings);
  const storeUpdate = useAppSettings((s) => s.updateSetting);

  const [section, setSection] = useState<Section>("appearance");
  const [saved, setSaved]     = useState(false);
  const saveTimer             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef            = useRef<HTMLDivElement>(null);
  const contentRef            = useRef<HTMLDivElement>(null);

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    storeUpdate(key, value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }, 400);
  }

  const loadAISettings = useAIStore((s) => s.loadAISettings);
  useEffect(() => { loadAISettings(); }, []);

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
      data-overlay-sentinel
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
    >
      <div className="relative flex w-[720px] max-w-[95vw] h-[520px] max-h-[90vh] rounded-xl shadow-2xl overflow-hidden bg-idemora-bg-secondary border border-idemora-border">

        <aside className="w-44 shrink-0 bg-idemora-bg-secondary border-r border-idemora-border flex flex-col py-4 gap-0.5 px-2 overflow-y-auto">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-idemora-text-muted px-2 mb-2">
            Settings
          </p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-colors duration-100 w-full ${
                section === s.id
                  ? "bg-blue-500/10 text-blue-400 font-medium"
                  : "text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
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

        <div className="flex-1 relative">
          <button
            onClick={closeSettings}
            className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-150"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>

          <div ref={contentRef} className="h-full overflow-y-auto pt-12 pb-6 px-6">
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
                      { value: "dark",  label: "Dark"  },
                    ]}
                  />
                </Row>

                <SectionTitle>Onboarding</SectionTitle>
                <Row label="Show welcome tour" description="View the onboarding guide again">
                  <button
                    onClick={() => { updateSetting("hasCompletedOnboarding", false); closeSettings(); }}
                    className="px-4 py-1.5 text-sm font-medium rounded-lg bg-idemora-bg-secondary border border-idemora-border text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
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
                      { value: "serif",   label: "Serif"                },
                      { value: "mono",    label: "Monospace"            },
                    ]}
                  />
                </Row>
                <Row label="Font size" description="Base font size in the editor">
                  <Select
                    value={settings.fontSize}
                    onChange={(v) => updateSetting("fontSize", v)}
                    options={[
                      { value: "sm", label: "Small"  },
                      { value: "md", label: "Medium" },
                      { value: "lg", label: "Large"  },
                    ]}
                  />
                </Row>
                <Row label="Line height" description="Spacing between lines in the editor">
                  <Select
                    value={settings.lineHeight}
                    onChange={(v) => updateSetting("lineHeight", v)}
                    options={[
                      { value: "compact",  label: "Compact"  },
                      { value: "normal",   label: "Normal"   },
                      { value: "relaxed",  label: "Relaxed"  },
                    ]}
                  />
                </Row>
              </div>
            )}

            {section === "editor" && (
              <div>
                <SectionTitle>Behaviour</SectionTitle>
                <Row label="Spell check" description="Underline misspelled words in the editor">
                  <Toggle checked={settings.spellCheck} onChange={(v) => updateSetting("spellCheck", v)} />
                </Row>
                <Row label="Show word count" description="Display word and character count in the status bar">
                  <Toggle checked={settings.showWordCount} onChange={(v) => updateSetting("showWordCount", v)} />
                </Row>
                <SectionTitle>Autosave</SectionTitle>
                <Row label="Autosave delay" description="How long after you stop typing before the note saves">
                  <Select
                    value={String(settings.autosaveDelay)}
                    onChange={(v) => updateSetting("autosaveDelay", Number(v))}
                    options={[
                      { value: "500",  label: "0.5 seconds" },
                      { value: "1000", label: "1 second"    },
                      { value: "2000", label: "2 seconds"   },
                      { value: "5000", label: "5 seconds"   },
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
                      { value: "split",  label: "Split pane"  },
                    ]}
                  />
                </Row>
              </div>
            )}

            {section === "keybindings" && (
              <div>
                <p className="text-xs text-idemora-text-muted mb-4">
                  Keybindings are fixed in this version. Custom bindings are coming in a future release.
                </p>
                {SHORTCUT_GROUPS.map((group: ShortcutGroup) => (
                  <div key={group.title}>
                    <SectionTitle>{group.title}</SectionTitle>
                    <div className="rounded-lg border border-idemora-border overflow-hidden mb-4">
                      {group.shortcuts.map((shortcut: Shortcut, i: number) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-3 py-2 border-b border-idemora-border last:border-b-0 bg-idemora-bg-secondary"
                        >
                          <span className="text-sm text-idemora-text-normal">{shortcut.label}</span>
                          <div className="flex items-center gap-1">
                            {shortcut.keys.map((key: string, j: number) => (
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

            {section === "data" && (
              <div>
                <SectionTitle>Storage</SectionTitle>
                <Row label="Auto-purge trash" description="Permanently delete trashed notes after 30 days">
                  <Toggle checked={settings.autoPurgeTrash} onChange={(v) => updateSetting("autoPurgeTrash", v)} />
                </Row>

                <SectionTitle>About</SectionTitle>
                <div className="rounded-lg border border-idemora-border overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-idemora-border bg-idemora-bg-secondary">
                    <span className="text-sm text-idemora-text-normal">App</span>
                    <span className="text-sm text-idemora-text-muted font-mono">Idemora</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 border-b border-idemora-border bg-idemora-bg-secondary">
                    <span className="text-sm text-idemora-text-normal">Version</span>
                    <span className="text-sm text-idemora-text-muted font-mono">1.1.0</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2 bg-idemora-bg-secondary">
                    <span className="text-sm text-idemora-text-normal">Storage</span>
                    <span className="text-sm text-idemora-text-muted font-mono">Local SQLite</span>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-lg bg-idemora-bg-secondary border border-idemora-border">
                  <p className="text-xs text-idemora-text-muted leading-relaxed">
                    All data is stored locally on your machine. No cloud sync, no accounts.
                    Use Export from the command palette to back up your notes.
                  </p>
                </div>
              </div>
            )}

            {section === "ai" && <AISection />}

            {section === "backup" && (
              <div>
                <BackupModal />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}