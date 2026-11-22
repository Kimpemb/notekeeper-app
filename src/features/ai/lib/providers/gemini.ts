// src/features/ai/lib/providers/gemini.ts
//
// Gemini provider — chat + embeddings.
// Primary model:    gemini-3.8-flash  (high-quality foreground responses)
// Processing model: gemini-3.5-flash-lite  (background ops — cheap, fast, 500 RPD free)
// Embedding model:  gemini-embedding-001  (replacement for deprecated text-embedding-004)

import type { ProviderName } from "@/features/ai/store/useAIStore";
import type { ToolDefinition } from "@/features/ai/lib/tools/definitions";
import type { ContentBlock } from "@/features/ai/lib/client";

// ─── Model catalogue ──────────────────────────────────────────────────────────

export const GEMINI_MODELS = {
  // Primary slot options (user-facing)
  PRIMARY: [
    { id: "gemini-3.8-flash",       label: "Gemini 3.8 Flash",              recommended: true  },
    { id: "gemini-3.5-flash-lite",  label: "Gemini 3.5 Flash-Lite",         recommended: false },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview, paid)", recommended: false },
  ],
  // Processing slot options (background ops)
  PROCESSING: [
    { id: "gemini-3.5-flash-lite",  label: "Gemini 3.5 Flash-Lite",  recommended: true  },
    { id: "gemini-3.1-flash-lite",  label: "Gemini 3.1 Flash-Lite",  recommended: false },
  ],
  // Embedding
  EMBEDDING: [
    { id: "gemini-embedding-001",   label: "gemini-embedding-001",   recommended: true  },
  ],
} as const;

// Stable model IDs used as defaults and in the capability map
export const GEMINI_PRIMARY_DEFAULT    = "gemini-3.8-flash";
export const GEMINI_PROCESSING_DEFAULT = "gemini-3.5-flash-lite";
export const GEMINI_EMBEDDING_MODEL    = "gemini-embedding-001";

// Used as the model_id key in the embeddings table
export const GEMINI_EMBEDDING_MODEL_ID = `gemini/${GEMINI_EMBEDDING_MODEL}`;

// Pricing constants (USD per million tokens, as of v2.1 spec)
// Paid-tier standard prices. Re-check ai.google.dev/gemini-api/docs/pricing before each release.
// gemini-3.8-flash: introductory rate through 2026-12-31; $1.50 / $7.50 from 2027-01-01.
export const GEMINI_PRICING = {
  "gemini-3.8-flash":       { input: 0.75, output: 3.75  },
  "gemini-3.5-flash-lite":  { input: 0.30, output: 2.50  },
  "gemini-3.1-flash-lite":  { input: 0.25, output: 1.50  },
  "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 },
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
    thinkingConfig?: { thinkingLevel: "low" | "medium" | "high" };
  };
}

// Gemini 3.8 Flash thinks at "medium" by default, which delayed the first token by ~31 s.
// Chat answers use "low". Only 3.8 models get the field (2.5 models use a different setting).
function applyThinkingLevel(body: GeminiChatRequest, model: string): void {
  if (!model.startsWith("gemini-3.8")) return;
  body.generationConfig = { ...body.generationConfig, thinkingConfig: { thinkingLevel: "low" } };
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

// ─── Tool-use types (Gemini function calling) ─────────────────────────────────

interface GeminiFunctionDeclaration {
  name:        string;
  description: string;
  parameters:  {
    type:       "OBJECT";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?:  string[];
  };
}

interface GeminiToolCallRequest extends GeminiChatRequest {
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
}

interface GeminiToolCallResponse {
  candidates: Array<{
    content: {
      parts: Array<
        | { text: string; functionCall?: never }
        | { functionCall: { name: string; args: Record<string, unknown> }; text?: never }
      >;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount:     number;
    candidatesTokenCount: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chatEndpoint(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function embedEndpoint(model: string): string {
  // v1beta, key goes in header x-goog-api-key, not URL query param
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
}

function toGeminiFunctionDeclarations(
  tools: ToolDefinition[]
): GeminiFunctionDeclaration[] {
  return tools.map((t) => ({
    name:        t.name,
    description: t.description,
    parameters:  {
      type:       "OBJECT" as const,
      properties: Object.fromEntries(
        Object.entries(t.input_schema.properties).map(([k, v]) => [
          k,
          {
            type:        v.type.toUpperCase(),
            description: v.description,
            ...(v.enum ? { enum: v.enum } : {}),
          },
        ])
      ),
      required: t.input_schema.required,
    },
  }));
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

  applyThinkingLevel(body, model);
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

// ─── Chat with tools ──────────────────────────────────────────────────────────

/**
 * Send a chat message to Gemini with tool/function calling support.
 *
 * @param apiKey   The raw API key string
 * @param model    Exact model string e.g. "gemini-2.5-pro"
 * @param messages Conversation history in Gemini format
 * @param tools    Tool definitions to make available to the model
 * @param system   Optional system instruction
 * @returns        Content blocks (text and/or tool_use)
 */
export async function geminiChatWithTools(
  apiKey:   string,
  model:    string,
  messages: GeminiMessage[],
  tools:    ToolDefinition[],
  system?:  string,
): Promise<{ content: ContentBlock[] }> {
  const body: GeminiToolCallRequest = {
    contents: messages,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };

  const res = await fetch(chatEndpoint(model, apiKey), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new GeminiError(res.status, err?.error?.message ?? res.statusText, model);
  }

  const data: GeminiToolCallResponse = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];

  const content: ContentBlock[] = parts.map((part) => {
    if (part.functionCall) {
      return {
        type:  "tool_use" as const,
        id:    crypto.randomUUID(),
        name:  part.functionCall.name,
        input: part.functionCall.args,
      };
    }
    return {
      type: "text" as const,
      text: part.text ?? "",
    };
  });

  return { content };
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
  apiKey:   string,
  text:     string,
  taskType: string = "RETRIEVAL_DOCUMENT",
): Promise<Float32Array> {
  const body: GeminiEmbedRequest = {
    model:    `models/${GEMINI_EMBEDDING_MODEL}`,
    content:  { parts: [{ text }] },
    taskType,
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

// ─── Streaming chat (SSE) ─────────────────────────────────────────────────────
// Same request as geminiChat, sent to :streamGenerateContent?alt=sse so text
// arrives as it is generated. Chat answers only (see client.ts).

interface GeminiStreamChunk {
  candidates?:    { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?:         { code?: number; message?: string };
}

export async function geminiChatStream(
  apiKey:      string,
  model:       string,
  messages:    GeminiMessage[],
  system:      string | undefined,
  onToken:     (token: string) => void,
  signal?:     AbortSignal,
  onActivity?: () => void,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const body: GeminiChatRequest = { contents: messages };
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  applyThinkingLevel(body, model);
  const url = new URL(chatEndpoint(model, apiKey));
  if (!url.pathname.includes(":generateContent")) {
    throw Object.assign(new Error("Unexpected Gemini endpoint; cannot stream."), { streamUnsupported: true });
  }
  url.pathname = url.pathname.replace(":generateContent", ":streamGenerateContent");
  url.searchParams.set("alt", "sse");

  const res = await fetch(url.toString(), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal,
  });
  onActivity?.(); // headers arrived

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new GeminiError(res.status, err?.error?.message ?? res.statusText, model);
  }

  const { readSSE, safeJSON } = await import("./sse");
  let text = "";
  let inputTokens  = 0;
  let outputTokens = 0;

  await readSSE(res, (ev) => {
    const d = safeJSON<GeminiStreamChunk>(ev.data);
    if (!d) return;
    if (d.error) throw new GeminiError(d.error.code ?? 500, d.error.message ?? "Gemini stream error", model);
    let piece = "";
    for (const p of d.candidates?.[0]?.content?.parts ?? []) {
      if (p.text && !p.thought) piece += p.text;
    }
    if (piece) { text += piece; onToken(piece); }
    if (d.usageMetadata) {
      inputTokens  = d.usageMetadata.promptTokenCount     ?? inputTokens;
      outputTokens = d.usageMetadata.candidatesTokenCount ?? outputTokens;
    }
  }, onActivity);

  return { text, inputTokens, outputTokens };
}