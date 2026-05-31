// src/features/ai/components/QuickSwitch.tsx
//
// Provider pill shown in the ChatPanel composer toolbar (and inline inside error states).
// Lets the user switch the primary slot provider in one click without opening Settings.
//
// Usage:
//   <QuickSwitch />                        — composer toolbar (compact, upward dropdown)
//   <QuickSwitch defaultOpen={true} />     — pre-opened dropdown (error state use)

import { useRef, useState, useEffect } from "react";
import { useAIStore } from "@/features/ai/store/useAIStore";
import type { ProviderName } from "@/features/ai/store/useAIStore";

const PROVIDER_LABELS: Record<ProviderName, string> = {
  gemini:   "Gemini",
  claude:   "Anthropic",
  openai:   "OpenAI",
  deepseek: "DeepSeek",
  grok:     "Grok",
};

function shortModel(model: string): string {
  return model
    .replace("gemini-", "")
    .replace("claude-", "")
    .replace("gpt-", "")
    .replace("deepseek-", "")
    .replace("-latest", "")
    .replace("-20250514", "")
    .replace("-20240229", "")
    .slice(0, 18);
}

const DOT_COLORS: Record<ProviderName, string> = {
  gemini:   "bg-blue-400",
  claude:   "bg-violet-400",
  openai:   "bg-emerald-400",
  deepseek: "bg-sky-400",
  grok:     "bg-zinc-400",
};

function ProviderDot({ provider, size = 7 }: { provider: ProviderName; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${DOT_COLORS[provider]}`}
      style={{ width: size, height: size }}
    />
  );
}

interface Props {
  defaultOpen?: boolean;
}

export function QuickSwitch({ defaultOpen = false }: Props) {
  const primarySlot    = useAIStore((s) => s.primarySlot);
  const providers      = useAIStore((s) => s.providers);
  const setPrimarySlot = useAIStore((s) => s.setPrimarySlot);
  const hasValidKey    = useAIStore((s) => s.hasValidKey);

  const [open, setOpen] = useState(defaultOpen);
  const ref             = useRef<HTMLDivElement>(null);

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

  const available = (Object.keys(providers) as ProviderName[]).filter(hasValidKey);

  if (available.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium text-idemora-text-muted border border-idemora-border/60">
        <span className="w-1.5 h-1.5 rounded-full bg-idemora-text-muted shrink-0" />
        No providers
      </span>
    );
  }

  const active = primarySlot.provider;
  const model  = primarySlot.model;

  async function switchTo(provider: ProviderName) {
    if (provider === active) { setOpen(false); return; }

    const defaultModels: Record<ProviderName, string> = {
      gemini:   "gemini-2.5-pro",
      claude:   "claude-sonnet-4-6",
      openai:   "gpt-4o",
      deepseek: "deepseek-chat",
      grok:     "grok-3",
    };

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

      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Switch model / provider"
        className={`
          inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium
          border transition-all duration-100 select-none
          ${open
            ? "bg-violet-500/10 border-violet-400/40 text-violet-400"
            : "border-idemora-border/60 text-idemora-text-muted hover:text-idemora-text-normal hover:border-idemora-border"
          }
        `}
      >
        <ProviderDot provider={active} size={7} />
        <span>{PROVIDER_LABELS[active]}</span>
        <span className="opacity-30">·</span>
        <span className="opacity-70 font-normal">{shortModel(model)}</span>
        <svg
          width="8" height="8" viewBox="0 0 8 8" fill="none"
          className={`shrink-0 opacity-40 transition-transform duration-100 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="M1.5 3L4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* ── Dropdown — opens upward ── */}
      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-50 min-w-[200px] rounded-xl border border-idemora-border bg-idemora-bg-primary py-1.5 overflow-hidden"
          style={{ boxShadow: "0 -4px 16px rgba(0,0,0,0.08)" }}
        >
          <p className="px-3 pt-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-idemora-text-muted border-b border-idemora-border/60">
            Switch model
          </p>

          {available.map((provider) => {
            const isActive = provider === active;
            const status   = providers[provider].connectionStatus;
            return (
              <button
                key={provider}
                onClick={() => switchTo(provider)}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2 text-[12px] transition-colors duration-75
                  ${isActive
                    ? "bg-violet-500/10 text-violet-400"
                    : "text-idemora-text-normal hover:bg-idemora-bg-secondary"
                  }
                `}
              >
                <ProviderDot provider={provider} size={7} />
                <span className="flex-1 text-left font-medium">{PROVIDER_LABELS[provider]}</span>
                {isActive && (
                  <span className="text-[10px] font-normal text-violet-400 opacity-70 mr-1">
                    {shortModel(model)}
                  </span>
                )}
                {isActive && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-violet-400">
                    <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {!isActive && status === "error" && (
                  <span className="text-[9px] text-red-400 font-medium">error</span>
                )}
              </button>
            );
          })}

          <div className="mx-3 mt-1 pt-1.5 border-t border-idemora-border/60">
            <p className="text-[10px] text-idemora-text-muted leading-relaxed">
              Add providers in <span className="font-medium">Settings → AI</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}