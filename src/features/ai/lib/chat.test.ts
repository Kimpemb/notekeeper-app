// src/features/ai/lib/chat.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/features/notes/db/client", () => ({
  getDb: vi.fn(),
}))

vi.mock("@/features/ai/lib/client", () => ({
  isAIReady:               vi.fn().mockReturnValue(false),
  callPrimary:             vi.fn(),
  promptPrimary:           vi.fn(),
  promptProcessing:        vi.fn(),
  ProcessingExhaustedError: class ProcessingExhaustedError extends Error {
    constructor(message = "exhausted") { super(message); this.name = "ProcessingExhaustedError" }
  },
}))

vi.mock("@/features/ai/lib/search/hybrid", () => ({
  hybridSearch:  vi.fn().mockResolvedValue({ results: [], excludedTitleMatches: [] }),
  expandContext: vi.fn().mockImplementation((r: any[]) => Promise.resolve(r)),
}))

vi.mock("@/features/ai/lib/search/intentDetection", () => ({
  detectIntent: vi.fn().mockReturnValue({
    intent:     "lookup",
    scope:      {},
    cleanQuery: "what is in Bentancur",
    isDeixis:   false,
    isPersonal: false,
    isFollowUp: false,
  }),
}))

// Pulled in by chat.ts for the web-search-nudge feature. Without this mock,
// importing chat.ts transitively drags in useAppSettings -> SettingsModal.tsx
// -> useUIStore, which touches `window` at module-eval time and crashes any
// test environment without a DOM (this repo's vitest config uses "node").
vi.mock("@/features/ai/lib/search/webSearchProvider", () => ({
  WEB_SEARCH_SCORE_THRESHOLD: 0.5,
  WEB_SEARCH_MIN_CHUNKS:      1,
  getWebSearchProvider:       vi.fn(),
}))

// Pulled in by chat.ts for AI write-tool confirmation UX. Without this mock,
// importing chat.ts transitively drags in writeTools.ts -> parseMarkdown.ts ->
// editor/NoteLink.ts -> editor/NoteLinkView.tsx -> useUIStore, a second,
// independent static import chain into the same window-at-module-eval-time
// crash that webSearchProvider.ts causes via a different route.
vi.mock("@/features/ai/lib/tools/confirmationGate", () => ({
  useConfirmationGate: {
    getState: () => ({
      pendingWrites:   new Map(),
      addPendingWrite: vi.fn(),
    }),
  },
  awaitWriteDecision: vi.fn(),
  buildWritePreview:  vi.fn(),
}))

vi.mock("@/features/notes/db/queries", () => ({
  getAIHistory:            vi.fn().mockResolvedValue([]),
  appendAIHistory:         vi.fn().mockResolvedValue(undefined),
  getConversationSummary:  vi.fn().mockResolvedValue(null),
  saveConversationSummary: vi.fn().mockResolvedValue(undefined),
  getAllNotesMeta:          vi.fn().mockResolvedValue([]),
  getAllDescendants:        vi.fn().mockResolvedValue([]),
}))

import { streamChatWithNotes } from "@/features/ai/lib/chat"
import { hybridSearch }        from "@/features/ai/lib/search/hybrid"
import { getDb }               from "@/features/notes/db/client"
import { detectIntent }        from "@/features/ai/lib/search/intentDetection"

const mockGetDb        = vi.mocked(getDb)
const mockHybridSearch = vi.mocked(hybridSearch)
const mockDetectIntent = vi.mocked(detectIntent)

let mockSelect:  any
let mockExecute: any

beforeEach(() => {
  vi.clearAllMocks()
  mockSelect  = vi.fn().mockResolvedValue([])
  mockExecute = vi.fn().mockResolvedValue(undefined)
  mockGetDb.mockResolvedValue({ select: mockSelect, execute: mockExecute } as any)
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EXCLUDED_NOTE = {
  note_id: "note-excluded",
  title:   "Bentancur",
}

const MOCK_NOTE = {
  id:           "note-current",
  title:        "Current Note",
  plaintext:    "",
  content:      "{}",
  tags:         null,
  frontmatter:  null,
  parent_id:    null,
  sync_id:      "sync-1",
  created_at:   Date.now(),
  updated_at:   Date.now(),
  deleted_at:   null,
  sort_order:   0,
  is_canvas:    false,
  canvas_state: null,
  rag_excluded: 0,
}

function makeStreaming() {
  const chunks: string[] = []
  return {
    onChunk: (t: string) => chunks.push(t),
    onDone:  vi.fn(),
    onError: vi.fn(),
    chunks,
  }
}

// ─── excluded note notices ────────────────────────────────────────────────────

describe("excluded note notices", () => {
  it("surfaces excludedNoteNotices when detectTitleQuery finds an excluded note", async () => {
    mockSelect.mockImplementation((sql: string) => {
      if (sql.includes("rag_excluded, 0) = 1")) {
        return Promise.resolve([{ note_id: EXCLUDED_NOTE.note_id, title: EXCLUDED_NOTE.title }])
      }
      return Promise.resolve([])
    })

    const streaming = makeStreaming()
    const result = await streamChatWithNotes(
      "what is in Bentancur",
      [],
      "note-current",
      MOCK_NOTE as any,
      undefined,
      streaming,
    )

    expect(result.excludedNoteNotices).toBeDefined()
    expect(result.excludedNoteNotices!.length).toBeGreaterThan(0)
    expect(result.excludedNoteNotices![0].note_id).toBe("note-excluded")
  })

  it("excludedNoteNotices is empty when no excluded notes match", async () => {
    mockSelect.mockResolvedValue([])

    const streaming = makeStreaming()
    const result = await streamChatWithNotes(
      "what is in Bentancur",
      [],
      "note-current",
      MOCK_NOTE as any,
      undefined,
      streaming,
    )

    expect(result.excludedNoteNotices ?? []).toHaveLength(0)
  })

  it("notice suppressed when overrideNoteIds includes the excluded note", async () => {
    mockSelect.mockImplementation((sql: string) => {
      if (sql.includes("rag_excluded, 0) = 1")) {
        return Promise.resolve([{ note_id: EXCLUDED_NOTE.note_id, title: EXCLUDED_NOTE.title }])
      }
      return Promise.resolve([])
    })

    const streaming = makeStreaming()
    const result = await streamChatWithNotes(
      "what is in Bentancur",
      [],
      "note-current",
      MOCK_NOTE as any,
      undefined,
      streaming,
      ["note-excluded"],
    )

    expect(result.excludedNoteNotices ?? []).toHaveLength(0)
  })

  it("hybridSearch receives overrideNoteIds when passed", async () => {
    mockSelect.mockResolvedValue([])
    mockHybridSearch.mockResolvedValue({ results: [], excludedTitleMatches: [], lowTermCoverage: false })

    const streaming = makeStreaming()
    await streamChatWithNotes(
      "how does indexing work",
      [],
      "note-current",
      MOCK_NOTE as any,
      undefined,
      streaming,
      ["note-excluded"],
    )

    expect(mockHybridSearch).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ overrideNoteIds: ["note-excluded"] })
    )
  })

  it("hybridSearch not passed overrideNoteIds when none provided", async () => {
    mockSelect.mockResolvedValue([])
    mockHybridSearch.mockResolvedValue({ results: [], excludedTitleMatches: [], lowTermCoverage: false })

    const streaming = makeStreaming()
    await streamChatWithNotes(
      "how does indexing work",
      [],
      "note-current",
      MOCK_NOTE as any,
      undefined,
      streaming,
    )

    expect(mockHybridSearch).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.not.objectContaining({ overrideNoteIds: expect.anything() })
    )
  })
})

// ─── titleMatchedNoteIds ──────────────────────────────────────────────────────

describe("titleMatchedNoteIds", () => {
  it("is empty when no title match found", async () => {
    mockSelect.mockResolvedValue([])

    const streaming = makeStreaming()
    const result = await streamChatWithNotes(
      "what is in Bentancur",
      [],
      "note-current",
      MOCK_NOTE as any,
      undefined,
      streaming,
    )

    expect(result.titleMatchedNoteIds ?? []).toHaveLength(0)
  })

  it("contains matched note id when active note found by title", async () => {
    mockSelect.mockImplementation((sql: string) => {
      if (sql.includes("rag_excluded, 0) = 1"))  return Promise.resolve([])
      if (sql.includes("note_title_chunks") && sql.includes("rag_excluded, 0) = 0")) {
        return Promise.resolve([{ note_id: "note-bentancur", title: "Bentancur" }])
      }
      if (sql.includes("note_blocks nb")) {
        return Promise.resolve([{
          block_id:      "block-1",
          plaintext:     "Bentancur content",
          chunk_heading: null,
          source_type:   "note",
          breadcrumb:    "Bentancur",
        }])
      }
      return Promise.resolve([])
    })

    const streaming = makeStreaming()
    const result = await streamChatWithNotes(
      "what is in Bentancur",
      [],
      "note-current",
      MOCK_NOTE as any,
      undefined,
      streaming,
    )

    expect(result.titleMatchedNoteIds).toContain("note-bentancur")
  })
})

// ─── detectIntent dedup (runPipeline precomputedIntent) ───────────────────────
//
// streamChatWithNotes used to call detectIntent(query) once directly (for
// budget allocation) and runPipeline called detectIntent(query) again
// internally with the identical query, concurrently, in the same Promise.all —
// two calls to the processing-slot classifier per message for the same input.
// runPipeline now accepts an optional precomputedIntent and only falls back
// to calling detectIntent itself when the caller doesn't already have one.

describe("runPipeline precomputedIntent", () => {
  it("calls detectIntent when no precomputedIntent is provided", async () => {
    mockSelect.mockResolvedValue([])
    const { runPipeline } = await import("@/features/ai/lib/chat")

    await runPipeline("what is in Bentancur", MOCK_NOTE as any)

    expect(mockDetectIntent).toHaveBeenCalledTimes(1)
    expect(mockDetectIntent).toHaveBeenCalledWith("what is in Bentancur")
  })

  it("skips its own detectIntent call when a precomputedIntent is passed in", async () => {
    mockSelect.mockResolvedValue([])
    const { runPipeline } = await import("@/features/ai/lib/chat")

    const precomputed = {
      intent:     "lookup" as const,
      scope:      {},
      cleanQuery: "already classified query",
      isDeixis:   false,
      isPersonal: false,
      isFollowUp: false,
    }

    const result = await runPipeline(
      "what is in Bentancur",
      MOCK_NOTE as any,
      undefined,
      undefined,
      undefined,
      precomputed,
    )

    expect(mockDetectIntent).not.toHaveBeenCalled()
    expect(result.detectedIntent).toBe("lookup")
  })

  it("uses the precomputed intent's cleanQuery for retrieval, not the raw query", async () => {
    mockSelect.mockResolvedValue([])
    mockHybridSearch.mockResolvedValue({ results: [], excludedTitleMatches: [], lowTermCoverage: false })
    const { runPipeline } = await import("@/features/ai/lib/chat")

    const precomputed = {
      intent:     "lookup" as const,
      scope:      {},
      cleanQuery: "cleaned version of the query",
      isDeixis:   false,
      isPersonal: false,
      isFollowUp: false,
    }

    await runPipeline(
      "what is in Bentancur, raw and unclean",
      MOCK_NOTE as any,
      undefined,
      undefined,
      undefined,
      precomputed,
    )

    expect(mockHybridSearch).toHaveBeenCalledWith(
      "cleaned version of the query",
      expect.any(Number),
      expect.anything(),
    )
  })
})

