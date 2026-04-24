// src/features/ai/components/AISetupModal.tsx
//
// Milestone 6 — First-launch AI onboarding modal.
// Shown once after the main onboarding tour completes, when no API key exists.
// Splits at "Do you have an API key?" and guides each user type to a working state.
// Sets hasSeenAISetup in AppSettings on dismiss so it never shows again.

import { useState } from "react";
import { useAIStore }          from "@/features/ai/store/useAIStore";
import { validateProviderKey } from "@/features/ai/lib/provider";
import { useAppSettings }      from "@/features/ui/store/useAppSettings";
import type { ProviderName }   from "@/features/ai/store/useAIStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "split" | "api-setup" | "free-tier";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDERS: {
  name: ProviderName;
  label: string;
  placeholder: string;
  docsUrl: string;
  docsLabel: string;
  recommended?: boolean;
}[] = [
  {
    name:        "gemini",
    label:       "Gemini",
    placeholder: "AIza...",
    docsUrl:     "https://aistudio.google.com/app/apikey",
    docsLabel:   "Get a free key at Google AI Studio →",
    recommended: true,
  },
  {
    name:        "claude",
    label:       "Claude",
    placeholder: "sk-ant-...",
    docsUrl:     "https://console.anthropic.com/settings/keys",
    docsLabel:   "Get a key at console.anthropic.com →",
  },
  {
    name:        "openai",
    label:       "OpenAI",
    placeholder: "sk-...",
    docsUrl:     "https://platform.openai.com/api-keys",
    docsLabel:   "Get a key at platform.openai.com →",
  },
  {
    name:        "deepseek",
    label:       "DeepSeek",
    placeholder: "sk-...",
    docsUrl:     "https://platform.deepseek.com/api_keys",
    docsLabel:   "Get a key at platform.deepseek.com →",
  },
  {
    name:        "grok",
    label:       "Grok",
    placeholder: "xai-...",
    docsUrl:     "https://console.x.ai/",
    docsLabel:   "Get a key at console.x.ai →",
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose:  () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
      <div className="relative w-[480px] max-w-[95vw] max-h-[90vh] rounded-xl shadow-2xl overflow-hidden bg-idemora-bg-secondary border border-idemora-border flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:bg-black/6 dark:hover:bg-white/7 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <p className="text-base font-semibold text-idemora-text-normal mb-1">{children}</p>;
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-idemora-text-muted leading-relaxed mb-4">{children}</p>;
}

// ─── Step 0: Split ────────────────────────────────────────────────────────────

function SplitStep({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-violet-500">
            <circle cx="8" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M3 13c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <Heading>Set up AI features</Heading>
          <p className="text-xs text-idemora-text-muted">Takes about 60 seconds</p>
        </div>
      </div>

      <p className="text-sm text-idemora-text-normal mb-5">
        Do you have an AI API key? (Gemini, Claude, OpenAI, DeepSeek, or Grok)
      </p>

      <div className="flex flex-col gap-2.5">
        <button
          onClick={onYes}
          className="w-full flex items-start gap-3 px-4 py-3 rounded-lg border border-idemora-border bg-idemora-bg-primary hover:border-blue-400/60 hover:bg-blue-500/5 transition-colors text-left group"
        >
          <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-green-500">
              <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-idemora-text-normal">Yes, I have a key</p>
            <p className="text-xs text-idemora-text-muted mt-0.5">Connect it now and unlock AI chat, semantic search, and vault processing.</p>
          </div>
        </button>

        <button
          onClick={onNo}
          className="w-full flex items-start gap-3 px-4 py-3 rounded-lg border border-idemora-border bg-idemora-bg-primary hover:border-idemora-border/80 transition-colors text-left"
        >
          <div className="w-6 h-6 rounded-full bg-idemora-bg-primary border border-idemora-border flex items-center justify-center shrink-0 mt-0.5">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-idemora-text-muted">
              <path d="M5 2v4M5 7.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-idemora-text-normal">No, I'll use the free tier</p>
            <p className="text-xs text-idemora-text-muted mt-0.5">Keyword search still works. Add a key anytime in Settings → AI.</p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── Step 1: API setup ────────────────────────────────────────────────────────

function APISetupStep({ onDone }: { onDone: () => void }) {
  const addKey            = useAIStore((s) => s.addKey);
  const markKeyValid      = useAIStore((s) => s.markKeyValid);
  const setProviderStatus = useAIStore((s) => s.setProviderStatus);
  const setEnabled        = useAIStore((s) => s.setEnabled);

const providers = useAIStore((s) => s.providers);

// Pre-detect: find the first provider that already has a valid key
const firstValidProvider = (["gemini","claude","openai","deepseek","grok"] as ProviderName[])
  .find((p) => providers[p]?.keys.some((k) => k.valid));

const [selectedProvider, setSelectedProvider] = useState<ProviderName>(firstValidProvider ?? "gemini");
const [keyValue,  setKeyValue]  = useState("");
const [showKey,   setShowKey]   = useState(false);
const [testing,   setTesting]   = useState(false);
const [connected, setConnected] = useState(!!firstValidProvider);
const [error,     setError]     = useState<string | null>(null);

  const meta = PROVIDERS.find((p) => p.name === selectedProvider)!;

  async function handleTest() {
    const trimmed = keyValue.trim();
    if (!trimmed) return;
    setTesting(true);
    setError(null);
    setProviderStatus(selectedProvider, "testing");

    try {
      await addKey(selectedProvider, "Personal", trimmed);
      const keys     = useAIStore.getState().providers[selectedProvider].keys;
      const newKeyId = keys[keys.length - 1]?.id;
      if (!newKeyId) throw new Error("Key was not saved.");

      const validationError = await validateProviderKey(selectedProvider, trimmed);

      if (validationError === null) {
        await markKeyValid(selectedProvider, newKeyId, true);
        setProviderStatus(selectedProvider, "connected");
        setConnected(true);
      } else {
        await markKeyValid(selectedProvider, newKeyId, false);
        setProviderStatus(selectedProvider, "error", validationError);
        setError(validationError);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error.";
      setProviderStatus(selectedProvider, "error", msg);
      setError(msg);
    } finally {
      setTesting(false);
    }
  }

  async function handleEnable() {
    await setEnabled(true);
    onDone();
  }

  return (
    <div>
      <Heading>Connect your API key</Heading>
      <Sub>Your key is stored locally — never sent through Idemora's servers.</Sub>

      {/* Provider selector */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {PROVIDERS.map((p) => (
          <button
            key={p.name}
            onClick={() => {
              if (connected) return;
              setSelectedProvider(p.name);
              setKeyValue("");
              setError(null);
            }}
            disabled={connected}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              selectedProvider === p.name
                ? "bg-blue-500 text-white border-blue-500"
                : "border-idemora-border text-idemora-text-muted bg-idemora-bg-primary hover:border-blue-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
          >
            {p.label}
            {p.recommended && selectedProvider !== p.name && (
              <span className="ml-1 text-[9px] text-green-400 font-semibold">FREE</span>
            )}
          </button>
        ))}
      </div>

      {/* Key input */}
      {!connected && (
        <div className="space-y-2.5 mb-4">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleTest(); }}
              placeholder={meta.placeholder}
              spellCheck={false}
              autoComplete="off"
              className="w-full px-3 py-2 pr-9 text-sm rounded-lg border border-idemora-border bg-idemora-bg-primary text-idemora-text-normal placeholder-idemora-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-idemora-text-muted"
            >
              {showKey ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M2 2l10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2"/>
                  <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              )}
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              disabled={!keyValue.trim() || testing}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {testing && (
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/>
                </svg>
              )}
              {testing ? "Testing…" : "Test & Connect"}
            </button>
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              {meta.docsLabel}
            </a>
          </div>
        </div>
      )}

      {/* Connected state */}
      {connected && (
        <div className="mb-4 flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-green-500/30 bg-green-500/5">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-600">
              {PROVIDERS.find((p) => p.name === selectedProvider)?.label} connected
            </p>
            <p className="text-xs text-idemora-text-muted mt-0.5">
              AI chat, semantic search, and vault processing are ready to enable.
            </p>
          </div>
        </div>
      )}

      {/* Gemini free tier note */}
      {selectedProvider === "gemini" && !connected && (
        <div className="mb-4 p-2.5 rounded-lg bg-idemora-bg-primary border border-idemora-border">
          <p className="text-xs text-idemora-text-muted leading-relaxed">
            💡 Gemini has a generous free tier — no credit card required.{" "}
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500">
              Get your free key →
            </a>
          </p>
        </div>
      )}

      {/* Enable button */}
      <button
        onClick={handleEnable}
        disabled={!connected}
        className="w-full py-2 text-sm font-medium rounded-lg bg-blue-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Enable AI features →
      </button>
    </div>
  );
}

// ─── Step 2: Free tier ────────────────────────────────────────────────────────

function FreeTierStep({ onDone }: { onDone: () => void }) {
  return (
    <div>
      <Heading>You're on the free tier</Heading>
      <Sub>No API key needed. Here's what works and what doesn't.</Sub>

      <div className="space-y-2 mb-5">
        {[
          { label: "Keyword search across all notes",         ok: true  },
          { label: "Note linking, tags, backlinks",           ok: true  },
          { label: "Canvas, graph view, version history",     ok: true  },
          { label: "AI chat and semantic search",             ok: false },
          { label: "Vault synthesis and rolling summaries",   ok: false },
          { label: "Similarity suggestions",                  ok: false },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
              item.ok ? "bg-green-500/10" : "bg-idemora-bg-primary border border-idemora-border"
            }`}>
              {item.ok ? (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-green-500">
                  <path d="M1.5 4l2 2L6.5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-idemora-text-muted">
                  <path d="M2 2l4 4M6 2L2 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              )}
            </span>
            <span className={`text-sm ${item.ok ? "text-idemora-text-normal" : "text-idemora-text-muted"}`}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      <div className="p-3 rounded-lg bg-idemora-bg-primary border border-idemora-border mb-4">
        <p className="text-xs text-idemora-text-muted leading-relaxed">
          💡 Gemini has a free tier with no credit card required. When you're ready,{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            get a free key at Google AI Studio
          </a>{" "}
          and add it in <span className="font-medium text-idemora-text-normal">Settings → AI</span>.
        </p>
      </div>

      <button
        onClick={onDone}
        className="w-full py-2 text-sm font-medium rounded-lg border border-idemora-border bg-idemora-bg-primary text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7 transition-colors"
      >
        Got it, continue with keyword search
      </button>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function AISetupModal({ isOpen, onClose }: Props) {
  const [step, setStep] = useState<Step>("split");
  const updateSetting   = useAppSettings((s) => s.updateSetting);

  if (!isOpen) return null;

  function dismiss() {
    updateSetting("hasSeenAISetup", true);
    onClose();
  }

  return (
    <ModalShell onClose={dismiss}>
      {step === "split" && (
        <SplitStep
          onYes={() => setStep("api-setup")}
          onNo={()  => setStep("free-tier")}
        />
      )}
      {step === "api-setup" && (
        <APISetupStep onDone={dismiss} />
      )}
      {step === "free-tier" && (
        <FreeTierStep onDone={dismiss} />
      )}
    </ModalShell>
  );
}