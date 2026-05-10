// src/features/ai/lib/search/intentDetection.ts
//
// RAG v3 — Query intent classifier and scoped search parser.
//
// Four intent types:
//   inventory   — "what notes do you have", "what do you know about"
//   lookup      — "what is", "how does", "define", "explain" (default)
//   exploration — "what have I written about", "summarise my thoughts"
//   scoped      — "in my [tag] notes", "from last week", "in [note title]"
//
// Scoped queries are parsed for:
//   - source_type filter  ("in my vault entries", "notes only")
//   - date range filter   ("last week", "this month", "last 30 days")
//   - tag filter          ("in my #work notes", "tagged productivity")
//   - note title filter   ("in the RAG postmortem note")
//   - folder filter       ("in my Work folder")

export type QueryIntent = "inventory" | "lookup" | "exploration" | "scoped"

export type SourceTypeFilter = "note" | "vault_entry" | null

export interface DateRangeFilter {
  after: number   // Unix ms — block_updated_at must be >= this
}

export interface ScopeFilter {
  sourceType?: string
  dateRange?:  { after: number }
  tag?:        string
  noteTitle?:  string
  folder?:     string
  noteIds?:    string[]
}

export interface DetectedIntent {
  intent:      QueryIntent
  scope:       ScopeFilter
  cleanQuery:  string   // query with scope phrases stripped for cleaner expansion
}

// ─── Intent pattern maps ──────────────────────────────────────────────────────

const INVENTORY_PATTERNS = [
  /what notes (do you have|can you access|exist)/i,
  /what (do you know|have you indexed|can you see)/i,
  /list (my|all) notes/i,
  /do I have (any )?notes (about|on)/i,
  /what('s| is) in my (vault|notes)/i,
  /show me (all|my) notes/i,
  /how many notes/i,
]

const EXPLORATION_PATTERNS = [
  /what have I (written|said|noted|thought) (about|on)/i,
  /summari[sz]e my (thoughts|notes|writing) (on|about)/i,
  /how does .+ connect to/i,
  /what patterns/i,
  /across (my )?notes/i,
  /throughout (my )?notes/i,
  /overview of (my|everything)/i,
  /recap (of|everything)/i,
]

// ─── Scope pattern maps ───────────────────────────────────────────────────────

// Source type
const VAULT_ENTRY_PATTERNS = [
  /in (my )?vault entries/i,
  /from (my )?vault/i,
  /vault entry/i,
  /vault only/i,
]

const NOTE_ONLY_PATTERNS = [
  /in (my )?notes only/i,
  /notes only/i,
  /from (my )?notes/i,
]

// Date ranges
const DATE_PATTERNS: Array<{ pattern: RegExp; daysBack: number }> = [
  { pattern: /this week|last 7 days/i,    daysBack: 7   },
  { pattern: /last week/i,                daysBack: 14  },
  { pattern: /this month|last 30 days/i,  daysBack: 30  },
  { pattern: /last month/i,               daysBack: 60  },
  { pattern: /last 3 months/i,            daysBack: 90  },
  { pattern: /this year/i,                daysBack: 365 },
  { pattern: /yesterday/i,                daysBack: 2   },
  { pattern: /today/i,                    daysBack: 1   },
  { pattern: /recent(ly)?/i,              daysBack: 30  },
]

// Tag: "in my #work notes", "tagged work", "with tag productivity"
const TAG_PATTERN = /(?:in my #(\w[\w-]*) notes?|tagged? (\w[\w-]*)|with tag (\w[\w-]*))/i

// Note title: "in the [title] note", "in [title]"
const NOTE_TITLE_PATTERN = /in (?:the )?["']?([^"']+?)["']? note/i

// Folder: "in my [folder] folder", "in [folder]"
const FOLDER_PATTERN = /in (?:my )?([^,]+?) folder/i

// ─── Scope stripper ───────────────────────────────────────────────────────────
//
// Removes scope phrases from the query so the cleaned version is used for
// embedding and expansion without the noise of "in my vault entries last week".

const SCOPE_STRIP_PATTERNS = [
  /in (my )?(vault entries?|notes? only|vault only|notes? only)/gi,
  /from (my )?(vault|notes?)/gi,
  /in (?:the )?["']?[^"']+?["']? note/gi,
  /in (?:my )?[^,]+? folder/gi,
  /tagged? \w[\w-]*/gi,
  /with tag \w[\w-]*/gi,
  /in my #\w[\w-]* notes?/gi,
  /this week|last 7 days|last week|this month|last 30 days|last month|last 3 months|this year|yesterday|today|recently?/gi,
]

function stripScopePhrases(query: string): string {
  let cleaned = query
  for (const pattern of SCOPE_STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ")
  }
  return cleaned.replace(/\s+/g, " ").trim()
}

// ─── Main detector ────────────────────────────────────────────────────────────

export function detectIntent(query: string): DetectedIntent {
  const q = query.trim()

  // ── Check inventory first — highest priority ──────────────────────────────
  if (INVENTORY_PATTERNS.some((p) => p.test(q))) {
    return {
      intent:     "inventory",
      scope:      {},
      cleanQuery: q,
    }
  }

  // ── Parse scope regardless of intent ─────────────────────────────────────
  const scope: ScopeFilter = {}
  let hasScopeSignal = false

  // Source type
  if (VAULT_ENTRY_PATTERNS.some((p) => p.test(q))) {
    scope.sourceType = "vault_entry"
    hasScopeSignal   = true
  } else if (NOTE_ONLY_PATTERNS.some((p) => p.test(q))) {
    scope.sourceType = "note"
    hasScopeSignal   = true
  }

  // Date range — use the most specific match (shortest daysBack wins on tie)
  for (const { pattern, daysBack } of DATE_PATTERNS) {
    if (pattern.test(q)) {
      const after = Date.now() - daysBack * 24 * 60 * 60 * 1000
      if (!scope.dateRange || daysBack < (Date.now() - scope.dateRange.after) / (24 * 60 * 60 * 1000)) {
        scope.dateRange  = { after }
        hasScopeSignal   = true
      }
      break
    }
  }

  // Tag
  const tagMatch = TAG_PATTERN.exec(q)
  if (tagMatch) {
    scope.tag      = (tagMatch[1] ?? tagMatch[2] ?? tagMatch[3]).toLowerCase()
    hasScopeSignal = true
  }

  // Note title
  const noteTitleMatch = NOTE_TITLE_PATTERN.exec(q)
  if (noteTitleMatch) {
    scope.noteTitle = noteTitleMatch[1].trim()
    hasScopeSignal  = true
  }

  // Folder
  const folderMatch = FOLDER_PATTERN.exec(q)
  if (folderMatch && !noteTitleMatch) {
    scope.folder   = folderMatch[1].trim()
    hasScopeSignal = true
  }

  const cleanQuery = stripScopePhrases(q) || q

  // ── Scoped intent — scope phrases detected ────────────────────────────────
  if (hasScopeSignal) {
    return { intent: "scoped", scope, cleanQuery }
  }

  // ── Exploration ───────────────────────────────────────────────────────────
  if (EXPLORATION_PATTERNS.some((p) => p.test(q))) {
    return { intent: "exploration", scope: {}, cleanQuery: q }
  }

  // ── Default: lookup ───────────────────────────────────────────────────────
  return { intent: "lookup", scope: {}, cleanQuery: q }
}