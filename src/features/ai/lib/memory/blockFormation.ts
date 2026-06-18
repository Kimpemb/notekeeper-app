// src/features/ai/lib/memory/blockFormation.ts
//
// Memory Block Formation — Memory Blocks Architecture Phase 2.
//
// On episode close, transforms the episode into a structured memory block
// and writes it to note_blocks with source_type = 'memory_warm'.
//
// Three embeddings are computed per episode:
//   query_embedding   — what the user was trying to achieve (user messages)
//   embedding         — what was delivered (topic summary) → stored in embeddings table
//   episode_embedding — session meaning (topic summary, higher-level)
//
// The block is excluded from normal vault search via source_type filter
// in hybridSearch — it is only retrieved through memoryRetrieval.ts.

import { getDb } from "@/features/notes/db/client"
import {
  getEpisodeMessages,
  type EpisodeRow,
} from "@/features/notes/db/queries"
import { callEmbedding } from "@/features/ai/lib/client"
import { vectorToBlob }  from "@/features/ai/lib/provider"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryBlock {
  blockId:          string
  episodeId:        string
  noteId:           string | null
  summary:          string
  intentTags:       string[]
  openedAt:         number
  closedAt:         number
  messageCount:     number
  queryEmbedding:   Float32Array | null
  responseEmbedding: Float32Array | null
  episodeEmbedding: Float32Array | null
}

// ─── Main formation function ──────────────────────────────────────────────────

export async function formMemoryBlock(episode: EpisodeRow): Promise<void> {
  if (!episode.closed_at || !episode.topic_summary) {
    console.warn('[blockFormation] episode not closed or missing summary — skipping:', episode.id)
    return
  }

  if (episode.message_count === 0) {
    console.log('[blockFormation] empty episode — skipping:', episode.id)
    return
  }

  const db = await getDb()

  // Check if block already formed for this episode
  const existing = await db.select<{ block_id: string }[]>(
    `SELECT block_id FROM note_blocks WHERE episode_id = $1 LIMIT 1`,
    [episode.id]
  )
  if (existing.length > 0) {
    console.log('[blockFormation] block already exists for episode:', episode.id)
    return
  }

  console.log('[blockFormation] forming block for episode:', episode.id)

  // ── Build query text from user messages ───────────────────────────────────
  const messages    = await getEpisodeMessages(episode.id)
  const userContent = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')
    .slice(0, 1000)

  const summary = episode.topic_summary

  // ── Compute three embeddings in parallel ──────────────────────────────────
  const [queryEmbedding, responseEmbedding, episodeEmbedding] = await Promise.all([
    userContent
      ? callEmbedding(userContent, 'RETRIEVAL_QUERY').catch((err) => {
          console.warn('[blockFormation] query embedding failed:', err)
          return null
        })
      : Promise.resolve(null),
    callEmbedding(summary, 'RETRIEVAL_DOCUMENT').catch((err) => {
      console.warn('[blockFormation] response embedding failed:', err)
      return null
    }),
    callEmbedding(summary, 'RETRIEVAL_DOCUMENT').catch((err) => {
      console.warn('[blockFormation] episode embedding failed:', err)
      return null
    }),
  ])

  // ── Parse intent tags ─────────────────────────────────────────────────────
  let intentTags: string[] = []
  try {
    if (episode.intent_tags) {
      const parsed = JSON.parse(episode.intent_tags)
      if (Array.isArray(parsed)) intentTags = parsed
    }
  } catch { /* use empty */ }

  // ── Write memory block to note_blocks ─────────────────────────────────────
  const blockId  = crypto.randomUUID()
  const now      = Date.now()

  const memoryMetadata = JSON.stringify({
    intent:       intentTags,
    messageCount: episode.message_count,
    openedAt:     episode.opened_at,
    closedAt:     episode.closed_at,
    noteId:       episode.note_id,
  })

  await db.execute(
    `INSERT INTO note_blocks (
      block_id, note_id, block_type, plaintext,
      chunk_heading, chunk_index, source_type,
      block_created_at, block_updated_at, content_hash,
      episode_id, memory_metadata,
      query_embedding, episode_embedding
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10,
      $11, $12,
      $13, $14
    )`,
    [
      blockId,
      episode.note_id,
      'memory_block',
      summary,
      summary.slice(0, 80),   // chunk_heading = truncated summary
      0,
      'memory_warm',
      now,
      now,
      await hashText(summary),
      episode.id,
      memoryMetadata,
      queryEmbedding   ? vectorToBlob(queryEmbedding)   : null,
      episodeEmbedding ? vectorToBlob(episodeEmbedding) : null,
    ]
  )

  // ── Write response embedding to embeddings table ──────────────────────────
  // This allows the existing vector search infrastructure to find memory blocks
  // via the standard embeddings table when memoryRetrieval does its search.
  if (responseEmbedding) {
    const { useAIStore }      = await import('@/features/ai/store/useAIStore')
    const { embeddingModelId } = await import('@/features/ai/lib/provider')
    const provider = useAIStore.getState().embeddingProvider
    const modelId  = embeddingModelId(provider)

    await db.execute(
      `INSERT INTO embeddings (block_id, note_id, model_id, vector, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(block_id, model_id) DO UPDATE SET
         vector     = excluded.vector,
         updated_at = excluded.updated_at`,
      [blockId, episode.note_id, modelId, vectorToBlob(responseEmbedding), now]
    )
  }

  console.log('[blockFormation] memory block formed:', blockId, 'for episode:', episode.id)
}

// ─── Age warm blocks to cold ──────────────────────────────────────────────────
//
// Called on app startup. Blocks older than 30 days become cold.
// Cold blocks are still retrieved — they get a lower rerank boost.

export async function ageWarmToCold(): Promise<void> {
  const db           = await getDb()
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  const result = await db.execute(
    `UPDATE note_blocks
     SET source_type = 'memory_cold'
     WHERE source_type = 'memory_warm'
       AND block_created_at < $1`,
    [thirtyDaysAgo]
  )

  if (result.rowsAffected > 0) {
    console.log(`[blockFormation] aged ${result.rowsAffected} warm blocks to cold`)
  }
}

// ─── Hash helper ──────────────────────────────────────────────────────────────

async function hashText(text: string): Promise<string> {
  const buf    = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}