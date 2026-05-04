// src/features/ai/lib/search/queryExpansion.ts
//
// RAG v3 — Query expansion via processing model with heuristic fallback.
//
// With processing model available:
//   - Rewrites query into 2-3 alternative phrasings via LLM
//   - 1.5s timeout — falls back to heuristic if exceeded
//
// Heuristic fallback:
//   - Strip stop words
//   - Synonym map for common technical terms
//   - Acronym expansion
//   - Append current note title as context signal
//   - Append active scope label as query signal

// ─── Stop words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "to", "for",
  "of", "and", "or", "but", "not", "with", "this", "that", "are",
  "was", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "can",
  "i", "my", "me", "we", "you", "your", "they", "their", "what",
  "how", "why", "when", "where", "which", "who", "from", "by", "as",
])

// ─── Synonym map ──────────────────────────────────────────────────────────────

const SYNONYM_MAP: Record<string, string[]> = {
  "bug":          ["error", "issue", "defect", "problem"],
  "fix":          ["resolve", "patch", "solution", "repair"],
  "build":        ["create", "develop", "construct", "make"],
  "deploy":       ["release", "ship", "publish", "launch"],
  "performance":  ["speed", "latency", "throughput", "efficiency"],
  "auth":         ["authentication", "login", "authorization", "access"],
  "config":       ["configuration", "settings", "setup", "options"],
  "api":          ["endpoint", "interface", "service", "integration"],
  "db":           ["database", "storage", "persistence", "data"],
  "ui":           ["interface", "frontend", "design", "view"],
  "test":         ["testing", "spec", "validation", "verification"],
  "doc":          ["documentation", "notes", "reference", "guide"],
  "meeting":      ["discussion", "call", "sync", "standup"],
  "goal":         ["objective", "target", "outcome", "aim"],
  "idea":         ["concept", "thought", "proposal", "approach"],
  "problem":      ["issue", "challenge", "obstacle", "blocker"],
  "plan":         ["strategy", "roadmap", "approach", "outline"],
  "result":       ["outcome", "output", "finding", "conclusion"],
  "reason":       ["cause", "explanation", "rationale", "why"],
  "fail":         ["failure", "broken", "error", "crash", "issue"],
}

// ─── Acronym map ──────────────────────────────────────────────────────────────

const ACRONYM_MAP: Record<string, string> = {
  "rag":   "retrieval augmented generation",
  "llm":   "large language model",
  "ai":    "artificial intelligence",
  "ml":    "machine learning",
  "ui":    "user interface",
  "ux":    "user experience",
  "api":   "application programming interface",
  "db":    "database",
  "sql":   "structured query language",
  "fts":   "full text search",
  "rrp":   "reciprocal rank fusion",
  "rrf":   "reciprocal rank fusion",
  "ci":    "continuous integration",
  "cd":    "continuous deployment",
  "pr":    "pull request",
  "mvp":   "minimum viable product",
  "kpi":   "key performance indicator",
  "okr":   "objectives and key results",
  "tbd":   "to be determined",
  "wip":   "work in progress",
}

// ─── Heuristic expansion ──────────────────────────────────────────────────────

export interface ExpansionContext {
  currentNoteTitle?: string
  activeScopeLabel?: string
}

export function heuristicExpand(
  query:   string,
  context: ExpansionContext = {}
): string[] {
  const words   = query.toLowerCase().split(/\s+/).filter(Boolean)
  const content = words.filter((w) => !STOP_WORDS.has(w))

  const variants = new Set<string>()
  variants.add(query)   // always include original

  // Acronym expansion — replace known acronyms with full form
  const expanded = content.map((w) => ACRONYM_MAP[w] ?? w)
  const expandedQuery = expanded.join(" ")
  if (expandedQuery !== query.toLowerCase()) {
    variants.add(expandedQuery)
  }

  // Synonym substitution — for each content word that has synonyms,
  // build one variant using the first synonym
  for (let i = 0; i < content.length; i++) {
    const synonyms = SYNONYM_MAP[content[i]]
    if (synonyms && synonyms.length > 0) {
      const variant = [...content]
      variant[i] = synonyms[0]
      variants.add(variant.join(" "))
      break  // one synonym variant is enough
    }
  }

  // Append current note title as context signal
  if (context.currentNoteTitle) {
    const titleWords = context.currentNoteTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => !STOP_WORDS.has(w) && w.length > 2)
      .slice(0, 3)
    if (titleWords.length > 0) {
      variants.add(`${query} ${titleWords.join(" ")}`)
    }
  }

  // Append active scope label
  if (context.activeScopeLabel) {
    variants.add(`${query} ${context.activeScopeLabel}`)
  }

  return [...variants].slice(0, 3)
}

// ─── LLM expansion ────────────────────────────────────────────────────────────

const EXPANSION_TIMEOUT_MS = 1500

async function llmExpand(query: string): Promise<string[] | null> {
  const {
    promptProcessing,
    ProcessingExhaustedError,    // ← NEW: import sentinel
  } = await import("@/features/ai/lib/client")

  const prompt = `Rewrite this search query into 2-3 alternative phrasings that capture the same intent using different vocabulary. Return ONLY the phrasings, one per line, no numbering, no explanation.

Query: ${query}`

  try {
    const result = await Promise.race([
      promptProcessing(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("expansion timeout")), EXPANSION_TIMEOUT_MS)
      ),
    ])

    const lines = result
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.length < 300)
      .slice(0, 3)

    return lines.length > 0 ? lines : null
  } catch (err) {
    // ProcessingExhaustedError — processing slot is fully exhausted.
    // Fall back to heuristic immediately; don't log as an error.
    if (err instanceof ProcessingExhaustedError) {
      console.info("[queryExpansion] processing slot exhausted — using heuristic fallback")
      return null
    }
    // Timeout or any other model error — also fall back to heuristic.
    return null
  }
}

// ─── Main expander ────────────────────────────────────────────────────────────

/**
 * Expand a query into 2-3 variants for parallel retrieval.
 * Tries the processing model first (1.5s timeout), falls back to heuristic.
 * Always returns the original query as the first element.
 * Never throws — heuristic fallback is always available.
 */
export async function expandQuery(
  query:   string,
  context: ExpansionContext = {}
): Promise<string[]> {
  if (!query.trim()) return [query]

  // Try LLM expansion first
  const llmVariants = await llmExpand(query)

  if (llmVariants && llmVariants.length > 0) {
    // Prepend original, deduplicate
    const all = [query, ...llmVariants]
    return [...new Set(all)].slice(0, 4)
  }

  // Heuristic fallback
  return heuristicExpand(query, context)
}