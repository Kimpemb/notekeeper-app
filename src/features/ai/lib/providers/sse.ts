// src/features/ai/lib/providers/sse.ts
//
// Shared helpers for streamed chat answers (Server-Sent Events).
// Used by the per-provider *ChatStream functions; client.ts adds the timeouts.

export interface SSEEvent {
  event: string | null;
  data:  string;
}

export interface StreamResult {
  text:         string;
  inputTokens:  number;
  outputTokens: number;
}

export function safeJSON<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** Reads an SSE response body and calls onEvent once per complete event.
 *  onActivity fires for every chunk of bytes (including keep-alive comments). */
export async function readSSE(
  res:         Response,
  onEvent:     (ev: SSEEvent) => void,
  onActivity?: () => void,
): Promise<void> {
  if (!res.body) {
    throw Object.assign(new Error("Streaming is not available: the response has no body."), { streamUnsupported: true });
  }
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = "";
  let event: string | null = null;
  let data: string[] = [];

  const flush = () => {
    if (data.length > 0) onEvent({ event, data: data.join("\n") });
    event = null;
    data  = [];
  };

  const handleLine = (raw: string) => {
    const l = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (l === "") { flush(); return; }
    if (l.startsWith(":")) return; // comment / keep-alive
    const i     = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    let value   = i === -1 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) handleLine(buffer);
    flush();
  } finally {
    reader.cancel().catch(() => {});
  }
}

// ─── OpenAI-compatible streaming (DeepSeek, OpenAI, Grok) ─────────────────────

export interface OpenAICompatStreamArgs {
  url:          string;
  apiKey:       string;
  model:        string;
  messages:     ReadonlyArray<{ role: string; content?: unknown }>;
  system?:      string;
  onToken:      (token: string) => void;
  signal?:      AbortSignal;
  onActivity?:  () => void;
  includeUsage: boolean; // adds stream_options.include_usage so token counts arrive
  makeError:    (status: number, message: string, code: string) => Error;
}

interface CompatChunk {
  choices?: { delta?: { content?: string | null } }[];
  usage?:   { prompt_tokens?: number; completion_tokens?: number } | null;
  error?:   { message?: string; code?: string | number | null } | null;
}

export async function streamOpenAICompat(a: OpenAICompatStreamArgs): Promise<StreamResult> {
  const allMessages = a.system
    ? [{ role: "system", content: a.system }, ...a.messages]
    : [...a.messages];
  const body: Record<string, unknown> = { model: a.model, messages: allMessages, stream: true };
  if (a.includeUsage) body.stream_options = { include_usage: true };

  const res = await fetch(a.url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${a.apiKey}` },
    body:    JSON.stringify(body),
    signal:  a.signal,
  });
  a.onActivity?.(); // headers arrived

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw a.makeError(res.status, err?.error?.message ?? res.statusText, String(err?.error?.code ?? "unknown"));
  }

  let text = "";
  let inputTokens  = 0;
  let outputTokens = 0;

  await readSSE(res, (ev) => {
    if (ev.data === "[DONE]") return;
    const d = safeJSON<CompatChunk>(ev.data);
    if (!d) return;
    if (d.error) {
      const c = d.error.code;
      throw a.makeError(typeof c === "number" ? c : 500, d.error.message ?? "Stream error", String(c ?? "unknown"));
    }
    const piece = d.choices?.[0]?.delta?.content;
    if (piece) { text += piece; a.onToken(piece); }
    if (d.usage) {
      inputTokens  = d.usage.prompt_tokens     ?? inputTokens;
      outputTokens = d.usage.completion_tokens ?? outputTokens;
    }
  }, a.onActivity);

  return { text, inputTokens, outputTokens };
}