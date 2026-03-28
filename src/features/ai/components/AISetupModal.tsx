// src/features/ai/components/AISetupModal.tsx
//
// Renders inside SettingsModal under the "AI" section.
// Handles: key entry → test → connected state → disconnect.

import { useState } from "react";
import { useAIStore } from "@/features/ai/store/useAIStore";

// ─── Sub-components (match SettingsModal style exactly) ───────────────────────

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
      } ${checked ? "bg-blue-500" : "bg-zinc-200 dark:bg-zinc-700"}`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "idle" | "testing" | "connected" | "error" }) {
  const styles = {
    idle:      "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500",
    testing:   "bg-blue-50 dark:bg-blue-900/30 text-blue-500",
    connected: "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400",
    error:     "bg-red-50 dark:bg-red-900/30 text-red-500",
  };
  const labels = {
    idle:      "Not connected",
    testing:   "Testing…",
    connected: "Connected",
    error:     "Connection failed",
  };
  const dots = {
    idle:      "bg-zinc-300 dark:bg-zinc-600",
    testing:   "bg-blue-400 animate-pulse",
    connected: "bg-green-500",
    error:     "bg-red-400",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {labels[status]}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AISetupModal() {
  const apiKey           = useAIStore((s) => s.apiKey);
  const enabled          = useAIStore((s) => s.enabled);
  const connectionStatus = useAIStore((s) => s.connectionStatus);
  const connectionError  = useAIStore((s) => s.connectionError);
  const setApiKey        = useAIStore((s) => s.setApiKey);
  const setEnabled       = useAIStore((s) => s.setEnabled);
  const testConnection   = useAIStore((s) => s.testConnection);
  const clearConnection  = useAIStore((s) => s.clearConnection);

  const [localKey, setLocalKey] = useState(apiKey);
  const [showKey, setShowKey]   = useState(false);

  const isConnected = connectionStatus === "connected";
  const isTesting   = connectionStatus === "testing";

  function handleKeyChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setLocalKey(val);
    setApiKey(val);
  }

  async function handleTest() {
    if (!localKey.trim()) return;
    await testConnection();
  }

  async function handleDisconnect() {
    setLocalKey("");
    await clearConnection();
  }

  return (
    <div>
      {/* ── Status ── */}
      <SectionTitle>Connection</SectionTitle>
      <Row label="Gemini API" description="Your key is stored locally — never sent anywhere except Google.">
        <StatusBadge status={connectionStatus} />
      </Row>

      {/* ── API Key input ── */}
      {!isConnected && (
        <>
          <SectionTitle>API Key</SectionTitle>
          <div className="space-y-3">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={localKey}
                onChange={handleKeyChange}
                placeholder="AIza..."
                spellCheck={false}
                autoComplete="off"
                className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder-zinc-300 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title={showKey ? "Hide key" : "Show key"}
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

            {/* Error message */}
            {connectionStatus === "error" && connectionError && (
              <p className="text-xs text-red-500 dark:text-red-400">{connectionError}</p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={handleTest}
                disabled={!localKey.trim() || isTesting}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors duration-150"
              >
                {isTesting && (
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" strokeLinecap="round"/>
                  </svg>
                )}
                {isTesting ? "Testing…" : "Test & Connect"}
              </button>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
              >
                Get a free API key →
              </a>
            </div>
          </div>
        </>
      )}

      {/* ── Connected state ── */}
      {isConnected && (
        <>
          <SectionTitle>Controls</SectionTitle>
          <Row label="Enable AI features" description="Turn AI actions on or off in the editor">
            <Toggle
              checked={enabled}
              onChange={(v) => setEnabled(v)}
            />
          </Row>

          <div className="mt-4 flex items-center justify-between p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
            <div>
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Gemini 2.0 Flash</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                Key ending in ···{apiKey.slice(-4)}
              </p>
            </div>
            <button
              onClick={handleDisconnect}
              className="text-xs text-red-400 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300 transition-colors font-medium"
            >
              Disconnect
            </button>
          </div>
        </>
      )}

      {/* ── Info footer ── */}
      <div className="mt-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800">
        <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
          Your API key is stored locally in the app database. It is only used to call Google's Gemini API directly from your device.
        </p>
      </div>
    </div>
  );
}