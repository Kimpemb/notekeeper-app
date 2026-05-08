// src/features/ai/lib/chat.ts
//
// RAG v3 — Full pipeline rewrite.
//
// Pipeline per query:
//   1. Intent detection (intentDetection.ts)
//   2. Scope parse (included in intent detection)
//   3. Query expansion (queryExpansion.ts) — processing model, 1.5s timeout
//   4. Hybrid retrieval (hybrid.ts) — FTS5 + vector + RRF
//   5. Rerank (rerank.ts) — metadata boosts, confidence calibration
//   6. Context expansion (hybrid.ts expandContext)
//   7. Prompt assembly — source_type on each excerpt, vault context block
//   8. Primary model response
//   9. Post-response cross-note connection pass
//
// Inventory awareness branch:
//   - Hybrid search skipped entirely
//   - Note inventory summary injected via processing model
//
// Tier 1 (no AI):
//   - Same retrieval pipeline runs
//   - Returns structured result set for UI rendering
//
// Token budget: 12,000 char cap, trimmed from bottom of ranked list.
// Summary generation routed through processing model.

import {
  hybridSearch,
  expandContext,
  type HybridResult,
  type ExcludedTitleMatch,
} from "@/features/ai/lib/search/hybrid"
import { detectIntent }    from "@/features/ai/lib/search/intentDetection"
import {
  callPrimary,
  promptPrimary,
  promptProcessing,
  ProcessingExhaustedError,
  type ProviderMessage,
  type AICallError,
  isAIReady,
} from "@/features/ai/lib/client"
import {
  getAllNotesMeta,
  getAIHistory,
  appendAIHistory,
  getConversationSummary,
  saveConversationSummary,
} from "@/features/notes/db/queries"
import type { Note } from "@/types"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id:        string
  role:      "user" | "assistant"
  content:   string
  createdAt: number
}

export interface RelatedNote {
  title:  string
  noteId: string
}

// Tier 1 result card — returned when AI is disabled
export interface Tier1ResultCard {
  noteId:       string
  noteTitle:    string
  sourceType:   string
  chunkHeading: string | null
  excerpt:      string
  blockType:    string
  confidence:   "strong" | "possible" | "weak"
}

export interface ChatResult {
  answer:               string
  sourceTitles:         string[]
  sourceNoteIds:        string[]
  usedEmbeddings:       boolean
  confidence:           "high" | "medium" | "low"
  relatedNotes:         RelatedNote[]
  tier1Results?:        Tier1ResultCard[]
  excludedNoteNotices?: ExcludedTitleMatch[]
}

export interface StreamingChatOptions {
  onChunk:  (token: string) => void
  onDone?:  () => void
  onError?: (err: AICallError) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CONTEXT_CHARS           = 12_000
const MEDIUM_CONFIDENCE_THRESHOLD = 0.08

// ─── Rolling session memory ───────────────────────────────────────────────────

async function buildHistoryBlock(noteId: string): Promise<string> {
  const [history, summaryRow] = await Promise.all([
    getAIHistory(noteId),
    getConversationSummary(noteId),
  ])

  const parts: string[] = []

  if (summaryRow?.summary) {
    parts.push(`Summary of earlier conversation:\n${summaryRow.summary}`)
  }

  if (history.length > 0) {
    const lines = history.map((h) =>
      `${h.role === "user" ? "User" : "Assistant"}: ${h.content.slice(0, 400)}`
    )
    parts.push(`Recent conversation:\n${lines.join("\n")}`)
  }

  return parts.length > 0 ? `\n${parts.join("\n\n")}\n` : ""
}

async function updateRollingSummary(
  noteId:          string,
  droppedContent:  string,
  existingSummary: string | null,
): Promise<void> {
  try {
    const prompt = existingSummary
      ? `You are summarizing a conversation for context compression.
Existing summary: ${existingSummary}

New messages to incorporate:
${droppedContent}

Write a concise updated summary (max 3 sentences) capturing the key topics discussed.
Summary:`
      : `Summarize this conversation in 2-3 sentences, capturing the key topics:
${droppedContent}
Summary:`

    const summary = await promptProcessing(prompt)
    const currentRow = await getConversationSummary(noteId)
    await saveConversationSummary(
      noteId,
      summary.trim(),
      (currentRow?.message_count ?? 0) + droppedContent.split("\n").length
    )
  } catch (err) {
    if (!(err instanceof ProcessingExhaustedError)) {
      console.debug("[updateRollingSummary] non-exhaustion error:", err)
    }
  }
}

// ─── Inventory awareness ──────────────────────────────────────────────────────

async function buildInventoryContext(): Promise<string> {
  const notes  = await getAllNotesMeta()
  const active = notes.filter((n) => !n.deleted_at)

  const recentTitles = active
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 10)
    .map((n) => `- ${n.title} (${new Date(n.updated_at).toLocaleDateString()})`)
    .join("\n")

  const allTags = new Set<string>()
  for (const note of active) {
    if (!note.tags) continue
    try {
      const tags: string[] = JSON.parse(note.tags)
      tags.forEach((t) => allTags.add(t))
    } catch { /* skip malformed */ }
  }

  const tagList = [...allTags].slice(0, 30).join(", ") || "none"

  const staticBlock = `[VAULT INVENTORY]
Total notes: ${active.length}
Recently edited:
${recentTitles}
Tags: ${tagList}`

  try {
    const prompt = `You have access to ${active.length} notes in the user's vault.

Recently edited notes:
${recentTitles}

Tags in vault: ${tagList}

Summarize what topics and areas are covered in this vault in 2-3 sentences.`

    const summary = await promptProcessing(prompt)
    return `${staticBlock}\n\n${summary}`
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      console.info("[buildInventoryContext] processing exhausted — returning static inventory")
      return staticBlock
    }
    console.debug("[buildInventoryContext] summary failed:", err)
    return staticBlock
  }
}

// ─── Context assembly ─────────────────────────────────────────────────────────

function buildExcerptBlock(results: HybridResult[]): string {
  const chunks: string[] = []
  let total = 0

  for (let i = 0; i < results.length; i++) {
    const r    = results[i]
    console.log(`[breadcrumb] result ${i + 1}: note="${r.note_title}" breadcrumb="${(r as any).breadcrumb ?? 'MISSING'}"`)
    const text = r.expanded_context ?? r.plaintext
    const heading    = r.chunk_heading ? ` — Section "${r.chunk_heading}"` : ""
    const location   = r.breadcrumb && r.breadcrumb !== r.note_title
      ? ` [${r.breadcrumb}]`
      : ""
    const label   = `[${i + 1}] From "${r.note_title}"${location} (${r.source_type})${heading}:\n${text}`

    if (total + label.length > MAX_CONTEXT_CHARS) break
    chunks.push(label)
    total += label.length
  }

  return chunks.join("\n\n")
}

// ─── Citation filtering ───────────────────────────────────────────────────────
//
// After the model responds, parse which [N] markers actually appear in the
// text and filter sourceTitles/sourceNoteIds to only those indices.
// If the model cited nothing, fall back to returning all sources.

// ─── Citation filtering ───────────────────────────────────────────────────────

function extractCitedIndices(text: string): Set<number> {
  const cited = new Set<number>()
  // Keep 1-based — we'll convert when resolving
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    cited.add(parseInt(match[1], 10))
  }
  return cited
}

function filterSourcesByCitations(
  chunkTitles:  string[],   // parallel to results[], one entry per chunk
  chunkNoteIds: string[],   // parallel to results[], one entry per chunk
  cited:        Set<number>, // 1-based indices from model response
): { titles: string[]; noteIds: string[] } {
  // If model cited nothing, return all unique sources as fallback
  if (cited.size === 0) {
    const seen = new Set<string>()
    const titles: string[] = []
    const noteIds: string[] = []
    for (let i = 0; i < chunkNoteIds.length; i++) {
      if (!seen.has(chunkNoteIds[i])) {
        seen.add(chunkNoteIds[i])
        titles.push(chunkTitles[i])
        noteIds.push(chunkNoteIds[i])
      }
    }
    return { titles, noteIds }
  }

  const seen = new Set<string>()
  const titles: string[] = []
  const noteIds: string[] = []

  for (const oneBased of cited) {
    const i = oneBased - 1 // convert to 0-based chunk index
    if (i < 0 || i >= chunkNoteIds.length) continue // bounds guard
    const noteId = chunkNoteIds[i]
    if (!seen.has(noteId)) {
      seen.add(noteId)
      noteIds.push(noteId)
      titles.push(chunkTitles[i])
    }
  }

  return { titles, noteIds }
}

// ─── Cross-note connection pass ───────────────────────────────────────────────

async function findRelatedNotes(
  answerText:    string,
  citedNoteIds:  Set<string>,
  currentNoteId: string | undefined,
  confidence:    "high" | "medium" | "low",
): Promise<RelatedNote[]> {
  if (confidence === "low") return []

  try {
    // FIX: strip [N] citation markers and truncate before passing to FTS.
    // Raw answer text contains [1], [2] etc. which break FTS5 MATCH syntax.
    const query = answerText
      .replace(/\[\d+\]/g, "")
      .replace(/[*•\-#>`]/g, " ")
      .slice(0, 300)
    if (!query.trim()) return []

    const { results } = await hybridSearch(query, 5, { currentNoteId })
    const seen    = new Set<string>()
    const related: RelatedNote[] = []

    for (const r of results) {
      if (citedNoteIds.has(r.note_id)) continue
      if (r.note_id === currentNoteId)  continue
      if (seen.has(r.note_id))          continue
      if (r.final_score < 0.005)        continue

      seen.add(r.note_id)
      related.push({ title: r.note_title, noteId: r.note_id })
      if (related.length >= 3) break
    }

    return related
  } catch {
    return []
  }
}

// ─── Tier 1 result cards ──────────────────────────────────────────────────────

function buildTier1Cards(results: HybridResult[]): Tier1ResultCard[] {
  return results.map((r) => {
    let confidence: "strong" | "possible" | "weak" = "weak"
    if (r.final_score >= MEDIUM_CONFIDENCE_THRESHOLD) confidence = "strong"
    else if (r.final_score >= 0.05) confidence = "possible"

    return {
      noteId:       r.note_id,
      noteTitle:    r.note_title,
      sourceType:   r.source_type,
      chunkHeading: r.chunk_heading,
      excerpt:      (r.expanded_context ?? r.plaintext).slice(0, 300),
      blockType:    "paragraph",
      confidence,
    }
  })
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

interface PipelineResult {
  excerptBlock:         string
  sourceTitles:         string[]
  sourceNoteIds:        string[]
  usedEmbeddings:       boolean
  confidence:           "high" | "medium" | "low"
  tier1Cards:           Tier1ResultCard[]
  inventoryMode:        boolean
  excludedNoteNotices:  ExcludedTitleMatch[]
}

async function runPipeline(
  query:         string,
  currentNote?:  Note,
  scopeNoteIds?: string[],
): Promise<PipelineResult> {
  const { intent, scope, cleanQuery } = detectIntent(query)

  if (intent === "inventory") {
    const inventoryContext = await buildInventoryContext()
    return {
      excerptBlock:        inventoryContext,
      sourceTitles:        [],
      sourceNoteIds:       [],
      usedEmbeddings:      false,
      confidence:          "high",
      tier1Cards:          [],
      inventoryMode:       true,
      excludedNoteNotices: [],
    }
  }

  const queryVariants = [cleanQuery]
  const topK = intent === "exploration" ? 12 : 8

  let results: HybridResult[] = []
  let usedEmbeddings = false
  let excludedNoteNotices: ExcludedTitleMatch[] = []

  try {
    console.log('[pipeline] scopeNoteIds:', scopeNoteIds)
    console.log('[pipeline] scope from intent:', scope)
    console.log('[pipeline] resolvedScope noteIds:', scopeNoteIds?.length ? scopeNoteIds : 'UNDEFINED — scope filter will not apply')
    const searchResult = await hybridSearch(cleanQuery, topK, {
      currentNoteId: currentNote?.id,
      scope,
      queryVariants,
      noteIds: scopeNoteIds,
    })
    results             = searchResult.results
    usedEmbeddings      = results.some((r) => r.matched_by.includes("semantic"))
    excludedNoteNotices = searchResult.excludedTitleMatches
  } catch { /* retrieval failure — empty results */ }

  if (results.length > 0) {
    results = await expandContext(results)
  }

  // REMOVE this block entirely:
  // const sourceTitles:  string[] = []
  // const sourceNoteIds: string[] = []
  // const seenNoteIds = new Set<string>()
  // for (const r of results) {
  //   if (!seenNoteIds.has(r.note_id)) { ... }
  // }

  // REPLACE with: one entry per chunk, aligned with buildExcerptBlock's [1]..[N] labels
  const chunkTitles  = results.map((r) => r.note_title)
  const chunkNoteIds = results.map((r) => r.note_id)

  const confidence   = results[0]?.confidence ?? "low"
  const excerptBlock = buildExcerptBlock(results)  // labels [1]..[N] by chunk
  const tier1Cards   = buildTier1Cards(results)

  return {
    excerptBlock,
    sourceTitles:  chunkTitles,   // chunk-parallel, not deduplicated yet
    sourceNoteIds: chunkNoteIds,  // chunk-parallel, not deduplicated yet
    usedEmbeddings,
    confidence,
    tier1Cards,
    inventoryMode: false,
    excludedNoteNotices,
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(
  query:        string,
  pipeline:     PipelineResult,
  historyBlock: string,
  currentNote?: Note,
): string {
  const currentNoteBlock = currentNote
    ? `\nContext — currently open note:\nTitle: ${currentNote.title}\n${(currentNote.plaintext ?? "").slice(0, 1500)}`
    : ""

  const excerptSection = pipeline.inventoryMode
    ? pipeline.excerptBlock
    : pipeline.excerptBlock
      ? `[NOTE AND VAULT EXCERPTS]\n${pipeline.excerptBlock}`
      : "(No matching content found in your notes.)"

  return `You are an assistant with access to the user's personal notes vault.
You will be given numbered excerpts [1], [2], [3]... from different notes.
Read ALL excerpts carefully before forming your answer — the relevant information may appear in any excerpt, not just the first ones.
Cite every excerpt you draw from using its number: [1], [2] etc.
Excerpts include a location path (e.g. "Projects / Vitobu / Day 1") — use this to give context about where information lives when it adds clarity.
Synthesise across excerpts when the answer is spread across multiple notes.
If after reading ALL excerpts the information is genuinely absent, say so in one sentence.
Do not say information is unavailable if it appears anywhere in the excerpts, even partially.
${historyBlock ? `[CONVERSATION HISTORY]\n${historyBlock}\n` : ""}
[EXCERPTS FROM YOUR NOTES]
${excerptSection}
${currentNoteBlock ? `[CURRENTLY OPEN NOTE]\nUse this as additional context. Do not cite it with a number — refer to it as "current note" if relevant.\n${currentNoteBlock}\n` : ""}
[QUESTION]
${query}

Answer:`
}

// ─── Streaming chat (primary path) ───────────────────────────────────────────

export async function streamChatWithNotes(
  query:        string,
  _allNotes:    Note[],
  noteId:       string,
  currentNote:  Note | undefined,
  scopeNoteIds: string[] | undefined,
  streaming:    StreamingChatOptions
): Promise<Omit<ChatResult, "answer">> {
  // Tier 1 — no AI key configured
  if (!isAIReady()) {
    const pipeline   = await runPipeline(query, currentNote, scopeNoteIds)
    const tier1Cards = pipeline.tier1Cards

    const summary = tier1Cards.length > 0
      ? `Found ${tier1Cards.length} relevant section${tier1Cards.length > 1 ? "s" : ""} in your notes.`
      : "No matching content found in your notes."

    streaming.onChunk(summary)
    streaming.onDone?.()

    return {
      sourceTitles:        pipeline.sourceTitles,
      sourceNoteIds:       pipeline.sourceNoteIds,
      usedEmbeddings:      pipeline.usedEmbeddings,
      confidence:          pipeline.confidence,
      relatedNotes:        [],
      tier1Results:        tier1Cards,
      excludedNoteNotices: pipeline.excludedNoteNotices,
    }
  }

  // Tier 2 — full AI pipeline
  const [historyBlock, pipeline] = await Promise.all([
    buildHistoryBlock(noteId),
    runPipeline(query, currentNote, scopeNoteIds),
  ])

  const prompt   = buildPrompt(query, pipeline, historyBlock, currentNote)
  const messages: ProviderMessage[] = [{ role: "user", content: prompt }]

  let assembled = ""

  try {
    const result = await callPrimary(messages)
    assembled    = result.text

    streaming.onChunk(assembled)

    await appendAIHistory(noteId, "user",      query)
    await appendAIHistory(noteId, "assistant", assembled)

    const history = await getAIHistory(noteId)
    if (history.length >= 6) {
      const existingRow  = await getConversationSummary(noteId)
      const droppedLines = [
        `User: ${query}`,
        `Assistant: ${assembled.slice(0, 300)}`,
      ].join("\n")
      updateRollingSummary(noteId, droppedLines, existingRow?.summary ?? null)
    }

    streaming.onDone?.()
  } catch (err: unknown) {
    streaming.onError?.(err as AICallError)
  }

  // Cross-note connection pass
  const citedNoteIds = new Set(pipeline.sourceNoteIds)
  const relatedNotes = await findRelatedNotes(
    assembled,
    citedNoteIds,
    currentNote?.id,
    pipeline.confidence,
  )

  // FIX: filter sources to only notes the model actually cited with [N] markers.
  const cited = extractCitedIndices(assembled)
  const { titles, noteIds } = filterSourcesByCitations(
    pipeline.sourceTitles,
    pipeline.sourceNoteIds,
    cited,
  )

  return {
    sourceTitles:        titles,
    sourceNoteIds:       noteIds,
    usedEmbeddings:      pipeline.usedEmbeddings,
    confidence:          pipeline.confidence,
    relatedNotes,
    excludedNoteNotices: pipeline.excludedNoteNotices,
  }
}

// ─── Non-streaming fallback ───────────────────────────────────────────────────

export async function chatWithNotes(
  query:        string,
  _allNotes:    Note[],
  noteId:       string,
  currentNote?: Note,
  scopeNoteIds?: string[]
): Promise<ChatResult> {
  const [historyBlock, pipeline] = await Promise.all([
    buildHistoryBlock(noteId),
    runPipeline(query, currentNote, scopeNoteIds),
  ])

  const prompt = buildPrompt(query, pipeline, historyBlock, currentNote)
  const answer = await promptPrimary(prompt)

  await appendAIHistory(noteId, "user",      query)
  await appendAIHistory(noteId, "assistant", answer)

  const citedNoteIds = new Set(pipeline.sourceNoteIds)
  const relatedNotes = await findRelatedNotes(
    answer,
    citedNoteIds,
    currentNote?.id,
    pipeline.confidence,
  )

  // FIX: filter sources to only notes the model actually cited with [N] markers.
  const cited = extractCitedIndices(answer)
  const { titles, noteIds } = filterSourcesByCitations(
    pipeline.sourceTitles,
    pipeline.sourceNoteIds,
    cited,
  )

  return {
    answer,
    sourceTitles:        titles,
    sourceNoteIds:       noteIds,
    usedEmbeddings:      pipeline.usedEmbeddings,
    confidence:          pipeline.confidence,
    relatedNotes,
    tier1Results:        pipeline.tier1Cards,
    excludedNoteNotices: pipeline.excludedNoteNotices,
  }
}