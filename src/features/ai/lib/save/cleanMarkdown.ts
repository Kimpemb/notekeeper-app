// src/features/ai/lib/save/cleanMarkdown.ts
//
// M7 — Clean markdown session formatter
// M8 — Clean markdown single response formatter
//
// Both route through the existing promptProcessing / processingSlot
// infrastructure. Falls back to raw transcript if processing model
// is unavailable (ProcessingExhaustedError).

import {
  promptProcessing,
  ProcessingExhaustedError,
} from "@/features/ai/lib/client"
import {
  formatRawTranscript,
  formatRawResponse,
} from "@/features/ai/lib/save/transcript"
import type { TranscriptMessage } from "@/features/ai/lib/save/transcript"

// ─── M6 — Token estimation & length gate ─────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export type LengthBand = "short" | "medium" | "long"

export function getLengthBand(tokens: number): LengthBand {
  if (tokens < 8_000)  return "short"
  if (tokens <= 20_000) return "medium"
  return "long"
}

export function getMaxTokens(band: LengthBand): number {
  return band === "short" ? 2000 : 4000
}

// ─── M7 — Session formatter ───────────────────────────────────────────────────

const SESSION_PROMPT = (conversation: string) => `\
You are formatting a chat session into a clean, structured markdown document.

Here is the raw conversation:
${conversation}

Return a single markdown document with this exact structure:
- A # heading that captures the main topic of the conversation
- A ## Summary section: 2–3 sentences describing what was discussed and decided
- One or more ## Discussion sections with descriptive headings derived from
  the conversation topics. Restructure exchanges as readable prose or Q&A.
  Do not summarise — preserve the substance of every meaningful exchange.
- A ## Decisions Made section: bullet list of concrete decisions reached.
  Omit if none were made.
- An ## Open Questions section: bullet list of questions raised but not resolved.
  Omit if none exist.
- A ## Code section: all code blocks from the conversation, preserved exactly
  with correct syntax highlighting. Omit if no code was discussed.

Rules:
- Never truncate or summarise technical content, code, or specific decisions
- Preserve all specifics — numbers, names, file paths, error messages
- Remove only filler, acknowledgements, affirmations, and conversational
  back-and-forth with no informational content
- Return only the markdown document. No preamble, no explanation.`

export interface CleanMarkdownResult {
  markdown:  string
  fallback:  boolean  // true = raw transcript was used
  band:      LengthBand
}

export async function formatCleanSession(
  messages: TranscriptMessage[],
): Promise<CleanMarkdownResult> {
  const raw    = formatRawTranscript(messages)
  const tokens = estimateTokens(raw)
  const band   = getLengthBand(tokens)

  try {
    const result = await promptProcessing(
      SESSION_PROMPT(raw),
      undefined,
    )
    return { markdown: result, fallback: false, band }
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      return { markdown: raw, fallback: true, band }
    }
    // Non-exhaustion error — fall back to raw
    console.warn("[cleanMarkdown] session formatter error:", err)
    return { markdown: raw, fallback: true, band }
  }
}

// ─── M8 — Single response formatter ──────────────────────────────────────────

const RESPONSE_PROMPT = (userMsg: string, assistantMsg: string) => `\
You are formatting a single assistant response into a clean, structured markdown document.

Here is the question that prompted the response:
${userMsg}

Here is the response:
${assistantMsg}

Return a single markdown document with this exact structure:
- A # heading that captures the main topic of the response
- A blockquote (>) containing the question that prompted this response
- A ## Summary section: 2–3 sentences describing what the response covers
- One or more ## sections with descriptive headings derived from the response content.
  Restructure as readable prose. Do not summarise — preserve the substance of
  every meaningful point.
- A ## Code section: all code blocks from the response, preserved exactly
  with correct syntax highlighting. Omit if no code was present.

Rules:
- Never truncate or summarise technical content, code, or specific details
- Preserve all specifics — numbers, names, file paths, error messages
- Remove only filler and conversational phrasing with no informational content
- Return only the markdown document. No preamble, no explanation.`

export async function formatCleanResponse(
  userMsg:      TranscriptMessage,
  assistantMsg: TranscriptMessage,
): Promise<CleanMarkdownResult> {
  const raw    = formatRawResponse(userMsg, assistantMsg)
  const tokens = estimateTokens(raw)
  const band   = getLengthBand(tokens)

  try {
    const result = await promptProcessing(
      RESPONSE_PROMPT(userMsg.content, assistantMsg.content),
      undefined,
    )
    return { markdown: result, fallback: false, band }
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      return { markdown: raw, fallback: true, band }
    }
    console.warn("[cleanMarkdown] response formatter error:", err)
    return { markdown: raw, fallback: true, band }
  }
}