// src/features/ai/lib/search/keyword.ts
//
// Keyword search over the FTS5 tables.
// Searches both notes_fts (note-level) and blocks_fts (block-level).
// Returns results with BM25 scores that SQLite computes natively.

import { getDb } from "@/features/notes/db/client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KeywordResult {
  block_id:  string        // actual block_id from note_blocks, or synthetic for note-level hits
  note_id:   string
  plaintext: string        // matched text — used for context building
  score:     number        // BM25 rank from SQLite (negative — closer to 0 = better)
  source:    "block" | "note"
}

// ─── Sanitizer ────────────────────────────────────────────────────────────────

/**
 * Sanitize query for FTS5 MATCH syntax.
 * Strips chars that break FTS5, appends * for prefix matching.
 */
function sanitizeFts(query: string): string {
  return query.trim().replace(/['"*^()]/g, " ").trim() + "*"
}

// ─── Main search function ─────────────────────────────────────────────────────

/**
 * Search FTS5 indexes for the query.
 * Searches blocks_fts first (more granular), then notes_fts as fallback.
 * Deduplicates by note_id so one note doesn't dominate results.
 */
export async function keywordSearch(
  query:  string,
  topK:   number = 15
): Promise<KeywordResult[]> {
  if (!query.trim()) return []

  const db        = await getDb()
  const sanitized = sanitizeFts(query)
  const results:  KeywordResult[] = []
  const seenNotes = new Set<string>()

  // ── Block-level FTS search ─────────────────────────────────────────────
  // blocks_fts is more granular — matches at the paragraph level.
  // This is the preferred result type since we embed at block level too.
  try {
    const blockRows = await db.select<{
      block_id: string
      note_id:  string
      plaintext: string
      rank:     number
    }[]>(
      `SELECT
         bf.block_id,
         bf.note_id,
         bf.plaintext,
         rank
       FROM blocks_fts bf
       WHERE blocks_fts MATCH $1
       ORDER BY rank
       LIMIT $2`,
      [sanitized, topK]
    )

    for (const row of blockRows) {
      results.push({
        block_id:  row.block_id,
        note_id:   row.note_id,
        plaintext: row.plaintext,
        score:     row.rank,
        source:    "block",
      })
      seenNotes.add(row.note_id)
    }
  } catch {
    // FTS errors are non-fatal — continue to note-level search
  }

  // ── Note-level FTS search ──────────────────────────────────────────────
  // Catches notes whose title matches but body blocks don't.
  // Only adds notes not already represented by block hits.
  try {
    const noteRows = await db.select<{
      id:       string
      plaintext: string
      rank:     number
    }[]>(
      `SELECT
         n.id,
         n.plaintext,
         rank
       FROM notes_fts f
       JOIN notes n ON n.id = f.id
       WHERE notes_fts MATCH $1
         AND n.deleted_at IS NULL
       ORDER BY rank
       LIMIT $2`,
      [sanitized, topK]
    )

    for (const row of noteRows) {
      if (seenNotes.has(row.id)) continue   // already have block-level hits for this note

      // Use a synthetic block_id for note-level hits — prefixed so
      // the context builder knows to fetch the full note plaintext
      results.push({
        block_id:  `note:${row.id}`,
        note_id:   row.id,
        plaintext: row.plaintext.slice(0, 500),
        score:     row.rank,
        source:    "note",
      })
    }
  } catch {
    // Non-fatal
  }

  return results.slice(0, topK)
}