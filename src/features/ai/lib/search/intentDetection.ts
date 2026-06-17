// src/features/ai/lib/search/intentDetection.ts
//
// RAG v3 — Query intent classifier and scoped search parser.
// Intent detection is now AI-first via promptProcessing, with a regex
// fallback when the processing slot is exhausted.

import { promptProcessing, ProcessingExhaustedError } from "@/features/ai/lib/client"

export type QueryIntent = "inventory" | "lookup" | "exploration" | "scoped" | "edit" | "hybrid"
export type SourceTypeFilter = "note" | "vault_entry" | null

export interface DateRangeFilter {
  after: number
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
  cleanQuery:  string
  isDeixis:    boolean
  isPersonal:  boolean
  isFollowUp:  boolean
}

// ─── Fallback regex (processing slot exhausted) ───────────────────────────────

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
  /how (should|do) (i|we) (organize|structure|set up|arrange)/i,
  /into what (folders|categories|sections)/i,
  /suggest.*(folder|structure|organiz)/i,
  /best (way|approach) to (organize|structure)/i,
  /what (folders|sections|categories) (should|would)/i,
]

const EDIT_PATTERNS = [
  /^change\s+(the|that|this)\s+/i,
  /^update\s+(the|that|this)\s+\w+/i,
  /^remove\s+(the|that|this)\s+\w+/i,
  /^delete\s+(the|that|this)\s+\w+/i,
  /^rewrite\s+(the|that|this)\s+\w+/i,
  /^rename\s+\S+\s+to\s+\S+/i,
  /^replace\s+(the|that|this)\s+.+?\s+with\s+/i,
  /^move\s+(the|that|this)\s+\w+/i,
  /^add\s+(the|that|this)\s+\w+/i,
  /^set\s+(the|that|this)\s+\w+\s+to\s+/i,
  /^swap\s+(the|that|this)\s+/i,
  /\b(the|that|this)\s+\w+\s+should\s+be\s+\w+/i,
  /\b(the|that|this)\s+\w+\s+is\s+(actually|now)\s+/i,
  /\bwas\s+supposed\s+to\s+be\b/i,
  /^use\s+.+?\s+instead\s+of\s+/i,
]

const ARTIFACT_REFS = /\b(the table|that table|the list|that list|the schedule|the timetable|that schedule|the row|that row|this row|the entry|that entry|the cell|that cell|the column|that column|the value|that value|the number|that number|the date|that date|the time|that time|the item|that item|the line|that line|the last (row|entry|item|value|line))\b/i

const HYBRID_PATTERNS = [
  /based on (my notes|what you found|the results)/i,
  /using (my notes|what you retrieved|the notes)/i,
  /from (my notes|the vault),?\s+(rewrite|update|edit|change)/i,
  /taking (my notes|that) into account/i,
]

const DEIXIS_PATTERNS = /\b(this note|the current note|this page|my current note|summarize this|summarise this|what is this|what's this|what is this about|what's this about|what does this|explain this|key points from this|main ideas here|tldr|tl;dr)\b/i

const PERSONAL_PATTERNS = /\b(my|i|i'm|i've|i have|i wrote|i said|i asked|i want|we|our)\b/i

const FOLLOWUP_PATTERNS = /\b(are you sure|is that correct|is that right|was that correct|cross.?check|double.?check|verify (that|what|those|this)|check (that|those|the figures?|the numbers?)|fact.?check|are those (correct|right|accurate)|are these (correct|right|accurate)|is that accurate|are you certain|can you confirm that|does that (sound|seem) right)\b/i

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

const TAG_PATTERN        = /(?:in my #(\w[\w-]*) notes?|tagged? (\w[\w-]*)|with tag (\w[\w-]*))/i
const NOTE_TITLE_PATTERN = /in (?:the )?["']?([^"']+?)["']? note/i
const FOLDER_PATTERN     = /in (?:my )?([^,]+?) folder/i

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

export function detectIntentFallback(query: string): DetectedIntent {
  const q = query.trim()

  if (INVENTORY_PATTERNS.some((p) => p.test(q))) {
    return { intent: "inventory", scope: {}, cleanQuery: q, isDeixis: false, isPersonal: true, isFollowUp: false }
  }

  if (FOLLOWUP_PATTERNS.test(q)) {
    return { intent: "hybrid", scope: {}, cleanQuery: q, isDeixis: false, isPersonal: false, isFollowUp: true }
  }

  if (HYBRID_PATTERNS.some((p) => p.test(q))) {
    return { intent: "hybrid", scope: {}, cleanQuery: q, isDeixis: false, isPersonal: true, isFollowUp: false }
  }

  const isEditPattern  = EDIT_PATTERNS.some((p) => p.test(q))
  const hasArtifactRef = ARTIFACT_REFS.test(q)
  if (isEditPattern && hasArtifactRef) {
    return { intent: "edit", scope: {}, cleanQuery: q, isDeixis: false, isPersonal: false, isFollowUp: false }
  }

  const scope: ScopeFilter = {}
  let hasScopeSignal = false

  if (/in (my )?(vault entries?|vault only)/i.test(q)) {
    scope.sourceType = "vault_entry"; hasScopeSignal = true
  } else if (/in (my )?notes? only|notes? only/i.test(q)) {
    scope.sourceType = "note"; hasScopeSignal = true
  }

  for (const { pattern, daysBack } of DATE_PATTERNS) {
    if (pattern.test(q)) {
      scope.dateRange = { after: Date.now() - daysBack * 24 * 60 * 60 * 1000 }
      hasScopeSignal  = true
      break
    }
  }

  const tagMatch = TAG_PATTERN.exec(q)
  if (tagMatch) { scope.tag = (tagMatch[1] ?? tagMatch[2] ?? tagMatch[3]).toLowerCase(); hasScopeSignal = true }

  const noteTitleMatch = NOTE_TITLE_PATTERN.exec(q)
  if (noteTitleMatch) { scope.noteTitle = noteTitleMatch[1].trim(); hasScopeSignal = true }

  const folderMatch = FOLDER_PATTERN.exec(q)
  if (folderMatch && !noteTitleMatch) { scope.folder = folderMatch[1].trim(); hasScopeSignal = true }

  const cleanQuery  = stripScopePhrases(q) || q
  const isDeixis    = DEIXIS_PATTERNS.test(q)
  const isPersonal  = PERSONAL_PATTERNS.test(q)

  if (hasScopeSignal) return { intent: "scoped",      scope, cleanQuery, isDeixis, isPersonal, isFollowUp: false }
  if (EXPLORATION_PATTERNS.some((p) => p.test(q))) return { intent: "exploration", scope: {}, cleanQuery: q, isDeixis, isPersonal, isFollowUp: false }
  return { intent: "lookup", scope: {}, cleanQuery, isDeixis, isPersonal, isFollowUp: false }
}

// ─── AI-first intent detection ────────────────────────────────────────────────

const INTENT_PROMPT = (query: string) => `You are an intent classifier for a personal notes assistant. Classify the user query below.

Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Fields:
- intent: one of "inventory" | "lookup" | "exploration" | "scoped" | "edit" | "hybrid"
- isDeixis: true if the query refers to the currently open note ("this note", "summarize this", "what's on this page", "explain this") — false otherwise
- isPersonal: true if the query is about the user's own content ("what did I write", "my notes on X", "do I have anything about") — false for general knowledge questions
- isFollowUp: true if the query is verifying, cross-checking, or challenging something already said in the conversation ("are you sure", "cross check that", "is that correct", "verify those figures", "double check that", "fact check this") — false otherwise
- cleanQuery: the query with any scope phrases (date ranges, folder names, tag filters) stripped out
- scope: object with optional fields: sourceType ("note"|"vault_entry"), dateRange ({after: unixMs}), tag (string), noteTitle (string), folder (string)

Intent definitions:
- inventory: asking what notes exist ("what notes do you have", "how many notes", "what's in my vault")
- exploration: asking about the user's own writing patterns across notes ("what have I written about X", "summarise my thoughts on Y")
- scoped: query explicitly scoped to a date range, tag, folder, or note title
- edit: instruction to modify something visible in the conversation ("change the table to 3pm", "update that row")
- hybrid: references both vault content and wants transformation ("based on my notes, rewrite the schedule")
- lookup: everything else — default
- hybrid: also use for follow-up verification queries ("are you sure", "is that correct", "cross check that", "verify what you said") — these need both history and vault context

Important:
- "what did I write about X" is exploration + isPersonal:true, NOT isDeixis
- "summarize this note" or "what's in the current note" is isDeixis:true
- "how does climate change work" is lookup + isPersonal:false
// after
- "what do I have on vitobu" is exploration + isPersonal:true
- "are you sure those figures are correct" or "cross check what you just said" is hybrid + isPersonal:false + isFollowUp:true
- "cross check if what I have in my notes are factually sound" mid-conversation about a specific topic is hybrid + isFollowUp:true
- "how many people did king leopold kill" is lookup + isPersonal:false — historical public figures are never personal
- "heard jamie foxx almost died, what happened" is lookup + isPersonal:false — celebrity news is never personal
- "how does climate change work" is lookup + isPersonal:false — no first-person pronoun means not personal

Query: ${JSON.stringify(query)}

JSON:`

export async function detectIntent(query: string): Promise<DetectedIntent> {
  try {
    const raw  = await promptProcessing(INTENT_PROMPT(query))
    const clean = raw.replace(/```json|```/g, "").trim()
// after
    const parsed = JSON.parse(clean)

    console.log('[intentDetection] AI classifier result:', {
      intent:     parsed.intent,
      isFollowUp: parsed.isFollowUp,
      isDeixis:   parsed.isDeixis,
      isPersonal: parsed.isPersonal,
    })

    // Validate shape — fall back if malformed
    const validIntents = ["inventory", "lookup", "exploration", "scoped", "edit", "hybrid"]
    if (!validIntents.includes(parsed.intent)) throw new Error("invalid intent")

    return {
      intent:     parsed.intent     as QueryIntent,
      isDeixis:   Boolean(parsed.isDeixis),
      isPersonal: Boolean(parsed.isPersonal),
      isFollowUp: Boolean(parsed.isFollowUp),
      cleanQuery: typeof parsed.cleanQuery === "string" ? parsed.cleanQuery : query,
      scope:      parsed.scope && typeof parsed.scope === "object" ? parsed.scope : {},
    }
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      console.info("[intentDetection] processing exhausted — using fallback")
    } else {
      console.warn("[intentDetection] AI classification failed — using fallback:", err)
    }
    return detectIntentFallback(query)
  }
}