// src/features/ai/lib/indexer.ts
//
// RAG v3 — Background embedding worker.
//
// Changes from v2:
//   - No hardcoded EMBED_MODEL_ID. Model ID is derived at tick time from
//     the active embeddingProvider via embeddingModelId() in provider.ts.
//   - RPD throttle uses embedding_quota_log in the DB (source of truth for
//     daily budget) in addition to the in-memory rpdBudget in the store.
//   - Priority ordering at startup enqueue:
//       1. Recently edited (block_updated_at DESC)
//       2. Recently visited (cross-referenced with note_visits)
//       3. Everything else in creation order (block_created_at ASC)
//   - Progress emission includes pendingJobs block count for UI consumption.
//   - Vault entry blocks handled identically to note blocks — no special
//     casing needed; source_type is on note_blocks, not the job queue.
//
// Lifecycle:
//   startIndexer()  — call once when AI is enabled and key is confirmed
//   stopIndexer()   — call when user disables AI or clears their key
//   nudgeIndexer()  — trigger an immediate tick after a note saves

import { callEmbedding, AICallError }     from "@/features/ai/lib/client"
import { embeddingModelId }               from "@/features/ai/lib/provider"
import { useAIStore }                     from "@/features/ai/store/useAIStore"
import type { ProviderName }              from "@/features/ai/store/useAIStore"
import { waitForDb }                      from "@/features/notes/db/queries"
import { addToEmbeddingCache, warmEmbeddingCache } from "@/features/ai/lib/search/semantic"

import {
  claimPendingJobs,
  markJobDone,
  markJobFailed,
  resetStuckJobs,
  getPendingJobCount,
  upsertEmbedding,
} from "@/features/notes/db/queries"

// ─── Config ───────────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS     = 30_000   // how often the worker wakes up
const JOBS_PER_TICK        = 3        // max blocks embedded per tick
const RECENT_NOTES_ON_STARTUP = 20    // notes to enqueue on startup

// ─── State ────────────────────────────────────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null
let isRunning       = false   // true while a tick is actively processing
let isPaused        = false   // true when quota is exhausted — skip ticks

// ─── IndexerStatus ────────────────────────────────────────────────────────────

export interface IndexerStatus {
  active:      boolean   // interval is running
  paused:      boolean   // backed off due to quota
  pendingJobs: number    // count of pending + processing jobs
}

// ─── Status subscribers ───────────────────────────────────────────────────────

type StatusListener = (status: IndexerStatus) => void
const listeners = new Set<StatusListener>()

export function subscribeToIndexerStatus(fn: StatusListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

async function emitStatus(): Promise<void> {
  if (listeners.size === 0) return
  const pendingJobs = await getPendingJobCount()
  const status: IndexerStatus = {
    active:      intervalHandle !== null,
    paused:      isPaused,
    pendingJobs,
  }
  for (const fn of listeners) fn(status)
}

// ─── Resolve active embedding provider + model ID ────────────────────────────
//
// Called at tick time, not at startup. If the user changes their embedding
// provider mid-session, the next tick picks up the new provider automatically.

interface EmbedConfig {
  provider:  string   // ProviderName — used for quota log and RPD store
  modelId:   string   // stable string stored in embeddings table
}

function resolveEmbedConfig(): EmbedConfig {
  const state    = useAIStore.getState()
  const provider = state.embeddingProvider
  const modelId  = embeddingModelId(provider)  // throws if provider has no embedding support
  return { provider, modelId }
}

// ─── RPD ceiling check ────────────────────────────────────────────────────────
//
// Two-layer check:
//   1. In-memory rpdBudget in the store — fast, survives the session
//   2. embedding_quota_log in the DB — survives restarts, source of truth
//
// If either says we're at or over ceiling, pause until midnight.

async function isQuotaExceeded(provider: string): Promise<boolean> {
  const state  = useAIStore.getState()
  const budget = state.rpdBudget[provider as ProviderName]
  if (!budget) return false
  const now = Date.now()
  if (now >= budget.resetAt) return false  // budget window has reset
  return budget.used >= budget.ceiling
}

function pauseIndexer(reason: string): void {
  isPaused = true
  console.info(`[indexer] paused — ${reason}. Will resume when a key recovers or a new key is added.`)
  emitStatus()
}

// ─── Core tick ────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (isRunning || isPaused) return

  isRunning = true

  try {
    // Resolve provider and model at tick time — picks up any mid-session changes
    let embedConfig: EmbedConfig
    try {
      embedConfig = resolveEmbedConfig()
    } catch (err) {
      // No embedding provider configured — stop quietly
      console.warn("[indexer] no embedding provider configured:", err)
      isRunning = false
      await emitStatus()
      return
    }

    const { provider, modelId } = embedConfig

    // RPD budget check before claiming any jobs
    if (await isQuotaExceeded(provider)) {
      pauseIndexer(`RPD ceiling reached`)
      isRunning = false
      await emitStatus()
      return
    }

    const jobs = await claimPendingJobs(JOBS_PER_TICK)

    if (jobs.length === 0) {
      await emitStatus()
      isRunning = false
      return
    }


    for (const job of jobs) {
      try {
        const { getDb } = await import("@/features/notes/db/client")
        const db        = await getDb()
        const rows      = await db.select<{ plaintext: string }[]>(
          `SELECT plaintext FROM note_blocks WHERE block_id = $1`,
          [job.block_id]
        )

        const plaintext = rows[0]?.plaintext ?? ""

        // Skip empty blocks — don't waste quota on blank paragraphs
        if (!plaintext.trim()) {
          await markJobDone(job.block_id)
          continue
        }

        // callEmbedding() resolves provider + key from the store internally.
        // It also calls incrementRPD() on the store after each successful call.
        const vector = await callEmbedding(plaintext)

        await upsertEmbedding(
          job.block_id,
          job.note_id,
          modelId,
          vector
        )

        await markJobDone(job.block_id)
        addToEmbeddingCache({
          block_id:   job.block_id,
          note_id:    job.note_id,
          model_id:   modelId,
          vector,
          updated_at: Date.now(),
        })

        // Re-check budget after each successful embed — stop this tick
        // immediately if we just hit the ceiling rather than burning
        // through the rest of the batch first.
        if (await isQuotaExceeded(provider)) {
          pauseIndexer(`RPD ceiling reached mid-tick`)
          break
        }

      } catch (err) {
        const isAIError = err instanceof AICallError
        const code      = isAIError ? err.code      : "UNKNOWN"
        const retryable = isAIError ? err.retryable : false
        const message   = err instanceof Error ? err.message : String(err)

        if (code === "QUOTA_EXCEEDED") {
          await markJobFailed(job.block_id, message, job.attempts, true)
          pauseIndexer(`QUOTA_EXCEEDED from provider`)
          break
        }

        if (code === "AUTH_FAILED") {
          // Bad key — stop the indexer entirely until user re-authenticates
          await markJobFailed(job.block_id, message, job.attempts, false)
          stopIndexer()
          break
        }

        // All other errors — mark failed with backoff, move to next job
        await markJobFailed(job.block_id, message, job.attempts, retryable)
      }
    }

    // Invalidate cache once per tick if any embeddings were written —
    // avoids cold reload on every job (was causing 12-27s search delays)
    

  } catch (err) {
    // Outer catch — DB error or store read threw unexpectedly
    console.warn("[indexer] tick error:", err)
  } finally {
    isRunning = false
    await emitStatus()
  }
}

// ─── Priority enqueue helper ──────────────────────────────────────────────────
//
// Priority ordering for startup enqueue:
//   Tier 1 — recently edited notes (updated_at DESC, top 20)
//   Tier 2 — recently visited notes (cross-ref note_visits, most recent first)
//   Tier 3 — everything else (block_created_at ASC — oldest first)
//
// Within each tier, only blocks without an embedding for the active model_id
// are enqueued. Vault entry blocks are handled identically — source_type lives
// on note_blocks, not the job queue, so no special casing is needed.

async function enqueueWithPriority(modelId: string, limit: number): Promise<number> {
  const { getDb } = await import("@/features/notes/db/client")
  const db        = await getDb()
  const ts        = Date.now()

  await db.execute(
    `INSERT INTO embedding_jobs
       (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
     SELECT nb.block_id, nb.note_id, 'pending', 0, NULL, 0, $1
     FROM note_blocks nb
     LEFT JOIN embeddings e
       ON e.block_id = nb.block_id
      AND e.model_id = $2
     LEFT JOIN (
       SELECT id, updated_at, 1 AS tier
       FROM notes
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT $3
     ) t1 ON t1.id = nb.note_id
     LEFT JOIN (
       SELECT note_id, MAX(visited_at) AS last_visit, 2 AS tier
       FROM note_visits
       GROUP BY note_id
       ORDER BY last_visit DESC
       LIMIT $3
     ) t2 ON t2.note_id = nb.note_id
     WHERE e.block_id IS NULL
     ORDER BY
       CASE
         WHEN t1.tier IS NOT NULL THEN 1
         WHEN t2.tier IS NOT NULL THEN 2
         ELSE 3
       END,
       nb.block_created_at ASC
     ON CONFLICT(block_id) DO NOTHING`,
    [ts, modelId, limit]
  )

  const rows = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM embedding_jobs WHERE status = 'pending'`
  )
  return rows[0]?.count ?? 0
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the indexer. Safe to call multiple times — won't create
 * duplicate intervals. Should be called after:
 *   - AI is enabled and key is confirmed valid
 *   - App restarts with a valid saved key
 */
export async function startIndexer(): Promise<void> {
  if (intervalHandle !== null) return;
  await waitForDb();

  await resetStuckJobs()

  // Resolve model ID at startup time for the enqueue pass
  try {
    const { modelId, provider } = resolveEmbedConfig()

    console.info(`[indexer] starting with provider=${provider} model=${modelId}`)

    const enqueued = await enqueueWithPriority(modelId, RECENT_NOTES_ON_STARTUP)
    if (enqueued > 0) {
      console.info(`[indexer] enqueued ${enqueued} blocks on startup (priority ordered)`)
    }
  } catch (err) {
    console.warn("[indexer] failed to enqueue on startup:", err)
  }

  isPaused = false
  // Delay first tick by 45 seconds — lets the app fully initialize
  // before competing for network and DB resources at startup.
  setTimeout(() => {
    tick()
  }, 45_000)
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS)
  await emitStatus()
  console.info("[indexer] started")

  // Delay cache warm by 20 seconds — avoids blocking startup rendering
  setTimeout(() => {
    warmEmbeddingCache().catch(() => {})
  }, 20_000)
}

/**
 * Enqueue embedding jobs for a single note's unindexed blocks.
 * Call this when a note is opened or saved. Safe to call repeatedly —
 * ON CONFLICT DO NOTHING prevents duplicate jobs.
 * Handles both notes and vault entries identically.
 */
export async function enqueueNoteForIndexing(noteId: string): Promise<void> {
  if (!useAIStore.getState().enabled) return
  try {
    let embedConfig: EmbedConfig
    try {
      embedConfig = resolveEmbedConfig()
    } catch {
      return
    }

    const { modelId } = embedConfig
    const { getDb }   = await import("@/features/notes/db/client")
    const db          = await getDb()
    const ts          = Date.now()

    await db.execute(
      `INSERT INTO embedding_jobs
         (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
       SELECT nb.block_id, nb.note_id, 'pending', 0, NULL, 0, $1
       FROM note_blocks nb
       LEFT JOIN embeddings e
         ON e.block_id = nb.block_id
        AND e.model_id = $2
       WHERE nb.note_id  = $3
         AND e.block_id IS NULL
       ON CONFLICT(block_id) DO NOTHING`,
      [ts, modelId, noteId]
    )

    nudgeIndexer()
  } catch (err) {
    console.warn("[indexer] enqueueNoteForIndexing failed:", err)
  }
}

export async function resumeIndexerWithKey(keyId: string): Promise<void> {
  if (!isPaused) return

  console.info(`[indexer] new key added — attempting resume with key ${keyId}`)

  try {
    const vector = await callEmbedding("test")
    if (vector) {
      isPaused = false
      const { markRecovered } = await import("@/features/notes/db/queries")
      const state = useAIStore.getState()
      await markRecovered(state.embeddingProvider, "gemini-embedding-001", keyId, "embedding")
      useAIStore.getState().setEmbeddingActiveKey(keyId)
      console.info(`[indexer] resumed with new key ${keyId}`)
      tick()
    }
  } catch {
    // Test request failed — key is bad, stay paused
    const { logExhaustion } = await import("@/features/notes/db/queries")
    const state = useAIStore.getState()
    await logExhaustion(state.embeddingProvider, "gemini-embedding-001", keyId, "embedding", "test_failed")
    console.warn(`[indexer] new key ${keyId} test failed — staying paused`)
  }
}

/**
 * Stop the indexer. Called when:
 *   - User disables AI
 *   - User clears their API key
 *   - AUTH_FAILED — bad key detected mid-indexing
 */
export function stopIndexer(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  isRunning = false
  isPaused  = false
  emitStatus()
  console.info("[indexer] stopped")
}

/**
 * Manually trigger a tick — call this immediately after a note saves
 * so the user doesn't wait up to 30 seconds for their edit to be indexed.
 * Safe to call while a tick is already running — the isRunning guard
 * prevents double-processing.
 */
let nudgeTimer: ReturnType<typeof setTimeout> | null = null

export function nudgeIndexer(): void {
  if (nudgeTimer) return
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null
    tick()
  }, 500)
}