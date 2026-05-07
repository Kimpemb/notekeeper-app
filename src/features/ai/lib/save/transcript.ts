// src/features/ai/lib/save/transcript.ts
//
// M1 — Raw transcript formatter
//
// Pure TypeScript — no AI calls, no DB writes, no imports from the rest of the
// codebase. Always available, always lossless. Ships as the Phase 1 foundation
// that the clean-markdown formatters (M7, M8) fall back to when the processing
// model is unavailable.
//
// Public API:
//   formatRawTranscript(messages)  → markdown string (full session)
//   formatRawResponse(userMsg, assistantMsg) → markdown string (single response)
//   generateNoteName(messages)     → "YYYY-MM-DD — [first user message]"
//   generateAppendHeading()        → "## Chat — YYYY-MM-DD"

// ─── Types ────────────────────────────────────────────────────────────────────

// Minimal message shape — matches ChatMessage from chat.ts but declared locally
// so this file has zero external imports and can be tested in isolation.
export interface TranscriptMessage {
  role:    "user" | "assistant"
  content: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTE_NAME_MAX_CHARS = 60
const DATE_PREFIX_SEPARATOR = " — "

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayPrefix(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ─── Note name ────────────────────────────────────────────────────────────────

/**
 * Produces the pre-filled note name for the save dialog.
 *
 * Format: "YYYY-MM-DD — [first user message, truncated at 60 chars]"
 *
 * Rules:
 *   - Uses the first user message in the session.
 *   - Strips newlines (replace with space) so the name stays on one line.
 *   - Truncates at NOTE_NAME_MAX_CHARS *before* adding the date prefix, so the
 *     prefix never eats into the meaningful part of the title.
 *   - Falls back to "Untitled chat" if no user message exists.
 */
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

// ─── Append heading ───────────────────────────────────────────────────────────

/**
 * Produces the section heading used when appending to an existing note.
 * Format: "## Chat — YYYY-MM-DD"
 */
export function generateAppendHeading(): string {
  return `## Chat — ${todayPrefix()}`
}

// ─── Code block preservation ──────────────────────────────────────────────────
//
// The content stored in ChatMessage.content is plain text (the streaming output
// from the model), not ProseMirror JSON. Code blocks arrive as raw markdown
// fenced blocks (```lang\n...\n```) in the assistant's response text.
// No transformation needed — we emit them verbatim and they render correctly
// in the note editor's markdown import path.

// ─── Full session formatter ───────────────────────────────────────────────────

/**
 * Formats a full chat session as a lossless raw transcript.
 *
 * Output structure:
 *
 *   # [note name without the date prefix]
 *
 *   **User:** [message]
 *
 *   **Assistant:** [response]
 *
 *   **User:** [message]
 *
 *   **Assistant:** [response]
 *
 * The # heading uses only the truncated first-message part (no date prefix)
 * because the date is already encoded in the note name / file metadata.
 *
 * Empty messages are skipped. Leading/trailing whitespace in each message is
 * preserved as-is — the content is lossless.
 */
export function formatRawTranscript(messages: TranscriptMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user")
  const headingText = firstUserMsg
    ? firstUserMsg.content.replace(/\n+/g, " ").trim().slice(0, NOTE_NAME_MAX_CHARS).trimEnd()
    : "Untitled chat"

  const lines: string[] = [`# ${headingText}`, ""]

  for (const msg of messages) {
    if (!msg.content.trim()) continue

    const label = msg.role === "user" ? "**User:**" : "**Assistant:**"

    // Separate label from content with a space.
    // Multi-line messages: emit label on its own line, then a blank line,
    // then the content block. This keeps code blocks and multi-paragraph
    // responses readable.
    if (msg.content.includes("\n")) {
      lines.push(label)
      lines.push("")
      lines.push(msg.content)
    } else {
      lines.push(`${label} ${msg.content}`)
    }

    lines.push("") // blank line between turns
  }

  // Trim trailing blank line
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop()
  }

  return lines.join("\n")
}

// ─── Single response formatter ────────────────────────────────────────────────

/**
 * Formats a single assistant response (and the user message that prompted it)
 * as a raw transcript note.
 *
 * Used as the fallback when the single-response clean markdown formatter
 * (M8) is unavailable.
 *
 * Output structure:
 *
 *   # [assistant response heading, truncated]
 *
 *   **User:** [the question]
 *
 *   **Assistant:** [the response]
 */
export function formatRawResponse(
  userMsg:       TranscriptMessage,
  assistantMsg:  TranscriptMessage,
): string {
  // Use the assistant response content for the heading (it's the "answer"),
  // falling back to the user message if the assistant content is empty.
  const headingSource = assistantMsg.content.trim() || userMsg.content.trim()
  const headingText = headingSource
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, NOTE_NAME_MAX_CHARS)
    .trimEnd()

  return formatRawTranscript([userMsg, assistantMsg].filter((m) => m.content.trim()))
    .replace(/^# .+/, `# ${headingText}`)
}

// ─── Append wrapper ───────────────────────────────────────────────────────────

/**
 * Wraps formatted content (session or single response) for the "Append to this
 * note" save mode.
 *
 * Produces:
 *
 *   \n\n## Chat — YYYY-MM-DD\n\n[content]
 *
 * The leading \n\n ensures a clean break from whatever was already in the note.
 * The ## heading causes the RAG chunker to split here, keeping the original
 * note content and the appended chat in separate chunks.
 */
export function wrapForAppend(formattedContent: string): string {
  return `\n\n${generateAppendHeading()}\n\n${formattedContent}`
}