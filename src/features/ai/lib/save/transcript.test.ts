// src/features/ai/lib/save/transcript.test.ts
//
// Run with:   npx tsx src/features/ai/lib/save/transcript.test.ts

import {
  generateNoteName,
  generateAppendHeading,
  formatRawTranscript,
  formatRawResponse,
  wrapForAppend,
  type TranscriptMessage,
} from "./transcript"

// ─── Assert helpers ───────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓  ${label}`)
    passed++
  } else {
    console.error(`  ✗  ${label}${detail ? `\n     ${detail}` : ""}`)
    failed++
  }
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected
  assert(label, ok, ok ? undefined : `expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`)
}

function assertContains(label: string, haystack: string, needle: string): void {
  assert(label, haystack.includes(needle), `"${needle}" not found in:\n     ${JSON.stringify(haystack)}`)
}

function assertNotContains(label: string, haystack: string, needle: string): void {
  assert(label, !haystack.includes(needle), `"${needle}" unexpectedly found in output`)
}

function assertStartsWith(label: string, actual: string, prefix: string): void {
  assert(
    label,
    actual.startsWith(prefix),
    `expected to start with: ${JSON.stringify(prefix)}\n     actual start: ${JSON.stringify(actual.slice(0, prefix.length + 10))}`
  )
}

function section(name: string): void {
  console.log(`\n${name}`)
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = (() => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
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

section("generateNoteName")

assertEqual(
  "date prefix is today in YYYY-MM-DD",
  generateNoteName(SIMPLE).slice(0, 10),
  TODAY
)

assertEqual(
  "separator is ' — '",
  generateNoteName(SIMPLE).slice(10, 13),
  " — "
)

assertContains(
  "first user message appears after separator",
  generateNoteName(SIMPLE),
  "What should the save flow look like?"
)

assert(
  "truncated body is <= 60 chars",
  generateNoteName(LONG_FIRST).split(" — ").slice(1).join(" — ").length <= 60
)

assertNotContains(
  "newlines in first message are collapsed",
  generateNoteName(MULTILINE_FIRST),
  "\n"
)

assertContains(
  "multiline message becomes single line with spaces",
  generateNoteName(MULTILINE_FIRST),
  "First line Second line Third line"
)

assertEqual(
  "falls back to 'Untitled chat' when no user message",
  generateNoteName(NO_USER).split(" — ").slice(1).join(" — "),
  "Untitled chat"
)

assertEqual(
  "falls back to 'Untitled chat' for empty session",
  generateNoteName(EMPTY).split(" — ").slice(1).join(" — "),
  "Untitled chat"
)

// ─── generateAppendHeading ────────────────────────────────────────────────────

section("generateAppendHeading")

assertEqual(
  "format is '## Chat — YYYY-MM-DD'",
  generateAppendHeading(),
  `## Chat — ${TODAY}`
)

// ─── formatRawTranscript ──────────────────────────────────────────────────────

section("formatRawTranscript")

const simpleOut = formatRawTranscript(SIMPLE)

assertStartsWith(
  "starts with # heading",
  simpleOut,
  "# "
)

assertContains(
  "heading derived from first user message",
  simpleOut,
  "# What should the save flow look like?"
)

assertContains("user turn has **User:** marker",           simpleOut, "**User:**")
assertContains("assistant turn has **Assistant:** marker", simpleOut, "**Assistant:**")

assertNotContains(
  "does not end with trailing blank lines",
  simpleOut,
  "\n\n\n"
)

const multiOut = formatRawTranscript(MULTI_TURN)

assertContains("all turns present — user 1",      multiOut, "What should the save flow look like?")
assertContains("all turns present — assistant 1", multiOut, "Triggered by Save to Note")
assertContains("all turns present — user 2",      multiOut, "Should it default to sub-note")
assertContains("all turns present — assistant 2", multiOut, "Sub-note when note has content.")

const codeOut = formatRawTranscript(WITH_CODE)
assertContains("code fences preserved",  codeOut, "```markdown")
assertContains("code content preserved", codeOut, "**User:** question")

const emptyOut = formatRawTranscript(WITH_EMPTY)
assertContains("non-empty user message present",    emptyOut, "Question")
assertContains("non-empty follow-up present",       emptyOut, "Follow up")
assert(
  "empty assistant turns produce no **Assistant:** markers",
  !emptyOut.includes("**Assistant:**")
)

assertContains(
  "multiline assistant response has label on its own line",
  formatRawTranscript(MULTI_TURN),
  "**Assistant:**\n"
)

// ─── formatRawResponse ────────────────────────────────────────────────────────

section("formatRawResponse")

const responseOut = formatRawResponse(SIMPLE[0], SIMPLE[1])

assertStartsWith("starts with # heading",       responseOut, "# ")
assertContains("user message present",          responseOut, "What should the save flow look like?")
assertContains("assistant message present",     responseOut, "Triggered by Save to Note")
assertContains("**User:** marker present",      responseOut, "**User:**")
assertContains("**Assistant:** marker present", responseOut, "**Assistant:**")

// ─── wrapForAppend ────────────────────────────────────────────────────────────

section("wrapForAppend")

const wrapped = wrapForAppend(formatRawTranscript(SIMPLE))

assertStartsWith(
  "starts with double newline",
  wrapped,
  "\n\n"
)

assertContains(
  "contains ## Chat — today heading",
  wrapped,
  `## Chat — ${TODAY}`
)

assertContains(
  "original content present",
  wrapped,
  "# What should the save flow look like?"
)

assert(
  "heading appears before transcript content",
  wrapped.indexOf(`## Chat — ${TODAY}`) < wrapped.indexOf("# What should")
)

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`)
if (failed === 0) {
  console.log(`✓ All ${passed} tests passed`)
} else {
  console.log(`${passed} passed, ${failed} failed`)
  process.exit(1)
}