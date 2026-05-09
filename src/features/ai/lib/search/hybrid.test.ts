// src/features/ai/lib/search/hybrid.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/features/notes/db/client", () => ({
  getDb: vi.fn(),
}))

vi.mock("@/features/ai/lib/search/semantic", () => ({
  semanticSearch: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/features/ai/lib/search/rerank", () => ({
  rerank: vi.fn().mockImplementation((inputs: any[]) =>
    inputs.map((r, i) => ({
      ...r,
      final_score:   1 / (i + 1),
      boost_applied: 0,
      confidence:    "high" as const,
    }))
  ),
}))

vi.mock("@/features/notes/db/queries", () => ({
  getSurroundingBlocks: vi.fn().mockResolvedValue([]),
}))

import { hybridSearch } from "@/features/ai/lib/search/hybrid"
import { getDb }        from "@/features/notes/db/client"

const mockGetDb = vi.mocked(getDb)

let mockSelect:  any
let mockExecute: any

beforeEach(() => {
  vi.clearAllMocks()
  mockSelect  = vi.fn().mockResolvedValue([])
  mockExecute = vi.fn().mockResolvedValue(undefined)
  mockGetDb.mockResolvedValue({ select: mockSelect, execute: mockExecute } as any)
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACTIVE_BLOCK = {
  block_id:         "block-1",
  note_id:          "note-active",
  plaintext:        "Active note content about the topic",
  chunk_heading:    null,
  source_type:      "note",
  note_title:       "Active Note",
  block_updated_at: Date.now(),
  rank:             1,
  breadcrumb:       "Active Note",
  rag_excluded:     0,
}

const EXCLUDED_BLOCK = {
  ...ACTIVE_BLOCK,
  block_id:     "block-excluded",
  note_id:      "note-excluded",
  note_title:   "Secret Note",
  breadcrumb:   "Secret Note",
  rag_excluded: 1,
}

const EXCLUDED_TITLE_ROW = {
  note_id: "note-excluded",
  title:   "Secret Note",
}

function makeSelectHandler({
  includeExcluded   = false,
  excludedTitleRows = [EXCLUDED_TITLE_ROW],
}: {
  includeExcluded?:   boolean
  excludedTitleRows?: typeof EXCLUDED_TITLE_ROW[]
} = {}) {
  return (sql: string, _params: unknown[]) => {
    if (sql.includes("blocks_fts")) {
      return Promise.resolve(includeExcluded ? [ACTIVE_BLOCK, EXCLUDED_BLOCK] : [ACTIVE_BLOCK])
    }
    if (sql.includes("note_title_chunks") && !sql.includes("rag_excluded, 0) = 1")) {
      return Promise.resolve([])
    }
    if (sql.includes("rag_excluded, 0) = 1")) {
      return Promise.resolve(excludedTitleRows)
    }
    if (sql.includes("note_blocks nb")) {
      return Promise.resolve([ACTIVE_BLOCK])
    }
    return Promise.resolve([])
  }
}

// ─── overrideNoteIds ──────────────────────────────────────────────────────────

describe("overrideNoteIds", () => {
  it("excludes rag_excluded blocks when overrideNoteIds is absent", async () => {
    mockSelect.mockImplementation(makeSelectHandler({ includeExcluded: true }))

    const { results } = await hybridSearch("topic", 8)

    const noteIds = results.map((r) => r.note_id)
    expect(noteIds).not.toContain("note-excluded")
    expect(noteIds).toContain("note-active")
  })

  it("includes rag_excluded block when its note_id is in overrideNoteIds", async () => {
    mockSelect.mockImplementation(makeSelectHandler({ includeExcluded: true }))

    const { results } = await hybridSearch("topic", 8, {
      overrideNoteIds: ["note-excluded"],
    })

    const noteIds = results.map((r) => r.note_id)
    expect(noteIds).toContain("note-excluded")
  })

  it("does not include excluded note when a different note_id is overridden", async () => {
    mockSelect.mockImplementation(makeSelectHandler({ includeExcluded: true }))

    const { results } = await hybridSearch("topic", 8, {
      overrideNoteIds: ["note-some-other"],
    })

    const noteIds = results.map((r) => r.note_id)
    expect(noteIds).not.toContain("note-excluded")
  })

  it("multiple note_ids in overrideNoteIds all get included", async () => {
    const secondExcluded = {
      ...EXCLUDED_BLOCK,
      block_id:   "block-excluded-2",
      note_id:    "note-excluded-2",
      note_title: "Another Secret",
    }
    mockSelect.mockImplementation((sql: string) => {
      if (sql.includes("blocks_fts"))    return Promise.resolve([ACTIVE_BLOCK, EXCLUDED_BLOCK, secondExcluded])
      if (sql.includes("rag_excluded, 0) = 1")) return Promise.resolve([EXCLUDED_TITLE_ROW, { note_id: "note-excluded-2", title: "Another Secret" }])
      if (sql.includes("note_blocks nb")) return Promise.resolve([ACTIVE_BLOCK])
      return Promise.resolve([])
    })

    const { results } = await hybridSearch("topic", 8, {
      overrideNoteIds: ["note-excluded", "note-excluded-2"],
    })

    const noteIds = results.map((r) => r.note_id)
    expect(noteIds).toContain("note-excluded")
    expect(noteIds).toContain("note-excluded-2")
  })
})

// ─── excludedTitleMatches ─────────────────────────────────────────────────────

describe("excludedTitleMatches", () => {
  it("returns excluded title match when query hits an excluded note title", async () => {
    mockSelect.mockImplementation(makeSelectHandler())

    const { excludedTitleMatches } = await hybridSearch("Secret Note", 8)

    expect(excludedTitleMatches).toHaveLength(1)
    expect(excludedTitleMatches[0].note_id).toBe("note-excluded")
    expect(excludedTitleMatches[0].note_title).toBe("Secret Note")
  })

  it("returns empty excludedTitleMatches when no excluded notes match", async () => {
    mockSelect.mockImplementation(makeSelectHandler({ excludedTitleRows: [] }))

    const { excludedTitleMatches } = await hybridSearch("topic", 8)

    expect(excludedTitleMatches).toHaveLength(0)
  })

  it("does not include excluded note in results even when title matches", async () => {
    mockSelect.mockImplementation(makeSelectHandler({ includeExcluded: true }))

    const { results, excludedTitleMatches } = await hybridSearch("Secret Note", 8)

    expect(excludedTitleMatches.length).toBeGreaterThan(0)
    expect(results.map((r) => r.note_id)).not.toContain("note-excluded")
  })

  it("untitled notes are excluded from excludedTitleMatches", async () => {
    mockSelect.mockImplementation(makeSelectHandler({
      excludedTitleRows: [{ note_id: "note-untitled", title: "Untitled" }],
    }))

    const { excludedTitleMatches } = await hybridSearch("Untitled", 8)

    expect(excludedTitleMatches).toHaveLength(0)
  })
})

// ─── empty query ──────────────────────────────────────────────────────────────

describe("empty query", () => {
  it("returns empty results for blank query", async () => {
    const result = await hybridSearch("", 8)
    expect(result.results).toHaveLength(0)
    expect(result.excludedTitleMatches).toHaveLength(0)
  })

  it("returns empty results for whitespace-only query", async () => {
    const result = await hybridSearch("   ", 8)
    expect(result.results).toHaveLength(0)
  })
})