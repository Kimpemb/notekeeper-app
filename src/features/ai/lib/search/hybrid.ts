// src/features/ai/lib/search/hybrid.ts
//
// RAG v3 — Hybrid retrieval: FTS5 + vector + RRF fusion + rerank. Feature A: overrideNoteIds.
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

export interface ExcludedTitleMatch {
  note_id:    string
  note_title: string
}

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
  expanded_context?: string
  breadcrumb?:     string
}

export interface HybridSearchOptions {
  topK?:            number
  currentNoteId?:   string
  scope?:           ScopeFilter
  queryVariants?:   string[]
  noteIds?:         string[]
  overrideNoteIds?: string[]
}

export interface HybridSearchResult {
  results:              HybridResult[]
  excludedTitleMatches: ExcludedTitleMatch[]
  lowTermCoverage:      boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUntitledNote(title: string): boolean {
  return /^Untitled(-\d+)?$/i.test(title.trim())
}

// ─── Scope WHERE clause builder ───────────────────────────────────────────────

interface ScopeClause {
  sql:    string
  params: unknown[]
  offset: number
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
    parts.push(`n.title LIKE $${idx++}`)
    params.push(`${scope.folder}%`)
  }
  if (scope.noteIds && scope.noteIds.length > 0) {
    const placeholders = scope.noteIds.map(() => `$${idx++}`).join(", ")
    parts.push(`nb.note_id IN (${placeholders})`)
    params.push(...scope.noteIds)
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
//
// FIX: untitled notes excluded from block FTS unless note_id === currentNoteId.
// Title-chunk FTS already excluded untitled. Now both passes are consistent.

interface FtsRow {
  block_id:         string
  note_id:          string
  plaintext:        string
  chunk_heading:    string | null
  source_type:      string
  note_title:       string
  block_updated_at: number
  rank:             number
  breadcrumb?:      string
  rag_excluded?:    number
}

const FTS_STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','need','dare','ought',
  'used','what','which','who','whom','whose','where','when',
  'why','how','this','that','these','those','it','its','in',
  'on','at','to','for','of','with','by','from','as','into',
  'through','about','than','then','so','if','or','and','but',
  'not','no','nor','yet','both','either','neither','each',
])

// Detects a precise numbered reference like "3.1.5" or "4.2a" (exercise/theorem/
// section numbers). FTS5's tokenizer splits these into separate digit tokens at
// index time, and the OR-joined term filter below already drops bare digits as
// noise — so without this, the only part of the query that actually identifies
// WHICH exercise gets silently discarded, and retrieval falls back to matching
// every exercise in the book. A quoted phrase query against the adjacent digit
// tokens recovers exact matching.
function extractNumericReferencePhrase(query: string): string | null {
  const match = query.match(/\b\d+(?:\.\d+){1,3}[a-z]?\b/i)
  if (!match) return null
  const digits = match[0].replace(/[a-z]$/i, "").split(".")
  if (digits.length < 2) return null
  return `"${digits.join(" ")}"`
}

async function ftsPass(
  queries:               string[],
  scope:                 ScopeFilter,
  topK:                  number,
  currentNoteId?:        string,
  excludedTitleMatches?: Map<string, string>,
  overrideNoteIds?:      string[],
  coverageStats?:        { zeroHitTerms: number; totalTerms: number },
): Promise<Map<string, { row: FtsRow; rank: number }>> {
  const db         = await getDb()
  const results    = new Map<string, { row: FtsRow; rank: number }>()
  let   globalRank = 0
  const _excludedMap = excludedTitleMatches ?? new Map<string, string>()
  const overrideSet  = new Set(overrideNoteIds ?? [])

  for (const query of queries) {
    // AFTER
    const rawTerms = query
      .trim()
      .replace(/['"*^()?!.,;:\[\]\/\\-]/g, " ")   // add / and \ to stripped chars
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) =>
        word.length > 2 &&                          // remove the digit exception — "2" is noise
        !/^\d+$/.test(word) &&                      // pure numbers are never useful FTS terms
        !FTS_STOP_WORDS.has(word.toLowerCase())
      )

    // IDF filtering — drop terms that match too many blocks (noise terms)
    // Runs one lightweight COUNT per term, skipped if only one term remains
    const MAX_DF = 200
    let filteredTerms = rawTerms
    if (rawTerms.length > 1) {
      const termFreqs = await Promise.all(
        rawTerms.map(async (term) => {
          try {
            const rows = await db.select<{ c: number }[]>(
              `SELECT COUNT(*) as c FROM blocks_fts WHERE blocks_fts MATCH $1`,
              [`${term}*`]
            )
            return { term, count: rows[0]?.c ?? 0 }
          } catch {
            return { term, count: Number.MAX_SAFE_INTEGER }
          }
        })
      )
      // Only filter if at least one term survives — never drop all terms
      console.log('[idf]', termFreqs.map(t => `"${t.term}": ${t.count}`).join(', '))
      // Only filter if at least one term survives — never drop all terms
      const surviving = termFreqs.filter((t) => t.count <= MAX_DF)
      if (surviving.length > 0) {
        filteredTerms = surviving.map((t) => t.term)
      }

      // Coverage tracking — terms with zero hits anywhere in the vault are the
      // strongest signal the query's actual subject isn't covered, independent
      // of how many generic filler words happen to match something.
      if (coverageStats) {
        coverageStats.totalTerms   += termFreqs.length
        coverageStats.zeroHitTerms += termFreqs.filter((t) => t.count === 0).length
      }
    }

    const looseTerms = filteredTerms
      .map((word) => `${word}*`)
      .join(" OR ")

    const numericPhrase = extractNumericReferencePhrase(query)
    const sanitized = numericPhrase
      ? (looseTerms ? `(${looseTerms}) AND ${numericPhrase}` : numericPhrase)
      : looseTerms

    console.log('[fts] sanitized:', sanitized)

    if (!sanitized) continue

    // $1 = currentNoteId (for untitled exclusion)
    // scope clause params start at $2

    // Block-level FTS — plaintext + chunk_heading
    // FIX: exclude untitled notes unless they are the currently open note.
    try {
      // When noteIds scope is active, push the filter INSIDE the FTS subquery
// so FTS5 only ranks blocks belonging to the scoped notes.
// Without this, FTS picks the global top-20 first; scoped notes may never appear.
// Full param-safe version:
const hasScopeNoteIds = scope.noteIds && scope.noteIds.length > 0
const scopeNoteIds    = scope.noteIds ?? []

// Build inner filter with params starting at $1
const innerParams: unknown[] = []
let   innerParamIdx = 1
let   innerFilter   = ""
if (hasScopeNoteIds) {
  const phs = scopeNoteIds.map(() => `$${innerParamIdx++}`).join(", ")
  innerFilter = `AND note_id IN (${phs})`
  innerParams.push(...scopeNoteIds)
}

// Outer clause params start after inner params
const outerScopeClause = buildScopeClause(
  { ...scope, noteIds: undefined },   // noteIds handled inside
  innerParamIdx + 1                   // +1 because $innerParamIdx is currentNoteId
)

const rows = await db.select<FtsRow[]>(
  `SELECT
  sub.block_id,
  sub.note_id,
  nb.plaintext,
  nb.chunk_heading,
  nb.source_type,
  nb.block_updated_at,
  n.title  AS note_title,
  sub.fts_rank AS rank,
  COALESCE(e.breadcrumb, ntc.breadcrumb) AS breadcrumb,
  COALESCE(n.rag_excluded, 0)            AS rag_excluded
FROM (
  SELECT block_id, note_id, rank AS fts_rank
  FROM blocks_fts
  WHERE blocks_fts MATCH '${sanitized}'
  ${innerFilter}
  ORDER BY rank
  LIMIT ${topK * 3}
) sub
JOIN note_blocks nb ON nb.block_id = sub.block_id
JOIN notes n        ON n.id        = sub.note_id
LEFT JOIN embeddings e          ON e.block_id  = sub.block_id
LEFT JOIN note_title_chunks ntc ON ntc.note_id = sub.note_id
WHERE n.deleted_at IS NULL
  AND (n.id = $${innerParamIdx} OR n.title NOT LIKE 'Untitled%')
  AND nb.source_type NOT IN ('memory_warm', 'memory_cold')
  ${outerScopeClause.sql}
  LIMIT ${topK}`,
  [...innerParams, currentNoteId ?? "", ...outerScopeClause.params]
)

      for (const row of rows) {
        if (row.rag_excluded === 1 && !overrideSet.has(row.note_id)) continue
        if (!results.has(row.block_id)) {
          results.set(row.block_id, { row, rank: globalRank++ })
        }
      }
    } catch (err) {
      console.warn('[fts] block FTS error:', err)
    }

    // Title-chunk FTS — untitled already excluded here
    try {
      const titleRows = await db.select<{
        note_id:      string
        title:        string
        source_type:  string
        updated_at:   number
        breadcrumb:   string | null
        rag_excluded: number
      }[]>(
        `SELECT ntc.note_id, ntc.title, ntc.source_type, ntc.updated_at, ntc.breadcrumb,
                COALESCE(n.rag_excluded, 0) AS rag_excluded
         FROM note_title_chunks ntc
         JOIN notes n ON n.id = ntc.note_id
         WHERE ntc.title LIKE $1
           AND n.deleted_at IS NULL
         LIMIT $2`,
        [`%${query.replace(/['"*^()]/g, " ").trim()}%`, Math.floor(topK / 2)]
      )

      for (const row of titleRows.filter(
        (r) => r.title && !isUntitledNote(r.title) && (r.rag_excluded !== 1 || overrideSet.has(r.note_id))
      )) {
        const syntheticId = `title:${row.note_id}`
        if (!results.has(syntheticId)) {
          results.set(syntheticId, {
            row: {
              block_id:         syntheticId,
              note_id:          row.note_id,
              plaintext:        row.title,
              chunk_heading:    null,
              source_type:      row.source_type,
              note_title:       row.title,
              block_updated_at: row.updated_at,
              rank:             0,
              breadcrumb:       row.breadcrumb ?? undefined,
            },
            rank: globalRank++,
          })
        }
      }
    } catch { /* non-fatal */ }

    // Excluded title discovery — fetch rag_excluded notes whose title matches
    try {
      const excludedTerms = query
  .replace(/['"*^()]/g, " ")
  .trim()
  .split(/\s+/)
  .filter((t) => t.length > 2 && !FTS_STOP_WORDS.has(t.toLowerCase()))


  console.log('[fts excluded] terms:', excludedTerms, 'query was:', query.slice(0, 60)) // HERE
  
const excludedRows = excludedTerms.length === 0 ? [] : await (async () => {
  const whereClauses = excludedTerms
    .slice(0, 4)
    .map((_, i) => `ntc.title LIKE $${i + 1}`)
    .join(" OR ")
  const params = excludedTerms.slice(0, 4).map((t) => `%${t}%`)

  return db.select<{ note_id: string; title: string }[]>(
    `SELECT ntc.note_id, ntc.title
     FROM note_title_chunks ntc
     JOIN notes n ON n.id = ntc.note_id
     WHERE (${whereClauses})
       AND n.deleted_at IS NULL
       AND COALESCE(n.rag_excluded, 0) = 1
     LIMIT 3`,
    params
  )
})()
      for (const row of excludedRows) {
        if (!isUntitledNote(row.title)) {
          _excludedMap.set(row.note_id, row.title)
        }
      }
      console.log('[fts] excludedTerms:', excludedTerms, 'excludedRows:', excludedRows.length, 'excludedMap size:', _excludedMap.size)
    } catch { /* non-fatal */ }
  }

  return results
}
// ─── Vector pass ──────────────────────────────────────────────────────────────
//
// Embeds the primary query (not variants — one embedding call per search),
// scores against all embeddings for active model_id.
// Skipped gracefully if no embeddings exist or embedding call fails.
//
// FIX: untitled notes excluded unless note_id === currentNoteId.
// When scope filters are active, exclusion uses the metaMap already being built.
// When no scope filters are active, a lightweight title lookup is performed.

async function vectorPass(
  query:          string,
  scope:          ScopeFilter,
  topK:           number,
  currentNoteId?: string,
  overrideSet?:   Set<string>,
  ftsCount?:      number,       // passed to semanticSearch for adaptive threshold
): Promise<Map<string, { note_id: string; rank: number }>> {
  const results      = new Map<string, { note_id: string; rank: number }>()
  const _overrideSet = overrideSet ?? new Set<string>()

  try {
    const semanticResults = await semanticSearch(query, topK, ftsCount ?? 0)
    if (semanticResults.length === 0) return results

    let filtered = semanticResults
    const hasScopeFilters = !!(
      scope.sourceType || scope.dateRange || scope.tag || scope.noteTitle ||
      (scope.noteIds && scope.noteIds.length > 0)
    )

    if (hasScopeFilters) {
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
        rag_excluded: number | null
      }[]>(
        `SELECT
           nb.block_id,
           nb.note_id,
           nb.source_type,
           n.tags,
           n.updated_at,
           n.title,
           n.rag_excluded
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
        if (scope.noteIds && scope.noteIds.length > 0 && !scope.noteIds.includes(meta.note_id)) return false
        if (isUntitledNote(meta.title) && meta.note_id !== currentNoteId) return false
        if (meta.rag_excluded === 1 && !_overrideSet.has(meta.note_id)) return false
        if (meta.source_type === 'memory_warm' || meta.source_type === 'memory_cold') return false
        return true
      })
    } else {
      // No scope filters active — run a lightweight title lookup for untitled exclusion
      const db       = await getDb()
      const blockIds = filtered.map((r) => r.block_id)

      if (blockIds.length > 0) {
        const phs      = blockIds.map((_, i) => `$${i + 1}`).join(", ")
        const titleRows = await db.select<{
          block_id:    string
          title:       string
          note_id:     string
          rag_excluded: number
          source_type: string
        }[]>(
          `SELECT nb.block_id, n.title, n.id AS note_id,
                  COALESCE(n.rag_excluded, 0) AS rag_excluded,
                  nb.source_type
           FROM note_blocks nb
           JOIN notes n ON n.id = nb.note_id
           WHERE nb.block_id IN (${phs})`,
          blockIds
        )
        const titleMap = new Map(titleRows.map((r) => [r.block_id, r]))

        // FIX: exclude untitled notes unless they are the current note
        filtered = filtered.filter((r) => {
          const t = titleMap.get(r.block_id)
          if (!t) return true
          if (isUntitledNote(t.title) && t.note_id !== currentNoteId) return false
          if (t.rag_excluded === 1 && !_overrideSet.has(t.note_id)) return false
          if (t.source_type === 'memory_warm' || t.source_type === 'memory_cold') return false
          return true
        })
      }
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

  for (const [block_id, { row, rank }] of ftsResults) {
    const prev         = scores.get(block_id)
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

  for (const [block_id, { note_id, rank }] of vectorResults) {
    const prev         = scores.get(block_id)
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
       0       AS rank,
       COALESCE(e.breadcrumb, ntc.breadcrumb) AS breadcrumb
     FROM note_blocks nb
     JOIN notes n ON n.id = nb.note_id
     LEFT JOIN embeddings e   ON e.block_id = nb.block_id
     LEFT JOIN note_title_chunks ntc ON ntc.note_id = nb.note_id
     WHERE nb.block_id IN (${phs})`,
    blockIds
  )

  for (const row of rows) {
    const entry = scores.get(row.block_id)
    if (entry) entry.row = row
  }
}

// ─── Context expansion ────────────────────────────────────────────────────────

const MAX_CONTEXT_CHARS = 32_000

export async function expandContext(results: HybridResult[]): Promise<HybridResult[]> {
  let totalChars = 0
  const expanded: HybridResult[] = []

  for (const result of results) {
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
        if (totalChars + result.plaintext.length <= MAX_CONTEXT_CHARS) {
          totalChars += result.plaintext.length
          expanded.push(result)
        }
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

export async function hybridSearch(
  query:   string,
  topK:    number = 8,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult> {
  if (!query.trim()) return { results: [], excludedTitleMatches: [], lowTermCoverage: false }

  const {
    currentNoteId,
    scope         = {},
    queryVariants = [query],
    noteIds,
    overrideNoteIds,
  } = options

  // Merge noteIds into scope if provided
  const resolvedScope = noteIds?.length ? { ...scope, noteIds } : scope
  const allQueries    = [query, ...queryVariants.filter((v) => v !== query)]
  const excludedTitleMatches = new Map<string, string>()
  const overrideSet   = new Set(overrideNoteIds ?? [])

  const coverageStats = { zeroHitTerms: 0, totalTerms: 0 }
  const ftsResults = await ftsPass(
  allQueries, resolvedScope, 20, currentNoteId, excludedTitleMatches, overrideNoteIds, coverageStats
)
const vectorResults = await vectorPass(
  query, resolvedScope, 20, currentNoteId, overrideSet, ftsResults.size
)
const lowTermCoverage = coverageStats.totalTerms > 0
  && (coverageStats.zeroHitTerms / coverageStats.totalTerms) >= 0.5
console.log(`[hybrid] term coverage: ${coverageStats.zeroHitTerms}/${coverageStats.totalTerms} zero-hit — lowTermCoverage=${lowTermCoverage}`)

  console.log(`[hybrid] query="${query.slice(0, 60)}"`)
  console.log(`[hybrid] FTS hits: ${ftsResults.size}  vector hits: ${vectorResults.size}`)

  const fused = rrfFuse(ftsResults, vectorResults)

  const excludedList: ExcludedTitleMatch[] = [...excludedTitleMatches.entries()].map(
    ([note_id, note_title]) => ({ note_id, note_title })
  )

  // Scope filtering is now handled by the noteIds in resolveScope
  // No additional filtering needed here since ftsPass and vectorPass already respect scope.noteIds

  if (fused.size === 0) {
    console.log('[hybrid] fused: 0 results — returning empty')
    return { results: [], excludedTitleMatches: [], lowTermCoverage }
  }

  await enrichMissingRows(fused)

  const sorted = [...fused.entries()]
    .filter(([, v]) => v.row !== null)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK * 2)

  console.log('[hybrid] top RRF scores:',
    sorted.slice(0, 5).map(([, v]) =>
      `${v.score.toFixed(4)} "${v.row?.note_title?.slice(0, 30) ?? '?'}"`
    )
  )

  const rerankInputs: RerankInput[] = sorted.map(([block_id, v]) => ({
    block_id,
    note_id:          v.note_id,
    note_title:       v.row!.note_title,
    plaintext:        v.row!.plaintext,
    chunk_heading:    v.row!.chunk_heading ?? null,
    source_type:      v.row!.source_type,
    rrf_score:        v.score,
    block_updated_at: v.row!.block_updated_at,
  }))

  const reranked = await rerank(rerankInputs, query, currentNoteId)

  console.log('[hybrid] after rerank, top 5:',
    reranked.slice(0, 5).map((r) =>
      `score=${r.final_score.toFixed(4)} conf=${r.confidence} "${r.note_title.slice(0, 30)}"`
    )
  )

  const results = reranked.slice(0, topK).map((r) => ({
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
    breadcrumb:    fused.get(r.block_id)?.row?.breadcrumb ?? undefined,
  }))

  return { results, excludedTitleMatches: excludedList, lowTermCoverage }
}