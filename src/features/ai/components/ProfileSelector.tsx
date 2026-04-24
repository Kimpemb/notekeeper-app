// src/features/ai/components/ProfileSelector.tsx
import { useState } from "react";
import { useAIStore }      from "@/features/ai/store/useAIStore";
import {
  applyPreset,
  PRESETS,
  missingKeyPrompt,
} from "@/features/ai/lib/profilePresets";
import type { ProfileMode } from "@/features/ai/store/useAIStore";

type ActiveMode = Exclude<ProfileMode, "custom">;

export function ProfileSelector() {
  const profile = useAIStore((s) => s.profile);

  const [expanded,   setExpanded]   = useState<ActiveMode | null>(null);
  const [switching,  setSwitching]  = useState(false);
  const [missingMsg, setMissingMsg] = useState<string | null>(null);

  const modes: ActiveMode[] = ["pro", "budget"];

  async function handleSwitch(mode: ActiveMode) {
    if (mode === profile) return;
    setSwitching(true);
    setMissingMsg(null);

    try {
      const result = await applyPreset(mode);
      if (!result.ok) {
        setMissingMsg(missingKeyPrompt(result.missingKey));
      }
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="mb-4">
      <div className="flex gap-2 mb-3">
        {modes.map((mode) => {
          const preset    = PRESETS[mode];
          const isActive  = profile === mode;

          return (
            <button
              key={mode}
              disabled={switching}
              onClick={() => handleSwitch(mode)}
              onMouseEnter={() => setExpanded(mode)}
              onMouseLeave={() => setExpanded(null)}
              className={`flex-1 relative px-3 py-2 rounded-lg border text-left transition-all duration-150 ${
                isActive
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-idemora-border bg-idemora-bg-primary hover:border-blue-400/50"
              } ${switching ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${isActive ? "text-blue-400" : "text-idemora-text-normal"}`}>
                  {preset.label}
                </span>
                {isActive && (
                  <span className="text-[10px] font-semibold text-blue-400">Active</span>
                )}
              </div>
              <p className="text-xs text-idemora-text-muted mt-0.5 leading-snug">
                {preset.description}
              </p>
            </button>
          );
        })}
      </div>

      {profile === "custom" && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-idemora-text-muted">
            Custom configuration active.
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-idemora-bg-primary border border-idemora-border text-idemora-text-muted">
            Custom
          </span>
        </div>
      )}

      {expanded && (
        <div className="rounded-lg border border-idemora-border bg-idemora-bg-primary px-3 py-2.5 mb-3">
          <p className="text-xs font-medium text-idemora-text-normal mb-1.5">
            {PRESETS[expanded].label} includes:
          </p>
          <ul className="space-y-1">
            {PRESETS[expanded].highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-idemora-text-muted">
                <span className="text-blue-400 shrink-0 mt-px">·</span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingMsg && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2.5 mb-3">
          <p className="text-xs text-yellow-500 leading-relaxed">{missingMsg}</p>
        </div>
      )}
    </div>
  );
}