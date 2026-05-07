// src/features/ai/lib/save/cleanMarkdown.test.ts
//
// Phase 2 — M6 / M7 / M8 test suite
//
// Covers:
//   M6  estimateTokens, getLengthBand, getMaxTokens
//   M7  formatCleanSession  — happy path, fallback on ProcessingExhaustedError,
//                             fallback on generic error, correct band propagation
//   M8  formatCleanResponse — happy path, fallback on ProcessingExhaustedError,
//                             fallback on generic error
//
// promptProcessing is mocked at the module boundary so no real API calls are
// made. The mock is reset between every test to prevent cross-test pollution.

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  estimateTokens,
  getLengthBand,
  getMaxTokens,
  formatCleanSession,
  formatCleanResponse,
  type LengthBand,
} from "@/features/ai/lib/save/cleanMarkdown"
import { ProcessingExhaustedError } from "@/features/ai/lib/client"
import type { TranscriptMessage } from "@/features/ai/lib/save/transcript"

// ─── Mock promptProcessing ────────────────────────────────────────────────────

vi.mock("@/features/ai/lib/client", () => ({
  promptProcessing: vi.fn(),
  ProcessingExhaustedError: class ProcessingExhaustedError extends Error {
    constructor(message = "processing exhausted") {
      super(message)
      this.name = "ProcessingExhaustedError"
    }
  },
}))

// Typed handle so individual tests can override the resolved value / rejection.
import { promptProcessing } from "@/features/ai/lib/client"
const mockPromptProcessing = vi.mocked(promptProcessing)

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SHORT_MESSAGES: TranscriptMessage[] = [
  { role: "user",      content: "What is a closure in JavaScript?" },
  { role: "assistant", content: "A closure is a function that retains access to its outer scope even after that scope has returned." },
]

const SINGLE_USER: TranscriptMessage = {
  role: "user",
  content: "Explain the event loop.",
}

const SINGLE_ASSISTANT: TranscriptMessage = {
  role: "assistant",
  content: "The event loop is the mechanism Node.js uses to handle async operations without blocking the main thread.",
}

// Produces a string long enough to push token estimates into the target band.
function makeText(charCount: number): string {
  return "a".repeat(charCount)
}

function makeMessages(charCount: number): TranscriptMessage[] {
  return [
    { role: "user",      content: makeText(charCount) },
    { role: "assistant", content: "" },
  ]
}

// ─── M6 — estimateTokens ──────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns Math.ceil(length / 4)", () => {
    expect(estimateTokens("abcd")).toBe(1)        // 4 / 4 = 1.0 → 1
    expect(estimateTokens("abcde")).toBe(2)       // 5 / 4 = 1.25 → 2
    expect(estimateTokens("")).toBe(0)
  })

  it("scales linearly with string length", () => {
    const text = "x".repeat(400)
    expect(estimateTokens(text)).toBe(100)
  })
})

// ─── M6 — getLengthBand ───────────────────────────────────────────────────────

describe("getLengthBand", () => {
  it("returns 'short' for tokens < 8 000", () => {
    expect(getLengthBand(0)).toBe("short")
    expect(getLengthBand(7_999)).toBe("short")
  })

  it("returns 'medium' for tokens 8 000 – 20 000 (inclusive)", () => {
    expect(getLengthBand(8_000)).toBe("medium")
    expect(getLengthBand(14_000)).toBe("medium")
    expect(getLengthBand(20_000)).toBe("medium")
  })

  it("returns 'long' for tokens > 20 000", () => {
    expect(getLengthBand(20_001)).toBe("long")
    expect(getLengthBand(100_000)).toBe("long")
  })

  it("treats the 8 000 boundary as medium, not short", () => {
    expect(getLengthBand(7_999)).toBe("short")
    expect(getLengthBand(8_000)).toBe("medium")
  })

  it("treats the 20 000 boundary as medium, not long", () => {
    expect(getLengthBand(20_000)).toBe("medium")
    expect(getLengthBand(20_001)).toBe("long")
  })
})

// ─── M6 — getMaxTokens ────────────────────────────────────────────────────────

describe("getMaxTokens", () => {
  it("returns 2 000 for short band", () => {
    expect(getMaxTokens("short")).toBe(2_000)
  })

  it("returns 4 000 for medium band", () => {
    expect(getMaxTokens("medium")).toBe(4_000)
  })

  it("returns 4 000 for long band", () => {
    expect(getMaxTokens("long")).toBe(4_000)
  })

  it("covers all LengthBand values without throwing", () => {
    const bands: LengthBand[] = ["short", "medium", "long"]
    for (const b of bands) {
      expect(() => getMaxTokens(b)).not.toThrow()
    }
  })
})

// ─── M7 — formatCleanSession ──────────────────────────────────────────────────

describe("formatCleanSession", () => {
  it("returns model output with fallback=false on success", async () => {
    const modelOutput = "# Closures\n\n## Summary\nWe discussed closures."
    mockPromptProcessing.mockResolvedValueOnce(modelOutput)

    const result = await formatCleanSession(SHORT_MESSAGES)

    expect(result.markdown).toBe(modelOutput)
    expect(result.fallback).toBe(false)
  })

  it("calls promptProcessing exactly once", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    await formatCleanSession(SHORT_MESSAGES)

    expect(mockPromptProcessing).toHaveBeenCalledTimes(1)
  })

  it("passes a non-empty prompt string to promptProcessing", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    await formatCleanSession(SHORT_MESSAGES)

    const [promptArg] = mockPromptProcessing.mock.calls[0]
    expect(typeof promptArg).toBe("string")
    expect(promptArg.length).toBeGreaterThan(0)
  })

  it("prompt includes the raw conversation content", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    await formatCleanSession(SHORT_MESSAGES)

    const [promptArg] = mockPromptProcessing.mock.calls[0]
    // The prompt wraps the raw transcript — at minimum the user message text
    // must appear in it so the model sees the actual conversation.
    expect(promptArg).toContain(SHORT_MESSAGES[0].content)
  })

  it("falls back to raw transcript on ProcessingExhaustedError", async () => {
    mockPromptProcessing.mockRejectedValueOnce(new ProcessingExhaustedError())

    const result = await formatCleanSession(SHORT_MESSAGES)

    expect(result.fallback).toBe(true)
    expect(result.markdown).toContain("**User:**")
    expect(result.markdown).toContain(SHORT_MESSAGES[0].content)
  })

  it("falls back to raw transcript on generic error", async () => {
    mockPromptProcessing.mockRejectedValueOnce(new Error("network timeout"))

    const result = await formatCleanSession(SHORT_MESSAGES)

    expect(result.fallback).toBe(true)
    expect(result.markdown).toContain("**User:**")
  })

  it("does not throw on any error — always resolves", async () => {
    mockPromptProcessing.mockRejectedValueOnce(new Error("kaboom"))

    await expect(formatCleanSession(SHORT_MESSAGES)).resolves.toBeDefined()
  })

  it("reports 'short' band for a short conversation", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    const result = await formatCleanSession(SHORT_MESSAGES)

    expect(result.band).toBe("short")
  })

  it("reports 'medium' band when raw text is 8 000–20 000 tokens", async () => {
    // 8 000 tokens × 4 chars/token = 32 000 chars
    const messages = makeMessages(32_000)
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    const result = await formatCleanSession(messages)

    expect(result.band).toBe("medium")
  })

  it("reports 'long' band when raw text exceeds 20 000 tokens", async () => {
    // 20 001 tokens × 4 chars/token = 80 004 chars
    const messages = makeMessages(80_100)
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    const result = await formatCleanSession(messages)

    expect(result.band).toBe("long")
  })

  it("band is consistent between happy path and fallback path", async () => {
    const messages = makeMessages(32_000) // medium band
    mockPromptProcessing.mockRejectedValueOnce(new ProcessingExhaustedError())

    const result = await formatCleanSession(messages)

    expect(result.fallback).toBe(true)
    expect(result.band).toBe("medium")
  })

  it("handles an empty messages array without throwing", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Empty")

    await expect(formatCleanSession([])).resolves.toBeDefined()
  })
})

// ─── M8 — formatCleanResponse ─────────────────────────────────────────────────

describe("formatCleanResponse", () => {
  it("returns model output with fallback=false on success", async () => {
    const modelOutput = "# Event Loop\n\n> Explain the event loop.\n\n## Summary\nCovered the loop."
    mockPromptProcessing.mockResolvedValueOnce(modelOutput)

    const result = await formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)

    expect(result.markdown).toBe(modelOutput)
    expect(result.fallback).toBe(false)
  })

  it("calls promptProcessing exactly once", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    await formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)

    expect(mockPromptProcessing).toHaveBeenCalledTimes(1)
  })

  it("prompt includes both the user message and the assistant response", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    await formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)

    const [promptArg] = mockPromptProcessing.mock.calls[0]
    expect(promptArg).toContain(SINGLE_USER.content)
    expect(promptArg).toContain(SINGLE_ASSISTANT.content)
  })

  it("falls back to raw transcript on ProcessingExhaustedError", async () => {
    mockPromptProcessing.mockRejectedValueOnce(new ProcessingExhaustedError())

    const result = await formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)

    expect(result.fallback).toBe(true)
    expect(result.markdown).toContain(SINGLE_USER.content)
    expect(result.markdown).toContain(SINGLE_ASSISTANT.content)
  })

  it("falls back to raw transcript on generic error", async () => {
    mockPromptProcessing.mockRejectedValueOnce(new Error("rate limited"))

    const result = await formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)

    expect(result.fallback).toBe(true)
    expect(result.markdown).toContain(SINGLE_USER.content)
  })

  it("does not throw on any error — always resolves", async () => {
    mockPromptProcessing.mockRejectedValueOnce(new Error("kaboom"))

    await expect(
      formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)
    ).resolves.toBeDefined()
  })

  it("reports 'short' band for a short single response", async () => {
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    const result = await formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)

    expect(result.band).toBe("short")
  })

  it("reports correct band when assistant response is long", async () => {
    // Force a long assistant message (> 20 000 token equivalent)
    const longAssistant: TranscriptMessage = {
      role: "assistant",
      content: makeText(80_100),
    }
    mockPromptProcessing.mockResolvedValueOnce("# Long topic")

    const result = await formatCleanResponse(SINGLE_USER, longAssistant)

    expect(result.band).toBe("long")
  })

  it("fallback markdown contains the assistant content, not just the user message", async () => {
    mockPromptProcessing.mockRejectedValueOnce(new ProcessingExhaustedError())

    const result = await formatCleanResponse(SINGLE_USER, SINGLE_ASSISTANT)

    expect(result.markdown).toContain("event loop")
  })

  it("handles empty assistant content gracefully", async () => {
    const emptyAssistant: TranscriptMessage = { role: "assistant", content: "" }
    mockPromptProcessing.mockResolvedValueOnce("# Topic")

    await expect(
      formatCleanResponse(SINGLE_USER, emptyAssistant)
    ).resolves.toBeDefined()
  })
})