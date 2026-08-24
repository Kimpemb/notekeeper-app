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
  isDirectReply?:      boolean
  // Which earlier turn isDirectReply is resolving against — "assistant_question"
  // when replying to something the assistant just asked/offered, "user_posed_choice"
  // when resolving a choice the USER themselves raised in an earlier turn (e.g.
  // "1, renaissance" answering their own earlier "Renaissance or Baroque?").
  // null when isDirectReply is false. See design-spec-context-aware-intent-classifier.md §2.2.
  directReplySource?: "assistant_question" | "user_posed_choice" | null
}

// A short reply that directly answers a question the assistant itself just
// asked ("do you want (1) or (2)?" → "1, fitness-survival") has almost no
// standalone semantic signal of its own — it's not a new independent query.
// Heuristic only: catches the common case (short reply directly after an
// assistant question/offer), not every elliptical reference. Moved here
// (originally in chat.ts as isLikelyDirectReplyToAssistant) so detectIntent
// can compute isDirectReply itself instead of every call site re-deriving it.
// Kept as a minimal structural type (not chat.ts's ChatMessage) to avoid a
// circular import between chat.ts and intentDetection.ts.
export interface ConversationMessage {
  role:    "user" | "assistant"
  content: string
}

export function isLikelyDirectReplyToAssistant(
  query:            string,
  sessionMessages?: ConversationMessage[],
): boolean {
  if (!sessionMessages || sessionMessages.length === 0) return false
  const last = sessionMessages[sessionMessages.length - 1]
  if (!last || last.role !== "assistant") return false

  const lastAssistantAsksOrOffers =
    /\?\s*$/.test(last.content.trim()) ||
    /\b(let me know|which would you prefer|want me to|should i|do you want)\b/i.test(last.content)
  if (!lastAssistantAsksOrOffers) return false

  const wordCount = query.trim().split(/\s+/).filter(Boolean).length
  return wordCount <= 15
}

// Companion heuristic to isLikelyDirectReplyToAssistant — catches the shape
// that heuristic structurally cannot: a choice the USER THEMSELVES posed in
// an earlier turn (not the assistant's most recent message), which the
// current short reply is now resolving (e.g. "1, renaissance" answering the
// user's own earlier "Renaissance or Baroque?"). See v6 handoff §3.4 — this
// is the exact shape that fell through every prior safety net. Used only by
// detectIntentFallback (the AI path judges this directly from real context —
// see buildIntentContextBlock / INTENT_PROMPT below).
const EITHER_OR_QUESTION_PATTERN = /\bor\b[^?]*\?\s*$/i

function isLikelyUserPosedChoiceReply(
  query:            string,
  sessionMessages?: ConversationMessage[],
): boolean {
  if (!sessionMessages || sessionMessages.length === 0) return false

  const priorUserTurns = sessionMessages.filter((m) => m.role === "user")
  const posedChoice     = priorUserTurns.some((m) => EITHER_OR_QUESTION_PATTERN.test(m.content.trim()))
  if (!posedChoice) return false

  const trimmed           = query.trim()
  const wordCount          = trimmed.split(/\s+/).filter(Boolean).length
  const looksLikeSelection = /^\d+\b/.test(trimmed) || wordCount <= 6
  return looksLikeSelection
}

// ─── Recent-context block for the AI classifier ───────────────────────────────
//
// Previously INTENT_PROMPT received ONLY the raw query — the AI classifier had
// zero conversation context, and inferred isFollowUp/isDirectReply purely from
// lexical cues in the query itself. That's the root cause behind the
// inconsistent isFollowUp classification and the "1, renaissance" regression
// documented in v6 §2–3. This gives the model the last two turns to reason
// against directly, instead of guessing blind.
const CONTEXT_TRUNCATE_CHARS = 300

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function buildIntentContextBlock(sessionMessages?: ConversationMessage[]): string {
  if (!sessionMessages || sessionMessages.length === 0) return ""

  const last       = sessionMessages[sessionMessages.length - 1]
  const secondLast = sessionMessages.length >= 2 ? sessionMessages[sessionMessages.length - 2] : undefined

  const lines: string[] = []
  if (secondLast) lines.push(`${secondLast.role === "user" ? "User" : "Assistant"}: ${truncate(secondLast.content, CONTEXT_TRUNCATE_CHARS)}`)
  if (last)       lines.push(`${last.role === "user" ? "User" : "Assistant"}: ${truncate(last.content, CONTEXT_TRUNCATE_CHARS)}`)

  return lines.length > 0 ? `\n[RECENT CONTEXT — last turns of this conversation]\n${lines.join("\n")}\n` : ""
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

const ACADEMIC_REFERENCE_PATTERN = /\b(exercise|problem|theorem|example|section|chapter|figure|table|corollary|lemma|definition|equation|proof)\s+\d+(\.\d+)*[a-z]?\b/i

function detectIntentFallbackCore(query: string): DetectedIntent {
  const q = query.trim()

  if (ACADEMIC_REFERENCE_PATTERN.test(q)) {
    return { intent: "lookup", scope: {}, cleanQuery: q, isDeixis: false, isPersonal: true, isFollowUp: false }
  }

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

// Widened fallback — used only when the AI classifier is unavailable
// (ProcessingExhaustedError or other failure). Wraps detectIntentFallbackCore
// (unchanged, regex-only, query-shape logic) and attaches isDirectReply /
// directReplySource using the same two heuristics the AI path is meant to
// subsume: isLikelyDirectReplyToAssistant (assistant asked/offered) and
// isLikelyUserPosedChoiceReply (user posed the choice themselves, earlier).
// Without this, every fallback-path query regresses back to the pre-redesign
// blind spot regardless of what the AI path now catches.
export function detectIntentFallback(
  query:            string,
  sessionMessages?: ConversationMessage[],
): DetectedIntent {
  const result = detectIntentFallbackCore(query)

  const assistantQuestion = isLikelyDirectReplyToAssistant(query, sessionMessages)
  const userPosedChoice   = isLikelyUserPosedChoiceReply(query, sessionMessages)

  result.isDirectReply     = assistantQuestion || userPosedChoice
  result.directReplySource = !result.isDirectReply
    ? null
    : userPosedChoice ? "user_posed_choice" : "assistant_question"

  return result
}

// ─── AI-first intent detection ────────────────────────────────────────────────

const INTENT_PROMPT = (query: string, contextBlock: string) => `You are an intent classifier for a personal notes assistant. Classify the user query below.
${contextBlock}
Return ONLY a valid JSON object — no markdown, no explanation, no backticks.

Fields:
- intent: one of "inventory" | "lookup" | "exploration" | "scoped" | "edit" | "hybrid"
- isDeixis: true if the query refers to the currently open note ("this note", "summarize this", "what's on this page", "explain this") — false otherwise
- isPersonal: true if the query is about the user's own content ("what did I write", "my notes on X", "do I have anything about") — false for general knowledge questions
- isFollowUp: true if the query is verifying, cross-checking, or challenging something already said in the conversation ("are you sure", "cross check that", "is that correct", "verify those figures", "double check that", "fact check this") — false otherwise
- isDirectReply: true if the query only makes sense given the [RECENT CONTEXT] above — either it directly answers a question or offer the assistant just made, OR it resolves a choice the user THEMSELVES posed in an earlier turn (e.g. they earlier asked "do you know more about X or Y?", and now reply "1, X"). False if there is no [RECENT CONTEXT] block, or if the query stands alone as a new topic regardless of the context given.
- directReplySource: when isDirectReply is true, one of "assistant_question" (replying to something the assistant just asked/offered) | "user_posed_choice" (resolving a choice the user themselves raised in an earlier turn) — null when isDirectReply is false.
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
- "what do I have on vitobu" is exploration + isPersonal:true
- "are you sure those figures are correct" or "cross check what you just said" is hybrid + isPersonal:false + isFollowUp:true
- "cross check if what I have in my notes are factually sound" mid-conversation about a specific topic is hybrid + isFollowUp:true
- "from page 88, now solve them" mid-conversation referencing a previous response is hybrid + isFollowUp:false + isPersonal:false — "from page X" is a conversational reference, not a vault scope filter; cleanQuery should preserve the full intent
- "now solve them", "do the same for b", "solve the first one" with no vault context are edit/hybrid — resolve from conversation history, do not search vault
- "how many people did king leopold kill" is lookup + isPersonal:false — historical public figures are never personal
- "heard jamie foxx almost died, what happened" is lookup + isPersonal:false — celebrity news is never personal
- "how does climate change work" is lookup + isPersonal:false — no first-person pronoun means not personal
- "exercise 3.1.5", "theorem 6", "problem 4.2" or any numbered exercise/theorem/problem reference is isPersonal:true even with no pronoun — these only make sense relative to a specific textbook edition in the vault, unlike general concept questions
- if [RECENT CONTEXT] shows the assistant's last message ending in a question or offer (e.g. "...which would you prefer?"), and the query is a short reply answering it, that's isDirectReply:true + directReplySource:"assistant_question" — e.g. "both please"
- if [RECENT CONTEXT] shows an earlier USER message posing an either/or choice (e.g. "do you know more about Renaissance painting or Baroque painting?"), and the current query is a bare selection resolving that choice (e.g. "1, renaissance"), that's isDirectReply:true + directReplySource:"user_posed_choice" — this applies even if the assistant's most recent message was declarative, not a question, since the dependency is on the user's own earlier framing, not the assistant's last line
- a query that stands alone as a coherent new topic, even with [RECENT CONTEXT] present, is isDirectReply:false + directReplySource:null

Query: ${JSON.stringify(query)}

JSON:`

export async function detectIntent(
  query:            string,
  sessionMessages?: ConversationMessage[],
): Promise<DetectedIntent> {
  return detectIntentCore(query, sessionMessages)
}

async function detectIntentCore(
  query:            string,
  sessionMessages?: ConversationMessage[],
): Promise<DetectedIntent> {
  const contextBlock = buildIntentContextBlock(sessionMessages)

  try {
    const raw  = await promptProcessing(INTENT_PROMPT(query, contextBlock))
    const clean = raw.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(clean)

    console.log('[intentDetection] AI classifier result:', {
      intent:            parsed.intent,
      isFollowUp:        parsed.isFollowUp,
      isDeixis:          parsed.isDeixis,
      isPersonal:        parsed.isPersonal,
      isDirectReply:     parsed.isDirectReply,
      directReplySource: parsed.directReplySource,
    })

    // Validate shape — fall back if malformed
    const validIntents = ["inventory", "lookup", "exploration", "scoped", "edit", "hybrid"]
    if (!validIntents.includes(parsed.intent)) throw new Error("invalid intent")

    // Same validation discipline as intent — a malformed directReplySource
    // should null out, not silently pass through a garbage string that
    // chat.ts's branch would then fail to match against either case.
    const validSources: Array<"assistant_question" | "user_posed_choice"> =
      ["assistant_question", "user_posed_choice"]

    // Hard structural rule, not just prompt wording — do not trust the model
    // to self-police "false if there is no [RECENT CONTEXT] block". Confirmed
    // live (2026-08-24 test) that it can ignore that instruction outright and
    // return isDirectReply:true with an empty contextBlock. There is no
    // question/offer/choice it could possibly be resolving against with zero
    // context, so this is enforced in code regardless of what the model says.
    const isDirectReply     = contextBlock.length > 0 && Boolean(parsed.isDirectReply)
    const directReplySource = isDirectReply && validSources.includes(parsed.directReplySource)
      ? parsed.directReplySource
      : null

    // Rollout instrumentation only — no behavior change. Compares the AI
    // path's judgment against the regex heuristics on every call where both
    // can run, so next session has real evidence on how in-sync the widened
    // fallback stays with the AI path, instead of assuming. See design-spec §2.6.
    const regexIsDirectReply = isLikelyDirectReplyToAssistant(query, sessionMessages)
      || isLikelyUserPosedChoiceReply(query, sessionMessages)
    if (regexIsDirectReply !== isDirectReply) {
      console.log('[intentDetection] isDirectReply disagreement — regex:', regexIsDirectReply, 'AI:', isDirectReply)
    }

    // Separate signal from the disagreement log above — this specifically
    // flags prompt non-adherence (model ignored an explicit instruction),
    // not a regex/AI judgment mismatch. Worth tracking on its own: repeated
    // hits here mean INTENT_PROMPT's instructions are being drifted past
    // more broadly, not just on this one field.
    if (contextBlock.length === 0 && Boolean(parsed.isDirectReply)) {
      console.warn('[intentDetection] model returned isDirectReply:true with no context block — overridden to false')
    }

    return {
      intent:     parsed.intent     as QueryIntent,
      isDeixis:   Boolean(parsed.isDeixis),
      isPersonal: Boolean(parsed.isPersonal),
      isFollowUp: Boolean(parsed.isFollowUp),
      cleanQuery: typeof parsed.cleanQuery === "string" ? parsed.cleanQuery : query,
      scope:      parsed.scope && typeof parsed.scope === "object" ? parsed.scope : {},
      isDirectReply,
      directReplySource,
    }
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      console.info("[intentDetection] processing exhausted — using fallback")
    } else {
      console.warn("[intentDetection] AI classification failed — using fallback:", err)
    }
    return detectIntentFallback(query, sessionMessages)
  }
}