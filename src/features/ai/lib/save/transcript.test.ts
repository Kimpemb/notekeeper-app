// src/features/ai/lib/save/transcript.test.ts

import { describe, it, expect, beforeAll } from "vitest"
import {
  generateNoteName,
  generateAppendHeading,
  formatRawTranscript,
  formatRawResponse,
  wrapForAppend,
  type TranscriptMessage,
} from "./transcript"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = (() => {
  const d   = new Date()
  const y   = d.getFullYear()
  const m   = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
})()

const SIMPLE: TranscriptMessage[] = [
  { role: "user",      content: "What should the save flow look like?" },
  { role: "assistant", content: "Triggered by Save to Note in the header." },
]

const MULTI_TURN: TranscriptMessage[] = [
  { role: "user",      content: "What should the save flow look like?" },
  { role: "assistant", content: "Triggered by Save to Note in the header." },
  { role: "user",      content: "Should it default to sub-note or append?" },
  { role: "assistant", content: "Sub-note when note has content.\nAppend when empty." },
]

const WITH_CODE: TranscriptMessage[] = [
  { role: "user",      content: "Show me the format" },
  { role: "assistant", content: "Here:\n```markdown\n**User:** question\n\n**Assistant:** answer\n```" },
]

const LONG_FIRST: TranscriptMessage[] = [
  { role: "user",      content: "This is a very long user message that definitely exceeds the sixty character limit set for note names in the spec" },
  { role: "assistant", content: "Short answer." },
]

const MULTILINE_FIRST: TranscriptMessage[] = [
  { role: "user",      content: "First line\nSecond line\nThird line" },
  { role: "assistant", content: "Answer." },
]

const WITH_EMPTY: TranscriptMessage[] = [
  { role: "user",      content: "Question" },
  { role: "assistant", content: "" },
  { role: "user",      content: "Follow up" },
  { role: "assistant", content: "   " },
]

const NO_USER: TranscriptMessage[] = [
  { role: "assistant", content: "Hello" },
]

const EMPTY: TranscriptMessage[] = []

// ─── generateNoteName ─────────────────────────────────────────────────────────

describe("generateNoteName", () => {
  it("date prefix is today in YYYY-MM-DD", () => {
    expect(generateNoteName(SIMPLE).slice(0, 10)).toBe(TODAY)
  })

  it("separator is ' — '", () => {
    expect(generateNoteName(SIMPLE).slice(10, 13)).toBe(" — ")
  })

  it("first user message appears after separator", () => {
    expect(generateNoteName(SIMPLE)).toContain("What should the save flow look like?")
  })

  it("truncated body is <= 60 chars", () => {
    expect(generateNoteName(LONG_FIRST).split(" — ").slice(1).join(" — ").length).toBeLessThanOrEqual(60)
  })

  it("newlines in first message are collapsed", () => {
    expect(generateNoteName(MULTILINE_FIRST)).not.toContain("\n")
  })

  it("multiline message becomes single line with spaces", () => {
    expect(generateNoteName(MULTILINE_FIRST)).toContain("First line Second line Third line")
  })

  it("falls back to 'Untitled chat' when no user message", () => {
    expect(generateNoteName(NO_USER).split(" — ").slice(1).join(" — ")).toBe("Untitled chat")
  })

  it("falls back to 'Untitled chat' for empty session", () => {
    expect(generateNoteName(EMPTY).split(" — ").slice(1).join(" — ")).toBe("Untitled chat")
  })
})

// ─── generateAppendHeading ────────────────────────────────────────────────────

describe("generateAppendHeading", () => {
  it("format is '## Chat — YYYY-MM-DD'", () => {
    expect(generateAppendHeading()).toBe(`## Chat — ${TODAY}`)
  })
})

// ─── formatRawTranscript ──────────────────────────────────────────────────────

describe("formatRawTranscript", () => {
  const simpleOut = formatRawTranscript(SIMPLE)
  const multiOut  = formatRawTranscript(MULTI_TURN)
  const codeOut   = formatRawTranscript(WITH_CODE)
  const emptyOut  = formatRawTranscript(WITH_EMPTY)

  it("starts with # heading", () => {
    expect(simpleOut.startsWith("# ")).toBe(true)
  })

  it("heading derived from first user message", () => {
    expect(simpleOut).toContain("# What should the save flow look like?")
  })

  it("user turn has **User:** marker", () => {
    expect(simpleOut).toContain("**User:**")
  })

  it("assistant turn has **Assistant:** marker", () => {
    expect(simpleOut).toContain("**Assistant:**")
  })

  it("does not end with trailing blank lines", () => {
    expect(simpleOut).not.toContain("\n\n\n")
  })

  it("all turns present — user 1", () => {
    expect(multiOut).toContain("What should the save flow look like?")
  })

  it("all turns present — assistant 1", () => {
    expect(multiOut).toContain("Triggered by Save to Note")
  })

  it("all turns present — user 2", () => {
    expect(multiOut).toContain("Should it default to sub-note")
  })

  it("all turns present — assistant 2", () => {
    expect(multiOut).toContain("Sub-note when note has content.")
  })

  it("code fences preserved", () => {
    expect(codeOut).toContain("```markdown")
  })

  it("code content preserved", () => {
    expect(codeOut).toContain("**User:** question")
  })

  it("non-empty user message present", () => {
    expect(emptyOut).toContain("Question")
  })

  it("non-empty follow-up present", () => {
    expect(emptyOut).toContain("Follow up")
  })

  it("empty assistant turns produce no **Assistant:** markers", () => {
    expect(emptyOut).not.toContain("**Assistant:**")
  })

  it("multiline assistant response has label on its own line", () => {
    expect(formatRawTranscript(MULTI_TURN)).toContain("**Assistant:**\n")
  })
})

// ─── formatRawResponse ────────────────────────────────────────────────────────

describe("formatRawResponse", () => {
  const responseOut = formatRawResponse(SIMPLE[0], SIMPLE[1])

  it("starts with # heading", () => {
    expect(responseOut.startsWith("# ")).toBe(true)
  })

  it("user message present", () => {
    expect(responseOut).toContain("What should the save flow look like?")
  })

  it("assistant message present", () => {
    expect(responseOut).toContain("Triggered by Save to Note")
  })

  it("**User:** marker present", () => {
    expect(responseOut).toContain("**User:**")
  })

  it("**Assistant:** marker present", () => {
    expect(responseOut).toContain("**Assistant:**")
  })
})

// ─── wrapForAppend ────────────────────────────────────────────────────────────

describe("wrapForAppend", () => {
  const wrapped = wrapForAppend(formatRawTranscript(SIMPLE))

  it("starts with double newline", () => {
    expect(wrapped.startsWith("\n\n")).toBe(true)
  })

  it("contains ## Chat — today heading", () => {
    expect(wrapped).toContain(`## Chat — ${TODAY}`)
  })

  it("original content present", () => {
    expect(wrapped).toContain("# What should the save flow look like?")
  })

  it("heading appears before transcript content", () => {
    expect(wrapped.indexOf(`## Chat — ${TODAY}`)).toBeLessThan(wrapped.indexOf("# What should"))
  })
})