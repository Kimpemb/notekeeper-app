// src/features/ai/store/useAIStore.ts

import { create } from "zustand";
import { getSetting, setSetting } from "@/features/notes/db/queries";
import { startIndexer, stopIndexer } from "@/features/ai/lib/indexer";

// ─── Constants ────────────────────────────────────────────────────────────────

const AI_SETTINGS_KEY    = "ai_settings_v2";
const AI_SETTINGS_KEY_V1 = "ai_settings_v1";

let indexerStarted = false;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderName =
  | "gemini"
  | "openai"
  | "claude"
  | "deepseek"
  | "grok";

export type ModelSlot = "primary" | "processing";

export type ProfileMode = "pro" | "budget" | "custom";

export type ConnectionStatus = "idle" | "testing" | "connected" | "error";

export type EmbeddingThroughput = "conservative" | "unlocked";

export type EmbeddingProvider = "gemini" | "openai" | "deepseek";

// A single stored API key entry for a provider
export interface StoredKey {
  id:     string;         // uuid — stable identifier
  label:  string;         // user-visible label e.g. "Personal", "Work"
  key:    string;         // the raw API key
  valid:  boolean;        // last validation result
}

// The independently configured slot for primary or processing model
export interface ModelSlotConfig {
  provider: ProviderName;
  model:    string;       // exact model string e.g. "gemini-2.0-flash-lite"
  keyId:    string | null; // references StoredKey.id for that provider
}

// Per-provider runtime state
export interface ProviderState {
  keys:            StoredKey[];
  activeKeyId:     string | null;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
}

// RPD (requests per day) budget tracking — per provider
export interface RPDBudget {
  used:      number;
  ceiling:   number;
  resetAt:   number;      // Unix ms — next midnight local time
}

export interface RotationState {
  provider: ProviderName;
  model:    string;
  keyId:    string | null;
}

export type RotationSlot = "primary" | "processing" | "embedding";


// What gets persisted to SQLite
interface PersistedSettings {
  primarySlot:          ModelSlotConfig;
  processingSlot:       ModelSlotConfig;
  providers:            Record<ProviderName, { keys: StoredKey[]; activeKeyId: string | null }>;
  embeddingProvider:    EmbeddingProvider;
  embeddingThroughput:  EmbeddingThroughput;
  profile:              ProfileMode;
  enabled:              boolean;
  rpdBudget?:           Record<ProviderName, RPDBudget>;
  providerRotationOrder?: ProviderName[];
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AIStore {
  // ── Persisted ────────────────────────────────────────────────────────────
  primarySlot:          ModelSlotConfig;
  processingSlot:       ModelSlotConfig;
  providers:            Record<ProviderName, ProviderState>;
  embeddingProvider:    EmbeddingProvider;
  embeddingThroughput:  EmbeddingThroughput;
  profile:              ProfileMode;
  enabled:              boolean;
  providerRotationOrder: ProviderName[];

  // ── Runtime ──────────────────────────────────────────────────────────────
  rpdBudget:            Record<ProviderName, RPDBudget>;
  isLoading:            boolean;

  // Runtime rotation state — independent per slot, never persisted
  primaryRotation:      RotationState;
  processingRotation:   RotationState;
  embeddingActiveKeyId: string | null;

  // ── Init ─────────────────────────────────────────────────────────────────
  loadAISettings: () => Promise<void>;

  // ── Key management ────────────────────────────────────────────────────────
  addKey:            (provider: ProviderName, label: string, key: string) => Promise<void>;
  removeKey:         (provider: ProviderName, keyId: string) => Promise<void>;
  setActiveKey:      (provider: ProviderName, keyId: string) => Promise<void>;
  markKeyValid:      (provider: ProviderName, keyId: string, valid: boolean) => Promise<void>;
  setProviderStatus: (provider: ProviderName, status: ConnectionStatus, error?: string | null) => void;

  // ── Slot configuration ────────────────────────────────────────────────────
  setPrimarySlot:    (config: Partial<ModelSlotConfig>) => Promise<void>;
  setProcessingSlot: (config: Partial<ModelSlotConfig>) => Promise<void>;

  // ── Profile presets ───────────────────────────────────────────────────────
  switchProfile: (mode: ProfileMode) => Promise<ProviderName | null>;

  // ── Embedding ─────────────────────────────────────────────────────────────
  setEmbeddingProvider:   (provider: EmbeddingProvider) => Promise<void>;
  setEmbeddingThroughput: (throughput: EmbeddingThroughput) => Promise<void>;

  // ── RPD budget ────────────────────────────────────────────────────────────
  incrementRPD: (provider: ProviderName) => void;
  resetRPD:     (provider: ProviderName) => void;

  // ── Master toggle ─────────────────────────────────────────────────────────
  setEnabled: (enabled: boolean) => Promise<void>;

  switchEmbeddingKey: (keyId: string) => Promise<void>;


  // ── Rotation — called by client.ts only ───────────────────────────────────
  setRotationState:        (slot: RotationSlot, state: Partial<RotationState>) => void;
  setEmbeddingActiveKey:   (keyId: string | null) => void;
  setProviderRotationOrder: (order: ProviderName[]) => Promise<void>;

  // ── Selectors ─────────────────────────────────────────────────────────────
  getActiveKey:          (provider: ProviderName) => string | null;
  getActiveKeyId:        (provider: ProviderName) => string | null;
  getKeyById:            (provider: ProviderName, keyId: string) => string | null;
  hasValidKey:           (provider: ProviderName) => boolean;
  hasAnyValidKey:        () => boolean;
  getRotationState:      (slot: RotationSlot) => RotationState;
  getNextProvider:       (currentProvider: ProviderName, slot: RotationSlot) => ProviderName | null;
  getNextKeyForProvider: (provider: ProviderName, exhaustedKeyIds: string[]) => string | null;
  getNextModelForProvider: (provider: ProviderName, model: string, exhaustedModels: string[]) => string | null;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PROVIDER_ROTATION_ORDER: ProviderName[] = [
  "gemini", "deepseek", "claude", "openai"
];

const DEFAULT_PRIMARY_SLOT: ModelSlotConfig = {
  provider: "gemini",
  model:    "gemini-2.5-flash",
  keyId:    null,
};

const DEFAULT_PROCESSING_SLOT: ModelSlotConfig = {
  provider: "gemini",
  model:    "gemini-2.0-flash-lite",
  keyId:    null,
};

const DEFAULT_PROVIDER_STATE: ProviderState = {
  keys:             [],
  activeKeyId:      null,
  connectionStatus: "idle",
  connectionError:  null,
};

function defaultProviders(): Record<ProviderName, ProviderState> {
  return {
    gemini:   { ...DEFAULT_PROVIDER_STATE },
    openai:   { ...DEFAULT_PROVIDER_STATE },
    claude:   { ...DEFAULT_PROVIDER_STATE },
    deepseek: { ...DEFAULT_PROVIDER_STATE },
    grok:     { ...DEFAULT_PROVIDER_STATE },
  };
}

const RPD_CEILINGS: Record<EmbeddingThroughput, number> = {
  conservative: 1000,
  unlocked:     5000,
};

function defaultRPDBudget(throughput: EmbeddingThroughput): Record<ProviderName, RPDBudget> {
  const ceiling = RPD_CEILINGS[throughput];
  const resetAt = nextMidnightMs();
  const entry: RPDBudget = { used: 0, ceiling, resetAt };
  return {
    gemini:   { ...entry },
    openai:   { ...entry },
    claude:   { ...entry },
    deepseek: { ...entry },
    grok:     { ...entry },
  };
}

function nextMidnightMs(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// ─── Profile preset definitions ───────────────────────────────────────────────

// Pro: Claude/OpenAI primary, Gemini Flash-Lite processing
const PRO_PRESET: { primary: Omit<ModelSlotConfig, "keyId">; processing: Omit<ModelSlotConfig, "keyId"> } = {
  primary:    { provider: "claude" as ProviderName,   model: "claude-sonnet-4-6" },
  processing: { provider: "gemini" as ProviderName,   model: "gemini-2.0-flash-lite" },
};

const BUDGET_PRESET: { primary: Omit<ModelSlotConfig, "keyId">; processing: Omit<ModelSlotConfig, "keyId"> } = {
  primary:    { provider: "gemini" as ProviderName,   model: "gemini-2.5-flash" },
  processing: { provider: "gemini" as ProviderName,   model: "gemini-2.0-flash-lite" },
};

// ─── Migration from v1 ────────────────────────────────────────────────────────

interface V1Settings {
  provider: "gemini" | "openai" | "anthropic";
  apiKey:   string;
  enabled:  boolean;
}

function migrateV1(raw: string): Partial<PersistedSettings> | null {
  try {
    const v1 = JSON.parse(raw) as Partial<V1Settings>;
    if (!v1.apiKey) return null;

    // Map "anthropic" → "claude"
    const providerName: ProviderName =
      v1.provider === "anthropic" ? "claude" : (v1.provider ?? "gemini");

    const keyId = crypto.randomUUID();
    const storedKey: StoredKey = {
      id:    keyId,
      label: "Imported",
      key:   v1.apiKey,
      valid: true,
    };

    const providers = defaultProviders();
    providers[providerName] = {
      keys:             [storedKey],
      activeKeyId:      keyId,
      connectionStatus: "connected",
      connectionError:  null,
    };

    return {
      primarySlot: {
        provider: providerName,
        model:    providerName === "gemini" ? "gemini-2.5-pro" : "claude-sonnet-4-6",
        keyId,
      },
      processingSlot: DEFAULT_PROCESSING_SLOT,
      providers,
      embeddingProvider:   "gemini",
      embeddingThroughput: "conservative",
      profile:             "custom",
      enabled:             v1.enabled ?? false,
    };
  } catch {
    return null;
  }
}

// ─── Persist helper ───────────────────────────────────────────────────────────

function toPersistedSettings(state: AIStore): PersistedSettings {
  const providers = {} as Record<ProviderName, { keys: StoredKey[]; activeKeyId: string | null }>;
  for (const p of Object.keys(state.providers) as ProviderName[]) {
    providers[p] = {
      keys:        state.providers[p].keys,
      activeKeyId: state.providers[p].activeKeyId,
    };
  }
  return {
    primarySlot:          state.primarySlot,
    processingSlot:       state.processingSlot,
    providers,
    embeddingProvider:    state.embeddingProvider,
    embeddingThroughput:  state.embeddingThroughput,
    profile:              state.profile,
    enabled:              state.enabled,
    rpdBudget:            state.rpdBudget,
    providerRotationOrder: state.providerRotationOrder,
  };
}

async function persist(state: AIStore): Promise<void> {
  await setSetting(AI_SETTINGS_KEY, JSON.stringify(toPersistedSettings(state)));
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAIStore = create<AIStore>((set, get) => ({
  // ── Defaults ──────────────────────────────────────────────────────────────
  primarySlot:         DEFAULT_PRIMARY_SLOT,
  processingSlot:      DEFAULT_PROCESSING_SLOT,
  providers:           defaultProviders(),
  embeddingProvider:   "gemini",
  embeddingThroughput: "conservative",
  profile:             "budget",
  enabled:             false,
  rpdBudget:           defaultRPDBudget("conservative"),
  isLoading:           false,
  providerRotationOrder: DEFAULT_PROVIDER_ROTATION_ORDER,
  primaryRotation: {
    provider: DEFAULT_PRIMARY_SLOT.provider,
    model:    DEFAULT_PRIMARY_SLOT.model,
    keyId:    DEFAULT_PRIMARY_SLOT.keyId,
  },
  processingRotation: {
    provider: DEFAULT_PROCESSING_SLOT.provider,
    model:    DEFAULT_PROCESSING_SLOT.model,
    keyId:    DEFAULT_PROCESSING_SLOT.keyId,
  },
  embeddingActiveKeyId: null,

// ── Load from SQLite ──────────────────────────────────────────────────────
loadAISettings: async () => {
  set({ isLoading: true });
  try {
    // Try v2 first
    let raw = await getSetting(AI_SETTINGS_KEY);
    console.log("[loadAISettings] raw:", raw);
    let parsed: Partial<PersistedSettings> | null = null;

    if (raw) {
      try { parsed = JSON.parse(raw) as PersistedSettings; }
      catch { parsed = null; }
    }

    // Fall back to v1 migration
    if (!parsed) {
      const v1Raw = await getSetting(AI_SETTINGS_KEY_V1);
      if (v1Raw) parsed = migrateV1(v1Raw);
    }

    if (!parsed) return;

    // Rehydrate provider state — merge persisted keys into default runtime state
    const providers = defaultProviders();
    if (parsed.providers) {
      for (const p of Object.keys(parsed.providers) as ProviderName[]) {
        const persisted = parsed.providers[p];
        providers[p] = {
          ...DEFAULT_PROVIDER_STATE,
          keys:         persisted.keys        ?? [],
          activeKeyId:  persisted.activeKeyId ?? null,
          connectionStatus: persisted.keys?.some((k) => k.valid) ? "connected" : "idle",
        };
      }
    }

    const throughput = parsed.embeddingThroughput ?? "conservative";
    const now = Date.now();

    // Restore persisted RPD budget, but reset any provider whose resetAt has passed
    let rpdBudget = defaultRPDBudget(throughput);
    if (parsed.rpdBudget) {
      for (const p of Object.keys(parsed.rpdBudget) as ProviderName[]) {
        const persisted = parsed.rpdBudget[p];
        if (persisted) {
          rpdBudget[p] = now >= persisted.resetAt
            ? { used: 0, ceiling: RPD_CEILINGS[throughput], resetAt: nextMidnightMs() }
            : { ...persisted, ceiling: RPD_CEILINGS[throughput] };
        }
      }
    }

    // Resolve keyIds for rotation slots — fall back to provider's activeKeyId
    // if slot was persisted before keyId tracking was added
    const primaryProvider    = parsed.primarySlot?.provider    ?? DEFAULT_PRIMARY_SLOT.provider;
    const processingProvider = parsed.processingSlot?.provider ?? DEFAULT_PROCESSING_SLOT.provider;
    const embeddingProvider  = parsed.embeddingProvider ?? "gemini";

    const primaryKeyId    = parsed.primarySlot?.keyId
      ?? providers[primaryProvider].activeKeyId
      ?? null;
    const processingKeyId = parsed.processingSlot?.keyId
      ?? providers[processingProvider].activeKeyId
      ?? null;
    const embeddingKeyId  = parsed.providers?.gemini?.activeKeyId
      ?? providers[embeddingProvider as ProviderName].activeKeyId
      ?? null;

    set({
      primarySlot:         parsed.primarySlot         ?? DEFAULT_PRIMARY_SLOT,
      processingSlot:      parsed.processingSlot       ?? DEFAULT_PROCESSING_SLOT,
      providers,
      embeddingProvider:   embeddingProvider,
      embeddingThroughput: throughput,
      profile:             parsed.profile              ?? "custom",
      enabled:             parsed.enabled              ?? false,
      rpdBudget,
      providerRotationOrder: parsed.providerRotationOrder ?? DEFAULT_PROVIDER_ROTATION_ORDER,
      primaryRotation: {
        provider: primaryProvider,
        model:    parsed.primarySlot?.model ?? DEFAULT_PRIMARY_SLOT.model,
        keyId:    primaryKeyId,
      },
      processingRotation: {
        provider: processingProvider,
        model:    parsed.processingSlot?.model ?? DEFAULT_PROCESSING_SLOT.model,
        keyId:    processingKeyId,
      },
      embeddingActiveKeyId: embeddingKeyId,
    });

    // Start indexer if enabled and has a valid key
    if (parsed.enabled && get().hasAnyValidKey() && !indexerStarted) {
      indexerStarted = true;
      await startIndexer();
    }
  } catch {
    // silently ignore — store stays at defaults
  } finally {
    set({ isLoading: false });
  }
},

  // ── Key management ────────────────────────────────────────────────────────

  addKey: async (provider, label, key) => {
  // Duplicate check across ALL providers — not just the target provider
  for (const p of Object.keys(get().providers) as ProviderName[]) {
    const match = get().providers[p].keys.find((k) => k.key === key);
    if (match) {
      throw new Error(`This key is already added under label "${match.label}" for ${p}`);
    }
  }

  const keyId = crypto.randomUUID();
  const newKey: StoredKey = { id: keyId, label, key, valid: false };
  set((s) => ({
    providers: {
      ...s.providers,
      [provider]: {
        ...s.providers[provider],
        keys: [...s.providers[provider].keys, newKey],
        activeKeyId: s.providers[provider].activeKeyId ?? keyId,
      },
    },
    rpdBudget: {
      ...s.rpdBudget,
      [provider]: {
        used: 0,
        ceiling: s.rpdBudget[provider]?.ceiling ?? RPD_CEILINGS[s.embeddingThroughput],
        resetAt: nextMidnightMs(),
      },
    },
  }));
  await persist(get());

  // If indexer is paused and this is a Gemini key, immediately attempt resume
  if (provider === "gemini") {
    const { resumeIndexerWithKey } = await import("@/features/ai/lib/indexer");
    await resumeIndexerWithKey(keyId);
  }
},

  removeKey: async (provider, keyId) => {
  const state    = get()
  const keys     = state.providers[provider].keys
  const remaining = keys.filter((k) => k.id !== keyId)

  // Last key for this provider — hard block for embedding (Gemini-only)
  if (remaining.length === 0 && provider === "gemini") {
    throw new Error(
      "Gemini is required for embedding. Add another Gemini key before removing this one, or indexing will stop permanently."
    )
  }

  // Check if key is active in any rotation slots
  const isActiveEmbedding = state.embeddingActiveKeyId === keyId
  const isActivePrimary   = state.primaryRotation.keyId === keyId
  const isActiveProcessing = state.processingRotation.keyId === keyId

  // Find next available key for this provider
  const nextKey = remaining.find((k) => k.valid) ?? remaining[0] ?? null

  set((s) => {
    const newActiveKeyId = s.providers[provider].activeKeyId === keyId
      ? (nextKey?.id ?? null)
      : s.providers[provider].activeKeyId

    return {
      providers: {
        ...s.providers,
        [provider]: {
          ...s.providers[provider],
          keys: remaining,
          activeKeyId: newActiveKeyId,
          connectionStatus: remaining.length === 0 ? "idle" : s.providers[provider].connectionStatus,
          connectionError:  remaining.length === 0 ? null  : s.providers[provider].connectionError,
        },
      },
      // Atomically switch rotation slots if they were using the deleted key
      embeddingActiveKeyId: isActiveEmbedding ? (nextKey?.id ?? null) : s.embeddingActiveKeyId,
      primaryRotation: isActivePrimary
        ? { ...s.primaryRotation, keyId: nextKey?.id ?? null }
        : s.primaryRotation,
      processingRotation: isActiveProcessing
        ? { ...s.processingRotation, keyId: nextKey?.id ?? null }
        : s.processingRotation,
    }
  })

  console.log("[removeKey] before persist, keys:", get().providers[provider].keys.map(k => k.id))
  await persist(get())
  console.log("[removeKey] persist complete")

  // If embedding slot just lost its key and no replacement, pause indexer
  if (isActiveEmbedding && !nextKey) {
    const { stopIndexer } = await import("@/features/ai/lib/indexer")
    stopIndexer()
    console.warn("[store] last embedding key removed — indexer stopped")
  }
},

  setActiveKey: async (provider, keyId) => {
    set((s) => ({
      providers: {
        ...s.providers,
        [provider]: { ...s.providers[provider], activeKeyId: keyId },
      },
    }));
    await persist(get());
  },

  markKeyValid: async (provider, keyId, valid) => {
    set((s) => ({
      providers: {
        ...s.providers,
        [provider]: {
          ...s.providers[provider],
          keys: s.providers[provider].keys.map((k) =>
            k.id === keyId ? { ...k, valid } : k
          ),
          connectionStatus: valid ? "connected" : "error",
          connectionError:  valid ? null : "Key validation failed.",
        },
      },
    }));
    await persist(get());
  },

  setProviderStatus: (provider, status, error = null) => {
    set((s) => ({
      providers: {
        ...s.providers,
        [provider]: {
          ...s.providers[provider],
          connectionStatus: status,
          connectionError:  error ?? null,
        },
      },
    }));
  },

  // ── Slot configuration ────────────────────────────────────────────────────

  setPrimarySlot: async (config) => {
    set((s) => ({
      primarySlot: { ...s.primarySlot, ...config },
      profile:     "custom",
    }));
    await persist(get());
  },

  setProcessingSlot: async (config) => {
    set((s) => ({
      processingSlot: { ...s.processingSlot, ...config },
      profile:        "custom",
    }));
    await persist(get());
  },

  // ── Profile presets ───────────────────────────────────────────────────────

  switchProfile: async (mode) => {
    if (mode === "custom") {
      set({ profile: "custom" });
      await persist(get());
      return null;
    }

    const preset = mode === "pro" ? PRO_PRESET : BUDGET_PRESET;

    // Guard: primary provider must have a valid key
    const primaryProvider = preset.primary.provider;
    if (!get().hasValidKey(primaryProvider)) {
      return primaryProvider; // caller surfaces "add a key for X" prompt
    }

    // Resolve keyId for primary slot
    const primaryKeyId =
      get().providers[primaryProvider].activeKeyId ??
      get().providers[primaryProvider].keys.find((k) => k.valid)?.id ??
      null;

    // Resolve keyId for processing slot (Gemini Flash-Lite — may share key)
    const processingProvider = preset.processing.provider;
    const processingKeyId =
      get().providers[processingProvider].activeKeyId ??
      get().providers[processingProvider].keys.find((k) => k.valid)?.id ??
      null;

    set({
      primarySlot:    { ...preset.primary,    keyId: primaryKeyId },
      processingSlot: { ...preset.processing, keyId: processingKeyId },
      profile:        mode,
    });
    await persist(get());
    return null;
  },

  // ── Embedding ─────────────────────────────────────────────────────────────

  setEmbeddingProvider: async (provider) => {
    set({ embeddingProvider: provider });
    await persist(get());
  },

  setEmbeddingThroughput: async (throughput) => {
    set((s) => ({
      embeddingThroughput: throughput,
      // Update ceilings in existing RPD budget entries
      rpdBudget: Object.fromEntries(
        Object.entries(s.rpdBudget).map(([p, b]) => [
          p,
          { ...b, ceiling: RPD_CEILINGS[throughput] },
        ])
      ) as Record<ProviderName, RPDBudget>,
    }));
    await persist(get());
  },

  // ── RPD budget ────────────────────────────────────────────────────────────

  incrementRPD: (provider) => {
    set((s) => {
      const budget = s.rpdBudget[provider];
      const now    = Date.now();
      if (now >= budget.resetAt) {
        return {
          rpdBudget: {
            ...s.rpdBudget,
            [provider]: { used: 1, ceiling: budget.ceiling, resetAt: nextMidnightMs() },
          },
        };
      }
      return {
        rpdBudget: {
          ...s.rpdBudget,
          [provider]: { ...budget, used: budget.used + 1 },
        },
      };
    });
    // Persist after every increment so count survives app restarts
    persist(get());
  },

  resetRPD: (provider) => {
    set((s) => ({
      rpdBudget: {
        ...s.rpdBudget,
        [provider]: {
          ...s.rpdBudget[provider],
          used:    0,
          resetAt: nextMidnightMs(),
        },
      },
    }));
  },

  // ── Master toggle ─────────────────────────────────────────────────────────

  setEnabled: async (enabled) => {
    if (enabled && !get().hasAnyValidKey()) return; // guard — can't enable without a key

    set({ enabled });
    await persist(get());

    if (enabled && !indexerStarted) {
      indexerStarted = true;
      await startIndexer();
    }

    if (!enabled) {
      stopIndexer();
      indexerStarted = false;
    }
  },

  // ── Rotation methods ──────────────────────────────────────────────────────

  setRotationState: (slot, state) => {
    if (slot === "primary") {
      set((s) => ({ primaryRotation: { ...s.primaryRotation, ...state } }));
    } else if (slot === "processing") {
      set((s) => ({ processingRotation: { ...s.processingRotation, ...state } }));
    }
    // embedding slot uses embeddingActiveKeyId — handled separately
  },

  setEmbeddingActiveKey: (keyId) => {
    set({ embeddingActiveKeyId: keyId });
  },

  setProviderRotationOrder: async (order) => {
    set({ providerRotationOrder: order });
    await persist(get());
  },

  switchEmbeddingKey: async (keyId: string) => {
  const { manualSwitchEmbeddingKey } = await import("@/features/ai/lib/client")
  const { getEmbeddingQuotaToday }   = await import("@/features/notes/db/queries")
  const state = get()

  const { wasExhausted } = await manualSwitchEmbeddingKey(keyId)

  const count = await getEmbeddingQuotaToday(
    state.embeddingProvider, "gemini-embedding-001", keyId
  )
  console.info(`[store] embedding key switched — today's count: ${count}, wasExhausted: ${wasExhausted}`)

  await persist(get())
},

  // ── Selectors ─────────────────────────────────────────────────────────────

  getActiveKey: (provider) => {
    const state    = get().providers[provider];
    const activeId = state.activeKeyId;
    if (!activeId) return null;
    return state.keys.find((k) => k.id === activeId)?.key ?? null;
  },

  getActiveKeyId: (provider) => {
    return get().providers[provider].activeKeyId;
  },

  getKeyById: (provider, keyId) => {
    return get().providers[provider].keys.find((k) => k.id === keyId)?.key ?? null;
  },

  hasValidKey: (provider) => {
    return get().providers[provider].keys.some((k) => k.valid);
  },

  hasAnyValidKey: () => {
    return Object.values(get().providers).some((p) =>
      p.keys.some((k) => k.valid)
    );
  },

  getRotationState: (slot) => {
    const s = get();
    if (slot === "primary")    return s.primaryRotation;
    if (slot === "processing") return s.processingRotation;
    // embedding slot
    return {
      provider: s.embeddingProvider as ProviderName,
      model:    "gemini-embedding-001",
      keyId:    s.embeddingActiveKeyId,
    };
  },

  getNextProvider: (currentProvider, _slot) => {
    const order = get().providerRotationOrder;
    const idx   = order.indexOf(currentProvider);
    if (idx === -1 || idx === order.length - 1) return null;
    return order[idx + 1];
  },

  getNextKeyForProvider: (provider, exhaustedKeyIds) => {
    const keys = get().providers[provider].keys;
    const next = keys.find((k) => k.valid && !exhaustedKeyIds.includes(k.id));
    return next?.id ?? null;
  },

  getNextModelForProvider: (provider, _currentModel, exhaustedModels) => {
    // Model lists per provider — extend as new models are added
    const MODEL_LISTS: Partial<Record<ProviderName, string[]>> = {
      gemini:   ["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.5-pro"],
      openai:   ["gpt-4o-mini", "gpt-4o"],
      claude:   ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
      deepseek: ["deepseek-chat", "deepseek-reasoner"],
      grok:     ["grok-3-mini", "grok-3"],
    };
    const models = MODEL_LISTS[provider] ?? [];
    return models.find((m) => !exhaustedModels.includes(m)) ?? null;
  },
}));