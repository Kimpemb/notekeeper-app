// src/features/ai/store/useChatSessionStore.m5.test.ts
//
// M5 — Reactive linked note lifecycle tests

import { describe, it, expect, beforeEach } from "vitest"
import { useChatSessionStore } from "./useChatSessionStore"
import type { ChatMessage } from "@/features/ai/lib/chat"

// Helper to create a valid empty session
function emptyTestSession() {
  return {
    messages:          [] as ChatMessage[],
    persistedMeta:     [],
    linkedNoteId:      null as string | null,
    linkedNoteTitle:   null as string | null,
    lastSavedAt:       null as number | null,
    ragScope:          "all" as "all" | "note",
    webSearchEnabled:  false,
    updatedAt:         Date.now(),
    linkedNoteTrashed: false,
    linkedNoteDeleted: false,
    isLoading:         false,
  }
}

beforeEach(() => {
  useChatSessionStore.setState({
    sessions: {
      "test-note-1": emptyTestSession(),
      "test-note-2": emptyTestSession(),
    },
    paneNoteId: { 1: "test-note-1", 2: "test-note-2" },
  })
})

// ─── Title updates ────────────────────────────────────────────────────────────

describe("setLinkedNoteTitle", () => {
  it("updates title when note is renamed", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNoteTitle("test-note-1", "New Title")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTitle).toBe("New Title")
  })

  it("does not affect linkedNoteId on rename", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNoteTitle("test-note-1", "New Title")
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-abc")
  })

  it("does not affect pane 2 when pane 1 title updates", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNote("test-note-2", "note-xyz", "Pane 2 Note")
    useChatSessionStore.getState().setLinkedNoteTitle("test-note-1", "New Title")
    expect(useChatSessionStore.getState().getSession(2).linkedNoteTitle).toBe("Pane 2 Note")
  })
})

// ─── Trash lifecycle ──────────────────────────────────────────────────────────

describe("markLinkedNoteTrashed", () => {
  it("sets linkedNoteTrashed to true", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(true)
  })

  it("preserves linkedNoteId and title when trashed", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteId).toBe("note-abc")
    expect(s.linkedNoteTitle).toBe("My Note")
  })

  it("isLinked still returns true when trashed", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    expect(useChatSessionStore.getState().isLinked(1)).toBe(true)
  })
})

// ─── Restore lifecycle ────────────────────────────────────────────────────────

describe("markLinkedNoteRestored", () => {
  it("clears trashed flag after restore", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    useChatSessionStore.getState().markLinkedNoteRestored("test-note-1", "My Note")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(false)
  })

  it("updates title on restore", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "Old Title")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    useChatSessionStore.getState().markLinkedNoteRestored("test-note-1", "Restored Title")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTitle).toBe("Restored Title")
  })

  it("preserves linkedNoteId after restore", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    useChatSessionStore.getState().markLinkedNoteRestored("test-note-1", "My Note")
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-abc")
  })
})

// ─── Permanent deletion ───────────────────────────────────────────────────────

describe("markLinkedNoteDeleted", () => {
  it("sets linkedNoteDeleted and clears linkedNoteId", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted("test-note-1")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteDeleted).toBe(true)
    expect(s.linkedNoteId).toBeNull()
    expect(s.linkedNoteTitle).toBeNull()
  })

  it("isLinked returns false after permanent deletion", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted("test-note-1")
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
  })

  it("clears trashed flag on permanent deletion", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    useChatSessionStore.getState().markLinkedNoteDeleted("test-note-1")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(false)
  })

  it("does not affect pane 2 when pane 1 note is deleted", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "Note 1")
    useChatSessionStore.getState().setLinkedNote("test-note-2", "note-xyz", "Note 2")
    useChatSessionStore.getState().markLinkedNoteDeleted("test-note-1")
    expect(useChatSessionStore.getState().isLinked(2)).toBe(true)
  })
})

// ─── Full lifecycle ───────────────────────────────────────────────────────────

describe("full lifecycle", () => {
  it("link → trash → restore → delete flows correctly", () => {
    const store = useChatSessionStore.getState()

    store.setLinkedNote("test-note-1", "note-abc", "My Note")
    expect(store.isLinked(1)).toBe(true)

    store.markLinkedNoteTrashed("test-note-1")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(true)

    store.markLinkedNoteRestored("test-note-1", "My Note")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(false)

    store.markLinkedNoteDeleted("test-note-1")
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
    expect(useChatSessionStore.getState().getSession(1).linkedNoteDeleted).toBe(true)
  })
})