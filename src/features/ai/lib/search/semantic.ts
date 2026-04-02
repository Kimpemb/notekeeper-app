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
 * gemini-embedding-001 is task-aware — using the wrong task type
 * silently degrades search quality, so we override here at query time.
 * For non-Gemini providers this falls back to the default embed() call.
 *
 * Returns null if embedding fails for any reason (quota, network, etc.)
 * so the caller can degrade gracefully to keyword-only search.
 */
async function embedQuery(query: string): Promise<Float32Array | null> {
  const provider = useAIStore.getState().getProvider()

  if (useAIStore.getState().provider === "gemini") {
    try {
      const apiKey = useAIStore.getState().apiKey
      const url    = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL_ID}:embedContent?key=${apiKey}`

      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:    `models/${EMBED_MODEL_ID}`,
          content:  { parts: [{ text: query.slice(0, 2000) }] },
          taskType: "RETRIEVAL_QUERY",
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const values: number[] = data.embedding?.values ?? []
        if (values.length > 0) return new Float32Array(values)
      }

      // Non-OK response (e.g. 429 quota) — return null, don't throw
      return null
    } catch {
      return null
    }
  }

  // Fallback — standard embed() for other providers
  try {
    const result = await provider.embed(query)
    return result.vector
  } catch {
    return null
  }
}

// ─── Main search function ─────────────────────────────────────────────────────

export async function semanticSearch(
  query:  string,
  topK:   number = 15
): Promise<SemanticResult[]> {
  if (!query.trim()) return []

  const queryVector = await embedQuery(query)

  // embedQuery returns null on any failure — degrade to keyword-only
  if (!queryVector) return []

  const embeddings = await getAllEmbeddings(EMBED_MODEL_ID)
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