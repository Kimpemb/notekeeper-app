// src/features/ai/lib/profilePresets.ts
//
// Profile preset definitions for Pro Mode and Budget Mode.
//
// Responsibilities:
//   - Define what each preset assigns to primary and processing slots
//   - applyPreset()         — applies a preset to the store with missing-key guard
//   - detectCurrentProfile() — infers which profile (if any) matches the live store state
//   - migrateLegacyProfile() — upgrades configs that predate the profile system
//
// This file does NOT write to the store directly — it calls store actions.
// All key resolution stays in the store. This layer only decides *what* to apply.

import { useAIStore }           from "@/features/ai/store/useAIStore";
import { PROVIDER_META }        from "@/features/ai/lib/provider";
import type {
  ProviderName,
  ProfileMode,
  ModelSlotConfig,
} from "@/features/ai/store/useAIStore";

// ─── Preset shape ─────────────────────────────────────────────────────────────

export interface PresetSlot {
  provider: ProviderName;
  model:    string;
}

export interface ProfilePreset {
  mode:             Exclude<ProfileMode, "custom">;
  label:            string;
  description:      string;
  primary:          PresetSlot;
  processing:       PresetSlot;
  embeddingProvider: "gemini" | "openai" | "deepseek";
  /** Bullet points shown in the ProfileSelector expand panel */
  highlights:       string[];
}

// ─── Preset definitions ───────────────────────────────────────────────────────

export const PRO_PRESET: ProfilePreset = {
  mode:        "pro",
  label:       "Pro Mode",
  description: "Best quality responses. Claude or GPT as primary model.",
  primary: {
    provider: "claude",
    model:    PROVIDER_META.claude.primaryDefault, // "claude-sonnet-4-6"
  },
  processing: {
    provider: "gemini",
    model:    PROVIDER_META.gemini.processingDefault, // "gemini-2.0-flash-lite"
  },
  embeddingProvider: "gemini",
  highlights: [
    "Primary: Claude Sonnet — strong reasoning and writing",
    "Processing: Gemini Flash-Lite — fractions of a cent per background op",
    "Embeddings: Gemini text-embedding-004 — generous free tier",
    "Recommended for users with an existing Claude or OpenAI subscription",
  ],
};

export const BUDGET_PRESET: ProfilePreset = {
  mode:        "budget",
  label:       "Budget Mode",
  description: "Near-identical quality at a fraction of the cost. Gemini as primary.",
  primary: {
    provider: "gemini",
    model:    PROVIDER_META.gemini.primaryDefault, // "gemini-2.5-pro"
  },
  processing: {
    provider: "gemini",
    model:    PROVIDER_META.gemini.processingDefault, // "gemini-2.0-flash-lite"
  },
  embeddingProvider: "gemini",
  highlights: [
    "Primary: Gemini 2.5 Pro — competitive quality, generous free tier",
    "Processing: Gemini Flash-Lite — negligible cost",
    "Embeddings: Gemini text-embedding-004 — free tier default",
    "Recommended for students, researchers, and cost-conscious users",
  ],
};

export const PRESETS: Record<Exclude<ProfileMode, "custom">, ProfilePreset> = {
  pro:    PRO_PRESET,
  budget: BUDGET_PRESET,
};

// ─── applyPreset ──────────────────────────────────────────────────────────────
//
// Attempts to apply a preset to the live store.
//
// Returns:
//   { ok: true }                          — preset applied, store updated
//   { ok: false, missingKey: ProviderName } — primary provider has no valid key;
//                                            caller should prompt the user to add one.
//                                            The current configuration is left unchanged.
//
// Processing slot: if the processing provider also has no valid key (unusual —
// Budget mode uses Gemini for both slots so it would already have failed above),
// the processing slot keyId is set to null. client.ts handles this gracefully by
// skipping background calls until a key is added.

export type ApplyPresetResult =
  | { ok: true }
  | { ok: false; missingKey: ProviderName };

export async function applyPreset(
  mode: Exclude<ProfileMode, "custom">,
): Promise<ApplyPresetResult> {
  const store  = useAIStore.getState();
  const preset = PRESETS[mode];

  // Guard — primary provider must have at least one valid key
  if (!store.hasValidKey(preset.primary.provider)) {
    return { ok: false, missingKey: preset.primary.provider };
  }

  // Apply primary slot
  await store.setPrimarySlot({
    provider: preset.primary.provider,
    model:    preset.primary.model,
    keyId:    resolveKeyId(preset.primary.provider),
  });

  // Apply processing slot (best-effort — null keyId is acceptable)
  await store.setProcessingSlot({
    provider: preset.processing.provider,
    model:    preset.processing.model,
    keyId:    resolveKeyId(preset.processing.provider),
  });

  // Apply embedding provider
  await store.setEmbeddingProvider(preset.embeddingProvider);

  // Mark profile as the named preset (not "custom")
  // switchProfile in the store handles the final profile label write,
  // but we call it here so the store stays consistent with the preset.
  // If switchProfile returns a provider name, something changed between
  // our guard above and now — treat it as success since slots are already set.
  await store.switchProfile(mode);

  return { ok: true };
}

// ─── detectCurrentProfile ─────────────────────────────────────────────────────
//
// Compares the live store's primary and processing slots against each preset.
// Returns the matching ProfileMode or "custom" if no preset matches.
//
// Used by ProfileSelector to show the correct active toggle state,
// and by the store's setPrimarySlot / setProcessingSlot to auto-set "custom"
// when the user manually overrides a slot (already done in the store actions).

export function detectCurrentProfile(
  primarySlot:    Pick<ModelSlotConfig, "provider" | "model">,
  processingSlot: Pick<ModelSlotConfig, "provider" | "model">,
): ProfileMode {
  for (const preset of Object.values(PRESETS)) {
    if (
      primarySlot.provider    === preset.primary.provider    &&
      primarySlot.model       === preset.primary.model       &&
      processingSlot.provider === preset.processing.provider &&
      processingSlot.model    === preset.processing.model
    ) {
      return preset.mode;
    }
  }
  return "custom";
}

// ─── migrateLegacyProfile ─────────────────────────────────────────────────────
//
// Called once at startup (from loadAISettings) when the persisted profile is
// "custom" but the slots happen to match a known preset — can occur when a user
// manually configured their slots before the profile system existed.
//
// Also handles configs that pre-date the dual-slot system entirely (v1 migration
// already ran in the store, but the resulting profile was set to "custom").
//
// Mutates nothing — returns the correct ProfileMode for the store to apply.

export function migrateLegacyProfile(
  primarySlot:    Pick<ModelSlotConfig, "provider" | "model">,
  processingSlot: Pick<ModelSlotConfig, "provider" | "model">,
  currentProfile: ProfileMode,
): ProfileMode {
  // If already a named preset, nothing to do
  if (currentProfile !== "custom") return currentProfile;

  // Try to match against known presets
  const detected = detectCurrentProfile(primarySlot, processingSlot);

  // Only upgrade "custom" → named preset if we find an exact match.
  // If it stays "custom", that's correct — user has a bespoke config.
  return detected;
}

// ─── Preset summary strings ───────────────────────────────────────────────────
//
// Short human-readable strings used in toasts and confirmation dialogs.

export function presetSwitchSummary(mode: Exclude<ProfileMode, "custom">): string {
  const preset = PRESETS[mode];
  return (
    `Switched to ${preset.label}. ` +
    `Primary: ${PROVIDER_META[preset.primary.provider].label} · ` +
    `Processing: ${PROVIDER_META[preset.processing.provider].label} Flash-Lite.`
  );
}

export function missingKeyPrompt(provider: ProviderName): string {
  const meta = PROVIDER_META[provider];
  return (
    `Add a ${meta.label} API key to switch to Pro Mode. ` +
    `Get one at ${meta.docsUrl}`
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the best available keyId for a provider from the live store.
 * Prefers the current active key, then falls back to the first valid key.
 * Returns null if no valid key exists (caller should have guarded before this).
 */
function resolveKeyId(provider: ProviderName): string | null {
  const state     = useAIStore.getState();
  const pState    = state.providers[provider];
  const activeId  = pState.activeKeyId;

  // Use active key if it's valid
  if (activeId && pState.keys.find((k) => k.id === activeId && k.valid)) {
    return activeId;
  }

  // Fall back to first valid key
  return pState.keys.find((k) => k.valid)?.id ?? null;
}