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

function msUntilMidnight(): number {
  const d = new Date()
  d.setHours(24, 0, 0, 0)
  return Math.max(d.getTime() - Date.now(), 60_000) // minimum 1 minute
}

function pauseUntilMidnight(provider: string, reason: string): void {
  isPaused = true
  const ms = msUntilMidnight()
  console.info(`[indexer] ${reason} — pausing for ${Math.round(ms / 60_000)} minutes.`)
  setTimeout(() => {
    isPaused = false
    useAIStore.getState().resetRPD(provider as ProviderName)
  }, ms)
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
      pauseUntilMidnight(provider, `RPD ceiling reached`)
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

        // Re-check budget after each successful embed — stop this tick
        // immediately if we just hit the ceiling rather than burning
        // through the rest of the batch first.
        if (await isQuotaExceeded(provider)) {
          pauseUntilMidnight(provider, `RPD ceiling reached mid-tick`)
          break
        }

      } catch (err) {
        const isAIError = err instanceof AICallError
        const code      = isAIError ? err.code      : "UNKNOWN"
        const retryable = isAIError ? err.retryable : false
        const message   = err instanceof Error ? err.message : String(err)

        if (code === "QUOTA_EXCEEDED") {
          await markJobFailed(job.block_id, message, job.attempts, true)
          pauseUntilMidnight(provider, `QUOTA_EXCEEDED from provider`)
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
  let   enqueued  = 0

  // ── Tier 1: recently edited notes ─────────────────────────────────────────
  const recentlyEdited = await db.select<{ id: string }[]>(
    `SELECT id FROM notes
     WHERE deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  )

  const tier1Ids = new Set(recentlyEdited.map((r) => r.id))

  for (const { id } of recentlyEdited) {
    const blocks = await db.select<{ block_id: string }[]>(
      `SELECT nb.block_id
       FROM note_blocks nb
       LEFT JOIN embeddings e
         ON e.block_id = nb.block_id
        AND e.model_id = $1
       WHERE nb.note_id   = $2
         AND e.block_id IS NULL`,
      [modelId, id]
    )
    for (const { block_id } of blocks) {
      await db.execute(
        `INSERT INTO embedding_jobs
           (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
         VALUES ($1, $2, 'pending', 0, NULL, 0, $3)
         ON CONFLICT(block_id) DO NOTHING`,
        [block_id, id, ts]
      )
      enqueued++
    }
  }

  // ── Tier 2: recently visited notes (not already covered by tier 1) ─────────
  const recentlyVisited = await db.select<{ note_id: string }[]>(
    `SELECT note_id, MAX(visited_at) as last_visit
     FROM note_visits
     GROUP BY note_id
     ORDER BY last_visit DESC
     LIMIT $1`,
    [limit]
  )

  for (const { note_id } of recentlyVisited) {
    if (tier1Ids.has(note_id)) continue  // already handled in tier 1

    const blocks = await db.select<{ block_id: string }[]>(
      `SELECT nb.block_id
       FROM note_blocks nb
       LEFT JOIN embeddings e
         ON e.block_id = nb.block_id
        AND e.model_id = $1
       WHERE nb.note_id   = $2
         AND e.block_id IS NULL`,
      [modelId, note_id]
    )
    for (const { block_id } of blocks) {
      await db.execute(
        `INSERT INTO embedding_jobs
           (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
         VALUES ($1, $2, 'pending', 0, NULL, 0, $3)
         ON CONFLICT(block_id) DO NOTHING`,
        [block_id, note_id, ts]
      )
      enqueued++
    }
  }

  // ── Tier 3: all remaining unindexed blocks, oldest first ───────────────────
  //
  // This catches vault entries and any note not visited or recently edited.
  // block_created_at ASC gives stable, predictable ordering.
  const remaining = await db.select<{ block_id: string; note_id: string }[]>(
    `SELECT nb.block_id, nb.note_id
     FROM note_blocks nb
     LEFT JOIN embeddings e
       ON e.block_id = nb.block_id
      AND e.model_id = $1
     WHERE e.block_id IS NULL
     ORDER BY nb.block_created_at ASC`,
    [modelId]
  )

  for (const { block_id, note_id } of remaining) {
    await db.execute(
      `INSERT INTO embedding_jobs
         (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
       VALUES ($1, $2, 'pending', 0, NULL, 0, $3)
       ON CONFLICT(block_id) DO NOTHING`,
      [block_id, note_id, ts]
    )
    enqueued++
  }

  return enqueued
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the indexer. Safe to call multiple times — won't create
 * duplicate intervals. Should be called after:
 *   - AI is enabled and key is confirmed valid
 *   - App restarts with a valid saved key
 */
export async function startIndexer(): Promise<void> {
  if (intervalHandle !== null) return

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
  tick()
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS)
  await emitStatus()
  console.info("[indexer] started")
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
      return  // no provider configured — fail silently
    }

    const { modelId } = embedConfig
    const { getDb }   = await import("@/features/notes/db/client")
    const db          = await getDb()

    const blocks = await db.select<{ block_id: string }[]>(
      `SELECT nb.block_id
       FROM note_blocks nb
       LEFT JOIN embeddings e
         ON e.block_id = nb.block_id
        AND e.model_id = $1
       WHERE nb.note_id   = $2
         AND e.block_id IS NULL`,
      [modelId, noteId]
    )

    if (blocks.length === 0) return

    const ts = Date.now()
    for (const { block_id } of blocks) {
      await db.execute(
        `INSERT INTO embedding_jobs
           (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
         VALUES ($1, $2, 'pending', 0, NULL, 0, $3)
         ON CONFLICT(block_id) DO NOTHING`,
        [block_id, noteId, ts]
      )
    }

    nudgeIndexer()
  } catch (err) {
    console.warn("[indexer] enqueueNoteForIndexing failed:", err)
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
export function nudgeIndexer(): void {
  tick()
}