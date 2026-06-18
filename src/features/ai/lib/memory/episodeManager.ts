// src/features/ai/lib/memory/episodeManager.ts
//
// Episode lifecycle manager — Memory Blocks Architecture Phase 1.
//
// Responsibilities:
//   - Open an episode on first message of a session
//   - Track boundary signals (idle timer, note switch, explicit clear)
//   - Close episode when boundary triggers:
//       Primary:   note switch + topic drift > 0.5
//       Secondary: idle > 1 hour
//       Tertiary:  explicit clear
//   - On close: generate topic summary, compute episode embedding, write to DB
//   - Expose getCurrentEpisode() and closeEpisode() for external callers

import {
  createEpisode,
  getOpenEpisode,
  closeEpisode as dbCloseEpisode,
  appendEpisodeMessage,
  getEpisodeMessages,
  type EpisodeRow,
} from "@/features/notes/db/queries"
import { callEmbedding, promptProcessing, ProcessingExhaustedError } from "@/features/ai/lib/client"
import { formMemoryBlock } from "@/features/ai/lib/memory/blockFormation"

// ─── Constants ────────────────────────────────────────────────────────────────

const IDLE_CLOSE_MS        = 60 * 60 * 1000   // 1 hour
const TOPIC_DRIFT_THRESHOLD = 0.5              // cosine distance threshold for note-switch close
const COSINE_CLOSE_ENOUGH  = 1 - TOPIC_DRIFT_THRESHOLD  // similarity floor

// ─── In-memory episode state ──────────────────────────────────────────────────
//
// Keyed by noteId. Tracks the open episode per note pane.
// DB is source of truth — this is a write-through cache.

interface EpisodeState {
  episodeId:        string
  noteId:           string | null
  lastMessageAt:    number
  firstEmbedding:   Float32Array | null  // embedding of first user message
  idleTimer:        ReturnType<typeof setTimeout> | null
}

const _state = new Map<string, EpisodeState>()
const _opening = new Map<string, Promise<string>>()  // in-flight episode open guard

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function clearIdleTimer(state: EpisodeState): void {
  if (state.idleTimer !== null) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }
}

function scheduleIdleClose(noteId: string, state: EpisodeState): void {
  clearIdleTimer(state)
  state.idleTimer = setTimeout(async () => {
    console.log('[episodeManager] idle close triggered for note:', noteId)
    await closeCurrentEpisode(noteId, 'idle')
  }, IDLE_CLOSE_MS)
}

// ─── Topic summary generator ──────────────────────────────────────────────────

async function generateTopicSummary(episodeId: string): Promise<{
  summary:    string
  intentTags: string[]
}> {
  try {
    const messages = await getEpisodeMessages(episodeId)
    if (messages.length === 0) return { summary: 'Empty session', intentTags: [] }

    const formatted = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
      .join('\n')

    const raw = await promptProcessing(
      `Summarize this conversation episode in 2-3 sentences.
Capture: what was being worked on, what was established, and what intent was served.
Then on a new line output a JSON array of 1-3 intent tags from this list only:
["teaching", "debugging", "planning", "qa", "writing", "reviewing", "exploring"]

Conversation:
${formatted}

Summary and tags:`
    )

    // Parse summary and intent tags from response
    const lines      = raw.trim().split('\n')
    const jsonLine   = lines.find((l) => l.trim().startsWith('['))
    let intentTags: string[] = []

    if (jsonLine) {
      try {
        const parsed = JSON.parse(jsonLine)
        if (Array.isArray(parsed)) intentTags = parsed.filter((t) => typeof t === 'string')
      } catch { /* use empty tags */ }
    }

    const summary = lines
      .filter((l) => !l.trim().startsWith('['))
      .filter((l) => !l.trim().startsWith('```'))
      .join(' ')
      .trim() || 'Conversation session'

    return { summary, intentTags }
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      console.info('[episodeManager] processing exhausted — using fallback summary')
    } else {
      console.warn('[episodeManager] summary generation failed:', err)
    }
    return { summary: 'Conversation session', intentTags: [] }
  }
}

// ─── Close episode ────────────────────────────────────────────────────────────

async function closeCurrentEpisode(
  noteId: string,
  reason: 'idle' | 'note_switch' | 'explicit'
): Promise<void> {
  const state = _state.get(noteId)
  if (!state) return

  clearIdleTimer(state)
  _state.delete(noteId)

  console.log(`[episodeManager] closing episode ${state.episodeId} reason: ${reason}`)

  try {
    const { summary, intentTags } = await generateTopicSummary(state.episodeId)

    let embedding: Float32Array | undefined
    try {
      embedding = await callEmbedding(summary, 'RETRIEVAL_DOCUMENT')
    } catch {
      console.warn('[episodeManager] episode embedding failed — storing without vector')
    }

// AFTER:
    await dbCloseEpisode(state.episodeId, summary, intentTags, embedding)
    console.log(`[episodeManager] episode ${state.episodeId} closed: "${summary}"`)

    // Form memory block from closed episode — non-blocking
    const { getOpenEpisode: _getEpisode } = await import('@/features/notes/db/queries')
    const closedEpisode = await _getEpisode(state.episodeId).catch(() => null)
    // getOpenEpisode won't find it since it's closed — fetch directly
    const db = await (await import('@/features/notes/db/client')).getDb()
    const rows = await db.select<EpisodeRow[]>(
      `SELECT * FROM episodes WHERE id = $1`,
      [state.episodeId]
    )
    if (rows[0]) {
      formMemoryBlock(rows[0]).catch((err) =>
        console.warn('[episodeManager] formMemoryBlock failed:', err)
      )
    }
  } catch (err) {
    console.warn('[episodeManager] closeCurrentEpisode failed:', err)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Called by chat.ts on every user message.
 * Opens a new episode if none exists for this noteId,
 * or returns the existing open episode.
 * Also appends the message to episode_messages.
 */
export async function trackMessage(
  noteId:  string,
  role:    'user' | 'assistant',
  content: string,
): Promise<string> {
  let state = _state.get(noteId)

  // No in-memory state — check DB for open episode
  // Guard against parallel calls racing to createEpisode simultaneously
  if (!state) {
    let inflight = _opening.get(noteId)
    if (!inflight) {
      inflight = (async () => {
        let episode = await getOpenEpisode(noteId)
        if (!episode) {
          episode = await createEpisode(noteId)
          console.log('[episodeManager] opened new episode:', episode.id, 'for note:', noteId)
        } else {
          console.log('[episodeManager] resuming episode:', episode.id, 'for note:', noteId)
        }
        const newState: EpisodeState = {
          episodeId:      episode.id,
          noteId,
          lastMessageAt:  Date.now(),
          firstEmbedding: null,
          idleTimer:      null,
        }
        _state.set(noteId, newState)
        _opening.delete(noteId)
        return episode.id
      })()
      _opening.set(noteId, inflight)
    }
    await inflight
    state = _state.get(noteId)!
  }

  // Update last message timestamp
  state.lastMessageAt = Date.now()

  // Compute and cache first user message embedding for topic drift detection
  if (role === 'user' && state.firstEmbedding === null) {
    try {
      state.firstEmbedding = await callEmbedding(content.slice(0, 500), 'RETRIEVAL_QUERY')
    } catch {
      /* non-fatal — drift detection will be skipped */
    }
  }

  // Append to DB
  try {
    let queryEmbedding: Float32Array | undefined
    if (role === 'user' && state.firstEmbedding !== null) {
      queryEmbedding = state.firstEmbedding
    }
    await appendEpisodeMessage(state.episodeId, role, content, queryEmbedding)
  } catch (err) {
    console.warn('[episodeManager] appendEpisodeMessage failed:', err)
  }

  // Reset idle timer
  scheduleIdleClose(noteId, state)

  return state.episodeId
}

/**
 * Called when the active note switches.
 * Checks topic drift — if drift is high, closes the current episode.
 * If drift is low (same topic, different note), keeps episode open.
 */
export async function onNoteSwitch(
  fromNoteId: string,
  firstQueryInNewNote?: string,
): Promise<void> {
  const state = _state.get(fromNoteId)
  if (!state) return

  // No first embedding means we can't compute drift — keep episode open
  if (!state.firstEmbedding || !firstQueryInNewNote) return

  try {
    const newEmbedding = await callEmbedding(
      firstQueryInNewNote.slice(0, 500),
      'RETRIEVAL_QUERY'
    )
    const similarity = cosineSimilarity(state.firstEmbedding, newEmbedding)
    console.log('[episodeManager] note switch drift similarity:', similarity.toFixed(3))

    if (similarity < COSINE_CLOSE_ENOUGH) {
      // Topic changed — close episode
      await closeCurrentEpisode(fromNoteId, 'note_switch')
    }
    // else: same topic, keep episode open across note switch
  } catch {
    // Drift check failed — keep episode open, don't disrupt UX
  }
}

/**
 * Called when user explicitly clears the chat.
 * Always closes the current episode immediately.
 */
export async function onExplicitClear(noteId: string): Promise<void> {
  await closeCurrentEpisode(noteId, 'explicit')
}

/**
 * Returns the current open episode for a noteId, or null.
 * Used by chat.ts to inject episode context into the prompt.
 */
export async function getCurrentEpisode(noteId: string): Promise<EpisodeRow | null> {
  const state = _state.get(noteId)
  if (!state) return getOpenEpisode(noteId)
  return getOpenEpisode(noteId)
}

/**
 * Force-closes an episode by ID regardless of noteId.
 * Used for testing and admin operations.
 */
export async function closeEpisode(episodeId: string): Promise<void> {
  // Find the noteId from state
  for (const [noteId, state] of _state.entries()) {
    if (state.episodeId === episodeId) {
      await closeCurrentEpisode(noteId, 'explicit')
      return
    }
  }
  // Not in memory — close directly with fallback summary
  const { summary, intentTags } = { summary: 'Closed session', intentTags: [] as string[] }
  await dbCloseEpisode(episodeId, summary, intentTags, undefined)
}