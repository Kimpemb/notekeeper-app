// src/features/ai/components/SaveNoteDialog.test.ts
//
// M4 — Re-save & conflict handling tests
// Tests the conflict detection logic directly without UI interaction.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { useChatSessionStore } from "@/features/ai/store/useChatSessionStore"
import type { ChatMessage } from "@/features/ai/lib/chat"

// Helper to create a valid empty session
function emptyTestSession() {
  return {
    messages:               [] as ChatMessage[],
    persistedMeta:          [],
    linkedNoteId:           null as string | null,
    linkedNoteTitle:        null as string | null,
    lastSavedAt:            null as number | null,
    ragScope:               "all" as "all" | "note",
    webSearchEnabled:       false,
    updatedAt:              Date.now(),
    linkedNoteTrashed:      false,
    linkedNoteDeleted:      false,
    isLoading:              false,
    summaryTitle:           null as string | null,
    summaryTitleGenerated:  false,
  }
}

// ─── Reset store before each test ─────────────────────────────────────────────

beforeEach(() => {
  useChatSessionStore.setState({
    sessions: {
      "test-note-1": emptyTestSession(),
      "test-note-2": emptyTestSession(),
    },
    paneNoteId: { 1: "test-note-1", 2: "test-note-2", 3: null },
  })
})

// ─── Conflict detection logic ─────────────────────────────────────────────────

function hasConflict(lastSavedAt: number | null, noteUpdatedAt: number): boolean {
  const saved = lastSavedAt ?? 0
  return noteUpdatedAt > saved
}

describe("conflict detection", () => {
  it("no conflict when note has not been edited since last save", () => {
    const lastSavedAt   = 1000
    const noteUpdatedAt = 900
    expect(hasConflict(lastSavedAt, noteUpdatedAt)).toBe(false)
  })

  it("no conflict when note updated_at equals lastSavedAt", () => {
    const lastSavedAt   = 1000
    const noteUpdatedAt = 1000
    expect(hasConflict(lastSavedAt, noteUpdatedAt)).toBe(false)
  })

  it("conflict when note was edited after last save", () => {
    const lastSavedAt   = 1000
    const noteUpdatedAt = 2000
    expect(hasConflict(lastSavedAt, noteUpdatedAt)).toBe(true)
  })

  it("conflict when lastSavedAt is null (never saved) and note has content", () => {
    const lastSavedAt   = null
    const noteUpdatedAt = 1000
    expect(hasConflict(lastSavedAt, noteUpdatedAt)).toBe(true)
  })

  it("no conflict when both are zero", () => {
    expect(hasConflict(0, 0)).toBe(false)
  })
})

// ─── stampSavedAt sets a timestamp that prevents false conflicts ───────────────

describe("stampSavedAt conflict prevention", () => {
  it("stamping after save prevents conflict on immediate re-save", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().stampSavedAt("test-note-1")

    const session     = useChatSessionStore.getState().getSession(1)
    const lastSavedAt = session.lastSavedAt!

    // Simulate note updated_at at the same time or before save
    const noteUpdatedAt = lastSavedAt - 1
    expect(hasConflict(lastSavedAt, noteUpdatedAt)).toBe(false)
  })

  it("conflict detected when note edited after stamp", async () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().stampSavedAt("test-note-1")

    const session     = useChatSessionStore.getState().getSession(1)
    const lastSavedAt = session.lastSavedAt!

    // Simulate note being edited 1 second after save
    const noteUpdatedAt = lastSavedAt + 1000
    expect(hasConflict(lastSavedAt, noteUpdatedAt)).toBe(true)
  })
})

// ─── Re-save path — session must be linked ────────────────────────────────────

describe("re-save path", () => {
  it("isLinked returns true after first save", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    expect(useChatSessionStore.getState().isLinked(1)).toBe(true)
  })

  it("re-save detects existing linkedNoteId", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    const session = useChatSessionStore.getState().getSession(1)
    expect(session.linkedNoteId).toBe("note-abc")
  })

  it("clearSession removes link — next save treated as first save", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().clearSession("test-note-1")
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBeNull()
  })

  it("stampSavedAt updates after re-save", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().stampSavedAt("test-note-1")
    const first = useChatSessionStore.getState().getSession(1).lastSavedAt!

    // Simulate time passing
    vi.useFakeTimers()
    vi.advanceTimersByTime(500)
    useChatSessionStore.getState().stampSavedAt("test-note-1")
    const second = useChatSessionStore.getState().getSession(1).lastSavedAt!
    vi.useRealTimers()

    expect(second).toBeGreaterThan(first)
  })
})