// src/features/ai/lib/search/semantic.ts
//
// Semantic search over the embeddings table.
// Embeds the query via the active embedding provider, then scores every stored
// embedding via cosine similarity. Returns results sorted by score, highest first.
//
// Embeddings are cached in memory after first load and invalidated when the
// indexer writes new embeddings. This eliminates the 10,000ms+ DB round-trip
// on every search query.

import { callEmbedding }    from "@/features/ai/lib/client"
import { embeddingModelId, cosineSimilarity } from "@/features/ai/lib/provider"
import { useAIStore }       from "@/features/ai/store/useAIStore"
import { getAllEmbeddings } from "@/features/notes/db/queries"
import type { EmbeddingWithVector } from "@/features/notes/db/queries"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SemanticResult {
  block_id: string
  note_id:  string
  score:    number
}

// ─── Embedding cache ──────────────────────────────────────────────────────────
//
// Loaded once per model, invalidated when indexer writes new embeddings
// or when the active model changes.

interface EmbeddingCache {
  modelId:    string
  embeddings: EmbeddingWithVector[]
}

let _cache:        EmbeddingCache | null          = null
let _cacheLoading: Promise<EmbeddingCache> | null = null

export function invalidateEmbeddingCache(): void {
  _cache        = null
  _cacheLoading = null
  console.log("[semantic] embedding cache invalidated")
}


export function addToEmbeddingCache(entry: EmbeddingWithVector): void {
  if (!_cache) return  // no cache loaded yet — nothing to update
  const idx = _cache.embeddings.findIndex(e => e.block_id === entry.block_id)
  if (idx !== -1) {
    _cache.embeddings[idx] = entry  // update existing
  } else {
    _cache.embeddings.push(entry)   // append new
  }
}

async function getEmbeddingsForModel(modelId: string): Promise<EmbeddingWithVector[]> {
  // Cache hit — same model already loaded
  if (_cache && _cache.modelId === modelId) {
    return _cache.embeddings
  }

  // Already loading — join the same promise, don't double-fetch
  if (_cacheLoading) {
    const loaded = await _cacheLoading
    return loaded.embeddings
  }

  // Load from DB
  _cacheLoading = (async (): Promise<EmbeddingCache> => {
    console.log("[semantic] loading embeddings into cache...")
    const t          = performance.now()
    const embeddings = await getAllEmbeddings(modelId, 5_000)
    console.log(`[semantic] cache loaded: ${embeddings.length} embeddings in ${(performance.now() - t).toFixed(0)}ms`)
    const cache: EmbeddingCache = { modelId, embeddings }
    _cache        = cache
    _cacheLoading = null
    return cache
  })()

  const loaded = await _cacheLoading
  return loaded.embeddings
}

// ─── Cache warmup ─────────────────────────────────────────────────────────────

export async function warmEmbeddingCache(): Promise<void> {
  try {
    const embedProvider = useAIStore.getState().embeddingProvider
    const modelId       = embeddingModelId(embedProvider)
    await getEmbeddingsForModel(modelId)
    console.log("[semantic] cache warmed at startup")
  } catch {
    /* non-fatal — search will cold-load on first query instead */
  }
}

// ─── Query embedder ───────────────────────────────────────────────────────────

async function embedQuery(query: string): Promise<Float32Array | null> {
  try {
    const t      = performance.now()
    const result = await callEmbedding(query.slice(0, 2000), "RETRIEVAL_QUERY")
    console.log(`[perf] embedding round-trip: ${(performance.now() - t).toFixed(0)}ms`)
    return result
  } catch {
    return null
  }
}

// ─── Main search function ─────────────────────────────────────────────────────

export async function semanticSearch(
  query:    string,
  topK:     number = 15,
  ftsCount: number = 0,   // hint from hybrid.ts — suppresses fallback when FTS is strong
): Promise<SemanticResult[]> {
  if (!query.trim()) return []

  const embedProvider = useAIStore.getState().embeddingProvider
  const modelId       = embeddingModelId(embedProvider)

  // Run embedding API call and cache load simultaneously —
  // neither depends on the other's result
  const [queryVector, embeddings] = await Promise.all([
    embedQuery(query),
    getEmbeddingsForModel(modelId),
  ])

  if (!queryVector)          return []
  if (embeddings.length === 0) return []

  // AFTER
const PRIMARY_THRESHOLD  = 0.45
const FALLBACK_THRESHOLD = 0.35

const scoreAt = (threshold: number): SemanticResult[] => {
  const out: SemanticResult[] = []
  for (const e of embeddings) {
    const s = cosineSimilarity(queryVector, e.vector)
    if (s >= threshold) out.push({ block_id: e.block_id, note_id: e.note_id, score: s })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, topK)
}

const primary = scoreAt(PRIMARY_THRESHOLD)

// Adaptive fallback: widen threshold only when primary is empty AND
// FTS is also weak. ftsCount is passed by vectorPass in hybrid.ts.
// Prevents vault noise on general queries while recovering borderline
// results on ambiguous ones.
if (primary.length > 0 || ftsCount >= 3) return primary

console.log('[semantic] primary empty + weak FTS — retrying at', FALLBACK_THRESHOLD)
return scoreAt(FALLBACK_THRESHOLD)
}