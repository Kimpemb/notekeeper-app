// src/features/ai/lib/providers/claude.ts
//
// Anthropic Claude provider — chat only (no embedding endpoint).
// Primary model:    claude-sonnet-4-6           (strong reasoning and writing)
// Processing model: claude-haiku-4-5-20251001   (fast, cheap background ops)
//
// Uses Anthropic's native Messages API — not OpenAI-compatible.

import type { ProviderName } from "@/features/ai/store/useAIStore";

// ─── Model catalogue ──────────────────────────────────────────────────────────

export const CLAUDE_MODELS = {
  PRIMARY: [
    { id: "claude-opus-4-6",           label: "Claude Opus 4.6",   recommended: false },
    { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6", recommended: true  },
  ],
  PROCESSING: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5",  recommended: true  },
  ],
} as const;

export const CLAUDE_PRIMARY_DEFAULT    = "claude-sonnet-4-6";
export const CLAUDE_PROCESSING_DEFAULT = "claude-haiku-4-5-20251001";

// Pricing constants (USD per million tokens)
export const CLAUDE_PRICING = {
  "claude-opus-4-6":           { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6":         { input:  3.00, output: 15.00 },
  "claude-haiku-4-5-20251001": { input:  0.80, output:  4.00 },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClaudeMessage {
  role:    "user" | "assistant";
  content: string;
}

export interface ClaudeChatRequest {
  model:      string;
  max_tokens: number;
  messages:   ClaudeMessage[];
  system?:    string;
}

export interface ClaudeChatResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  usage?: {
    input_tokens:  number;
    output_tokens: number;
  };
}

// ─── Endpoint ─────────────────────────────────────────────────────────────────

const CLAUDE_BASE_URL    = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION  = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8096;

// ─── Chat ─────────────────────────────────────────────────────────────────────

/**
 * Send a chat message to Claude.
 *
 * @param apiKey   The raw API key string
 * @param model    Exact model string e.g. "claude-sonnet-4-6"
 * @param messages Conversation history — system messages must be extracted
 * @param system   Optional system prompt (sent as top-level field, not in messages)
 * @returns        The assistant reply text and token counts
 */
export async function claudeChat(
  apiKey:   string,
  model:    string,
  messages: ClaudeMessage[],
  system?:  string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const body: ClaudeChatRequest = {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages,
    ...(system ? { system } : {}),
  };

  const res = await fetch(`${CLAUDE_BASE_URL}/messages`, {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ClaudeError(
      res.status,
      err?.error?.message ?? res.statusText,
      model,
      err?.error?.type ?? "unknown",
    );
  }

  const data: ClaudeChatResponse = await res.json();
  const text         = data.content?.find((b) => b.type === "text")?.text ?? "";
  const inputTokens  = data.usage?.input_tokens  ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;

  return { text, inputTokens, outputTokens };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a Claude API key. Returns null on success or a human-readable error string.
 */
export async function validateClaudeKey(apiKey: string): Promise<string | null> {
  try {
    await claudeChat(
      apiKey,
      CLAUDE_PROCESSING_DEFAULT, // Use Haiku for validation — cheapest
      [{ role: "user", content: "hi" }],
    );
    return null;
  } catch (e) {
    if (e instanceof ClaudeError) {
      if (e.status === 401)
        return "API key rejected. Check it at console.anthropic.com.";
      if (e.status === 403)
        return "API key lacks permission. Check your Anthropic account.";
      if (e.status === 429)
        return "Rate limited. Key is valid but quota is exhausted.";
      if (e.status === 529)
        return "Anthropic API is overloaded. Try again in a moment.";
      return `Claude error ${e.status}: ${e.message}`;
    }
    return "Could not reach Anthropic. Check your connection.";
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class ClaudeError extends Error {
  constructor(
    public readonly status:    number,
    message:                   string,
    public readonly model:     string,
    public readonly errorType: string = "unknown",
  ) {
    super(message);
    this.name = "ClaudeError";
  }

  get isQuotaExhausted(): boolean { return this.status === 429; }
  get isInvalidKey():     boolean { return this.status === 401 || this.status === 403; }
  get isNetworkError():   boolean { return this.status === 0; }
  get isOverloaded():     boolean { return this.status === 529; }
}

// ─── Provider identity ────────────────────────────────────────────────────────

export const CLAUDE_PROVIDER_META = {
  name:              "claude" as ProviderName,
  label:             "Claude",
  capabilities:      ["chat"] as const, // no embedding endpoint
  primaryDefault:    CLAUDE_PRIMARY_DEFAULT,
  processingDefault: CLAUDE_PROCESSING_DEFAULT,
  embeddingModelId:  null,
  docsUrl:           "https://console.anthropic.com/settings/keys",
};