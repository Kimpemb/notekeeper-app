// src/features/ai/lib/providers/grok.ts
//
// Grok provider — chat only (no embedding endpoint available).
// Primary model: grok-3  (xAI, competitive on coding benchmarks at low cost)
//
// API is OpenAI-compatible.

import type { ProviderName } from "@/features/ai/store/useAIStore";

// ─── Model catalogue ──────────────────────────────────────────────────────────

export const GROK_MODELS = {
  PRIMARY: [
    { id: "grok-3",       label: "Grok 3",       recommended: true  },
    { id: "grok-3-mini",  label: "Grok 3 Mini",  recommended: false },
  ],
  PROCESSING: [
    { id: "grok-3-mini",  label: "Grok 3 Mini",  recommended: true  },
  ],
} as const;

export const GROK_PRIMARY_DEFAULT    = "grok-3";
export const GROK_PROCESSING_DEFAULT = "grok-3-mini";

// Pricing constants (USD per million tokens)
export const GROK_PRICING = {
  "grok-3":      { input: 3.00,  output: 15.00 },
  "grok-3-mini": { input: 0.30,  output: 0.50  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

// OpenAI-compatible
export interface GrokMessage {
  role:    "system" | "user" | "assistant";
  content: string;
}

export interface GrokChatRequest {
  model:       string;
  messages:    GrokMessage[];
  temperature?: number;
  max_tokens?:  number;
}

export interface GrokChatResponse {
  choices: Array<{
    message:       { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens:     number;
    completion_tokens: number;
    total_tokens:      number;
  };
}

// ─── Endpoint ─────────────────────────────────────────────────────────────────

const GROK_BASE_URL = "https://api.x.ai/v1";

// ─── Chat ─────────────────────────────────────────────────────────────────────

/**
 * Send a chat message to Grok.
 *
 * @param apiKey   The raw API key string
 * @param model    Exact model string e.g. "grok-3"
 * @param messages Conversation history
 * @param system   Optional system message
 * @returns        The assistant reply text and token counts
 */
export async function grokChat(
  apiKey:   string,
  model:    string,
  messages: GrokMessage[],
  system?:  string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const allMessages: GrokMessage[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const body: GrokChatRequest = { model, messages: allMessages };

  const res = await fetch(`${GROK_BASE_URL}/chat/completions`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new GrokError(res.status, err?.error?.message ?? res.statusText, model);
  }

  const data: GrokChatResponse = await res.json();
  const text         = data.choices?.[0]?.message?.content ?? "";
  const inputTokens  = data.usage?.prompt_tokens     ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return { text, inputTokens, outputTokens };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a Grok API key. Returns null on success or an error string.
 */
export async function validateGrokKey(apiKey: string): Promise<string | null> {
  try {
    await grokChat(apiKey, GROK_PRIMARY_DEFAULT, [{ role: "user", content: "hi" }]);
    return null;
  } catch (e) {
    if (e instanceof GrokError) {
      if (e.status === 401 || e.status === 403)
        return "API key rejected. Check it at console.x.ai.";
      if (e.status === 429)
        return "Rate limited. Key is valid but quota is exhausted.";
      return `Grok error ${e.status}: ${e.message}`;
    }
    return "Could not reach Grok. Check your connection.";
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class GrokError extends Error {
  constructor(
    public readonly status:  number,
    message:                 string,
    public readonly model:   string,
  ) {
    super(message);
    this.name = "GrokError";
  }

  get isQuotaExhausted(): boolean { return this.status === 429; }
  get isInvalidKey():     boolean { return this.status === 401 || this.status === 403; }
  get isNetworkError():   boolean { return this.status === 0; }
}

// ─── Provider identity ────────────────────────────────────────────────────────

export const GROK_PROVIDER_META = {
  name:              "grok" as ProviderName,
  label:             "Grok",
  capabilities:      ["chat"] as const,  // no embedding endpoint
  primaryDefault:    GROK_PRIMARY_DEFAULT,
  processingDefault: GROK_PROCESSING_DEFAULT,
  embeddingModelId:  null,               // not supported
  docsUrl:           "https://console.x.ai/",
};