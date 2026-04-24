// src/features/ai/lib/client.ts
//
// Slot-aware AI client. Every AI call in the app routes through one of:
//   callPrimary()    — foreground user-facing chat
//   callProcessing() — background ops (query expansion, synthesis, summarisation)
//   callEmbedding()  — embedding requests, routed through the embedding provider
//
// Responsibilities:
//   - Resolve provider / model / key from the live store for the correct slot
//   - Dispatch to provider.ts (which calls the concrete provider implementation)
//   - Normalise all provider-specific errors into AICallError
//   - Auto-retry rate-limit errors with exponential backoff
//   - Write every call outcome to debugLog.ts
//   - Never silently fall back — every failure surfaces a typed error
//
// This file does not import from chat.ts, indexer.ts, or semantic.ts.
// Those call sites import from here.

import { useAIStore }           from "@/features/ai/store/useAIStore";
import type { ProviderName, EmbeddingProvider } from "@/features/ai/store/useAIStore";
import {
  callProviderChat,
  callProviderEmbed,
  providerSupports,
  type ProviderMessage,
  type ProviderChatResult,
} from "@/features/ai/lib/provider";
import { logCallOk, logCallError } from "@/features/ai/lib/debugLog";
import type { LogSlot }            from "@/features/ai/lib/debugLog";

// ─── Public types ─────────────────────────────────────────────────────────────

export type { ProviderMessage };

export type AIErrorCode =
  | "NETWORK_ERROR"       // fetch failed entirely — DNS, timeout, offline
  | "AUTH_FAILED"         // 401 / 403 — key invalid or lacks permission
  | "QUOTA_EXCEEDED"      // 429 with quota exhausted, or DeepSeek 402
  | "RATE_LIMITED"        // 429 transient — retried internally, surfaces if all retries fail
  | "OVERLOADED"          // 529 (Claude) — provider overloaded
  | "NO_KEY"              // no key configured for this provider
  | "NO_PROVIDER"         // slot has no provider assigned
  | "EMBED_UNSUPPORTED"   // provider does not support embeddings
  | "UNKNOWN";            // anything else

/**
 * Normalised error returned by all callPrimary / callProcessing / callEmbedding
 * calls. Callers switch on `.code` to decide how to surface the error.
 */
export class AICallError extends Error {
  constructor(
    public readonly code:     AIErrorCode,
    public readonly provider: string,
    public readonly model:    string,
    message:                  string,
  ) {
    super(message);
    this.name = "AICallError";
  }

  /** True if retrying immediately is likely to succeed */
  get retryable(): boolean {
    return this.code === "RATE_LIMITED" || this.code === "OVERLOADED";
  }
}

// ─── Retry config ─────────────────────────────────────────────────────────────

const RETRY_ATTEMPTS    = 3;
const RETRY_BASE_MS     = 1_000;  // 1s, 2s, 4s

function backoffMs(attempt: number): number {
  return RETRY_BASE_MS * Math.pow(2, attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Error normalisation ──────────────────────────────────────────────────────
//
// Each provider has its own error class. Normalise them all into AICallError
// so callers only need to handle one shape.

function normaliseError(err: unknown, provider: string, model: string): AICallError {
  // Network failure — fetch() threw before any HTTP response
  if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
    return new AICallError("NETWORK_ERROR", provider, model, `Could not reach ${provider}. Check your connection.`);
  }

  // Extract status from any provider error class (all have .status)
  const status: number = (err as { status?: number }).status ?? -1;

  if (status === 0) {
    return new AICallError("NETWORK_ERROR", provider, model, `Could not reach ${provider}. Check your connection.`);
  }

  if (status === 401 || status === 403) {
    return new AICallError("AUTH_FAILED", provider, model,
      `Your ${provider} API key was rejected. Update it in Settings.`);
  }

  if (status === 402) {
    // DeepSeek — account balance zero
    return new AICallError("QUOTA_EXCEEDED", provider, model,
      `Your DeepSeek account balance is zero. Top up at platform.deepseek.com.`);
  }

  if (status === 429) {
    // Distinguish quota-exhausted (OpenAI `insufficient_quota`) from transient rate limit
    const code: string = (err as { code?: string }).code ?? "";
    if (code === "insufficient_quota") {
      return new AICallError("QUOTA_EXCEEDED", provider, model,
        `Your ${provider} quota is exhausted. Check your billing or switch providers.`);
    }
    return new AICallError("RATE_LIMITED", provider, model,
      `Too many requests to ${provider}. Retrying...`);
  }

  if (status === 529) {
    // Claude overloaded
    return new AICallError("OVERLOADED", provider, model,
      `${provider} is overloaded. Retrying...`);
  }

  const message = err instanceof Error ? err.message : String(err);
  return new AICallError("UNKNOWN", provider, model, message);
}

// ─── Slot resolution ──────────────────────────────────────────────────────────

interface ResolvedSlot {
  provider: ProviderName;
  model:    string;
  apiKey:   string;
}

function resolveSlot(slot: "primary" | "processing"): ResolvedSlot {
  const state      = useAIStore.getState();
  const slotConfig = slot === "primary" ? state.primarySlot : state.processingSlot;

  const provider = slotConfig.provider;
  const model    = slotConfig.model;

  const apiKey = state.getActiveKey(provider);
  if (!apiKey) {
    throw new AICallError(
      "NO_KEY",
      provider,
      model,
      `No API key configured for ${provider}. Add one in Settings → AI.`,
    );
  }

  return { provider, model, apiKey };
}

function resolveEmbeddingSlot(): { provider: EmbeddingProvider; apiKey: string } {
  const state    = useAIStore.getState();
  const provider = state.embeddingProvider;

  if (!providerSupports(provider, "embedding")) {
    throw new AICallError(
      "EMBED_UNSUPPORTED",
      provider,
      "embedding",
      `${provider} does not support embeddings.`,
    );
  }

  const apiKey = state.getActiveKey(provider);
  if (!apiKey) {
    throw new AICallError(
      "NO_KEY",
      provider,
      "embedding",
      `No API key configured for ${provider}. Add one in Settings → AI.`,
    );
  }

  return { provider, apiKey };
}

// ─── Core dispatcher with retry ───────────────────────────────────────────────

async function dispatchChat(
  slot:     "primary" | "processing",
  logSlot:  LogSlot,
  messages: ProviderMessage[],
  system?:  string,
): Promise<ProviderChatResult> {
  const { provider, model, apiKey } = resolveSlot(slot);

  let lastError: AICallError | null = null;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const t0 = Date.now();

    try {
      const result = await callProviderChat(provider, apiKey, model, messages, system);

      logCallOk({
        slot:         logSlot,
        provider,
        model,
        inputTokens:  result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs:    Date.now() - t0,
      });

      return result;

    } catch (err) {
      const latencyMs  = Date.now() - t0;
      const normalised = normaliseError(err, provider, model);

      // Non-retryable — log and throw immediately
      if (!normalised.retryable) {
        logCallError({
          slot:         logSlot,
          provider,
          model,
          latencyMs,
          errorCode:    normalised.code,
          errorMessage: normalised.message,
        });
        throw normalised;
      }

      // Retryable — log the attempt and back off before next try
      logCallError({
        slot:         logSlot,
        provider,
        model,
        latencyMs,
        errorCode:    normalised.code,
        errorMessage: `${normalised.message} (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
      });

      lastError = normalised;

      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt));
      }
    }
  }

  // All retries exhausted
  throw lastError ?? new AICallError("UNKNOWN", provider, model, "All retry attempts failed.");
}

// ─── Public call surface ──────────────────────────────────────────────────────

/**
 * Route a chat completion through the PRIMARY model slot.
 * Use for all foreground user-facing calls — chat responses the user reads.
 * Never use for background operations.
 */
export async function callPrimary(
  messages: ProviderMessage[],
  system?:  string,
): Promise<ProviderChatResult> {
  return dispatchChat("primary", "primary", messages, system);
}

/**
 * Route a chat completion through the PROCESSING model slot.
 * Use for all background ops:
 *   - query expansion
 *   - vault synthesis / formatting passes
 *   - rolling summary compression
 *   - inventory summarisation
 *   - CDE report generation
 *   - similarity suggestions
 */
export async function callProcessing(
  messages: ProviderMessage[],
  system?:  string,
): Promise<ProviderChatResult> {
  return dispatchChat("processing", "processing", messages, system);
}

/**
 * Route an embedding request through the active embedding provider.
 * Use for all embedding calls — indexer, semantic search, similarity.
 */
export async function callEmbedding(text: string): Promise<Float32Array> {
  const { provider, apiKey } = resolveEmbeddingSlot();
  const model = "embedding"; // model string is internal to the provider impl

  const t0 = Date.now();

  try {
    const vector = await callProviderEmbed(provider, apiKey, text);

    logCallOk({
      slot:         "embedding",
      provider,
      model,
      inputTokens:  0,
      outputTokens: 0,
      latencyMs:    Date.now() - t0,
    });

    // Increment RPD counter for the embedding provider
    useAIStore.getState().incrementRPD(provider);

    return vector;

  } catch (err) {
    const latencyMs  = Date.now() - t0;
    const normalised = normaliseError(err, provider, model);

    logCallError({
      slot:         "embedding",
      provider,
      model,
      latencyMs,
      errorCode:    normalised.code,
      errorMessage: normalised.message,
    });

    throw normalised;
  }
}

// ─── Convenience: single-turn prompt helpers ──────────────────────────────────
//
// Many call sites (actions.ts, buildContext.ts, etc.) send a single string
// prompt rather than a structured messages array. These helpers reduce boilerplate.

/**
 * Send a single prompt through the PRIMARY slot and return the text response.
 */
export async function promptPrimary(
  prompt: string,
  system?: string,
): Promise<string> {
  const result = await callPrimary(
    [{ role: "user", content: prompt }],
    system,
  );
  return result.text;
}

/**
 * Send a single prompt through the PROCESSING slot and return the text response.
 */
export async function promptProcessing(
  prompt: string,
  system?: string,
): Promise<string> {
  const result = await callProcessing(
    [{ role: "user", content: prompt }],
    system,
  );
  return result.text;
}

// ─── Store readiness guard ────────────────────────────────────────────────────

/**
 * Returns true if the AI layer is enabled and at least one provider slot
 * has a resolvable key. Use this before making any AI call in contexts
 * where AI might legitimately be disabled (e.g. free tier users).
 */
export function isAIReady(): boolean {
  const state = useAIStore.getState();
  if (!state.enabled) return false;
  return state.hasAnyValidKey();
}