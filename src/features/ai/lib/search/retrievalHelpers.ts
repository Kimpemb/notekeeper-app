// Pure helpers for retrieval. No DB or Tauri imports, so they are unit-testable.

const TITLE_SKIP_WORDS = new Set(["the", "and", "for", "from", "with", "of", "in", "on", "to", "a", "an"])

/** "data communications" -> ["data", "communicat"]. Each prefix is matched with LIKE,
 *  so a typo late in a word ("Communicatons") still matches. */
export function titleScopePrefixes(noteTitle: string): string[] {
  const words = noteTitle
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
  const meaningful = words.filter((w) => w.length > 2 && !TITLE_SKIP_WORDS.has(w))
  const source = meaningful.length > 0 ? meaningful : words
  const prefixes = source.map((w) =>
    w.slice(0, Math.min(w.length, Math.max(4, Math.ceil(w.length * 0.7))))
  )
  return [...new Set(prefixes)]
}

const REF_LABELS = [
  "example", "figure", "fig", "table", "section", "exercise", "problem",
  "theorem", "lemma", "definition", "equation", "eq", "chapter", "algorithm", "listing",
]
const REF_RE = new RegExp(
  `\\b(${REF_LABELS.join("|")})\\.?\\s+(\\d+(?:\\.\\d+){1,3}[a-z]?)(?![\\w])`,
  "i"
)

export interface ReferenceLabel { label: string; num: string }

/** "Example 31.1" -> { label: "example", num: "31.1" }; null when the query has no such label. */
export function findReference(query: string): ReferenceLabel | null {
  const m = REF_RE.exec(query)
  if (!m) return null
  let label = m[1].toLowerCase()
  if (label === "fig") label = "figure"
  if (label === "eq") label = "equation"
  return { label, num: m[2].toLowerCase() }
}

const LABEL_SYNONYMS: Record<string, string[]> = {
  figure: ["figure", "fig"],
  equation: ["equation", "eq"],
}

/** True when the text contains the exact reference ("Example 31.1" but not "31.12" or "31.1.2"). */
export function textHasReference(text: string, ref: ReferenceLabel): boolean {
  const labels = LABEL_SYNONYMS[ref.label] ?? [ref.label]
  const num = ref.num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`\\b(?:${labels.join("|")})\\.?\\s+${num}(?![\\d]|\\.\\d)`, "i")
  return re.test(text)
}