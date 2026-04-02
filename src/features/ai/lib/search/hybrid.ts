// src/features/ai/lib/search/hybrid.ts
//
// Reciprocal Rank Fusion (RRF) over semantic + keyword results,
// followed by a metadata re-ranking layer (Phase 3).
//
// RRF formula: score(d) = Σ 1 / (k + rank(d)) for each list
// k=60 is the standard constant — dampens the impact of very high ranks.
//
// Re-ranking boosts (applied after RRF, multiplicative):
//   - Recently edited   updated_at within 7 days → ×1.3
//   - Frequently visited top-visited notes → ×1.0–1.25 (proportional)
//   - Backlinked        connected to current note → ×1.2
//   - Family            current note's parent/children/grandchildren → ×1.15

import { semanticSearch, type SemanticResult } from "@/features/ai/lib/search/semantic"
import { keywordSearch,  type KeywordResult }  from "@/features/ai/lib/search/keyword"
import { getDb }                               from "@/features/notes/db/client"

// ─── Config ───────────────────────────────────────────────────────────────────

const RRF_K            = 60
const SEMANTIC_WEIGHT  = 1.0
const KEYWORD_WEIGHT   = 1.0

// Re-ranking multipliers — all tunable
const BOOST_RECENT     = 1.3    // edited within RECENT_DAYS
const BOOST_BACKLINKED = 1.2    // connected to current note via backlinks
const BOOST_FAMILY     = 1.15   // parent / children / grandchildren of current note
const BOOST_VISITED_MAX = 1.25  // max visit boost (scales proportionally)
const RECENT_DAYS      = 7

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HybridResult {
  block_id:    string
  note_id:     string
  note_title:  string
  plaintext:   string
  rrf_score:   number      // raw RRF score before re-ranking
  final_score: number      // after metadata boosts
  matched_by:  ("semantic" | "keyword")[]
}

export interface HybridSearchOptions {
  topK?:          number
  currentNoteId?: string   // used for backlink + family boost
}

// ─── DB fetchers ──────────────────────────────────────────────────────────────

async function fetchBlockPlaintexts(blockIds: string[]): Promise<Map<string, string>> {
  if (blockIds.length === 0) return new Map()
  const db  = await getDb()
  const map = new Map<string, string>()
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

async function fetchNoteMeta(noteIds: string[]): Promise<Map<string, { title: string; updated_at: number }>> {
  if (noteIds.length === 0) return new Map()
  const db  = await getDb()
  const map = new Map<string, { title: string; updated_at: number }>()
  const placeholders = noteIds.map((_, i) => `$${i + 1}`).join(", ")
  const rows = await db.select<{ id: string; title: string; updated_at: number }[]>(
    `SELECT id, title, updated_at FROM notes WHERE id IN (${placeholders})`,
    noteIds
  )
  for (const row of rows) map.set(row.id, { title: row.title, updated_at: row.updated_at })
  return map
}

// ─── Re-ranking signal fetchers ───────────────────────────────────────────────

/**
 * Returns a map of noteId → visit count for all notes in the result set.
 * Capped at the last 30 days to keep the signal fresh.
 */
async function fetchVisitCounts(noteIds: string[]): Promise<Map<string, number>> {
  if (noteIds.length === 0) return new Map()
  const db      = await getDb()
  const cutoff  = Date.now() - 30 * 24 * 60 * 60 * 1000
  const map     = new Map<string, number>()
  const placeholders = noteIds.map((_, i) => `$${i + 2}`).join(", ")
  const rows = await db.select<{ note_id: string; count: number }[]>(
    `SELECT note_id, COUNT(*) as count
     FROM note_visits
     WHERE visited_at > $1
       AND note_id IN (${placeholders})
     GROUP BY note_id`,
    [cutoff, ...noteIds]
  )
  for (const row of rows) map.set(row.note_id, row.count)
  return map
}

/**
 * Returns the set of note IDs connected to currentNoteId via backlinks
 * (bidirectional — notes that link to it or that it links to).
 */
async function fetchBacklinkedNoteIds(currentNoteId: string): Promise<Set<string>> {
  const db   = await getDb()
  const rows = await db.select<{ source_id: string; target_id: string }[]>(
    `SELECT source_id, target_id FROM backlinks
     WHERE source_id = $1 OR target_id = $1`,
    [currentNoteId]
  )
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.source_id !== currentNoteId) ids.add(row.source_id)
    if (row.target_id !== currentNoteId) ids.add(row.target_id)
  }
  return ids
}

/**
 * Returns the set of note IDs in the family of currentNoteId:
 * parent, children, and grandchildren (depth 2).
 */
async function fetchFamilyNoteIds(currentNoteId: string): Promise<Set<string>> {
  const db  = await getDb()
  const ids = new Set<string>()

  // Get parent
  const parentRows = await db.select<{ parent_id: string | null }[]>(
    `SELECT parent_id FROM notes WHERE id = $1`,
    [currentNoteId]
  )
  const parentId = parentRows[0]?.parent_id
  if (parentId) ids.add(parentId)

  // Get children
  const childRows = await db.select<{ id: string }[]>(
    `SELECT id FROM notes WHERE parent_id = $1 AND deleted_at IS NULL`,
    [currentNoteId]
  )
  const childIds = childRows.map((r) => r.id)
  for (const id of childIds) ids.add(id)

  // Get grandchildren
  if (childIds.length > 0) {
    const placeholders = childIds.map((_, i) => `$${i + 1}`).join(", ")
    const grandRows = await db.select<{ id: string }[]>(
      `SELECT id FROM notes WHERE parent_id IN (${placeholders}) AND deleted_at IS NULL`,
      childIds
    )
    for (const row of grandRows) ids.add(row.id)
  }

  return ids
}

// ─── Re-ranking layer ─────────────────────────────────────────────────────────

interface RerankSignals {
  visitCounts:    Map<string, number>
  backlinkIds:    Set<string>
  familyIds:      Set<string>
  maxVisitCount:  number
}

function applyBoosts(
  noteId:    string,
  rrfScore:  number,
  updatedAt: number,
  signals:   RerankSignals
): number {
  let score = rrfScore

  // ── Recency boost ────────────────────────────────────────────────────────
  const ageMs = Date.now() - updatedAt
  if (ageMs < RECENT_DAYS * 24 * 60 * 60 * 1000) {
    score *= BOOST_RECENT
  }

  // ── Visit boost (proportional to max visits in result set) ───────────────
  const visits = signals.visitCounts.get(noteId) ?? 0
  if (visits > 0 && signals.maxVisitCount > 0) {
    const visitRatio  = visits / signals.maxVisitCount          // 0–1
    const visitBoost  = 1 + (BOOST_VISITED_MAX - 1) * visitRatio
    score *= visitBoost
  }

  // ── Backlink boost ───────────────────────────────────────────────────────
  if (signals.backlinkIds.has(noteId)) {
    score *= BOOST_BACKLINKED
  }

  // ── Family boost ─────────────────────────────────────────────────────────
  if (signals.familyIds.has(noteId)) {
    score *= BOOST_FAMILY
  }

  return score
}

// ─── Main search function ─────────────────────────────────────────────────────

/**
 * Hybrid search: RRF fusion of semantic + keyword results,
 * followed by metadata re-ranking.
 *
 * Pass currentNoteId to enable backlink and family boosting.
 */
export async function hybridSearch(
  query:   string,
  topK:    number = 10,
  options: HybridSearchOptions = {}
): Promise<HybridResult[]> {
  if (!query.trim()) return []

  const { currentNoteId } = options

  // ── Run both searches in parallel ─────────────────────────────────────────
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
  const noteIds = new Map<string, string>()
  const texts   = new Map<string, string>()

  semantic.forEach((result, rank) => {
    const prev = scores.get(result.block_id) ?? 0
    scores.set(result.block_id, prev + SEMANTIC_WEIGHT * (1 / (RRF_K + rank + 1)))
    if (!matched.has(result.block_id)) matched.set(result.block_id, new Set())
    matched.get(result.block_id)!.add("semantic")
    noteIds.set(result.block_id, result.note_id)
  })

  keyword.forEach((result, rank) => {
    const prev = scores.get(result.block_id) ?? 0
    scores.set(result.block_id, prev + KEYWORD_WEIGHT * (1 / (RRF_K + rank + 1)))
    if (!matched.has(result.block_id)) matched.set(result.block_id, new Set())
    matched.get(result.block_id)!.add("keyword")
    noteIds.set(result.block_id, result.note_id)
    texts.set(result.block_id, result.plaintext)
  })

  // Sort by raw RRF score — we re-sort after boosts
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK * 2)   // fetch 2× topK before boosting so boosts can reorder

  if (ranked.length === 0) return []

  // ── Enrich with note metadata ─────────────────────────────────────────────
  const allBlockIds = ranked.map(([id]) => id)
  const allNoteIds  = [...new Set(ranked.map(([id]) => noteIds.get(id)!).filter(Boolean))]

  const [plaintextMap, noteMetaMap] = await Promise.all([
    fetchBlockPlaintexts(allBlockIds),
    fetchNoteMeta(allNoteIds),
  ])

  // ── Fetch re-ranking signals in parallel ──────────────────────────────────
  const [visitCounts, backlinkIds, familyIds] = await Promise.all([
    fetchVisitCounts(allNoteIds),
    currentNoteId ? fetchBacklinkedNoteIds(currentNoteId) : Promise.resolve(new Set<string>()),
    currentNoteId ? fetchFamilyNoteIds(currentNoteId)     : Promise.resolve(new Set<string>()),
  ])

  const maxVisitCount = Math.max(0, ...[...visitCounts.values()])
  const signals: RerankSignals = { visitCounts, backlinkIds, familyIds, maxVisitCount }

  // ── Apply boosts and re-sort ──────────────────────────────────────────────
  const boosted = ranked.map(([block_id, rrf_score]) => {
    const note_id   = noteIds.get(block_id) ?? ""
    const meta      = noteMetaMap.get(note_id)
    const updatedAt = meta?.updated_at ?? 0
    const final_score = applyBoosts(note_id, rrf_score, updatedAt, signals)

    return {
      block_id,
      note_id,
      note_title:  meta?.title          ?? "Untitled",
      plaintext:   plaintextMap.get(block_id) ?? texts.get(block_id) ?? "",
      rrf_score,
      final_score,
      matched_by:  [...(matched.get(block_id) ?? [])],
    }
  })

  // Re-sort by final_score, take topK
  return boosted
    .sort((a, b) => b.final_score - a.final_score)
    .slice(0, topK)
}