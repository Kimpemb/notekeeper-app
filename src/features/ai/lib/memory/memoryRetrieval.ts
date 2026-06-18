// src/features/ai/lib/memory/memoryRetrieval.ts
//
// Memory Block Retrieval — Memory Blocks Architecture Phase 3.
//
// Dedicated search over memory blocks (source_type IN ('memory_warm','memory_cold')).
// Never mixed with vault search — called separately in chat.ts buildPrompt.
//
// Retrieval strategy:
//   1. Temporal signal — if query contains time reference, filter by time range first
//   2. Multi-vector search — score against all three embedding columns in parallel:
//        query_embedding   (what user was trying to achieve)
//        embeddings.vector (response embedding — what was delivered)
//        episode_embedding (session-level meaning)
//   3. RRF fusion across the three result sets
//   4. Warm boost — warm blocks score 10% higher than cold blocks
//   5. Return top-N results with metadata for prompt injection

import { getDb }            from "@/features/notes/db/client"
import { callEmbedding }    from "@/features/ai/lib/client"
import { cosineSimilarity, embeddingModelId, blobToVector } from "@/features/ai/lib/provider"
import { useAIStore }       from "@/features/ai/store/useAIStore"

// ─── Constants ────────────────────────────────────────────────────────────────

const RRF_K              = 60
const WARM_BOOST         = 1.10   // 10% score boost for warm blocks
const MIN_SCORE          = 0.005  // minimum RRF score — RRF values are small (1/(K+rank)), not cosine similarity
const DEFAULT_LIMIT      = 3

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemorySearchResult {
  episodeId:   string
  blockId:     string
  summary:     string
  intentTags:  string[]
  openedAt:    number
  closedAt:    number
  score:       number
  matchedBy:   ('query' | 'response' | 'episode')[]
  isWarm:      boolean
}

interface MemoryBlockRow {
  block_id:         string
  episode_id:       string
  plaintext:        string
  source_type:      string
  memory_metadata:  string | null
  query_embedding:  Uint8Array | string | null
  episode_embedding: Uint8Array | string | null
  block_created_at: number
}

interface TemporalSignal {
  afterMs:  number
  beforeMs: number
}

// ─── Temporal signal extraction ───────────────────────────────────────────────
//
// Recognises common time references in natural language.
// Returns a time range window, or null if no signal found.

function extractTemporalSignal(query: string): TemporalSignal | null {
  const q   = query.toLowerCase()
  const now = Date.now()

  // "yesterday"
  if (/\byesterday\b/.test(q)) {
    const start = now - 2 * 24 * 60 * 60 * 1000
    const end   = now - 0 * 24 * 60 * 60 * 1000
    return { afterMs: start, beforeMs: end }
  }

  // "last week" / "this week"
  if (/\blast\s+week\b/.test(q) || /\bthis\s+week\b/.test(q)) {
    return { afterMs: now - 7 * 24 * 60 * 60 * 1000, beforeMs: now }
  }

  // "last month" / "this month"
  if (/\blast\s+month\b/.test(q) || /\bthis\s+month\b/.test(q)) {
    return { afterMs: now - 30 * 24 * 60 * 60 * 1000, beforeMs: now }
  }

  // "N days ago" / "N weeks ago" / "N months ago"
  const daysAgo   = q.match(/(\d+)\s+days?\s+ago/)
  const weeksAgo  = q.match(/(\d+)\s+weeks?\s+ago/)
  const monthsAgo = q.match(/(\d+)\s+months?\s+ago/)

  if (daysAgo) {
    const n = parseInt(daysAgo[1], 10)
    return { afterMs: now - (n + 1) * 24 * 60 * 60 * 1000, beforeMs: now - (n - 1) * 24 * 60 * 60 * 1000 }
  }
  if (weeksAgo) {
    const n = parseInt(weeksAgo[1], 10)
    return { afterMs: now - (n + 1) * 7 * 24 * 60 * 60 * 1000, beforeMs: now - (n - 1) * 7 * 24 * 60 * 60 * 1000 }
  }
  if (monthsAgo) {
    const n = parseInt(monthsAgo[1], 10)
    return { afterMs: now - (n + 1) * 30 * 24 * 60 * 60 * 1000, beforeMs: now - (n - 1) * 30 * 24 * 60 * 60 * 1000 }
  }

  return null
}

// ─── Temporal search ──────────────────────────────────────────────────────────
//
// Fetches memory blocks whose episode closed within the time window.
// Returns them sorted by recency (most recent first), no embedding needed.

async function searchByTimeRange(
  signal: TemporalSignal,
  limit:  number,
): Promise<MemorySearchResult[]> {
  const db = await getDb()

  const rows = await db.select<{
    block_id:        string
    episode_id:      string
    plaintext:       string
    source_type:     string
    memory_metadata: string | null
    block_created_at: number
  }[]>(
    `SELECT nb.block_id, nb.episode_id, nb.plaintext, nb.source_type,
            nb.memory_metadata, nb.block_created_at
     FROM note_blocks nb
     JOIN episodes ep ON ep.id = nb.episode_id
     WHERE nb.source_type IN ('memory_warm', 'memory_cold')
       AND nb.episode_id IS NOT NULL
       AND ep.closed_at >= $1
       AND ep.closed_at <= $2
     ORDER BY ep.closed_at DESC
     LIMIT $3`,
    [signal.afterMs, signal.beforeMs, limit]
  )

  return rows.map((row) => {
    const meta      = parseMemoryMetadata(row.memory_metadata)
    return {
      episodeId:  row.episode_id,
      blockId:    row.block_id,
      summary:    row.plaintext,
      intentTags: meta.intent ?? [],
      openedAt:   meta.openedAt ?? row.block_created_at,
      closedAt:   meta.closedAt ?? row.block_created_at,
      score:      1.0,   // temporal match — full score
      matchedBy:  [] as ('query' | 'response' | 'episode')[],
      isWarm:     row.source_type === 'memory_warm',
    }
  })
}

// ─── Metadata parser ──────────────────────────────────────────────────────────

interface ParsedMetadata {
  intent?:       string[]
  messageCount?: number
  openedAt?:     number
  closedAt?:     number
}

function parseMemoryMetadata(raw: string | null): ParsedMetadata {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as ParsedMetadata
  } catch {
    return {}
  }
}

// ─── Load all memory blocks ───────────────────────────────────────────────────
//
// Loads all memory blocks with their three embedding columns.
// Memory block count stays small (one per episode), so full scan is fine.

async function loadMemoryBlocks(): Promise<MemoryBlockRow[]> {
  const db = await getDb()

  return db.select<MemoryBlockRow[]>(
    `SELECT
       nb.block_id,
       nb.episode_id,
       nb.plaintext,
       nb.source_type,
       nb.memory_metadata,
       nb.query_embedding,
       nb.episode_embedding,
       nb.block_created_at
     FROM note_blocks nb
     WHERE nb.source_type IN ('memory_warm', 'memory_cold')
       AND nb.episode_id IS NOT NULL`,
    []
  )
}

// ─── Load response embeddings ─────────────────────────────────────────────────
//
// Response embeddings are stored in the embeddings table, not on note_blocks.
// Fetches them for all memory block IDs in one query.

async function loadResponseEmbeddings(
  blockIds: string[],
  modelId:  string,
): Promise<Map<string, Float32Array>> {
  if (blockIds.length === 0) return new Map()

  const db  = await getDb()
  const phs = blockIds.map((_, i) => `$${i + 2}`).join(', ')

  const rows = await db.select<{ block_id: string; vector: Uint8Array | string }[]>(
    `SELECT block_id, vector
     FROM embeddings
     WHERE model_id = $1
       AND block_id IN (${phs})`,
    [modelId, ...blockIds]
  )

  const out = new Map<string, Float32Array>()
  for (const row of rows) {
    try {
      const raw = row.vector
      const vec = typeof raw === 'string'
        ? blobToVector(raw)
        : new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
      out.set(row.block_id, vec)
    } catch { /* skip malformed */ }
  }  return out
}

// ─── Score one embedding column ───────────────────────────────────────────────
//
// Scores all memory blocks against the query vector using one embedding column.
// Returns block_id → rank map sorted by score descending.

function scoreEmbeddingColumn(
  blocks:      MemoryBlockRow[],
  queryVec:    Float32Array,
  getVector:   (row: MemoryBlockRow) => Float32Array | null,
): Map<string, number> {
  const scores: { blockId: string; score: number }[] = []

  for (const block of blocks) {
    const vec = getVector(block)
    if (!vec) continue
    const score = cosineSimilarity(queryVec, vec)
    if (score > 0) scores.push({ blockId: block.block_id, score })
  }

  scores.sort((a, b) => b.score - a.score)

  const rankMap = new Map<string, number>()
  scores.forEach(({ blockId }, rank) => rankMap.set(blockId, rank))
  return rankMap
}

// ─── RRF fusion ───────────────────────────────────────────────────────────────

type MatchType = 'query' | 'response' | 'episode'

function rrfFuse(
  rankMaps: { map: Map<string, number>; label: MatchType }[],
): Map<string, { score: number; matchedBy: Set<MatchType> }> {
  const fused = new Map<string, { score: number; matchedBy: Set<MatchType> }>()

  for (const { map, label } of rankMaps) {
    for (const [blockId, rank] of map) {
      const contribution = 1 / (RRF_K + rank + 1)
      const prev         = fused.get(blockId)
      if (prev) {
        prev.score += contribution
        prev.matchedBy.add(label)
      } else {
        fused.set(blockId, { score: contribution, matchedBy: new Set([label]) })
      }
    }
  }

  return fused
}

// ─── Main search function ─────────────────────────────────────────────────────

export async function searchMemoryBlocks(
  query:          string,
  _currentNoteId?: string,   // reserved for future note-scoped boosting
  limit:          number = DEFAULT_LIMIT,
): Promise<MemorySearchResult[]> {
  if (!query.trim()) return []

  // ── 1. Temporal signal check ──────────────────────────────────────────────
  const temporal = extractTemporalSignal(query)
  if (temporal) {
    console.log('[memoryRetrieval] temporal signal detected — searching by time range')
    return searchByTimeRange(temporal, limit)
  }

  // ── 2. Load memory blocks ─────────────────────────────────────────────────
  const blocks = await loadMemoryBlocks()
  if (blocks.length === 0) {
    console.log('[memoryRetrieval] no memory blocks found')
    return []
  }

  // ── 3. Embed query + load response embeddings in parallel ─────────────────
  const embedProvider = useAIStore.getState().embeddingProvider
  const modelId       = embeddingModelId(embedProvider)
  const blockIds      = blocks.map((b) => b.block_id)

  const [queryVec, responseEmbedMap] = await Promise.all([
    callEmbedding(query.slice(0, 500), 'RETRIEVAL_QUERY').catch((err) => {
      console.warn('[memoryRetrieval] query embedding failed:', err)
      return null
    }),
    loadResponseEmbeddings(blockIds, modelId),
  ])

  if (!queryVec) return []

  // ── 4. Score against three embedding columns ──────────────────────────────

  // query_embedding — stored as BLOB on note_blocks
  const queryRanks = scoreEmbeddingColumn(blocks, queryVec, (row) => {
    if (!row.query_embedding) return null
    try {
      const raw = row.query_embedding
      if (typeof raw === 'string') return blobToVector(raw)
      return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    } catch { return null }
  })

  // response embedding — from embeddings table
  const responseRanks = scoreEmbeddingColumn(blocks, queryVec, (row) => {
    return responseEmbedMap.get(row.block_id) ?? null
  })

  // episode_embedding — stored as BLOB on note_blocks
  const episodeRanks = scoreEmbeddingColumn(blocks, queryVec, (row) => {
    if (!row.episode_embedding) return null
    try {
      const raw = row.episode_embedding
      if (typeof raw === 'string') return blobToVector(raw)
      return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    } catch { return null }
  })

  console.log(
    `[memoryRetrieval] query="${query.slice(0, 50)}" ` +
    `queryHits=${queryRanks.size} responseHits=${responseRanks.size} episodeHits=${episodeRanks.size}`
  )

  // ── 5. RRF fusion ─────────────────────────────────────────────────────────
  const fused = rrfFuse([
    { map: queryRanks,    label: 'query'    },
    { map: responseRanks, label: 'response' },
    { map: episodeRanks,  label: 'episode'  },
  ])

  if (fused.size === 0) return []

  // ── 6. Build result objects ───────────────────────────────────────────────
  const blockMap = new Map(blocks.map((b) => [b.block_id, b]))

  const results: MemorySearchResult[] = []

  for (const [blockId, { score, matchedBy }] of fused) {
    const block = blockMap.get(blockId)
    if (!block) continue

    const isWarm     = block.source_type === 'memory_warm'
    const boosted    = isWarm ? score * WARM_BOOST : score

    if (boosted < MIN_SCORE) continue

    const meta = parseMemoryMetadata(block.memory_metadata)

    results.push({
      episodeId:  block.episode_id,
      blockId,
      summary:    block.plaintext,
      intentTags: meta.intent ?? [],
      openedAt:   meta.openedAt ?? block.block_created_at,
      closedAt:   meta.closedAt ?? block.block_created_at,
      score:      boosted,
      matchedBy:  [...matchedBy],
      isWarm,
    })
  }

  // ── 7. Sort by score, return top-N ────────────────────────────────────────
  results.sort((a, b) => b.score - a.score)

  console.log(
    '[memoryRetrieval] top results:',
    results.slice(0, 3).map((r) =>
      `score=${r.score.toFixed(4)} warm=${r.isWarm} "${r.summary.slice(0, 50)}"`
    )
  )

  return results.slice(0, limit)
}

// ─── Prompt formatter ─────────────────────────────────────────────────────────
//
// Formats memory results for injection into the prompt.
// Called by chat.ts after searchMemoryBlocks returns.

export function formatMemoryResults(results: MemorySearchResult[]): string {
  if (results.length === 0) return ''

  const lines: string[] = []

  for (const r of results) {
    const date      = new Date(r.closedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
    const tags      = r.intentTags.length > 0 ? ` [${r.intentTags.join(', ')}]` : ''
    const freshness = r.isWarm ? '' : ' (older session)'

    lines.push(`— ${date}${tags}${freshness}: ${r.summary}`)
  }

  return lines.join('\n')
}