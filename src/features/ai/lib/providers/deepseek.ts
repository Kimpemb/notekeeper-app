// src/features/ai/lib/providers/deepseek.ts
//
// DeepSeek provider — chat + embeddings.
// Primary model:    deepseek-chat    (DeepSeek V3.2 — cost-efficient, strong technical)
// Processing model: deepseek-chat    (same model at processing tier pricing)
// Embedding model:  deepseek-embedding
//
// ⚠ DATA RESIDENCY NOTICE (surfaced in UI before activation):
//   DeepSeek routes requests through infrastructure in China.
//   Users storing sensitive research or professional work should make this
//   choice consciously. The notice is shown once in the embedding selector
//   before DeepSeek embeddings are set active.

import type { ProviderName } from "@/features/ai/store/useAIStore";
import type { ToolDefinition } from "@/features/ai/lib/tools/definitions";
import type { ContentBlock } from "@/features/ai/lib/client";

// ─── Model catalogue ──────────────────────────────────────────────────────────

export const DEEPSEEK_MODELS = {
  PRIMARY: [
    { id: "deepseek-chat",      label: "DeepSeek V3.2 (Chat)",    recommended: true  },
    { id: "deepseek-reasoner",  label: "DeepSeek R1 (Reasoner)",  recommended: false },
  ],
  PROCESSING: [
    { id: "deepseek-chat",      label: "DeepSeek V3.2 (Chat)",    recommended: true  },
  ],
  EMBEDDING: [
    { id: "deepseek-embedding", label: "DeepSeek Embedding",      recommended: true  },
  ],
} as const;

export const DEEPSEEK_PRIMARY_DEFAULT    = "deepseek-chat";
export const DEEPSEEK_PROCESSING_DEFAULT = "deepseek-chat";
export const DEEPSEEK_EMBEDDING_MODEL    = "deepseek-embedding";

// Used as the model_id key in the embeddings table — must be stable
export const DEEPSEEK_EMBEDDING_MODEL_ID = `deepseek/${DEEPSEEK_EMBEDDING_MODEL}`;

// Pricing constants (USD per million tokens, as of v2.1 spec)
export const DEEPSEEK_PRICING = {
  "deepseek-chat":      { input: 0.28, output: 1.10 },
  "deepseek-reasoner":  { input: 0.55, output: 2.19 },
  "deepseek-embedding": { input: 0.02, output: 0.00 },
} as const;

// Free token grant on signup — used in the UI to show budget estimate
export const DEEPSEEK_FREE_TOKEN_GRANT = 5_000_000; // 5M tokens

// ─── Data residency flag ──────────────────────────────────────────────────────
// The UI reads this before allowing DeepSeek to be set as the active embedding
// provider. The notice is shown exactly once per device (tracked via a settings
// flag). After the user acknowledges it, activation proceeds normally.

export const DEEPSEEK_DATA_RESIDENCY_NOTICE =
  "DeepSeek routes requests through servers located in China. " +
  "If you store sensitive research, professional, or confidential work in Idemora, " +
  "consider using Gemini or OpenAI for embeddings instead.";

export const DEEPSEEK_DATA_RESIDENCY_SETTING_KEY = "deepseek_residency_ack";

// ─── Types ────────────────────────────────────────────────────────────────────

// DeepSeek's API is OpenAI-compatible — same message format
export interface DeepSeekMessage {
  role:    "system" | "user" | "assistant";
  content: string;
}

export interface DeepSeekChatRequest {
  model:       string;
  messages:    DeepSeekMessage[];
  temperature?: number;
  max_tokens?:  number;
  stream?:      boolean;
}

export interface DeepSeekChatResponse {
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

export interface DeepSeekEmbedRequest {
  model:  string;
  input:  string | string[];
}

export interface DeepSeekEmbedResponse {
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

interface DeepSeekTool {
  type:     "function";
  function: {
    name:        string;
    description: string;
    parameters:  {
      type:       "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?:  string[];
    };
  };
}

interface DeepSeekToolCallResponse {
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

// ─── Endpoints ────────────────────────────────────────────────────────────────

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDeepSeekTools(tools: ToolDefinition[]): DeepSeekTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name:        t.name,
      description: t.description,
      parameters:  {
        type:       "object" as const,
        properties: t.input_schema.properties,
        required:   t.input_schema.required,
      },
    },
  }));
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

/**
 * Send a chat message to DeepSeek.
 *
 * @param apiKey   The raw API key string
 * @param model    Exact model string e.g. "deepseek-chat"
 * @param messages Conversation history in OpenAI-compatible format
 * @param system   Optional system message (prepended automatically)
 * @returns        The assistant reply text and token counts
 */
export async function deepseekChat(
  apiKey:   string,
  model:    string,
  messages: DeepSeekMessage[],
  system?:  string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const allMessages: DeepSeekMessage[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const body: DeepSeekChatRequest = {
    model,
    messages: allMessages,
  };

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new DeepSeekError(res.status, err?.error?.message ?? res.statusText, model);
  }

  const data: DeepSeekChatResponse = await res.json();
  const text         = data.choices?.[0]?.message?.content ?? "";
  const inputTokens  = data.usage?.prompt_tokens     ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return { text, inputTokens, outputTokens };
}

// ─── Chat with tools ──────────────────────────────────────────────────────────

/**
 * Send a chat message to DeepSeek with tool/function calling support.
 *
 * @param apiKey   The raw API key string
 * @param model    Exact model string e.g. "deepseek-chat"
 * @param messages Conversation history in OpenAI-compatible format
 * @param tools    Tool definitions to make available to the model
 * @param system   Optional system message (prepended automatically)
 * @returns        Content blocks (text and/or tool_use)
 */
export async function deepseekChatWithTools(
  apiKey:   string,
  model:    string,
  messages: DeepSeekMessage[],
  tools:    ToolDefinition[],
  system?:  string,
): Promise<{ content: ContentBlock[] }> {
  const allMessages: DeepSeekMessage[] = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const body = {
    model,
    messages:    allMessages,
    tools:       toDeepSeekTools(tools),
    tool_choice: "auto",
  };

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new DeepSeekError(res.status, err?.error?.message ?? res.statusText, model);
  }

  const data: DeepSeekToolCallResponse = await res.json();
  const message = data.choices?.[0]?.message;
  const content: ContentBlock[] = [];

  if (message?.content) {
    content.push({ type: "text", text: message.content });
  }

  for (const tc of message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.function.arguments); } catch { /* malformed args */ }
    content.push({
      type:  "tool_use",
      id:    tc.id,
      name:  tc.function.name,
      input,
    });
  }

  return { content };
}

// ─── Embedding ────────────────────────────────────────────────────────────────

/**
 * Embed a single text string using DeepSeek's embedding endpoint.
 *
 * @param apiKey  The raw API key string
 * @param text    The text to embed
 * @returns       Float32Array of the embedding vector
 */
export async function deepseekEmbed(
  apiKey: string,
  text:   string,
): Promise<Float32Array> {
  const body: DeepSeekEmbedRequest = {
    model: DEEPSEEK_EMBEDDING_MODEL,
    input: text,
  };

  const res = await fetch(`${DEEPSEEK_BASE_URL}/embeddings`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new DeepSeekError(res.status, err?.error?.message ?? res.statusText, DEEPSEEK_EMBEDDING_MODEL);
  }

  const data: DeepSeekEmbedResponse = await res.json();
  return new Float32Array(data.data[0].embedding);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a DeepSeek API key by making a lightweight test call.
 * Returns null on success, or a human-readable error string.
 */
export async function validateDeepSeekKey(apiKey: string): Promise<string | null> {
  try {
    await deepseekChat(
      apiKey,
      DEEPSEEK_PRIMARY_DEFAULT,
      [{ role: "user", content: "hi" }],
    );
    return null;
  } catch (e) {
    if (e instanceof DeepSeekError) {
      if (e.status === 401 || e.status === 403)
        return "API key rejected. Check it at platform.deepseek.com.";
      if (e.status === 402)
        return "DeepSeek account balance is zero. Top up at platform.deepseek.com.";
      if (e.status === 429)
        return "Rate limited. Key is valid but quota is exhausted.";
      return `DeepSeek error ${e.status}: ${e.message}`;
    }
    return "Could not reach DeepSeek. Check your connection.";
  }
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class DeepSeekError extends Error {
  constructor(
    public readonly status:  number,
    message:                 string,
    public readonly model:   string,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }

  get isQuotaExhausted(): boolean { return this.status === 429 || this.status === 402; }
  get isInvalidKey():     boolean { return this.status === 401 || this.status === 403; }
  get isNetworkError():   boolean { return this.status === 0; }
}

// ─── Provider identity ────────────────────────────────────────────────────────

export const DEEPSEEK_PROVIDER_META = {
  name:               "deepseek" as ProviderName,
  label:              "DeepSeek",
  capabilities:       ["chat", "embedding"] as const,
  primaryDefault:     DEEPSEEK_PRIMARY_DEFAULT,
  processingDefault:  DEEPSEEK_PROCESSING_DEFAULT,
  embeddingModelId:   DEEPSEEK_EMBEDDING_MODEL_ID,
  dataResidencyNotice: DEEPSEEK_DATA_RESIDENCY_NOTICE,
  freeTokenGrant:     DEEPSEEK_FREE_TOKEN_GRANT,
  docsUrl:            "https://platform.deepseek.com/api_keys",
};