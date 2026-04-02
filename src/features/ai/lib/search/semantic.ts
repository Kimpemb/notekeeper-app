// src/features/ai/lib/search/semantic.ts
//
// Semantic search over the embeddings table.
// Embeds the query, then scores every stored embedding via cosine similarity.
// Returns results sorted by score, highest first.

import { useAIStore }        from "@/features/ai/store/useAIStore"
import { getAllEmbeddings }  from "@/features/notes/db/queries"
import { cosineSimilarity }  from "@/features/ai/lib/provider"

// ─── Constants ────────────────────────────────────────────────────────────────

const EMBED_MODEL_ID = "gemini-embedding-001"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SemanticResult {
  block_id:  string
  note_id:   string
  score:     number    // cosine similarity: -1 to 1, higher = more relevant
}

// ─── Query embedder ───────────────────────────────────────────────────────────

/**
 * Embed a search query using RETRIEVAL_QUERY task type.
 * Gemini embedding-004 is task-aware — using the wrong task type
 * silently degrades search quality, so we override here at query time.
 * For non-Gemini providers this falls back to the default embed() call.
 */
async function embedQuery(query: string): Promise<Float32Array> {
  const provider = useAIStore.getState().getProvider()

  // Gemini provider supports task type override via a direct fetch.
  // We reach into the provider's apiKey for this one specialised call.
  // All other providers use the standard embed() interface.
  if (useAIStore.getState().provider === "gemini") {
    const apiKey = useAIStore.getState().apiKey
    const url    = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-004:embedContent?key=${apiKey}`

    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:    "models/gemini-embedding-004",
        content:  { parts: [{ text: query.slice(0, 2000) }] },
        taskType: "RETRIEVAL_QUERY",   // ← different from RETRIEVAL_DOCUMENT
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const values: number[] = data.embedding?.values ?? []
      if (values.length > 0) return new Float32Array(values)
    }
  }

  // Fallback — standard embed() for other providers
  const result = await provider.embed(query)
  return result.vector
}

// ─── Main search function ─────────────────────────────────────────────────────

/**
 * Search all embeddings for the given query.
 * Returns up to `topK` results sorted by cosine similarity.
 *
 * Performance note: loading all embeddings into memory and scoring in JS
 * is fast enough for ~50k chunks (< 30ms). If vaults grow beyond that,
 * we add ANN indexing in a later phase.
 */
export async function semanticSearch(
  query:  string,
  topK:   number = 15
): Promise<SemanticResult[]> {
  if (!query.trim()) return []

  // Embed the query
  let queryVector: Float32Array
  try {
    queryVector = await embedQuery(query)
  } catch {
    // If embedding the query fails, return empty — don't crash chat
    return []
  }

  // Load all stored embeddings for the active model
  const embeddings = await getAllEmbeddings(EMBED_MODEL_ID)
  if (embeddings.length === 0) return []

  // Score every embedding
  const scored = embeddings.map((e) => ({
    block_id: e.block_id,
    note_id:  e.note_id,
    score:    cosineSimilarity(queryVector, e.vector),
  }))

  // Sort descending, take topK
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}