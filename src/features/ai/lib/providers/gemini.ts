// src/features/ai/lib/providers/gemini.ts
//
// Gemini provider — chat + embeddings.
// Primary model:    gemini-2.5-pro  (high-quality foreground responses)
// Processing model: gemini-2.0-flash-lite  (background ops — cheap, fast)
// Embedding model:  gemini-embedding-001  (replacement for deprecated text-embedding-004)

import type { ProviderName } from "@/features/ai/store/useAIStore";

// ─── Model catalogue ──────────────────────────────────────────────────────────

export const GEMINI_MODELS = {
  // Primary slot options (user-facing)
  PRIMARY: [
    { id: "gemini-2.5-pro",         label: "Gemini 2.5 Pro",         recommended: true  },
    { id: "gemini-2.5-flash",       label: "Gemini 2.5 Flash",       recommended: false },
    { id: "gemini-2.0-flash",       label: "Gemini 2.0 Flash",       recommended: false },
  ],
  // Processing slot options (background ops)
  PROCESSING: [
    { id: "gemini-2.0-flash-lite",  label: "Gemini 2.0 Flash-Lite",  recommended: true  },
    { id: "gemini-2.0-flash",       label: "Gemini 2.0 Flash",       recommended: false },
  ],
  // Embedding
  EMBEDDING: [
    { id: "gemini-embedding-001",   label: "gemini-embedding-001",   recommended: true  },
  ],
} as const;

// Stable model IDs used as defaults and in the capability map
export const GEMINI_PRIMARY_DEFAULT    = "gemini-2.5-pro";
export const GEMINI_PROCESSING_DEFAULT = "gemini-2.0-flash-lite";
export const GEMINI_EMBEDDING_MODEL    = "gemini-embedding-001";

// Used as the model_id key in the embeddings table
export const GEMINI_EMBEDDING_MODEL_ID = `gemini/${GEMINI_EMBEDDING_MODEL}`;

// Pricing constants (USD per million tokens, as of v2.1 spec)
export const GEMINI_PRICING = {
  "gemini-2.5-pro":        { input: 1.25,  output: 5.00  },
  "gemini-2.5-flash":      { input: 0.075, output: 0.30  },
  "gemini-2.0-flash":      { input: 0.10,  output: 0.40  },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeminiMessage {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

export interface GeminiChatRequest {
  contents:         GeminiMessage[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?:    number;
    maxOutputTokens?: number;
    topP?:           number;
  };
}

export interface GeminiChatResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount:     number;
    candidatesTokenCount: number;
    totalTokenCount:      number;
  };
}

export interface GeminiEmbedRequest {
  model:    string;
  content:  { parts: Array<{ text: string }> };
  taskType?: string;
}

export interface GeminiEmbedResponse {
  embedding: { values: number[] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chatEndpoint(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function embedEndpoint(model: string): string {
  // v1beta, key goes in header x-goog-api-key, not URL query param
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

/**
 * Send a chat message to Gemini.
 *
 * @param apiKey   The raw API key string (resolved by the caller from the store)
 * @param model    Exact model string e.g. "gemini-2.5-pro"
 * @param messages Conversation history in Gemini format
 * @param system   Optional system instruction
 * @returns        The assistant reply text
 */
export async function geminiChat(
  apiKey:   string,
  model:    string,
  messages: GeminiMessage[],
  system?:  string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const body: GeminiChatRequest = { contents: messages };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const res = await fetch(chatEndpoint(model, apiKey), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new GeminiError(res.status, err?.error?.message ?? res.statusText, model);
  }

  const data: GeminiChatResponse = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const inputTokens  = data.usageMetadata?.promptTokenCount     ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

  return { text, inputTokens, outputTokens };
}

// ─── Embedding ────────────────────────────────────────────────────────────────

/**
 * Embed a single text string using Gemini's embedding endpoint.
 *
 * @param apiKey  The raw API key string (sent via x-goog-api-key header)
 * @param text    The text to embed
 * @returns       Float32Array of the embedding vector (3072-dimensional)
 */
export async function geminiEmbed(
  apiKey: string,
  text:   string,
): Promise<Float32Array> {
  const body: GeminiEmbedRequest = {
    model:    `models/${GEMINI_EMBEDDING_MODEL}`,
    content:  { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
  };

  const res = await fetch(embedEndpoint(GEMINI_EMBEDDING_MODEL), {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,  // Key goes in header, not URL query param
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new GeminiError(res.status, err?.error?.message ?? res.statusText, GEMINI_EMBEDDING_MODEL);
  }

  const data: GeminiEmbedResponse = await res.json();
  return new Float32Array(data.embedding.values);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a Gemini API key by making a lightweight test call.
 * Returns null on success, or a human-readable error string.
 */
export async function validateGeminiKey(apiKey: string): Promise<string | null> {
  try {
    await geminiChat(
      apiKey,
      GEMINI_PROCESSING_DEFAULT, // Use Flash-Lite for validation — cheap
      [{ role: "user", parts: [{ text: "hi" }] }],
    );
    return null;
  } catch (e) {
    if (e instanceof GeminiError) {
      if (e.status === 400) return "Invalid API key format.";
      if (e.status === 401 || e.status === 403) return "API key rejected. Check it in Google AI Studio.";
      if (e.status === 429) return null;
      return `Gemini error ${e.status}: ${e.message}`;
    }
    return "Could not reach Gemini. Check your connection.";
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class GeminiError extends Error {
  constructor(
    public readonly status:  number,
    message:                 string,
    public readonly model:   string,
  ) {
    super(message);
    this.name = "GeminiError";
  }

  get isQuotaExhausted(): boolean { return this.status === 429; }
  get isInvalidKey():     boolean { return this.status === 401 || this.status === 403; }
  get isNetworkError():   boolean { return this.status === 0; }
}

// ─── Provider identity (consumed by provider.ts capability map) ───────────────

export const GEMINI_PROVIDER_META = {
  name:              "gemini" as ProviderName,
  label:             "Google Gemini",
  capabilities:      ["chat", "embedding"] as const,
  primaryDefault:    GEMINI_PRIMARY_DEFAULT,
  processingDefault: GEMINI_PROCESSING_DEFAULT,
  embeddingModelId:  GEMINI_EMBEDDING_MODEL_ID,
  docsUrl:           "https://aistudio.google.com/app/apikey",
};