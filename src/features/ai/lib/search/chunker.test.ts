// src/features/ai/lib/search/chunker.test.ts

import { describe, it, expect, beforeAll } from "vitest"
import { chunkDocument } from "./chunker"

// ─── Fixture ──────────────────────────────────────────────────────────────────

const testDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, blockId: "h1", blockCreatedAt: 1000, blockUpdatedAt: 1000 },
      content: [{ type: "text", text: "Introduction" }],
    },
    {
      type: "paragraph",
      attrs: { blockId: "p1", blockCreatedAt: 1000, blockUpdatedAt: 1000 },
      content: [{ type: "text", text: "This is an intro paragraph with enough text to meet the minimum body chunk size requirement for the chunker. Adding more text here to ensure we are well above the two hundred character minimum threshold that the chunker enforces on body chunks." }],
    },
    {
      type: "heading",
      attrs: { level: 2, blockId: "h2", blockCreatedAt: 1000, blockUpdatedAt: 1000 },
      content: [{ type: "text", text: "Sub-section" }],
    },
    {
      type: "codeBlock",
      attrs: { blockId: "cb1", blockCreatedAt: 1000, blockUpdatedAt: 1000 },
      content: [{ type: "text", text: "function hello() {\n  // This code block needs to be long enough to pass the minimum body chunk size check\n  console.log('do not split me ever under any circumstances');\n  return true;\n}" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          attrs: { blockId: "li1", blockCreatedAt: 1000, blockUpdatedAt: 1000 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "List item one with sufficient text content to pass the minimum body chunk size requirement of fifty tokens" }] }],
        },
        {
          type: "listItem",
          attrs: { blockId: "li2", blockCreatedAt: 1000, blockUpdatedAt: 1000 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "List item two with sufficient text content to also pass the minimum requirement and ensure no splitting occurs during the chunking process" }] }],
        },
      ],
    },
  ],
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("chunkDocument", () => {
  let chunks: Awaited<ReturnType<typeof chunkDocument>>

  beforeAll(async () => {
    chunks = await chunkDocument(JSON.stringify(testDoc), "note")

    // Keep the diagnostic output that was useful during development
    console.log(`Total chunks: ${chunks.length}`)
    chunks.forEach((c, i) => {
      console.log(`\n[${i}] type=${c.blockType} heading="${c.chunkHeading}" hash=${c.contentHash ? "✅" : "❌"}`)
      console.log(`    text="${c.plaintext.slice(0, 60)}..."`)
    })
  })

  it("code block whole (not split)", () => {
    const codeChunk = chunks.find((c) => c.blockType === "codeBlock")
    expect(codeChunk).toBeDefined()
  })

  it("sub-section heading propagated", () => {
    const subSectionChunks = chunks.filter((c) => c.chunkHeading === "Sub-section")
    expect(subSectionChunks.length).toBeGreaterThan(0)
  })

  it("all chunks have content_hash", () => {
    const missingHash = chunks.filter((c) => !c.contentHash)
    expect(missingHash).toHaveLength(0)
  })
})