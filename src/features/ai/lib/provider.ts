// src/features/ai/lib/provider.ts
//
// Central provider abstraction layer.
// - Capability map: which providers support chat / embedding / both
// - Default model per provider per slot (primary, processing)
// - Unified chat() and embed() dispatchers — slot-aware, called by client.ts
// - blobToVector / vectorToBlob — used by queries.ts for embedding storage
//
// This file does NOT read from the store directly. All key and model resolution
// happens in client.ts, which passes concrete strings here. This keeps the
// provider layer pure and testable.

import { geminiChat, geminiEmbed, validateGeminiKey, GEMINI_PROVIDER_META }         from "./providers/gemini";
import { deepseekChat, deepseekEmbed, validateDeepSeekKey, DEEPSEEK_PROVIDER_META } from "./providers/deepseek";
import { grokChat, validateGrokKey, GROK_PROVIDER_META }                            from "./providers/grok";
import { claudeChat, validateClaudeKey, CLAUDE_PROVIDER_META }                      from "./providers/claude";
import { openaiChat, openaiEmbed, validateOpenAIKey, OPENAI_PROVIDER_META }         from "./providers/openai";

import type { ProviderName, EmbeddingProvider } from "@/features/ai/store/useAIStore";

// ─── Capability map ───────────────────────────────────────────────────────────
//
// chat:      provider can handle foreground and background chat completions
// embedding: provider can produce embedding vectors
//
// Used by:
//   - ProfileSelector — to warn when a chosen processing model can't embed
//   - SettingsModal   — to filter embedding provider options to connected keys
//   - client.ts       — to guard against routing embed requests to chat-only providers

export type ProviderCapability = "chat" | "embedding";

export interface ProviderMeta {
  name:               ProviderName;
  label:              string;
  capabilities:       readonly ProviderCapability[];
  primaryDefault:     string;   // default model for the primary slot
  processingDefault:  string;   // default model for the processing slot
  embeddingModelId:   string | null; // stable ID used in the embeddings table
  dataResidencyNotice?: string; // shown before activation if present
  freeTokenGrant?:    number;   // shown in budget estimate UI
  docsUrl:            string;
}

export const PROVIDER_META: Record<ProviderName, ProviderMeta> = {
  gemini:   GEMINI_PROVIDER_META,
  deepseek: DEEPSEEK_PROVIDER_META,
  grok:     GROK_PROVIDER_META,
  claude:   CLAUDE_PROVIDER_META,
  openai:   OPENAI_PROVIDER_META,
};

// ─── Convenience selectors ───────────────────────────────────────────────────

export function providerSupports(
  provider: ProviderName,
  capability: ProviderCapability,
): boolean {
  return PROVIDER_META[provider].capabilities.includes(capability);
}

export function defaultModelForSlot(
  provider: ProviderName,
  slot: "primary" | "processing",
): string {
  const meta = PROVIDER_META[provider];
  return slot === "primary" ? meta.primaryDefault : meta.processingDefault;
}

/** Returns all providers that support embedding, in display order */
export function embeddingCapableProviders(): EmbeddingProvider[] {
  return (Object.keys(PROVIDER_META) as ProviderName[]).filter(
    (p) => providerSupports(p, "embedding")
  ) as EmbeddingProvider[];
}

// ─── Unified chat dispatcher ─────────────────────────────────────────────────
//
// client.ts calls callProviderChat() with concrete provider/model/key strings.
// The slot (primary vs processing) is determined before this call and passed
// through for debug log purposes only.

export interface ProviderMessage {
  role:    "user" | "assistant" | "system";
  content: string;
}

export interface ProviderChatResult {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
}

/**
 * Route a chat completion to the correct provider implementation.
 * All parameters are resolved by client.ts before this call.
 */
export async function callProviderChat(
  provider: ProviderName,
  apiKey:   string,
  model:    string,
  messages: ProviderMessage[],
  system?:  string,
): Promise<ProviderChatResult> {
  switch (provider) {
    case "gemini":
      return geminiChat(
        apiKey,
        model,
        messages.map((m) => ({
          role:  m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        system,
      );

    case "deepseek":
      return deepseekChat(
        apiKey,
        model,
        messages.map((m) => ({
          role:    m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        system,
      );

    case "grok":
      return grokChat(
        apiKey,
        model,
        messages.map((m) => ({
          role:    m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        system,
      );

    case "claude":
      // Claude's Messages API does not accept a "system" role in the messages
      // array — system prompt goes in the top-level system field, which
      // claudeChat handles. Filter any system-role entries from the array so
      // callers that include them don't double-apply or cause an API error.
      return claudeChat(
        apiKey,
        model,
        messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role:    m.role as "user" | "assistant",
            content: m.content,
          })),
        system,
      );

    case "openai":
      return openaiChat(
        apiKey,
        model,
        messages.map((m) => ({
          role:    m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        system,
      );

    default: {
      const _exhaustive: never = provider;
      throw new ProviderError(_exhaustive, "unknown", "unknown", "Unknown provider");
    }
  }
}

// ─── Unified embedding dispatcher ────────────────────────────────────────────

/**
 * Route an embedding request to the correct provider.
 * Only providers with embedding capability should be passed here.
 * client.ts enforces this before calling.
 */
export async function callProviderEmbed(
  provider: EmbeddingProvider,
  apiKey:   string,
  text:     string,
): Promise<Float32Array> {
  switch (provider) {
    case "gemini":
      return geminiEmbed(apiKey, text);

    case "deepseek":
      return deepseekEmbed(apiKey, text);

    case "openai":
      return openaiEmbed(apiKey, text);

    default: {
      const _exhaustive: never = provider;
      throw new ProviderError(_exhaustive as string, "unknown", "unknown", "Unknown embedding provider");
    }
  }
}

// ─── Key validation dispatcher ───────────────────────────────────────────────

/**
 * Validate an API key for a given provider.
 * Returns null on success, or a human-readable error string.
 */
export async function validateProviderKey(
  provider: ProviderName,
  apiKey:   string,
): Promise<string | null> {
  switch (provider) {
    case "gemini":   return validateGeminiKey(apiKey);
    case "deepseek": return validateDeepSeekKey(apiKey);
    case "grok":     return validateGrokKey(apiKey);
    case "claude":   return validateClaudeKey(apiKey);
    case "openai":   return validateOpenAIKey(apiKey);
    default: {
      const _exhaustive: never = provider;
      return `Unknown provider: ${_exhaustive}`;
    }
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly model:    string,
    public readonly code:     string,
    message:                  string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// ─── Embedding storage helpers ────────────────────────────────────────────────
//
// These were in the original provider.ts and are referenced by queries.ts.
// Kept here so the import path is stable.

/**
 * Convert a Float32Array embedding vector to a base64 string for SQLite storage.
 */
export function vectorToBlob(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer);
  let binary  = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string from SQLite back to a Float32Array.
 */
export function blobToVector(blob: string): Float32Array {
  const binary = atob(blob);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

// ─── Embedding model ID helpers ───────────────────────────────────────────────

/**
 * Returns the stable model_id string used in the embeddings table
 * for the currently active embedding provider.
 * This must be consistent — changing it invalidates all stored embeddings.
 */
export function embeddingModelId(provider: EmbeddingProvider): string {
  const modelId = PROVIDER_META[provider].embeddingModelId;
  if (!modelId) throw new ProviderError(provider, "unknown", "no-embedding", `${provider} does not support embeddings`);
  return modelId;
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two Float32Array vectors.
 * Returns a value in [-1, 1]; higher is more similar.
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}