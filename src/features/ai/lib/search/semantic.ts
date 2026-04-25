// src/features/ai/lib/search/semantic.ts
//
// Semantic search over the embeddings table.
// Embeds the query via the active embedding provider, then scores every stored
// embedding via cosine similarity. Returns results sorted by score, highest first.

import { callEmbedding }    from "@/features/ai/lib/client"
import { embeddingModelId, cosineSimilarity } from "@/features/ai/lib/provider"
import { useAIStore }       from "@/features/ai/store/useAIStore"
import { getAllEmbeddings } from "@/features/notes/db/queries"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SemanticResult {
  block_id: string
  note_id:  string
  score:    number    // cosine similarity: -1 to 1, higher = more relevant
}

// ─── Query embedder ───────────────────────────────────────────────────────────

/**
 * Embed a search query through the active embedding provider.
 * Routes through callEmbedding() in client.ts — slot-aware, logged, RPD-tracked.
 *
 * Returns null on any failure so the caller can degrade gracefully to
 * keyword-only search without throwing.
 */
async function embedQuery(query: string): Promise<Float32Array | null> {
  try {
    return await callEmbedding(query.slice(0, 2000), "RETRIEVAL_QUERY")
  } catch {
    return null
  }
}

// ─── Main search function ─────────────────────────────────────────────────────

export async function semanticSearch(
  query: string,
  topK:  number = 15
): Promise<SemanticResult[]> {
  if (!query.trim()) return []

  const queryVector = await embedQuery(query)

  // embedQuery returns null on any failure — degrade to keyword-only
  if (!queryVector) return []

  // Fetch embeddings stored under the active embedding model.
  // Using the live model ID ensures we only score against vectors produced
  // by the same model — cross-model cosine similarity is meaningless.
  const embedProvider = useAIStore.getState().embeddingProvider
  const modelId       = embeddingModelId(embedProvider)

  const embeddings = await getAllEmbeddings(modelId)
  if (embeddings.length === 0) return []

  const scored = embeddings.map((e) => ({
    block_id: e.block_id,
    note_id:  e.note_id,
    score:    cosineSimilarity(queryVector, e.vector),
  }))

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}