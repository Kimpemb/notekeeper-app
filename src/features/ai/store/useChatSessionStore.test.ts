// src/features/ai/store/useChatSessionStore.test.ts

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

// Reset store state before each test
beforeEach(() => {
  useChatSessionStore.setState({
    sessions: {
      "test-note-1": emptyTestSession(),
      "test-note-2": emptyTestSession(),
    },
    paneNoteId: { 1: "test-note-1", 2: "test-note-2" },
  })
})

// ─── Initial state ────────────────────────────────────────────────────────────

describe("initial state", () => {
  it("both panes start unlinked", () => {
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
    expect(useChatSessionStore.getState().isLinked(2)).toBe(false)
  })

  it("getLinkedNoteId returns null for both panes", () => {
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBeNull()
    expect(useChatSessionStore.getState().getLinkedNoteId(2)).toBeNull()
  })

  it("lastSavedAt is null on both panes", () => {
    expect(useChatSessionStore.getState().getSession(1).lastSavedAt).toBeNull()
    expect(useChatSessionStore.getState().getSession(2).lastSavedAt).toBeNull()
  })
})

// ─── setLinkedNote ────────────────────────────────────────────────────────────

describe("setLinkedNote", () => {
  it("links pane 1 to a note", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteId).toBe("note-abc")
    expect(s.linkedNoteTitle).toBe("My Note")
  })

  it("does not affect pane 2 when pane 1 is linked", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    expect(useChatSessionStore.getState().isLinked(2)).toBe(false)
  })

  it("clears trashed and deleted flags on link", () => {
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteDeleted).toBe(false)
  })

  it("panes are independent — linking pane 2 does not affect pane 1", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-111", "Note 1")
    useChatSessionStore.getState().setLinkedNote("test-note-2", "note-222", "Note 2")
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-111")
    expect(useChatSessionStore.getState().getLinkedNoteId(2)).toBe("note-222")
  })
})

// ─── setLinkedNoteTitle ───────────────────────────────────────────────────────

describe("setLinkedNoteTitle", () => {
  it("updates title without affecting other fields", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNoteTitle("test-note-1", "New Title")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteTitle).toBe("New Title")
    expect(s.linkedNoteId).toBe("note-abc")
  })
})

// ─── stampSavedAt ─────────────────────────────────────────────────────────────

describe("stampSavedAt", () => {
  it("sets lastSavedAt to a recent timestamp", () => {
    const before = Date.now()
    useChatSessionStore.getState().stampSavedAt("test-note-1")
    const after = Date.now()
    const ts = useChatSessionStore.getState().getSession(1).lastSavedAt
    expect(ts).not.toBeNull()
    expect(ts!).toBeGreaterThanOrEqual(before)
    expect(ts!).toBeLessThanOrEqual(after)
  })

  it("does not affect pane 2", () => {
    useChatSessionStore.getState().stampSavedAt("test-note-1")
    expect(useChatSessionStore.getState().getSession(2).lastSavedAt).toBeNull()
  })
})

// ─── markLinkedNoteTrashed ────────────────────────────────────────────────────

describe("markLinkedNoteTrashed", () => {
  it("sets linkedNoteTrashed to true", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(true)
  })

  it("preserves linkedNoteId when trashed", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-abc")
  })
})

// ─── markLinkedNoteDeleted ────────────────────────────────────────────────────

describe("markLinkedNoteDeleted", () => {
  it("sets linkedNoteDeleted to true and clears linkedNoteId", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted("test-note-1")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteDeleted).toBe(true)
    expect(s.linkedNoteId).toBeNull()
    expect(s.linkedNoteTitle).toBeNull()
    expect(s.linkedNoteTrashed).toBe(false)
  })

  it("isLinked returns false after deletion", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted("test-note-1")
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
  })
})

// ─── markLinkedNoteRestored ───────────────────────────────────────────────────

describe("markLinkedNoteRestored", () => {
  it("clears trashed flag and updates title", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed("test-note-1")
    useChatSessionStore.getState().markLinkedNoteRestored("test-note-1", "My Note Restored")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteTitle).toBe("My Note Restored")
  })
})

// ─── clearSession ─────────────────────────────────────────────────────────────

describe("clearSession", () => {
  it("resets pane 1 to empty session", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-abc", "My Note")
    useChatSessionStore.getState().stampSavedAt("test-note-1")
    useChatSessionStore.getState().clearSession("test-note-1")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteId).toBeNull()
    expect(s.linkedNoteTitle).toBeNull()
    expect(s.lastSavedAt).toBeNull()
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteDeleted).toBe(false)
  })

  it("does not affect pane 2 when pane 1 is cleared", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-1", "note-111", "Note 1")
    useChatSessionStore.getState().setLinkedNote("test-note-2", "note-222", "Note 2")
    useChatSessionStore.getState().clearSession("test-note-1")
    expect(useChatSessionStore.getState().getLinkedNoteId(2)).toBe("note-222")
  })
})

// ─── getSession selector ──────────────────────────────────────────────────────

describe("getSession", () => {
  it("returns full session object for the pane", () => {
    useChatSessionStore.getState().setLinkedNote("test-note-2", "note-xyz", "XYZ")
    const s = useChatSessionStore.getState().getSession(2)
    expect(s.linkedNoteId).toBe("note-xyz")
    expect(s.linkedNoteTitle).toBe("XYZ")
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteDeleted).toBe(false)
  })
})

// ─── ragScope ─────────────────────────────────────────────────────────────────

describe("ragScope", () => {
  it("defaults to 'all' on both panes", () => {
    expect(useChatSessionStore.getState().getSession(1).ragScope).toBe("all")
    expect(useChatSessionStore.getState().getSession(2).ragScope).toBe("all")
  })

  it("setRagScope switches pane 1 to 'note'", () => {
    useChatSessionStore.getState().setRagScope("test-note-1", "note")
    expect(useChatSessionStore.getState().getSession(1).ragScope).toBe("note")
  })

  it("setRagScope does not affect pane 2", () => {
    useChatSessionStore.getState().setRagScope("test-note-1", "note")
    expect(useChatSessionStore.getState().getSession(2).ragScope).toBe("all")
  })

  it("setRagScope can switch back to 'all'", () => {
    useChatSessionStore.getState().setRagScope("test-note-1", "note")
    useChatSessionStore.getState().setRagScope("test-note-1", "all")
    expect(useChatSessionStore.getState().getSession(1).ragScope).toBe("all")
  })

  it("clearSession resets ragScope to 'all'", () => {
    useChatSessionStore.getState().setRagScope("test-note-1", "note")
    useChatSessionStore.getState().clearSession("test-note-1")
    expect(useChatSessionStore.getState().getSession(1).ragScope).toBe("all")
  })

  it("panes have independent ragScope", () => {
    useChatSessionStore.getState().setRagScope("test-note-1", "note")
    useChatSessionStore.getState().setRagScope("test-note-2", "all")
    expect(useChatSessionStore.getState().getSession(1).ragScope).toBe("note")
    expect(useChatSessionStore.getState().getSession(2).ragScope).toBe("all")
  })
})