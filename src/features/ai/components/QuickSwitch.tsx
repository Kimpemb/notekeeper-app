// src/features/ai/components/QuickSwitch.tsx
//
// Provider pill shown in the ChatPanel header (and inline inside error states).
// Lets the user switch the primary slot provider in one click without opening Settings.
//
// Usage:
//   <QuickSwitch />                        — compact pill (header use)
//   <QuickSwitch defaultOpen={true} />     — pre-opened dropdown (error state use)

import { useRef, useState, useEffect } from "react";
import { useAIStore } from "@/features/ai/store/useAIStore";
import type { ProviderName } from "@/features/ai/store/useAIStore";

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<ProviderName, string> = {
  gemini:   "Gemini",
  claude:   "Claude",
  openai:   "OpenAI",
  deepseek: "DeepSeek",
  grok:     "Grok",
};

// Short model label shown in the pill (trim the prefix noise)
function shortModel(model: string): string {
  return model
    .replace("gemini-", "")
    .replace("claude-", "")
    .replace("gpt-",    "")
    .replace("deepseek-", "")
    .replace("-latest", "")
    .replace("-20250514", "")  // claude date suffix
    .replace("-20240229", "")
    .slice(0, 22);
}

// ─── Provider icon (inline SVG, 10×10) ───────────────────────────────────────

function ProviderDot({ provider, size = 8 }: { provider: ProviderName; size?: number }) {
  const colors: Record<ProviderName, string> = {
    gemini:   "bg-blue-400",
    claude:   "bg-violet-400",
    openai:   "bg-emerald-400",
    deepseek: "bg-sky-400",
    grok:     "bg-zinc-400",
  };
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${colors[provider]}`}
      style={{ width: size, height: size }}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** Pre-open the dropdown — used when QuickSwitch is embedded inside an error card */
  defaultOpen?: boolean;
}

export function QuickSwitch({ defaultOpen = false }: Props) {
  const primarySlot    = useAIStore((s) => s.primarySlot);
  const providers      = useAIStore((s) => s.providers);
  const setPrimarySlot = useAIStore((s) => s.setPrimarySlot);
  const hasValidKey    = useAIStore((s) => s.hasValidKey);

  const [open, setOpen] = useState(defaultOpen);
  const ref             = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // All providers that have at least one valid key
  const available = (Object.keys(providers) as ProviderName[]).filter(hasValidKey);

  // If no valid keys at all, render a dimmed "no providers" pill
  if (available.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium text-idemora-text-muted bg-idemora-bg-primary border border-idemora-border">
        <span className="w-1.5 h-1.5 rounded-full bg-idemora-text-muted shrink-0" />
        No providers
      </span>
    );
  }

  const active  = primarySlot.provider;
  const model   = primarySlot.model;

  async function switchTo(provider: ProviderName) {
    if (provider === active) { setOpen(false); return; }

    // Derive a sensible default model for the provider being switched to.
    // We don't want to carry over a model string that belongs to a different provider.
    const defaultModels: Record<ProviderName, string> = {
      gemini:   "gemini-2.5-pro",
      claude:   "claude-sonnet-4-6",
      openai:   "gpt-4o",
      deepseek: "deepseek-chat",
      grok:     "grok-3",
    };

    // Re-resolve the active key for the newly selected provider
    const providerState = useAIStore.getState().providers[provider];
    const keyId =
      providerState.activeKeyId ??
      providerState.keys.find((k) => k.valid)?.id ??
      null;

    await setPrimarySlot({
      provider,
      model: defaultModels[provider],
      keyId,
    });

    setOpen(false);
  }

  return (
    <div ref={ref} className="relative inline-block">
      {/* ── Pill trigger ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`
          inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium
          border transition-colors duration-100 select-none
          ${open
            ? "bg-violet-50 border-violet-200 text-violet-600"
            : "bg-idemora-bg-primary border-idemora-border text-idemora-text-muted hover:border-violet-300 hover:text-idemora-text-normal"
          }
        `}
        title="Switch primary provider"
      >
        <ProviderDot provider={active} size={6} />
        <span>{PROVIDER_LABELS[active]}</span>
        <span className="text-idemora-text-muted opacity-60">·</span>
        <span className="opacity-70 font-normal">{shortModel(model)}</span>
        <svg
          width="8" height="8" viewBox="0 0 8 8" fill="none"
          className={`shrink-0 opacity-50 transition-transform duration-100 ${open ? "rotate-180" : ""}`}
        >
          <path d="M1.5 3L4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[170px] rounded-lg border border-idemora-border bg-idemora-bg-primary shadow-lg py-1 overflow-hidden">
          <p className="px-3 pt-1 pb-1.5 text-[9px] font-semibold uppercase tracking-widest text-idemora-text-muted">
            Switch provider
          </p>

          {available.map((provider) => {
            const isActive = provider === active;
            const status   = providers[provider].connectionStatus;
            return (
              <button
                key={provider}
                onClick={() => switchTo(provider)}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors duration-75
                  ${isActive
                    ? "bg-violet-50 text-violet-600"
                    : "text-idemora-text-normal hover:bg-idemora-bg-primary"
                  }
                `}
              >
                <ProviderDot provider={provider} size={7} />
                <span className="flex-1 text-left font-medium">{PROVIDER_LABELS[provider]}</span>
                {isActive && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-violet-500">
                    <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {!isActive && status === "error" && (
                  <span className="text-[9px] text-red-400 font-medium">error</span>
                )}
              </button>
            );
          })}

          <div className="mx-3 mt-1 pt-1 border-t border-idemora-border">
            <p className="text-[9px] text-idemora-text-muted pb-1 leading-relaxed">
              Add providers in <span className="font-medium">Settings → AI</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}