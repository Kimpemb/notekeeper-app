// src/features/ai/store/useAIStore.ts

import { create } from "zustand";
import { getSetting, setSetting } from "@/features/notes/db/queries";

const AI_SETTINGS_KEY = "ai_settings_v1";

export type AIProvider = "gemini";
export type ConnectionStatus = "idle" | "testing" | "connected" | "error";

interface AISettings {
  provider: AIProvider;
  apiKey: string;
  enabled: boolean;
}

interface AIStore {
  // ── Persisted state ──────────────────────────────────────────────────────
  provider: AIProvider;
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
}

export const useAIStore = create<AIStore>((set, get) => ({
  // ── Defaults ─────────────────────────────────────────────────────────────
  provider: "gemini",
  apiKey: "",
  enabled: false,
  connectionStatus: "idle",
  connectionError: null,
  isLoading: false,

  // ── Load from SQLite settings ─────────────────────────────────────────────
  loadAISettings: async () => {
  try {
    const raw = await getSetting(AI_SETTINGS_KEY);
    console.log("loadAISettings raw:", raw); // ← add this
    if (!raw) return;
    const parsed: Partial<AISettings> = JSON.parse(raw);
    console.log("loadAISettings parsed:", parsed); // ← and this
    set({
      provider: parsed.provider ?? "gemini",
      apiKey: parsed.apiKey ?? "",
      enabled: parsed.enabled ?? false,
      connectionStatus: parsed.apiKey ? "connected" : "idle",
    });
  } catch (err) {
    console.log("loadAISettings error:", err); // ← and this
  }
},

  // ── Persist to SQLite ─────────────────────────────────────────────────────
  saveAISettings: async (settings) => {
    const current = get();
    const merged: AISettings = {
      provider: settings.provider ?? current.provider,
      apiKey: settings.apiKey ?? current.apiKey,
      enabled: settings.enabled ?? current.enabled,
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

  // ── Test Gemini connection ────────────────────────────────────────────────
  testConnection: async () => {
    const { apiKey, provider } = get();
    if (!apiKey.trim()) {
      set({ connectionStatus: "error", connectionError: "API key is required." });
      return false;
    }

    set({ connectionStatus: "testing", connectionError: null });

    try {
      const { testGeminiConnection } = await import("@/features/ai/lib/client");
      const ok = await testGeminiConnection(apiKey);

      if (ok) {
        await get().saveAISettings({ apiKey, provider, enabled: true });
        set({ connectionStatus: "connected", connectionError: null });
        return true;
      } else {
        set({ connectionStatus: "error", connectionError: "Invalid API key or connection failed." });
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
    await get().saveAISettings({ apiKey: "", enabled: false });
    set({
      apiKey: "",
      enabled: false,
      connectionStatus: "idle",
      connectionError: null,
    });
  },
}));