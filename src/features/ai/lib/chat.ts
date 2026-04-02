// src/features/ai/lib/chat.ts
//
// "Chat with your notes" — answers questions using hybrid search
// (semantic + keyword) to retrieve relevant blocks as context.
// Falls back gracefully if no embeddings exist yet (uses summaries).

import { hybridSearch }    from "@/features/ai/lib/search/hybrid"
import { useAIStore }      from "@/features/ai/store/useAIStore"
import { getAllAISummaries, getAIHistory, appendAIHistory } from "@/features/notes/db/queries"
import type { Note } from "@/types"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id:        string
  role:      "user" | "assistant"
  content:   string
  createdAt: number
}

export interface ChatResult {
  answer:       string
  sourceTitles: string[]
  usedEmbeddings: boolean   // lets UI show "indexed" vs "summary" mode
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
// Used when no embeddings exist yet — keeps the chatbot working on day one
// before the indexer has had a chance to embed everything.

function scoreByKeyword(query: string, title: string, summary: string): number {
  const q      = query.toLowerCase()
  const words  = q.split(/\s+/).filter((w) => w.length > 2)
  const target = `${title} ${summary}`.toLowerCase()
  return words.reduce((acc, word) => acc + (target.includes(word) ? 1 : 0), 0)
}

async function buildSummaryFallbackContext(
  query:    string,
  allNotes: Note[]
): Promise<{ context: string; sourceTitles: string[] }> {
  const summaryMap = await getAllAISummaries()
  if (summaryMap.size === 0) {
    return {
      context: "(No summaries stored yet. Ask the AI to summarize some notes first.)",
      sourceTitles: [],
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
      context: "(No notes closely matched this query.)",
      sourceTitles: [],
    }
  }

  const lines = scored.map(
    (r) => `Note: "${r.note.title}"\nSummary: ${r.summary}`
  )
  return {
    context:      `Relevant notes from your vault:\n${lines.join("\n\n")}`,
    sourceTitles: scored.map((r) => r.note.title),
  }
}

// ─── Main chat function ───────────────────────────────────────────────────────

export async function chatWithNotes(
  query:        string,
  allNotes:     Note[],
  noteId:       string,
  currentNote?: Note
): Promise<ChatResult> {
  const provider       = useAIStore.getState().getProvider()
  const historyBlock   = await buildHistoryBlock(noteId)

  // ── Try hybrid search first ───────────────────────────────────────────────
  let vaultContext  = ""
  let sourceTitles: string[] = []
  let usedEmbeddings = false

  try {
    const results = await hybridSearch(query, 8)

    if (results.length > 0) {
      usedEmbeddings = true
      sourceTitles   = [...new Set(results.map((r) => r.note_title))]

      const contextChunks = results.map((r, i) =>
        `[${i + 1}] From "${r.note_title}":\n${r.plaintext}`
      )
      vaultContext = `Relevant excerpts from your notes:\n\n${contextChunks.join("\n\n")}`
    }
  } catch {
    // Hybrid search failed — fall through to summary fallback
  }

  // ── Fall back to summaries if no embeddings yet ───────────────────────────
  if (!usedEmbeddings) {
    const fallback = await buildSummaryFallbackContext(query, allNotes)
    vaultContext   = fallback.context
    sourceTitles   = fallback.sourceTitles
  }

  // ── Current note context ──────────────────────────────────────────────────
  let currentNoteBlock = ""
  if (currentNote) {
    currentNoteBlock = `\nNote you're currently viewing:\nTitle: ${currentNote.title}\nContent: ${(currentNote.plaintext ?? "").slice(0, 1500)}`
  }

  // ── Build prompt ──────────────────────────────────────────────────────────
  const prompt = `You are a knowledgeable assistant with access to the user's personal notes vault.
Answer the user's question using ONLY the provided note excerpts as your source.
If the excerpts don't contain enough information to answer, say so honestly — do not guess.
Cite sources by referencing the excerpt numbers like [1] or [2] where relevant.
Be concise and direct.
${historyBlock}
${vaultContext}
${currentNoteBlock}

User question: ${query}

Answer:`

  const answer = await provider.complete(prompt, {
    temperature: 0.3,   // lower = more grounded, less creative
    maxTokens:   1024,
  })

  // ── Persist history ───────────────────────────────────────────────────────
  await appendAIHistory(noteId, "user",      query)
  await appendAIHistory(noteId, "assistant", answer)

  return { answer, sourceTitles, usedEmbeddings }
}