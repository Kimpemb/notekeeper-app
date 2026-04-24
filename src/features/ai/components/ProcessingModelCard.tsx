// src/features/ai/components/ProcessingModelCard.tsx
//
// Processing model configuration card.
// Shows current processing provider/model, cost estimate, daily RPD consumption.
// Allows override from profile default.

import { useState } from "react";
import { useAIStore }    from "@/features/ai/store/useAIStore";
import { PROVIDER_META } from "@/features/ai/lib/provider";
import type { ProviderName } from "@/features/ai/store/useAIStore";

// ─── Pricing estimates ────────────────────────────────────────────────────────
// Rough estimate: one vault import ≈ 2000 processing tokens

const PROCESSING_COST_PER_1M: Partial<Record<string, number>> = {
  "gemini-2.0-flash-lite": 0.075,
  "gemini-2.0-flash":      0.10,
  "deepseek-chat":         0.28,
  "gpt-4o-mini":           0.15,
  "claude-haiku-4-5-20251001": 0.80,
};

function estimateCostPer1kTokens(model: string): string {
  const perM = PROCESSING_COST_PER_1M[model];
  if (!perM) return "—";
  const per1k = perM / 1000;
  if (per1k < 0.001) return "<$0.001";
  return `$${per1k.toFixed(4)}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProcessingModelCard() {
  const processingSlot    = useAIStore((s) => s.processingSlot);
  const setProcessingSlot = useAIStore((s) => s.setProcessingSlot);
  const providers         = useAIStore((s) => s.providers);
  const rpdBudget         = useAIStore((s) => s.rpdBudget);

  const [showOverride, setShowOverride] = useState(false);
  const [newProvider,  setNewProvider]  = useState<ProviderName>(processingSlot.provider);
  const [newModel,     setNewModel]     = useState(processingSlot.model);

  const meta    = PROVIDER_META[processingSlot.provider];
  const budget  = rpdBudget[processingSlot.provider];
  const usedPct = budget ? Math.min(100, (budget.used / budget.ceiling) * 100) : 0;

  // Only providers with a valid key are selectable for processing
  const selectableProviders = (Object.keys(PROVIDER_META) as ProviderName[]).filter(
    (p) => providers[p].keys.some((k) => k.valid)
  );

  async function handleSave() {
    await setProcessingSlot({ provider: newProvider, model: newModel.trim() || undefined });
    setShowOverride(false);
  }

  const resetTime = budget
    ? new Date(budget.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <div className="rounded-lg border border-idemora-border bg-idemora-bg-primary overflow-hidden mb-3">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-idemora-border">
        <span className="text-sm font-medium text-idemora-text-normal">Processing Model</span>
        <span className="text-xs text-idemora-text-muted">Background operations</span>
      </div>

      {/* Current config */}
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-idemora-text-muted">Provider</span>
          <span className="text-xs text-idemora-text-normal font-medium">{meta.label}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-idemora-text-muted">Model</span>
          <span className="text-xs font-mono text-idemora-text-normal">{processingSlot.model}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-idemora-text-muted">Est. cost / 1k tokens</span>
          <span className="text-xs text-idemora-text-normal">{estimateCostPer1kTokens(processingSlot.model)}</span>
        </div>

        {/* RPD mini-bar */}
        {budget && (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-idemora-text-muted">Daily requests</span>
              <span className="text-xs text-idemora-text-muted">
                {budget.used} / {budget.ceiling} · resets {resetTime}
              </span>
            </div>
            <div className="h-1 rounded-full bg-idemora-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  usedPct >= 90 ? "bg-red-400" : usedPct >= 70 ? "bg-yellow-400" : "bg-blue-500"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Override section */}
      <div className="border-t border-idemora-border">
        <button
          onClick={() => setShowOverride((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
        >
          <span>Override</span>
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            className={`transition-transform ${showOverride ? "rotate-180" : ""}`}
          >
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {showOverride && (
          <div className="px-3 pb-3 space-y-2">
            <div>
              <label className="text-xs text-idemora-text-muted block mb-1">Provider</label>
              <select
                value={newProvider}
                onChange={(e) => {
                  const p = e.target.value as ProviderName;
                  setNewProvider(p);
                  setNewModel(PROVIDER_META[p].processingDefault);
                }}
                className="w-full text-xs bg-idemora-bg-secondary text-idemora-text-normal border border-idemora-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {selectableProviders.map((p) => (
                  <option key={p} value={p}>{PROVIDER_META[p].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-idemora-text-muted block mb-1">Model</label>
              <input
                type="text"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-md border border-idemora-border bg-idemora-bg-secondary text-idemora-text-normal font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-xs rounded-md bg-blue-500 text-white transition-colors"
              >
                Apply
              </button>
              <button
                onClick={() => {
                  setNewProvider(processingSlot.provider);
                  setNewModel(processingSlot.model);
                  setShowOverride(false);
                }}
                className="px-3 py-1.5 text-xs rounded-md border border-idemora-border text-idemora-text-muted hover:text-idemora-text-normal transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}