// src/features/ai/components/ProviderCard.tsx
//
// Reusable provider card component for the AI settings panel.
// Shows: provider name, connection status, key manager, advanced model override.
// One card per supported provider, ordered by the parent (Gemini first).

import { useState } from "react";
import { useAIStore }          from "@/features/ai/store/useAIStore";
import { validateProviderKey } from "@/features/ai/lib/provider";
import { PROVIDER_META }       from "@/features/ai/lib/provider";
import type { ProviderName }   from "@/features/ai/store/useAIStore";

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: "idle" | "testing" | "connected" | "error" }) {
  const map = {
    idle:      { dot: "bg-zinc-400",              text: "text-idemora-text-muted",  label: "Not connected" },
    testing:   { dot: "bg-blue-400 animate-pulse", text: "text-blue-500",            label: "Testing…"      },
    connected: { dot: "bg-green-500",             text: "text-green-500",           label: "Connected"     },
    error:     { dot: "bg-red-400",               text: "text-red-500",             label: "Failed"        },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── Key row ──────────────────────────────────────────────────────────────────

function KeyRow({
  label,
  keyTail,
  isActive,
  onSetActive,
  onDelete,
}: {
  label:       string;
  keyTail:     string;
  isActive:    boolean;
  onSetActive: () => void;
  onDelete:    () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-idemora-border last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onSetActive}
          className={`w-3 h-3 rounded-full border shrink-0 transition-colors ${
            isActive
              ? "bg-blue-500 border-blue-500"
              : "border-idemora-border bg-idemora-bg-primary hover:border-blue-400"
          }`}
          title={isActive ? "Active key" : "Set as active"}
        />
        <span className="text-xs text-idemora-text-normal truncate">{label}</span>
        <span className="text-xs text-idemora-text-muted font-mono shrink-0">···{keyTail}</span>
      </div>
      <button
        onClick={onDelete}
        className="text-xs text-idemora-text-muted hover:text-red-400 transition-colors shrink-0"
      >
        Remove
      </button>
    </div>
  );
}

// ─── Add key form ─────────────────────────────────────────────────────────────

function AddKeyForm({
  provider,
  onDone,
}: {
  provider: ProviderName;
  onDone:   () => void;
}) {
  const addKey            = useAIStore((s) => s.addKey);
  const markKeyValid      = useAIStore((s) => s.markKeyValid);
  const setProviderStatus = useAIStore((s) => s.setProviderStatus);

  const [label,   setLabel]   = useState("Personal");
  const [key,     setKey]     = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const placeholders: Record<ProviderName, string> = {
    gemini:   "AIza...",
    openai:   "sk-...",
    claude:   "sk-ant-...",
    deepseek: "sk-...",
    grok:     "xai-...",
  };

  async function handleTest() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setTesting(true);
    setError(null);
    setProviderStatus(provider, "testing");

    try {
      await addKey(provider, label.trim() || "Personal", trimmed);
      const keys     = useAIStore.getState().providers[provider].keys;
      const newKeyId = keys[keys.length - 1]?.id;
      if (!newKeyId) throw new Error("Key was not saved.");

      const validationError = await validateProviderKey(provider, trimmed);

      if (validationError === null) {
        await markKeyValid(provider, newKeyId, true);
        setProviderStatus(provider, "connected");
        onDone();
      } else {
        await markKeyValid(provider, newKeyId, false);
        setProviderStatus(provider, "error", validationError);
        setError(validationError);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error.";
      setProviderStatus(provider, "error", msg);
      setError(msg);
    } finally {
      setTesting(false);
    }
  }

  const meta = PROVIDER_META[provider];

  return (
    <div className="mt-3 space-y-2">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder='Label (e.g. "Personal")'
        className="w-full px-3 py-1.5 text-xs rounded-md border border-idemora-border bg-idemora-bg-primary text-idemora-text-normal placeholder-idemora-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="relative">
        <input
          type={showKey ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={placeholders[provider]}
          spellCheck={false}
          autoComplete="off"
          className="w-full px-3 py-1.5 pr-8 text-xs rounded-md border border-idemora-border bg-idemora-bg-primary text-idemora-text-normal placeholder-idemora-text-muted focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
        />
        <button
          onClick={() => setShowKey((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-idemora-text-muted"
        >
          {showKey ? (
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="7" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M2 2l10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
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
          disabled={!key.trim() || testing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {testing && (
            <svg className="animate-spin" width="11" height="11" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/>
            </svg>
          )}
          {testing ? "Testing…" : "Test & Save"}
        </button>
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500"
        >
          Get key →
        </a>
        <button
          onClick={onDone}
          className="ml-auto text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main ProviderCard ────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: ProviderName;
  showModelOverride?: boolean;
}

export function ProviderCard({ provider, showModelOverride = true }: ProviderCardProps) {
  const providers      = useAIStore((s) => s.providers);
  const removeKey      = useAIStore((s) => s.removeKey);
  const setActiveKey   = useAIStore((s) => s.setActiveKey);
  const primarySlot    = useAIStore((s) => s.primarySlot);
  const setPrimarySlot = useAIStore((s) => s.setPrimarySlot);

  const [addingKey,     setAddingKey]     = useState(false);
  const [showAdvanced,  setShowAdvanced]  = useState(false);
  const [modelOverride, setModelOverride] = useState("");

  const pState   = providers[provider];
  const meta     = PROVIDER_META[provider];
  const hasKeys  = pState.keys.length > 0;
  const hasValid = pState.keys.some((k) => k.valid);

  const isActivePrimary = primarySlot.provider === provider;
  const currentModel    = isActivePrimary ? primarySlot.model : meta.primaryDefault;

  async function handleSaveModelOverride() {
    const trimmed = modelOverride.trim();
    if (!trimmed) return;
    if (isActivePrimary) {
      await setPrimarySlot({ model: trimmed });
    }
    setShowAdvanced(false);
    setModelOverride("");
  }

  return (
    <div className="rounded-lg border border-idemora-border bg-idemora-bg-primary overflow-hidden mb-3">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-idemora-text-normal">{meta.label}</span>
          {isActivePrimary && (
            <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">
              Active
            </span>
          )}
        </div>
        <StatusPill status={pState.connectionStatus} />
      </div>

      {/* Key list */}
      {hasKeys && (
        <div className="px-3 pb-1 border-t border-idemora-border">
          {pState.keys.map((k) => (
            <KeyRow
              key={k.id}
              label={k.label}
              keyTail={k.key.slice(-4)}
              isActive={k.id === pState.activeKeyId}
              onSetActive={() => setActiveKey(provider, k.id)}
              onDelete={() => removeKey(provider, k.id)}
            />
          ))}
        </div>
      )}

      {/* Add key form or button */}
      <div className="px-3 pb-3">
        {addingKey ? (
          <AddKeyForm provider={provider} onDone={() => setAddingKey(false)} />
        ) : (
          <button
            onClick={() => setAddingKey(true)}
            className="mt-2 text-xs text-blue-500 hover:text-blue-400 transition-colors"
          >
            + Add key
          </button>
        )}
      </div>

      {/* Advanced model override */}
      {showModelOverride && hasValid && (
        <div className="border-t border-idemora-border">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
          >
            <span>Advanced</span>
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            >
              <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {showAdvanced && (
            <div className="px-3 pb-3 space-y-2">
              <p className="text-xs text-idemora-text-muted">
                Override the primary model for {meta.label}. Default: <span className="font-mono">{meta.primaryDefault}</span>
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={modelOverride || currentModel}
                  onChange={(e) => setModelOverride(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-xs rounded-md border border-idemora-border bg-idemora-bg-secondary text-idemora-text-normal font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleSaveModelOverride}
                  className="px-3 py-1.5 text-xs rounded-md bg-idemora-bg-secondary border border-idemora-border text-idemora-text-normal hover:bg-black/6 dark:hover:bg-white/7 transition-colors"
                >
                  Apply
                </button>
                <button
                  onClick={async () => {
                    if (isActivePrimary) await setPrimarySlot({ model: meta.primaryDefault });
                    setModelOverride("");
                    setShowAdvanced(false);
                  }}
                  className="px-3 py-1.5 text-xs rounded-md border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}