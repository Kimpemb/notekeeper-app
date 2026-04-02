// src/features/ai/lib/indexer.ts
//
// Background embedding worker. Runs on a fixed interval, claims pending
// jobs from the queue, embeds each block, and writes results to the
// embeddings table. Never runs on startup — only after the first save.
//
// Lifecycle:
//   startIndexer()  — call once when AI is enabled and key is confirmed
//   stopIndexer()   — call when user disables AI or clears their key
//
// The worker is intentionally simple — no Web Workers, no SharedArrayBuffer.
// SQLite is the coordination layer. The interval is the heartbeat.

import { useAIStore }           from "@/features/ai/store/useAIStore"
import { ProviderError }        from "@/features/ai/lib/provider"
import {
  claimPendingJobs,
  markJobDone,
  markJobFailed,
  resetStuckJobs,
  enqueueUnindexedBlocks,
  getPendingJobCount,
  upsertEmbedding,
} from "@/features/notes/db/queries"

// ─── Config ───────────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS  = 30_000   // how often the worker wakes up
const JOBS_PER_TICK     = 3        // max blocks embedded per tick
const EMBED_MODEL_ID    = "gemini-embedding-001"

// ─── State ────────────────────────────────────────────────────────────────────

let intervalHandle:  ReturnType<typeof setInterval> | null = null
let isRunning        = false   // true while a tick is actively processing
let isPaused         = false   // true when quota is exhausted — skip ticks

// Exposed for the status indicator in the UI
export interface IndexerStatus {
  active:      boolean   // interval is running
  paused:      boolean   // backed off due to quota
  pendingJobs: number    // count of pending + processing jobs
}

// ─── Status subscribers ───────────────────────────────────────────────────────
// Lightweight pub/sub so the UI status dot can react without polling.

type StatusListener = (status: IndexerStatus) => void
const listeners = new Set<StatusListener>()

export function subscribeToIndexerStatus(fn: StatusListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)   // returns unsubscribe
}

async function emitStatus(): Promise<void> {
  if (listeners.size === 0) return
  const pendingJobs = await getPendingJobCount()
  const status: IndexerStatus = {
    active:  intervalHandle !== null,
    paused:  isPaused,
    pendingJobs,
  }
  for (const fn of listeners) fn(status)
}

// ─── Core tick ────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  // Skip if already mid-tick or backed off due to quota
  if (isRunning || isPaused) return

  isRunning = true

  try {
    const provider = useAIStore.getState().getProvider()
    const jobs     = await claimPendingJobs(JOBS_PER_TICK)

    if (jobs.length === 0) {
      await emitStatus()
      return
    }

    for (const job of jobs) {
      try {
        // Fetch the block plaintext fresh from note_blocks
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

        const result = await provider.embed(plaintext)

        await upsertEmbedding(
          job.block_id,
          job.note_id,
          result.modelId,
          result.vector
        )

        await markJobDone(job.block_id)

      } catch (err) {
        const isProviderError = err instanceof ProviderError
        const code            = isProviderError ? err.code : "UNKNOWN"
        const retryable       = isProviderError ? err.retryable : false
        const message         = err instanceof Error ? err.message : String(err)

        if (code === "QUOTA_EXCEEDED") {
          // Pause the entire worker for 60 seconds — no point hammering
          // the API when quota is exhausted. Other jobs stay pending.
          await markJobFailed(job.block_id, message, job.attempts, true)
          isPaused = true
          setTimeout(() => {
            isPaused = false
          }, 60_000)
          break   // stop processing remaining jobs this tick
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
    // Outer catch — DB error or getProvider() threw (no key configured)
    // Don't crash the interval — just log and wait for next tick
    console.warn("[indexer] tick error:", err)
  } finally {
    isRunning = false
    await emitStatus()
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the indexer. Safe to call multiple times — won't create
 * duplicate intervals. Should be called after:
 *   - AI is enabled and key is confirmed valid
 *   - App restarts with a valid saved key
 */
export async function startIndexer(): Promise<void> {
  if (intervalHandle !== null) return   // already running

  // Rescue any jobs stuck in 'processing' from last session
  await resetStuckJobs()

  // Enqueue any blocks that have never been embedded under the active model
  // This handles: fresh installs, notes created while AI was off, model switches
  try {
    const count = await enqueueUnindexedBlocks(EMBED_MODEL_ID)
    if (count > 0) {
      console.info(`[indexer] enqueued ${count} unindexed blocks`)
    }
  } catch (err) {
    console.warn("[indexer] failed to enqueue unindexed blocks:", err)
  }

  isPaused = false

  // Run first tick immediately, then on interval
  tick()
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS)

  await emitStatus()
  console.info("[indexer] started")
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