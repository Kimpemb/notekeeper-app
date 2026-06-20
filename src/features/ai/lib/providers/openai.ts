// src/features/ai/lib/providers/openai.ts
//
// OpenAI provider — chat + embeddings.
// Primary model:    gpt-4o                  (strongest on polyglot code generation)
// Processing model: gpt-4o-mini             (cheap background ops)
// Embedding model:  text-embedding-3-small  (default) / text-embedding-3-large (precision)

import type { ProviderName } from "@/features/ai/store/useAIStore";
import type { ToolDefinition } from "@/features/ai/lib/tools/definitions";
import type { ContentBlock } from "@/features/ai/lib/client";

// ─── Model catalogue ──────────────────────────────────────────────────────────

export const OPENAI_MODELS = {
  PRIMARY: [
    { id: "gpt-4o",        label: "GPT-4o",        recommended: true  },
    { id: "gpt-4.1",       label: "GPT-4.1",        recommended: false },
    { id: "o3",            label: "o3",              recommended: false },
  ],
  PROCESSING: [
    { id: "gpt-4o-mini",   label: "GPT-4o Mini",    recommended: true  },
  ],
  EMBEDDING: [
    { id: "text-embedding-3-small", label: "text-embedding-3-small (recommended)", recommended: true  },
    { id: "text-embedding-3-large", label: "text-embedding-3-large (high precision)", recommended: false },
  ],
} as const;

export const OPENAI_PRIMARY_DEFAULT    = "gpt-4o";
export const OPENAI_PROCESSING_DEFAULT = "gpt-4o-mini";
export const OPENAI_EMBEDDING_MODEL    = "text-embedding-3-small";

// Used as the model_id key in the embeddings table — must be stable
export const OPENAI_EMBEDDING_MODEL_ID = `openai/${OPENAI_EMBEDDING_MODEL}`;

// Pricing constants (USD per million tokens)
export const OPENAI_PRICING = {
  "gpt-4o":                   { input:  2.50, output: 10.00 },
  "gpt-4.1":                  { input:  2.00, output:  8.00 },
  "o3":                       { input: 10.00, output: 40.00 },
  "gpt-4o-mini":              { input:  0.15, output:  0.60 },
  "text-embedding-3-small":   { input:  0.02, output:  0.00 },
  "text-embedding-3-large":   { input:  0.13, output:  0.00 },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenAIMessage {
  role:    "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  model:        string;
  messages:     OpenAIMessage[];
  temperature?: number;
  max_tokens?:  number;
}

export interface OpenAIChatResponse {
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

export interface OpenAIEmbedRequest {
  model:          string;
  input:          string | string[];
  encoding_format?: "float" | "base64";
}

export interface OpenAIEmbedResponse {
  data: Array<{
    embedding: number[];
    index:     number;
  }>;
  usage?: {
    prompt_tokens: number;
    total_tokens:  number;
  };
}

// ─── Tool-use types (OpenAI-compatible function calling) ─────────────────────

interface OpenAIToolCallResponse {
  choices: Array<{
    message: {
      role:       string;
      content:    string | null;
      tool_calls?: Array<{
        id:       string;
        type:     "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens:     number;
    completion_tokens: number;
  };
}

// ─── Endpoint ─────────────────────────────────────────────────────────────────

const OPENAI_BASE_URL = "https://api.openai.com/v1";

// ─── Chat ─────────────────────────────────────────────────────────────────────

/**
 * Send a chat message to OpenAI.
 *
 * @param apiKey   The raw API key string
 * @param model    Exact model string e.g. "gpt-4o"
 * @param messages Conversation history in OpenAI format
 * @param system   Optional system message (prepended automatically)
 * @returns        The assistant reply text and token counts
 */
export async function openaiChat(
  apiKey:   string,
  model:    string,
  messages: OpenAIMessage[],
  system?:  string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const allMessages: OpenAIMessage[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const body: OpenAIChatRequest = { model, messages: allMessages };

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new OpenAIError(
      res.status,
      err?.error?.message ?? res.statusText,
      model,
      err?.error?.code   ?? "unknown",
    );
  }

  const data: OpenAIChatResponse = await res.json();
  const text         = data.choices?.[0]?.message?.content ?? "";
  const inputTokens  = data.usage?.prompt_tokens     ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return { text, inputTokens, outputTokens };
}

// ─── Chat with tools ──────────────────────────────────────────────────────────

/**
 * Send a chat message to OpenAI with tool/function calling support.
 *
 * @param apiKey   The raw API key string
 * @param model    Exact model string e.g. "gpt-4o"
 * @param messages Conversation history in OpenAI format
 * @param tools    Tool definitions to make available to the model
 * @param system   Optional system message (prepended automatically)
 * @returns        Content blocks (text and/or tool_use)
 */
export async function openaiChatWithTools(
  apiKey:   string,
  model:    string,
  messages: OpenAIMessage[],
  tools:    ToolDefinition[],
  system?:  string,
): Promise<{ content: ContentBlock[] }> {
  const allMessages: OpenAIMessage[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const body = {
    model,
    messages: allMessages,
    tools: tools.map((t) => ({
      type: "function" as const,
      function: {
        name:        t.name,
        description: t.description,
        parameters:  {
          type:       "object",
          properties: t.input_schema.properties,
          required:   t.input_schema.required,
        },
      },
    })),
    tool_choice: "auto",
  };

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new OpenAIError(res.status, err?.error?.message ?? res.statusText, model, err?.error?.code ?? "unknown");
  }

  const data: OpenAIToolCallResponse = await res.json();
  const message = data.choices?.[0]?.message;
  const content: ContentBlock[] = [];

  if (message?.content) {
    content.push({ type: "text", text: message.content });
  }

  for (const tc of message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.function.arguments); } catch { /* malformed */ }
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }

  return { content };
}

// ─── Embedding ────────────────────────────────────────────────────────────────

/**
 * Embed a single text string using OpenAI's embedding endpoint.
 * Defaults to text-embedding-3-small — pass model explicitly for large.
 *
 * @param apiKey  The raw API key string
 * @param text    The text to embed
 * @param model   Embedding model to use (defaults to text-embedding-3-small)
 * @returns       Float32Array of the embedding vector
 */
export async function openaiEmbed(
  apiKey: string,
  text:   string,
  model:  string = OPENAI_EMBEDDING_MODEL,
): Promise<Float32Array> {
  const body: OpenAIEmbedRequest = {
    model,
    input:           text,
    encoding_format: "float",
  };

  const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new OpenAIError(
      res.status,
      err?.error?.message ?? res.statusText,
      model,
      err?.error?.code   ?? "unknown",
    );
  }

  const data: OpenAIEmbedResponse = await res.json();
  return new Float32Array(data.data[0].embedding);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate an OpenAI API key. Returns null on success or a human-readable error string.
 */
export async function validateOpenAIKey(apiKey: string): Promise<string | null> {
  try {
    await openaiChat(
      apiKey,
      OPENAI_PROCESSING_DEFAULT, // Use Mini for validation — cheapest
      [{ role: "user", content: "hi" }],
    );
    return null;
  } catch (e) {
    if (e instanceof OpenAIError) {
      if (e.status === 401)
        return "API key rejected. Check it at platform.openai.com.";
      if (e.status === 403)
        return "API key lacks permission. Check your OpenAI account.";
      if (e.status === 429) {
        if (e.code === "insufficient_quota")
          return "OpenAI account quota exhausted. Check your billing at platform.openai.com.";
        return "Rate limited. Key is valid but quota is exhausted.";
      }
      return `OpenAI error ${e.status}: ${e.message}`;
    }
    return "Could not reach OpenAI. Check your connection.";
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class OpenAIError extends Error {
  constructor(
    public readonly status: number,
    message:                string,
    public readonly model:  string,
    public readonly code:   string = "unknown",
  ) {
    super(message);
    this.name = "OpenAIError";
  }

  get isQuotaExhausted(): boolean {
    return this.status === 429 || this.code === "insufficient_quota";
  }
  get isInvalidKey():   boolean { return this.status === 401 || this.status === 403; }
  get isNetworkError(): boolean { return this.status === 0; }
}

// ─── Provider identity ────────────────────────────────────────────────────────

export const OPENAI_PROVIDER_META = {
  name:              "openai" as ProviderName,
  label:             "OpenAI",
  capabilities:      ["chat", "embedding"] as const,
  primaryDefault:    OPENAI_PRIMARY_DEFAULT,
  processingDefault: OPENAI_PROCESSING_DEFAULT,
  embeddingModelId:  OPENAI_EMBEDDING_MODEL_ID,
  docsUrl:           "https://platform.openai.com/api-keys",
};