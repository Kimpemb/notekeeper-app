// src/features/ai/lib/save/cleanMarkdown.ts

import {
  promptProcessing,
  ProcessingExhaustedError,
} from "@/features/ai/lib/client"
import { formatRawTranscript } from "@/features/ai/lib/save/transcript"
import type { TranscriptMessage } from "@/features/ai/lib/save/transcript"

// ─── Token estimation & length gate ──────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export type LengthBand = "short" | "medium" | "long"

export function getLengthBand(tokens: number): LengthBand {
  if (tokens < 8_000)   return "short"
  if (tokens <= 20_000) return "medium"
  return "long"
}

export function getMaxTokens(band: LengthBand): number {
  return band === "short" ? 2000 : 4000
}

// ─── Document prompt ──────────────────────────────────────────────────────────

const DOCUMENT_PROMPT = (conversation: string) => `\
You are converting a chat conversation into a polished written document.

Here is the conversation:
${conversation}

Write a well-organised markdown document from this conversation. The reader should not be able to tell it came from a chat — write as a single author, not as a dialogue.

Choose the structure that best serves the content: documentation style for technical topics, structured prose for research or explanations, concise single-section notes for simple queries. Use ## and ### headings to organise sections naturally.

Preserve everything of substance: code blocks with correct language tags, specific numbers, names, file paths, error messages, and decisions. Remove only filler, acknowledgements, and back-and-forth with no informational content.

Return only the markdown document. No preamble, no explanation.`

// ─── Result type ──────────────────────────────────────────────────────────────

export interface FormatResult {
  markdown: string
  fallback: boolean
  band:     LengthBand
}

// ─── Document formatter ───────────────────────────────────────────────────────

export async function formatDocument(
  messages: TranscriptMessage[],
): Promise<FormatResult> {
  const raw    = formatRawTranscript(messages)
  const tokens = estimateTokens(raw)
  const band   = getLengthBand(tokens)

  try {
    const result = await promptProcessing(DOCUMENT_PROMPT(raw))
    return { markdown: result, fallback: false, band }
  } catch (err) {
    if (err instanceof ProcessingExhaustedError) {
      return { markdown: raw, fallback: true, band }
    }
    console.warn("[cleanMarkdown] document formatter error:", err)
    return { markdown: raw, fallback: true, band }
  }
}