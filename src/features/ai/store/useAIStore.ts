// src/features/ai/store/useAIStore.ts

import { create } from "zustand";
import { getSetting, setSetting } from "@/features/notes/db/queries";
import { createGeminiProvider } from "@/features/ai/lib/providers/gemini";
import type { AIProvider } from "@/features/ai/lib/provider";
import { startIndexer, stopIndexer } from "@/features/ai/lib/indexer"


const AI_SETTINGS_KEY = "ai_settings_v1";
let indexerStarted = false


// AIProviderName is the string identifier stored in settings
// AIProvider (imported) is the interface that providers implement
export type AIProviderName = "gemini" | "openai" | "anthropic";
export type ConnectionStatus = "idle" | "testing" | "connected" | "error";

interface AISettings {
  provider: AIProviderName;   // ← string name, not the interface
  apiKey: string;
  enabled: boolean;
}

interface AIStore {
  // ── Persisted state ──────────────────────────────────────────────────────
  provider: AIProviderName;   // ← string name, not the interface
  apiKey: string;
  enabled: boolean;

  // ── Runtime state ────────────────────────────────────────────────────────
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  isLoading: boolean;

  // ── Actions ──────────────────────────────────────────────────────────────
  loadAISettings: () => Promise<void>;
  saveAISettings: (settings: Partial<AISettings>) => Promise<void>;
  setApiKey: (key: string) => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  testConnection: () => Promise<boolean>;
  clearConnection: () => Promise<void>;

  /**
   * Returns the active AIProvider instance using the current apiKey.
   * Throws ProviderError if no key is configured or provider is unknown.
   * Call this in new code instead of importing callGemini directly.
   */
  getProvider: () => AIProvider;  // ← returns the interface, takes AIProviderName from state
}

export const useAIStore = create<AIStore>((set, get) => ({
  // ── Defaults ─────────────────────────────────────────────────────────────
  provider: "gemini",           // ← AIProviderName string
  apiKey: "",
  enabled: false,
  connectionStatus: "idle",
  connectionError: null,
  isLoading: false,

  // ── Get active provider instance ──────────────────────────────────────────
  getProvider: (): AIProvider => {
    const { apiKey, provider } = get();
    if (provider === "gemini") return createGeminiProvider(apiKey);
    // "openai" and "anthropic" slot in here in Phase 5
    throw new Error(`Provider "${provider}" not yet implemented.`);
  },

  // ── Load from SQLite settings ─────────────────────────────────────────────
  loadAISettings: async () => {
  try {
    const raw = await getSetting(AI_SETTINGS_KEY);
    if (!raw) return;
    const parsed: Partial<AISettings> = JSON.parse(raw);
    set({
      provider: parsed.provider ?? "gemini",
      apiKey:   parsed.apiKey   ?? "",
      enabled:  parsed.enabled  ?? false,
      connectionStatus: parsed.apiKey ? "connected" : "idle",
    });
    // Only start the indexer once per session
    if (parsed.apiKey && parsed.enabled && !indexerStarted) {
      indexerStarted = true
      await startIndexer()
    }
  } catch {
    // silently ignore
  }
},

  // ── Persist to SQLite ─────────────────────────────────────────────────────
  saveAISettings: async (settings) => {
    const current = get();
    const merged: AISettings = {
      provider: settings.provider ?? current.provider,
      apiKey:   settings.apiKey   ?? current.apiKey,
      enabled:  settings.enabled  ?? current.enabled,
    };
    set(merged);
    await setSetting(AI_SETTINGS_KEY, JSON.stringify(merged));
  },

  // ── Set key in memory (not saved until testConnection succeeds) ───────────
  setApiKey: (key) => {
    set({ apiKey: key, connectionStatus: "idle", connectionError: null });
  },

  // ── Toggle AI on/off ──────────────────────────────────────────────────────
  setEnabled: async (enabled) => {
    await get().saveAISettings({ enabled });
  },

  // ── Test connection via active provider ───────────────────────────────────
  testConnection: async () => {
    const { apiKey, provider } = get();
    if (!apiKey.trim()) {
      set({ connectionStatus: "error", connectionError: "API key is required." });
      return false;
    }

    set({ connectionStatus: "testing", connectionError: null });

    try {
      const activeProvider = get().getProvider();
      const ok = await activeProvider.testConnection();

      if (ok) {
        await get().saveAISettings({ apiKey, provider, enabled: true });
        set({ connectionStatus: "connected", connectionError: null });
        await startIndexer()   // ← start indexer once key is confirmed valid
        return true;
      } else {
        set({
          connectionStatus: "error",
          connectionError: "Invalid API key or connection failed.",
        });
        return false;
      }
    } catch (err) {
      set({
        connectionStatus: "error",
        connectionError: err instanceof Error ? err.message : "Connection failed.",
      });
      return false;
    }
  },


  // ── Clear API key and reset ───────────────────────────────────────────────
  clearConnection: async () => {
  stopIndexer()
  indexerStarted = false   // ← allow restart if user re-adds a key
  await get().saveAISettings({ apiKey: "", enabled: false });
  set({
    apiKey: "",
    enabled: false,
    connectionStatus: "idle",
    connectionError: null,
  });
},
}));