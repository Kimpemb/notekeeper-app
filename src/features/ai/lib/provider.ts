// src/features/ai/lib/provider.ts
//
// The single interface every AI provider must implement.
// Nothing in the app calls Gemini, OpenAI, or Anthropic directly —
// everything goes through this contract. Swapping providers = swapping
// one implementation file, nothing else changes.

// ─── Completion options ───────────────────────────────────────────────────────

export interface CompleteOptions {
  temperature?: number      // defaults to 0.4
  maxTokens?:   number      // defaults to 2048
  systemPrompt?: string     // injected as system role where supported
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export interface StreamOptions extends CompleteOptions {
  onChunk:  (chunk: string) => void   // called with each token as it arrives
  onDone?:  () => void                // called when stream completes
  onError?: (err: Error) => void      // called on stream error
}

// ─── Embedding result ─────────────────────────────────────────────────────────

export interface EmbedResult {
  vector:  Float32Array
  modelId: string           // canonical model string e.g. "gemini-embedding-004"
                            // stored in embeddings.model_id for mismatch detection
}

// ─── Provider capability flags ────────────────────────────────────────────────
// Anthropic has no native embedding API — capability flags let the app
// know to fall back to a configured embedding provider when needed.

export interface ProviderCapabilities {
  canEmbed:   boolean   // provider has a native embedding endpoint
  canStream:  boolean   // provider supports streaming completions
}

// ─── The contract ─────────────────────────────────────────────────────────────

export interface AIProvider {
  /** Unique identifier — stored in embeddings.model_id and settings */
  readonly id: string

  /** Human-readable name shown in UI */
  readonly name: string

  readonly capabilities: ProviderCapabilities

  /**
   * Single-turn completion. The workhorse — used by actions, chat, indexer.
   * Throws on network error, auth failure, or quota exhaustion.
   * Quota errors throw with code "QUOTA_EXCEEDED" so the indexer
   * can catch them specifically and apply backoff.
   */
  complete(prompt: string, options?: CompleteOptions): Promise<string>

  /**
   * Streaming completion. Calls onChunk with each token as it arrives.
   * Falls back to complete() and calls onChunk once if canStream is false.
   * Returns the full assembled string when done.
   */
  streamComplete(prompt: string, options: StreamOptions): Promise<string>

  /**
   * Embed a single string into a fixed-dimension vector.
   * Only callable when capabilities.canEmbed is true.
   * Throws ProviderError with code "NOT_SUPPORTED" if called on a
   * provider without embedding support (e.g. Anthropic).
   */
  embed(text: string): Promise<EmbedResult>

  /**
   * Lightweight ping to verify the API key works.
   * Returns true on success, false on auth failure.
   * Throws on network errors (not auth errors).
   */
  testConnection(): Promise<boolean>
}

// ─── Typed error ──────────────────────────────────────────────────────────────
// All providers throw ProviderError — never raw fetch errors.
// The indexer and chat layer catch these and handle by code.

export type ProviderErrorCode =
  | "AUTH_FAILED"        // 401/403 — bad API key
  | "QUOTA_EXCEEDED"     // 429 — rate limit hit
  | "NOT_SUPPORTED"      // capability not available on this provider
  | "EMPTY_RESPONSE"     // provider returned no content
  | "NETWORK_ERROR"      // fetch failed entirely
  | "UNKNOWN"            // anything else

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

// ─── Cosine similarity (lives here — used by search, not tied to any provider)

/**
 * Cosine similarity between two Float32Arrays.
 * Returns a value between -1 and 1. Higher = more similar.
 * Both vectors must be the same length.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ─── Float32Array ↔ BLOB serialization ───────────────────────────────────────
// SQLite stores vectors as BLOB. These two functions are the only place
// in the codebase that know about that encoding.

/**
 * Serialize a Float32Array into a base64 string for SQLite BLOB storage.
 * tauri-plugin-sql expects BLOB values as base64 strings.
 */
export function vectorToBlob(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer)
  let binary  = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Deserialize a base64 BLOB string back into a Float32Array.
 */
export function blobToVector(blob: string): Float32Array {
  const binary = atob(blob)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Float32Array(bytes.buffer)
}