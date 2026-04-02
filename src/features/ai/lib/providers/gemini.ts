// src/features/ai/lib/providers/gemini.ts
//
// Gemini implementation of the AIProvider interface.
// Handles completion, streaming, and embedding via Google's REST API.
// All errors are normalized to ProviderError so callers never see raw
// fetch errors or Gemini-specific error shapes.

import {
  type AIProvider,
  type CompleteOptions,
  type StreamOptions,
  type EmbedResult,
  type ProviderCapabilities,
  ProviderError,
} from "@/features/ai/lib/provider"

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL        = "https://generativelanguage.googleapis.com/v1beta"
const COMPLETE_MODEL  = "gemini-2.5-flash"
const EMBED_MODEL     = "gemini-embedding-001"

// ─── Raw API response shapes ──────────────────────────────────────────────────

interface GeminiCompleteResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[]
    }
    finishReason?: string
  }[]
  error?: {
    code:    number
    message: string
    status:  string
  }
}

interface GeminiEmbedResponse {
  embedding?: {
    values: number[]
  }
  error?: {
    code:    number
    message: string
    status:  string
  }
}

// ─── Error normalizer ─────────────────────────────────────────────────────────

function normalizeError(status: number, message: string): ProviderError {
  if (status === 401 || status === 403 || message.includes("API_KEY_INVALID")) {
    return new ProviderError(
      "Invalid Gemini API key. Check your key in Settings → AI.",
      "AUTH_FAILED",
      false   // not retryable — bad key won't fix itself
    )
  }
  if (status === 429 || message.includes("RESOURCE_EXHAUSTED")) {
    return new ProviderError(
      "Gemini quota reached. The indexer will retry automatically.",
      "QUOTA_EXCEEDED",
      true    // retryable — back off and try again
    )
  }
  if (status === 0 || message.includes("fetch")) {
    return new ProviderError(
      "Network error reaching Gemini. Check your connection.",
      "NETWORK_ERROR",
      true    // retryable
    )
  }
  return new ProviderError(
    `Gemini error: ${message}`,
    "UNKNOWN",
    false
  )
}

// ─── Provider implementation ──────────────────────────────────────────────────

export class GeminiProvider implements AIProvider {
  readonly id   = `gemini/${COMPLETE_MODEL}`
  readonly name = "Google Gemini"

  readonly capabilities: ProviderCapabilities = {
    canEmbed:  true,
    canStream: true,
  }

  constructor(private readonly apiKey: string) {}

  // ── Completion ─────────────────────────────────────────────────────────────

  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    const {
      temperature  = 0.4,
      maxTokens    = 2048,
      systemPrompt,
    } = options

    const url  = `${BASE_URL}/models/${COMPLETE_MODEL}:generateContent?key=${this.apiKey}`
    const body: Record<string, unknown> = {
      contents: [
        { role: "user", parts: [{ text: prompt }] },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }

    // Gemini supports system instructions as a top-level field
    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }],
      }
    }

    let res: Response
    try {
      res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
    } catch (err) {
      throw new ProviderError(
        "Network error reaching Gemini.",
        "NETWORK_ERROR",
        true
      )
    }

    const data: GeminiCompleteResponse = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw normalizeError(res.status, data.error?.message ?? `HTTP ${res.status}`)
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ""
    if (!text) {
      throw new ProviderError("Gemini returned an empty response.", "EMPTY_RESPONSE", false)
    }

    return text
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  async streamComplete(prompt: string, options: StreamOptions): Promise<string> {
    const {
      temperature  = 0.4,
      maxTokens    = 2048,
      systemPrompt,
      onChunk,
      onDone,
      onError,
    } = options

    const url  = `${BASE_URL}/models/${COMPLETE_MODEL}:streamGenerateContent?key=${this.apiKey}&alt=sse`
    const body: Record<string, unknown> = {
      contents: [
        { role: "user", parts: [{ text: prompt }] },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    }

    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] }
    }

    let res: Response
    try {
      res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
    } catch (err) {
      const providerErr = new ProviderError("Network error reaching Gemini.", "NETWORK_ERROR", true)
      onError?.(providerErr)
      throw providerErr
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const providerErr = normalizeError(res.status, data?.error?.message ?? `HTTP ${res.status}`)
      onError?.(providerErr)
      throw providerErr
    }

    // ── Read SSE stream ──────────────────────────────────────────────────────
    const reader  = res.body?.getReader()
    const decoder = new TextDecoder()
    let assembled = ""
    let buffer    = ""

    if (!reader) {
      throw new ProviderError("No response body from Gemini stream.", "EMPTY_RESPONSE", false)
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")

        // Last element may be incomplete — keep it in buffer
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          // SSE lines start with "data: "
          if (!line.startsWith("data: ")) continue
          const json = line.slice(6).trim()
          if (json === "[DONE]") break

          try {
            const chunk: GeminiCompleteResponse = JSON.parse(json)
            const token = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
            if (token) {
              assembled += token
              onChunk(token)
            }
          } catch {
            // Malformed SSE chunk — skip silently
          }
        }
      }
    } finally {
      reader.cancel()
    }

    onDone?.()
    return assembled
  }

  // ── Embedding ──────────────────────────────────────────────────────────────

  async embed(text: string): Promise<EmbedResult> {
    // Truncate to ~8000 chars — gemini-embedding-004 has a token limit.
    // Truncating here rather than throwing keeps the indexer moving.
    const input = text.slice(0, 8000)
    const url   = `${BASE_URL}/models/${EMBED_MODEL}:embedContent?key=${this.apiKey}`

    let res: Response
    try {
      res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:   `models/${EMBED_MODEL}`,
          content: { parts: [{ text: input }] },
          // task_type RETRIEVAL_DOCUMENT for indexing.
          // Query-time embedding uses RETRIEVAL_QUERY — handled in search layer.
          taskType: "RETRIEVAL_DOCUMENT",
        }),
      })
    } catch (err) {
      throw new ProviderError("Network error reaching Gemini embedding API.", "NETWORK_ERROR", true)
    }

    const data: GeminiEmbedResponse = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw normalizeError(res.status, data.error?.message ?? `HTTP ${res.status}`)
    }

    const values = data.embedding?.values
    if (!values || values.length === 0) {
      throw new ProviderError("Gemini returned an empty embedding.", "EMPTY_RESPONSE", false)
    }

    return {
      vector:  new Float32Array(values),
      modelId: EMBED_MODEL,
    }
  }

  // ── Connection test ────────────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    try {
      await this.complete("Reply with only the word: ok", { maxTokens: 10 })
      return true
    } catch (err) {
      if (err instanceof ProviderError && err.code === "AUTH_FAILED") return false
      throw err
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
// Used by useAIStore to get the active provider instance.
// Always reads the key fresh — no stale closures.

export function createGeminiProvider(apiKey: string): GeminiProvider {
  if (!apiKey.trim()) {
    throw new ProviderError(
      "No Gemini API key configured. Add your key in Settings → AI.",
      "AUTH_FAILED",
      false
    )
  }
  return new GeminiProvider(apiKey)
}