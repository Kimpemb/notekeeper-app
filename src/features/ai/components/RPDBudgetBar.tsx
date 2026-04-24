// src/features/ai/components/RPDBudgetBar.tsx
//
// Daily embedding request consumption bar.
// Shows used / ceiling, reset time, quota-reached state.
// Shown in the AI settings panel under the embedding provider selector.

import { useAIStore } from "@/features/ai/store/useAIStore";

export function RPDBudgetBar() {
  const embeddingProvider  = useAIStore((s) => s.embeddingProvider);
  const embeddingThroughput = useAIStore((s) => s.embeddingThroughput);
  const rpdBudget          = useAIStore((s) => s.rpdBudget);
  const setEmbeddingThroughput = useAIStore((s) => s.setEmbeddingThroughput);
  const hasAnyValidKey     = useAIStore((s) => s.hasAnyValidKey);

  const budget = rpdBudget[embeddingProvider];
  if (!budget) return null;

  const usedPct   = Math.min(100, (budget.used / budget.ceiling) * 100);
  const isMaxed   = budget.used >= budget.ceiling;
  const resetTime = new Date(budget.resetAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const barColor = isMaxed
    ? "bg-red-400"
    : usedPct >= 80
    ? "bg-yellow-400"
    : "bg-blue-500";

  return (
    <div className="rounded-lg border border-idemora-border bg-idemora-bg-primary px-3 py-2.5 mb-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-idemora-text-normal">
          Embedding requests today
        </span>
        <span className={`text-xs font-medium ${isMaxed ? "text-red-400" : "text-idemora-text-muted"}`}>
          {isMaxed ? "Quota reached" : `${budget.used} / ${budget.ceiling}`}
        </span>
      </div>

      {/* Bar */}
      <div className="h-1.5 rounded-full bg-idemora-border overflow-hidden mb-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${Math.max(usedPct, usedPct > 0 ? 2 : 0)}%` }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        {isMaxed ? (
          <p className="text-xs text-idemora-text-muted">
            Resets at {resetTime}. Keyword search still works.
          </p>
        ) : (
          <p className="text-xs text-idemora-text-muted">
            Resets at {resetTime}
          </p>
        )}

        {/* Throughput toggle — only shown when an API key exists */}
        {hasAnyValidKey() && (
          <button
            onClick={() =>
              setEmbeddingThroughput(
                embeddingThroughput === "conservative" ? "unlocked" : "conservative"
              )
            }
            className="text-xs text-blue-500 hover:text-blue-400 transition-colors shrink-0 ml-3"
          >
            {embeddingThroughput === "conservative" ? "Unlock higher limit" : "Use conservative limit"}
          </button>
        )}
      </div>
    </div>
  );
}