// src/features/ai/lib/search/hybrid.ts
//
// RAG v3 — Hybrid retrieval: FTS5 + vector + RRF fusion + rerank.
//
// Changes from v2:
//   - Uses v3 chunker output — chunk_heading, source_type on every result
//   - Title chunks included in both FTS5 and vector passes
//   - FTS5 searches plaintext + chunk_heading + note_title_chunks
//   - Vector pass searches embeddings for active model_id
//   - Vector pass skipped gracefully if no embeddings exist
//   - RRF fusion — results in both lists score higher
//   - Scoped pre-filter applied as WHERE clause before both passes
//   - Source type filter wired through
//   - Top-k: 8 for lookup, 12 for exploration (passed in by caller)
//   - Reranker applied after RRF (rerank.ts)
//   - Context expansion via getSurroundingBlocks, chunk_heading prepended
//   - 12,000 char cap on total context

import { getDb }                          from "@/features/notes/db/client"
import { semanticSearch }                 from "@/features/ai/lib/search/semantic"
import { rerank, type RerankInput }       from "@/features/ai/lib/search/rerank"
import { getSurroundingBlocks }           from "@/features/notes/db/queries"
import type { ScopeFilter }               from "@/features/ai/lib/search/intentDetection"

// ─── Config ───────────────────────────────────────────────────────────────────

const RRF_K = 60

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HybridResult {
  block_id:        string
  note_id:         string
  note_title:      string
  plaintext:       string
  chunk_heading:   string | null
  source_type:     string
  rrf_score:       number
  final_score:     number
  boost_applied:   number
  confidence:      import("@/features/ai/lib/search/rerank").ConfidenceLevel
  matched_by:      ("semantic" | "keyword")[]
  expanded_context?: string   // populated by expandContext()
}

export interface HybridSearchOptions {
  topK?:          number
  currentNoteId?: string
  scope?:         ScopeFilter
  queryVariants?: string[]    // from queryExpansion.ts — searched in parallel
}

// ─── Scope WHERE clause builder ───────────────────────────────────────────────
//
// Builds a SQL fragment and parameter list for the scope pre-filter.
// Applied identically to both FTS5 and vector passes.

interface ScopeClause {
  sql:    string      // e.g. " AND nb.source_type = $3 AND nb.block_updated_at > $4"
  params: unknown[]   // values to append to the query params
  offset: number      // next param index after these
}

function buildScopeClause(scope: ScopeFilter, startIdx: number): ScopeClause {
  const parts:  string[]  = []
  const params: unknown[] = []
  let   idx               = startIdx

  if (scope.sourceType) {
    parts.push(`nb.source_type = $${idx++}`)
    params.push(scope.sourceType)
  }

  if (scope.dateRange) {
    parts.push(`nb.block_updated_at >= $${idx++}`)
    params.push(scope.dateRange.after)
  }

  if (scope.tag) {
    parts.push(`n.tags LIKE $${idx++}`)
    params.push(`%${scope.tag}%`)
  }

  if (scope.noteTitle) {
    parts.push(`n.title LIKE $${idx++}`)
    params.push(`%${scope.noteTitle}%`)
  }

  if (scope.folder) {
    // folder is matched against note title prefix (parent folder naming convention)
    parts.push(`n.title LIKE $${idx++}`)
    params.push(`${scope.folder}%`)
  }

  const sql = parts.length > 0 ? " AND " + parts.join(" AND ") : ""
  return { sql, params, offset: idx }
}

// ─── FTS5 pass ────────────────────────────────────────────────────────────────
//
// Searches:
//   - blocks_fts (plaintext + chunk_heading)
//   - note_title_chunks (title-only matches)
//
// Returns top-20 candidates with BM25 rank.
// All query variants are searched and results merged + deduplicated.

interface FtsRow {
  block_id:        string
  note_id:         string
  plaintext:       string
  chunk_heading:   string | null
  source_type:     string
  note_title:      string
  block_updated_at: number
  rank:            number
}

async function ftsPass(
  queries:  string[],
  scope:    ScopeFilter,
  topK:     number,
): Promise<Map<string, { row: FtsRow; rank: number }>> {
  const db      = await getDb()
  const results = new Map<string, { row: FtsRow; rank: number }>()
  let   globalRank = 0

  for (const query of queries) {
    const sanitized = query.trim().replace(/['"*^()]/g, " ").trim() + "*"
    if (!sanitized.replace("*", "").trim()) continue

    const scopeClause = buildScopeClause(scope, 3)

    // Block-level FTS — plaintext + chunk_heading
    try {
      const rows = await db.select<FtsRow[]>(
        `SELECT
           bf.block_id,
           bf.note_id,
           nb.plaintext,
           nb.chunk_heading,
           nb.source_type,
           nb.block_updated_at,
           n.title  AS note_title,
           bf.rank  AS rank
         FROM blocks_fts bf
         JOIN note_blocks nb ON nb.block_id = bf.block_id
         JOIN notes n        ON n.id        = bf.note_id
         WHERE blocks_fts MATCH $1
           AND n.deleted_at IS NULL
           ${scopeClause.sql}
         ORDER BY bf.rank
         LIMIT $2`,
        [sanitized, topK, ...scopeClause.params]
      )

      for (const row of rows) {
        if (!results.has(row.block_id)) {
          results.set(row.block_id, { row, rank: globalRank++ })
        }
      }
    } catch { /* FTS errors non-fatal */ }

    // Title-chunk FTS — searches note_title_chunks
    try {
      const titleRows = await db.select<{
        note_id:   string
        title:     string
        source_type: string
        updated_at: number
      }[]>(
        `SELECT ntc.note_id, ntc.title, ntc.source_type, ntc.updated_at
         FROM note_title_chunks ntc
         JOIN notes n ON n.id = ntc.note_id
         WHERE ntc.title LIKE $1
           AND n.deleted_at IS NULL
         LIMIT $2`,
        [`%${query.replace(/['"*^()]/g, " ").trim()}%`, Math.floor(topK / 2)]
      )

      for (const row of titleRows) {
        const syntheticId = `title:${row.note_id}`
        if (!results.has(syntheticId)) {
          results.set(syntheticId, {
            row: {
              block_id:        syntheticId,
              note_id:         row.note_id,
              plaintext:       row.title,
              chunk_heading:   null,
              source_type:     row.source_type,
              note_title:      row.title,
              block_updated_at: row.updated_at,
              rank:            0,
            },
            rank: globalRank++,
          })
        }
      }
    } catch { /* non-fatal */ }
  }

  return results
}

// ─── Vector pass ──────────────────────────────────────────────────────────────
//
// Embeds the primary query (not variants — one embedding call per search),
// scores against all embeddings for active model_id.
// Skipped gracefully if no embeddings exist or embedding call fails.

async function vectorPass(
  query:  string,
  scope:  ScopeFilter,
  topK:   number,
): Promise<Map<string, { note_id: string; rank: number }>> {
  const results = new Map<string, { note_id: string; rank: number }>()

  try {
    const semanticResults = await semanticSearch(query, topK)
    if (semanticResults.length === 0) return results

    // Apply scope filter post-retrieval if needed
    // (semantic search returns block_id + note_id — we filter by note metadata)
    let filtered = semanticResults

    if (scope.sourceType || scope.dateRange || scope.tag || scope.noteTitle) {
      const db       = await getDb()
      const blockIds = semanticResults.map((r) => r.block_id)
      const bPhs     = blockIds.map((_, i) => `$${i + 1}`).join(", ")

      const blockMeta = await db.select<{
        block_id:    string
        note_id:     string
        source_type: string
        tags:        string | null
        updated_at:  number
        title:       string
      }[]>(
        `SELECT
           nb.block_id,
           nb.note_id,
           nb.source_type,
           n.tags,
           n.updated_at,
           n.title
         FROM note_blocks nb
         JOIN notes n ON n.id = nb.note_id
         WHERE nb.block_id IN (${bPhs})`,
        blockIds
      )

      const metaMap = new Map(blockMeta.map((b) => [b.block_id, b]))

      filtered = semanticResults.filter((r) => {
        const meta = metaMap.get(r.block_id)
        if (!meta) return false
        if (scope.sourceType && meta.source_type !== scope.sourceType) return false
        if (scope.dateRange  && meta.updated_at < scope.dateRange.after) return false
        if (scope.tag        && (!meta.tags || !meta.tags.includes(scope.tag))) return false
        if (scope.noteTitle  && !meta.title.toLowerCase().includes(scope.noteTitle.toLowerCase())) return false
        return true
      })
    }

    filtered.forEach((result, rank) => {
      results.set(result.block_id, { note_id: result.note_id, rank })
    })
  } catch { /* vector pass fails silently — FTS-only fallback */ }

  return results
}

// ─── RRF fusion ───────────────────────────────────────────────────────────────

function rrfFuse(
  ftsResults:    Map<string, { row: FtsRow; rank: number }>,
  vectorResults: Map<string, { note_id: string; rank: number }>,
): Map<string, { score: number; row: FtsRow | null; note_id: string; matchedBy: Set<"semantic" | "keyword"> }> {
  const scores = new Map<string, {
    score:     number
    row:       FtsRow | null
    note_id:   string
    matchedBy: Set<"semantic" | "keyword">
  }>()

  // FTS contributions
  for (const [block_id, { row, rank }] of ftsResults) {
    const prev = scores.get(block_id)
    const contribution = 1 / (RRF_K + rank + 1)
    if (prev) {
      prev.score += contribution
      prev.matchedBy.add("keyword")
    } else {
      scores.set(block_id, {
        score:     contribution,
        row,
        note_id:   row.note_id,
        matchedBy: new Set(["keyword"]),
      })
    }
  }

  // Vector contributions
  for (const [block_id, { note_id, rank }] of vectorResults) {
    const prev       = scores.get(block_id)
    const contribution = 1 / (RRF_K + rank + 1)
    if (prev) {
      prev.score += contribution
      prev.matchedBy.add("semantic")
    } else {
      scores.set(block_id, {
        score:     contribution,
        row:       ftsResults.get(block_id)?.row ?? null,
        note_id,
        matchedBy: new Set(["semantic"]),
      })
    }
  }

  return scores
}

// ─── Block metadata enrichment ────────────────────────────────────────────────
//
// For blocks that came from the vector pass only (no FTS row),
// we need to fetch plaintext, chunk_heading, source_type, note_title.

async function enrichMissingRows(
  scores: Map<string, { score: number; row: FtsRow | null; note_id: string; matchedBy: Set<"semantic" | "keyword"> }>
): Promise<void> {
  const missing = [...scores.entries()].filter(([, v]) => v.row === null)
  if (missing.length === 0) return

  const db       = await getDb()
  const blockIds = missing.map(([id]) => id).filter((id) => !id.startsWith("title:"))
  if (blockIds.length === 0) return

  const phs  = blockIds.map((_, i) => `$${i + 1}`).join(", ")
  const rows = await db.select<FtsRow[]>(
    `SELECT
       nb.block_id,
       nb.note_id,
       nb.plaintext,
       nb.chunk_heading,
       nb.source_type,
       nb.block_updated_at,
       n.title AS note_title,
       0       AS rank
     FROM note_blocks nb
     JOIN notes n ON n.id = nb.note_id
     WHERE nb.block_id IN (${phs})`,
    blockIds
  )

  for (const row of rows) {
    const entry = scores.get(row.block_id)
    if (entry) entry.row = row
  }
}

// ─── Context expansion ────────────────────────────────────────────────────────
//
// For each top result, fetch 2 surrounding blocks.
// Prepend chunk_heading to the expanded context.
// Cap total context at 12,000 chars — trim from bottom of ranked list.

const MAX_CONTEXT_CHARS = 12_000

export async function expandContext(results: HybridResult[]): Promise<HybridResult[]> {
  let totalChars = 0
  const expanded: HybridResult[] = []

  for (const result of results) {
    // Skip title synthetic blocks for expansion
    if (result.block_id.startsWith("title:")) {
      expanded.push(result)
      continue
    }

    try {
      const surrounding = await getSurroundingBlocks(result.block_id, result.note_id, 2)
      const prefix      = result.chunk_heading
        ? `[Section: ${result.chunk_heading}]\n`
        : ""
      const context     = prefix + (surrounding.length > 0
        ? surrounding.join("\n")
        : result.plaintext)

      if (totalChars + context.length > MAX_CONTEXT_CHARS) {
        // Budget exhausted — include original plaintext only if it fits
        if (totalChars + result.plaintext.length <= MAX_CONTEXT_CHARS) {
          totalChars += result.plaintext.length
          expanded.push(result)
        }
        // else skip this result entirely
        continue
      }

      totalChars += context.length
      expanded.push({ ...result, expanded_context: context })
    } catch {
      expanded.push(result)
    }
  }

  return expanded
}

// ─── Main search function ─────────────────────────────────────────────────────

/**
 * Hybrid search: FTS5 + vector + RRF + rerank.
 * Pass scope to apply pre-filters. Pass queryVariants for parallel FTS expansion.
 * Pass currentNoteId to enable current-note and backlink boosts.
 */
export async function hybridSearch(
  query:   string,
  topK:    number = 8,
  options: HybridSearchOptions = {}
): Promise<HybridResult[]> {
  if (!query.trim()) return []

  const {
    currentNoteId,
    scope        = {},
    queryVariants = [query],
  } = options

  // Ensure original query is always included
  const allQueries = [query, ...queryVariants.filter((v) => v !== query)]

  // ── Run FTS and vector passes in parallel ─────────────────────────────────
  const [ftsResults, vectorResults] = await Promise.all([
    ftsPass(allQueries, scope, 20),
    vectorPass(query, scope, 20),
  ])

  // ── RRF fusion ────────────────────────────────────────────────────────────
  const fused = rrfFuse(ftsResults, vectorResults)

  if (fused.size === 0) return []

  // ── Enrich any blocks only found via vector (no FTS row) ──────────────────
  await enrichMissingRows(fused)

  // ── Sort by RRF score, take 2× topK before reranking ─────────────────────
  const sorted = [...fused.entries()]
    .filter(([, v]) => v.row !== null)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK * 2)

  // ── Build rerank inputs ───────────────────────────────────────────────────
  const rerankInputs: RerankInput[] = sorted.map(([block_id, v]) => ({
    block_id,
    note_id:         v.note_id,
    note_title:      v.row!.note_title,
    plaintext:       v.row!.plaintext,
    chunk_heading:   v.row!.chunk_heading ?? null,
    source_type:     v.row!.source_type,
    rrf_score:       v.score,
    block_updated_at: v.row!.block_updated_at,
  }))

  // ── Apply reranker ────────────────────────────────────────────────────────
  const reranked = await rerank(rerankInputs, query, currentNoteId)

  // ── Map to HybridResult, take final topK ──────────────────────────────────
  return reranked.slice(0, topK).map((r) => ({
    block_id:      r.block_id,
    note_id:       r.note_id,
    note_title:    r.note_title,
    plaintext:     r.plaintext,
    chunk_heading: r.chunk_heading,
    source_type:   r.source_type,
    rrf_score:     r.rrf_score,
    final_score:   r.final_score,
    boost_applied: r.boost_applied,
    confidence:    r.confidence,
    matched_by:    [...(fused.get(r.block_id)?.matchedBy ?? new Set<"semantic" | "keyword">())],
  }))
}