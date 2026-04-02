// src/features/ai/lib/search/hybrid.ts
//
// Reciprocal Rank Fusion (RRF) over semantic + keyword results.
// Merges two ranked lists into one without needing score normalization.
// Formula: score(d) = Σ 1 / (k + rank(d)) for each list
// k=60 is the standard constant — dampens the impact of very high ranks.

import { semanticSearch, type SemanticResult } from "@/features/ai/lib/search/semantic"
import { keywordSearch,  type KeywordResult }  from "@/features/ai/lib/search/keyword"
import { getDb }                               from "@/features/notes/db/client"

// ─── Config ───────────────────────────────────────────────────────────────────

const RRF_K            = 60     // standard RRF constant
const SEMANTIC_WEIGHT  = 1.0    // relative weight of semantic ranking
const KEYWORD_WEIGHT   = 1.0    // relative weight of keyword ranking

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HybridResult {
  block_id:    string
  note_id:     string
  note_title:  string
  plaintext:   string      // block text — used for context building in chat
  rrf_score:   number      // higher = more relevant
  matched_by:  ("semantic" | "keyword")[]
}

// ─── Block plaintext fetcher ──────────────────────────────────────────────────

async function fetchBlockPlaintexts(
  blockIds: string[]
): Promise<Map<string, string>> {
  if (blockIds.length === 0) return new Map()

  const db  = await getDb()
  const map = new Map<string, string>()

  // Fetch real block plaintexts
  const realIds = blockIds.filter((id) => !id.startsWith("note:"))
  if (realIds.length > 0) {
    const placeholders = realIds.map((_, i) => `$${i + 1}`).join(", ")
    const rows = await db.select<{ block_id: string; plaintext: string }[]>(
      `SELECT block_id, plaintext FROM note_blocks WHERE block_id IN (${placeholders})`,
      realIds
    )
    for (const row of rows) map.set(row.block_id, row.plaintext)
  }

  return map
}

async function fetchNoteTitles(
  noteIds: string[]
): Promise<Map<string, string>> {
  if (noteIds.length === 0) return new Map()

  const db  = await getDb()
  const map = new Map<string, string>()

  const placeholders = noteIds.map((_, i) => `$${i + 1}`).join(", ")
  const rows = await db.select<{ id: string; title: string }[]>(
    `SELECT id, title FROM notes WHERE id IN (${placeholders})`,
    noteIds
  )
  for (const row of rows) map.set(row.id, row.title)
  return map
}

// ─── RRF fusion ───────────────────────────────────────────────────────────────

/**
 * Merge semantic and keyword results using Reciprocal Rank Fusion.
 * Returns up to `topK` results with enriched plaintext and note titles.
 */
export async function hybridSearch(
  query:  string,
  topK:   number = 10
): Promise<HybridResult[]> {
  if (!query.trim()) return []

  // Run both searches in parallel — neither depends on the other
  const [semanticResults, keywordResults] = await Promise.allSettled([
    semanticSearch(query, 15),
    keywordSearch(query, 15),
  ])

  const semantic: SemanticResult[] = semanticResults.status === "fulfilled"
    ? semanticResults.value : []
  const keyword:  KeywordResult[]  = keywordResults.status  === "fulfilled"
    ? keywordResults.value : []

  // ── RRF scoring ───────────────────────────────────────────────────────────
  const scores  = new Map<string, number>()
  const matched = new Map<string, Set<"semantic" | "keyword">>()
  const noteIds = new Map<string, string>()         // block_id → note_id
  const texts   = new Map<string, string>()         // block_id → plaintext

  // Score semantic results
  semantic.forEach((result, rank) => {
    const prev = scores.get(result.block_id) ?? 0
    scores.set(result.block_id, prev + SEMANTIC_WEIGHT * (1 / (RRF_K + rank + 1)))
    if (!matched.has(result.block_id)) matched.set(result.block_id, new Set())
    matched.get(result.block_id)!.add("semantic")
    noteIds.set(result.block_id, result.note_id)
  })

  // Score keyword results
  keyword.forEach((result, rank) => {
    const prev = scores.get(result.block_id) ?? 0
    scores.set(result.block_id, prev + KEYWORD_WEIGHT * (1 / (RRF_K + rank + 1)))
    if (!matched.has(result.block_id)) matched.set(result.block_id, new Set())
    matched.get(result.block_id)!.add("keyword")
    noteIds.set(result.block_id, result.note_id)
    texts.set(result.block_id, result.plaintext)    // keyword results already have plaintext
  })

  // Sort by RRF score descending
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)

  if (ranked.length === 0) return []

  // ── Enrich with plaintext and note titles ─────────────────────────────────
  const allBlockIds  = ranked.map(([id]) => id)
  const allNoteIds   = [...new Set(ranked.map(([id]) => noteIds.get(id)!).filter(Boolean))]

  const [plaintextMap, titleMap] = await Promise.all([
    fetchBlockPlaintexts(allBlockIds),
    fetchNoteTitles(allNoteIds),
  ])

  return ranked.map(([block_id, rrf_score]) => {
    const note_id = noteIds.get(block_id) ?? ""
    return {
      block_id,
      note_id,
      note_title:  titleMap.get(note_id)     ?? "Untitled",
      plaintext:   plaintextMap.get(block_id) ?? texts.get(block_id) ?? "",
      rrf_score,
      matched_by:  [...(matched.get(block_id) ?? [])],
    }
  })
}