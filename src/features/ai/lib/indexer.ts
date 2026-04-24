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

  import { callEmbedding, AICallError } from "@/features/ai/lib/client"
  import { embeddingModelId }           from "@/features/ai/lib/provider"
  import { useAIStore }                 from "@/features/ai/store/useAIStore"
  import {
    claimPendingJobs,
    markJobDone,
    markJobFailed,
    resetStuckJobs,
    getPendingJobCount,
    upsertEmbedding,
  } from "@/features/notes/db/queries"

  // ─── Config ───────────────────────────────────────────────────────────────────

  const TICK_INTERVAL_MS = 30_000   // how often the worker wakes up
  const JOBS_PER_TICK    = 3        // max blocks embedded per tick

  // ─── State ────────────────────────────────────────────────────────────────────

  let intervalHandle: ReturnType<typeof setInterval> | null = null
  let isRunning       = false   // true while a tick is actively processing
  let isPaused        = false   // true when quota is exhausted — skip ticks

  // Exposed for the status indicator in the UI
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
      active:  intervalHandle !== null,
      paused:  isPaused,
      pendingJobs,
    }
    for (const fn of listeners) fn(status)
  }

  // ─── Core tick ────────────────────────────────────────────────────────────────

  async function tick(): Promise<void> {
  if (isRunning || isPaused) return

  isRunning = true

  try {
    const embedProvider = useAIStore.getState().embeddingProvider
    const modelId       = embeddingModelId(embedProvider)

    // Check RPD budget before claiming any jobs
    const budget = useAIStore.getState().rpdBudget[embedProvider]
    if (budget) {
      const now = Date.now()
      if (now < budget.resetAt && budget.used >= budget.ceiling) {
        // Daily quota reached — pause until midnight
        const msUntilReset = budget.resetAt - now
        isPaused = true
        setTimeout(() => {
          isPaused = false
          useAIStore.getState().resetRPD(embedProvider)
        }, msUntilReset)
        console.info(`[indexer] RPD ceiling reached (${budget.used}/${budget.ceiling}). Pausing until midnight.`)
        isRunning = false
        await emitStatus()
        return
      }
    }

    const jobs = await claimPendingJobs(JOBS_PER_TICK)

      if (jobs.length === 0) {
        await emitStatus()
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

          // All embedding calls route through callEmbedding() in client.ts.
          // This writes to the debug log and increments the RPD counter.
          const vector = await callEmbedding(plaintext)

          await upsertEmbedding(
            job.block_id,
            job.note_id,
            modelId,
            vector
          )

          await markJobDone(job.block_id)

        } catch (err) {
          // Normalise to AICallError — callEmbedding always throws AICallError,
          // but guard for unexpected throws from DB calls above.
          const isAIError = err instanceof AICallError
          const code      = isAIError ? err.code      : "UNKNOWN"
          const retryable = isAIError ? err.retryable : false
          const message   = err instanceof Error ? err.message : String(err)

          if (code === "QUOTA_EXCEEDED") {
            await markJobFailed(job.block_id, message, job.attempts, true)
            isPaused = true
            const budget = useAIStore.getState().rpdBudget[embedProvider]
            const msUntilReset = budget ? Math.max(budget.resetAt - Date.now(), 60_000) : 60_000
            console.info(`[indexer] QUOTA_EXCEEDED — pausing for ${Math.round(msUntilReset / 60000)} minutes.`)
            setTimeout(() => {
              isPaused = false
              useAIStore.getState().resetRPD(embedProvider)
            }, msUntilReset)
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

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Start the indexer. Safe to call multiple times — won't create
   * duplicate intervals. Should be called after:
   *   - AI is enabled and key is confirmed valid
   *   - App restarts with a valid saved key
   */
  const RECENT_NOTES_ON_STARTUP = 20

export async function startIndexer(): Promise<void> {
  if (intervalHandle !== null) return

  await resetStuckJobs()

  // Only enqueue the N most recently edited notes on startup.
  // Full backfill is intentionally removed — notes are indexed lazily
  // as they are opened or edited, keeping quota usage sustainable.
  try {
    const embedProvider = useAIStore.getState().embeddingProvider
    const modelId       = embeddingModelId(embedProvider)
    const { getDb }     = await import("@/features/notes/db/client")
    const db            = await getDb()

    const recentNotes = await db.select<{ id: string }[]>(
      `SELECT id FROM notes
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT $1`,
      [RECENT_NOTES_ON_STARTUP]
    )

    let enqueued = 0
    for (const { id } of recentNotes) {
      const blocks = await db.select<{ block_id: string }[]>(
        `SELECT nb.block_id
         FROM note_blocks nb
         LEFT JOIN embeddings e
           ON e.block_id = nb.block_id
          AND e.model_id = $1
         WHERE nb.note_id = $2
           AND e.block_id IS NULL`,
        [modelId, id]
      )
      for (const { block_id } of blocks) {
        await db.execute(
          `INSERT INTO embedding_jobs
             (block_id, note_id, status, attempts, last_error, next_attempt_at, updated_at)
           VALUES ($1, $2, 'pending', 0, NULL, 0, $3)
           ON CONFLICT(block_id) DO NOTHING`,
          [block_id, id, Date.now()]
        )
        enqueued++
      }
    }

    if (enqueued > 0) {
      console.info(`[indexer] enqueued ${enqueued} blocks from ${RECENT_NOTES_ON_STARTUP} most recent notes`)
    }
  } catch (err) {
    console.warn("[indexer] failed to enqueue recent notes:", err)
  }

  isPaused = false
  tick()
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS)
  await emitStatus()
  console.info("[indexer] started")
}

/**
 * Enqueue embedding jobs for a single note's unindexed blocks.
 * Call this when a note is opened. Safe to call repeatedly — 
 * ON CONFLICT DO NOTHING prevents duplicate jobs.
 */
export async function enqueueNoteForIndexing(noteId: string): Promise<void> {
  if (!useAIStore.getState().enabled) return
  try {
    const embedProvider = useAIStore.getState().embeddingProvider
    const modelId       = embeddingModelId(embedProvider)
    const { getDb }     = await import("@/features/notes/db/client")
    const db            = await getDb()

    const blocks = await db.select<{ block_id: string }[]>(
      `SELECT nb.block_id
       FROM note_blocks nb
       LEFT JOIN embeddings e
         ON e.block_id = nb.block_id
        AND e.model_id = $1
       WHERE nb.note_id = $2
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