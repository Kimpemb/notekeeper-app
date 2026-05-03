// src/features/ai/lib/search/rerank.ts
//
// RAG v3 — Metadata boosting, confidence calibration, context expansion.
//
// All 7 boosts from the spec, additive, capped at +40%:
//   1. Recency         block_updated_at within 7 days  → +15%
//   2. Recency (soft)  block_updated_at within 30 days → +8%
//   3. Visit frequency note visited > 5 times          → +10%
//   4. Backlink density note has > 3 backlinks          → +8%
//   5. Current note    block from currently open note  → +20%
//   6. Heading match   query terms in chunk_heading    → +12%
//   7. Title match     query terms in note title       → +15%
//   8. Vault entry     source is vault_entry + project terms → +10%
//
// Confidence calibration:
//   high   — top RRF score > 0.15 AND >= 2 results from different sources > 0.08
//   medium — top score > 0.08 OR >= 3 results above 0.05
//   low    — everything else

import { getDb } from "@/features/notes/db/client"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low"

export interface RerankInput {
  block_id:      string
  note_id:       string
  note_title:    string
  plaintext:     string
  chunk_heading: string | null
  source_type:   string
  rrf_score:     number
  block_updated_at: number
}

export interface RerankResult extends RerankInput {
  final_score:   number
  boost_applied: number   // total additive boost (0–0.40)
  confidence:    ConfidenceLevel
}

// ─── Boost constants ──────────────────────────────────────────────────────────

const BOOST_RECENCY_RECENT  = 0.15   // within 7 days
const BOOST_RECENCY_SOFT    = 0.08   // within 30 days
const BOOST_VISIT_FREQ      = 0.10   // visited > 5 times
const BOOST_BACKLINK        = 0.08   // > 3 backlinks
const BOOST_CURRENT_NOTE    =  0   // block from currently open note
const BOOST_HEADING_MATCH   = 0.12   // query terms in chunk_heading
const BOOST_TITLE_MATCH     = 0.15   // query terms in note title
const BOOST_VAULT_ENTRY     = 0.10   // vault_entry + project terms
const BOOST_CAP             = 0.40   // additive cap

const RECENCY_7D  = 7  * 24 * 60 * 60 * 1000
const RECENCY_30D = 30 * 24 * 60 * 60 * 1000

const PROJECT_TERMS = [
  "project", "task", "milestone", "deadline", "sprint", "roadmap",
  "objective", "goal", "deliverable", "stakeholder", "client",
]

// ─── Signal fetchers ──────────────────────────────────────────────────────────

export async function fetchVisitCountsForRerank(
  noteIds: string[]
): Promise<Map<string, number>> {
  if (noteIds.length === 0) return new Map()
  const db         = await getDb()
  const cutoff     = Date.now() - RECENCY_30D
  const placeholders = noteIds.map((_, i) => `$${i + 2}`).join(", ")
  const rows = await db.select<{ note_id: string; count: number }[]>(
    `SELECT note_id, COUNT(*) as count
     FROM note_visits
     WHERE visited_at > $1
       AND note_id IN (${placeholders})
     GROUP BY note_id`,
    [cutoff, ...noteIds]
  )
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.note_id, row.count)
  return map
}

export async function fetchBacklinkCountsForRerank(
  noteIds: string[]
): Promise<Map<string, number>> {
  if (noteIds.length === 0) return new Map()
  const db           = await getDb()
  const placeholders = noteIds.map((_, i) => `$${i + 1}`).join(", ")
  const rows = await db.select<{ target_id: string; count: number }[]>(
    `SELECT target_id, COUNT(*) as count
     FROM backlinks
     WHERE target_id IN (${placeholders})
     GROUP BY target_id`,
    noteIds
  )
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.target_id, row.count)
  return map
}

// ─── Query term extractor ─────────────────────────────────────────────────────

function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

function termsMatchText(terms: string[], text: string | null): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return terms.some((t) => lower.includes(t))
}

// ─── Single result booster ────────────────────────────────────────────────────

function computeBoost(
  result:        RerankInput,
  queryTerms:    string[],
  currentNoteId: string | undefined,
  visitCounts:   Map<string, number>,
  backlinkCounts: Map<string, number>,
  query:         string,
): number {
  let boost  = 0
  const now  = Date.now()
  const age  = now - result.block_updated_at

  // 1 + 2. Recency
  if (age < RECENCY_7D) {
    boost += BOOST_RECENCY_RECENT
  } else if (age < RECENCY_30D) {
    boost += BOOST_RECENCY_SOFT
  }

  // 3. Visit frequency
  const visits = visitCounts.get(result.note_id) ?? 0
  if (visits > 5) {
    boost += BOOST_VISIT_FREQ
  }

  // 4. Backlink density
  const backlinks = backlinkCounts.get(result.note_id) ?? 0
  if (backlinks > 3) {
    boost += BOOST_BACKLINK
  }

  // 5. Current note
  if (currentNoteId && result.note_id === currentNoteId) {
    boost += BOOST_CURRENT_NOTE
  }

  // 6. Heading match
  if (termsMatchText(queryTerms, result.chunk_heading)) {
    boost += BOOST_HEADING_MATCH
  }

  // 7. Title match
  if (termsMatchText(queryTerms, result.note_title)) {
    boost += BOOST_TITLE_MATCH
  }

  // 8. Vault entry + project terms
  if (
    result.source_type === "vault_entry" &&
    PROJECT_TERMS.some((t) => query.toLowerCase().includes(t))
  ) {
    boost += BOOST_VAULT_ENTRY
  }

  // 9. Penalise untitled notes — likely empty or placeholder
  if (/^Untitled(-\d+)?$/i.test(result.note_title.trim())) {
    boost -= 0.30
  }

  // Additive cap
  return Math.min(boost, BOOST_CAP)
}

// ─── Confidence calibration ───────────────────────────────────────────────────

export function calibrateConfidence(results: RerankResult[]): ConfidenceLevel {
  if (results.length === 0) return "low"

  const topScore = results[0].rrf_score

  // High: top result clearly above noise + multiple corroborating results
  const aboveHigh = results.filter((r) => r.rrf_score > 0.013)
  const uniqueHigh = new Set(aboveHigh.map((r) => r.note_id))
  if (topScore > 0.015 && uniqueHigh.size >= 2) return "high"

  // Medium: something meaningfully retrieved
  const aboveMedium = results.filter((r) => r.rrf_score > 0.010)
  if (topScore > 0.013 || aboveMedium.length >= 3) return "medium"

  return "low"
}

// ─── Main reranker ────────────────────────────────────────────────────────────

/**
 * Apply metadata boosts to a list of RRF-scored results.
 * Returns results sorted by final_score descending.
 * Confidence is computed from the raw RRF scores, not the boosted scores,
 * to avoid inflating confidence via metadata.
 */
export async function rerank(
  results:       RerankInput[],
  query:         string,
  currentNoteId?: string,
): Promise<RerankResult[]> {
  if (results.length === 0) return []

  const noteIds      = [...new Set(results.map((r) => r.note_id))]
  const queryTerms   = extractQueryTerms(query)

  const [visitCounts, backlinkCounts] = await Promise.all([
    fetchVisitCountsForRerank(noteIds),
    fetchBacklinkCountsForRerank(noteIds),
  ])

  const boosted: RerankResult[] = results.map((result) => {
    const boost = computeBoost(
      result,
      queryTerms,
      currentNoteId,
      visitCounts,
      backlinkCounts,
      query,
    )
    return {
      ...result,
      final_score:   result.rrf_score * (1 + boost),
      boost_applied: boost,
      confidence:    "low",   // placeholder — set below after sorting
    }
  })

  boosted.sort((a, b) => b.final_score - a.final_score)

  // Calibrate confidence from raw RRF scores
  const confidence = calibrateConfidence(boosted)

  // Apply same confidence level to all results — caller uses the top-level value
  return boosted.map((r) => ({ ...r, confidence }))
}