// src/features/ai/lib/save/transcript.ts

import {
  promptProcessing,
  ProcessingExhaustedError,
} from "@/features/ai/lib/client"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscriptMessage {
  role:    "user" | "assistant"
  content: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTE_NAME_MAX_CHARS   = 60
const DATE_PREFIX_SEPARATOR = " — "

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayPrefix(): string {
  const d   = new Date()
  const y   = d.getFullYear()
  const m   = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ─── Sanitise message content ─────────────────────────────────────────────────
// Strips web-search citation markers (e.g. [web:1]) that are rendered
// decoratively in the chat UI but should never appear in saved notes.

function stripCitations(text: string): string {
  return text.replace(/\[web:\d+\]/g, "").replace(/ {2,}/g, " ").trim()
}

// ─── Note name (fallback) ─────────────────────────────────────────────────────

export function generateNoteName(messages: TranscriptMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user")
  const base = firstUserMsg
    ? firstUserMsg.content.replace(/\n+/g, " ").trim()
    : "Untitled chat"

  const truncated = base.length > NOTE_NAME_MAX_CHARS
    ? base.slice(0, NOTE_NAME_MAX_CHARS).trimEnd()
    : base

  return `${todayPrefix()}${DATE_PREFIX_SEPARATOR}${truncated}`
}

// ─── Note name (AI) ───────────────────────────────────────────────────────────

const NOTE_NAME_PROMPT = (conversation: string) => `\
Given this chat conversation, generate a short, specific, descriptive title for a note that captures what was actually discussed or decided.

Conversation:
${conversation.slice(0, 2000)}

Rules:
- Maximum 8 words
- No date prefix
- No quotes around the title
- Specific and meaningful — someone should know what's in the note from the title alone
- Return only the title, nothing else`

export async function generateNoteNameAI(
  messages: TranscriptMessage[],
): Promise<string> {
  const fallback = generateNoteName(messages)
  const raw      = formatRawTranscript(messages)

  try {
    const result  = await promptProcessing(NOTE_NAME_PROMPT(raw))
    const cleaned = result.trim().replace(/^["']|["']$/g, "").trim()
    if (!cleaned || cleaned.length > 80) return fallback
    return `${todayPrefix()}${DATE_PREFIX_SEPARATOR}${cleaned}`
  } catch (err) {
    if (!(err instanceof ProcessingExhaustedError)) {
      console.warn("[transcript] AI note name failed:", err)
    }
    return fallback
  }
}

// ─── Note name from a single response ────────────────────────────────────────
// Used when saving "this response" — derives name from the user question,
// no AI call, always instant.

export function generateNoteNameFromResponse(
  userMsg: TranscriptMessage,
): string {
  const base = userMsg.content.replace(/\n+/g, " ").trim()
  const truncated = base.length > NOTE_NAME_MAX_CHARS
    ? base.slice(0, NOTE_NAME_MAX_CHARS).trimEnd()
    : base
  return `${todayPrefix()}${DATE_PREFIX_SEPARATOR}${truncated}`
}

// ─── Append heading ───────────────────────────────────────────────────────────

export function generateAppendHeading(): string {
  return `## Chat — ${todayPrefix()}`
}

// ─── Full session formatter ───────────────────────────────────────────────────

export function formatRawTranscript(messages: TranscriptMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user")
  const headingText  = firstUserMsg
    ? firstUserMsg.content.replace(/\n+/g, " ").trim().slice(0, NOTE_NAME_MAX_CHARS).trimEnd()
    : "Untitled chat"

  const lines: string[] = [`# ${headingText}`, ""]

  for (const msg of messages) {
    const content = stripCitations(msg.content)
    if (!content) continue

    const label = msg.role === "user" ? "**User:**" : "**Assistant:**"

    if (content.includes("\n")) {
      lines.push(label)
      lines.push("")
      lines.push(content)
    } else {
      lines.push(`${label} ${content}`)
    }

    lines.push("")
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }

  return lines.join("\n")
}

// ─── Single response formatter ────────────────────────────────────────────────
// Saves just one assistant response. The user's question becomes the heading,
// the assistant content is the body. No AI involved — always instant.

export function formatSingleResponse(
  userMsg:      TranscriptMessage,
  assistantMsg: TranscriptMessage,
): string {
  const headingText = userMsg.content
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, NOTE_NAME_MAX_CHARS)
    .trimEnd()

  const lines: string[] = [`# ${headingText}`, ""]

  const assistantContent = stripCitations(assistantMsg.content)
  if (assistantContent) {
    lines.push(assistantContent)
  }

  return lines.join("\n")
}

// ─── Append wrapper ───────────────────────────────────────────────────────────

export function wrapForAppend(formattedContent: string): string {
  return `\n\n${generateAppendHeading()}\n\n${formattedContent}`
}