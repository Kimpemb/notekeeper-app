// src/features/ai/lib/chat.ts
//
// "Chat with your notes" — answers questions using hybrid search
// (semantic + keyword + metadata re-ranking) to retrieve relevant blocks.
// Falls back gracefully if no embeddings exist yet (uses summaries).

import { hybridSearch }    from "@/features/ai/lib/search/hybrid"
import { useAIStore }      from "@/features/ai/store/useAIStore"
import {
  getAllAISummaries,
  getAIHistory,
  appendAIHistory,
  getSurroundingBlocks,
} from "@/features/notes/db/queries"
import type { Note } from "@/types"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id:        string
  role:      "user" | "assistant"
  content:   string
  createdAt: number
}

export interface ChatResult {
  answer:         string
  sourceTitles:   string[]
  sourceNoteIds:  string[]
  usedEmbeddings: boolean
  confidence:     "high" | "low"
}

export interface StreamingChatOptions {
  onChunk:  (token: string) => void
  onDone?:  () => void
  onError?: (err: Error) => void
}

// ─── Token budget ─────────────────────────────────────────────────────────────

const MAX_CONTEXT_CHARS = 12_000

function enforceTokenBudget(chunks: string[]): string[] {
  let total = 0
  const result: string[] = []
  for (const chunk of chunks) {
    if (total + chunk.length > MAX_CONTEXT_CHARS) break
    result.push(chunk)
    total += chunk.length
  }
  return result
}

// ─── Parent context expansion ─────────────────────────────────────────────────

async function expandWithSurroundingBlocks(
  results: Awaited<ReturnType<typeof hybridSearch>>
): Promise<Map<string, string>> {
  const expanded = new Map<string, string>()
  await Promise.allSettled(
    results.map(async (r) => {
      try {
        const surrounding = await getSurroundingBlocks(r.block_id, r.note_id, 2)
        if (surrounding.length > 0) {
          expanded.set(r.block_id, surrounding.join("\n"))
        }
      } catch { /* use original plaintext as fallback */ }
    })
  )
  return expanded
}

// ─── Session memory ───────────────────────────────────────────────────────────

async function buildHistoryBlock(noteId: string): Promise<string> {
  const history = await getAIHistory(noteId)
  if (history.length === 0) return ""
  const lines = history.map((h) =>
    `${h.role === "user" ? "User" : "Assistant"}: ${h.content.slice(0, 400)}`
  )
  return `\nConversation so far:\n${lines.join("\n")}\n`
}

// ─── Summary fallback ─────────────────────────────────────────────────────────

function scoreByKeyword(query: string, title: string, summary: string): number {
  const q      = query.toLowerCase()
  const words  = q.split(/\s+/).filter((w) => w.length > 2)
  const target = `${title} ${summary}`.toLowerCase()
  return words.reduce((acc, word) => acc + (target.includes(word) ? 1 : 0), 0)
}

async function buildSummaryFallbackContext(
  query:    string,
  allNotes: Note[]
): Promise<{ context: string; sourceTitles: string[]; sourceNoteIds: string[] }> {
  const summaryMap = await getAllAISummaries()
  if (summaryMap.size === 0) {
    return {
      context:       "(No summaries stored yet. Ask the AI to summarize some notes first.)",
      sourceTitles:  [],
      sourceNoteIds: [],
    }
  }

  const scored = allNotes
    .filter((n) => summaryMap.has(n.id))
    .map((note) => ({
      note,
      summary: summaryMap.get(note.id)!,
      score:   scoreByKeyword(query, note.title, summaryMap.get(note.id)!),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  if (scored.length === 0) {
    return {
      context:       "(No notes closely matched this query.)",
      sourceTitles:  [],
      sourceNoteIds: [],
    }
  }

  const lines = scored.map(
    (r) => `Note: "${r.note.title}"\nSummary: ${r.summary}`
  )
  return {
    context:       `Relevant notes from your vault:\n${lines.join("\n\n")}`,
    sourceTitles:  scored.map((r) => r.note.title),
    sourceNoteIds: scored.map((r) => r.note.id),
  }
}

// ─── Context builder ──────────────────────────────────────────────────────────

async function buildChatContext(
  query:        string,
  allNotes:     Note[],
  currentNote?: Note
): Promise<{
  prompt:         string
  sourceTitles:   string[]
  sourceNoteIds:  string[]
  usedEmbeddings: boolean
  confidence:     "high" | "low"
}> {
  let vaultContext   = ""
  let sourceTitles:  string[] = []
  let sourceNoteIds: string[] = []
  let usedEmbeddings = false
  let topScore       = 0

  try {
    // Pass currentNoteId so Phase 3 re-ranking can apply backlink + family boosts
    const results = await hybridSearch(query, 8, {
      currentNoteId: currentNote?.id,
    })

    if (results.length > 0) {
      usedEmbeddings = true
      // Use final_score (post-boost) for confidence signal
      topScore = results[0]?.final_score ?? results[0]?.rrf_score ?? 0

      const seenNoteIds = new Set<string>()
      for (const r of results) {
        if (!seenNoteIds.has(r.note_id)) {
          seenNoteIds.add(r.note_id)
          sourceTitles.push(r.note_title)
          sourceNoteIds.push(r.note_id)
        }
      }

      const expansions     = await expandWithSurroundingBlocks(results)
      const rawChunks      = results.map((r, i) => {
        const text = expansions.get(r.block_id) ?? r.plaintext
        return `[${i + 1}] From "${r.note_title}":\n${text}`
      })
      const budgetedChunks = enforceTokenBudget(rawChunks)
      vaultContext = `Relevant excerpts from your notes:\n\n${budgetedChunks.join("\n\n")}`
    }
  } catch { /* fall through to summary fallback */ }

  if (!usedEmbeddings) {
    const fallback = await buildSummaryFallbackContext(query, allNotes)
    vaultContext   = fallback.context
    sourceTitles   = fallback.sourceTitles
    sourceNoteIds  = fallback.sourceNoteIds
  }

  let currentNoteBlock = ""
  if (currentNote) {
    currentNoteBlock = `\nNote you're currently viewing:\nTitle: ${currentNote.title}\nContent: ${(currentNote.plaintext ?? "").slice(0, 1500)}`
  }

  const confidence: "high" | "low" =
    !usedEmbeddings || topScore < 0.1 ? "low" : "high"

  const prompt = `You are a knowledgeable assistant with access to the user's personal notes vault.
Answer the user's question using ONLY the provided note excerpts as your source.
If the excerpts don't contain enough information to answer, say so honestly — do not guess.
Cite sources by referencing the excerpt numbers like [1] or [2] where relevant.
Be concise and direct.
${vaultContext}
${currentNoteBlock}

User question: ${query}

Answer:`

  return { prompt, sourceTitles, sourceNoteIds, usedEmbeddings, confidence }
}

// ─── Streaming chat (primary path) ───────────────────────────────────────────

export async function streamChatWithNotes(
  query:       string,
  allNotes:    Note[],
  noteId:      string,
  currentNote: Note | undefined,
  streaming:   StreamingChatOptions
): Promise<Omit<ChatResult, "answer">> {
  const provider     = useAIStore.getState().getProvider()
  const historyBlock = await buildHistoryBlock(noteId)
  const ctx          = await buildChatContext(query, allNotes, currentNote)

  const promptWithHistory = ctx.prompt.replace(
    "User question:",
    `${historyBlock}User question:`
  )

  let assembled = ""

  await provider.streamComplete(promptWithHistory, {
    temperature: 0.3,
    maxTokens:   1024,
    onChunk: (token) => {
      assembled += token
      streaming.onChunk(token)
    },
    onDone: async () => {
      await appendAIHistory(noteId, "user",      query)
      await appendAIHistory(noteId, "assistant", assembled)
      streaming.onDone?.()
    },
    onError: (err) => {
      streaming.onError?.(err)
    },
  })

  return {
    sourceTitles:   ctx.sourceTitles,
    sourceNoteIds:  ctx.sourceNoteIds,
    usedEmbeddings: ctx.usedEmbeddings,
    confidence:     ctx.confidence,
  }
}

// ─── Non-streaming fallback ───────────────────────────────────────────────────

export async function chatWithNotes(
  query:        string,
  allNotes:     Note[],
  noteId:       string,
  currentNote?: Note
): Promise<ChatResult> {
  const provider     = useAIStore.getState().getProvider()
  const historyBlock = await buildHistoryBlock(noteId)
  const ctx          = await buildChatContext(query, allNotes, currentNote)

  const promptWithHistory = ctx.prompt.replace(
    "User question:",
    `${historyBlock}User question:`
  )

  const answer = await provider.complete(promptWithHistory, {
    temperature: 0.3,
    maxTokens:   1024,
  })

  await appendAIHistory(noteId, "user",      query)
  await appendAIHistory(noteId, "assistant", answer)

  return { answer, ...ctx }
}