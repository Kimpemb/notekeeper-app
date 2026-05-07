// src/features/ai/store/useChatSessionStore.test.ts

import { describe, it, expect, beforeEach } from "vitest"
import { useChatSessionStore } from "./useChatSessionStore"

// Reset store state before each test
beforeEach(() => {
  useChatSessionStore.setState({
    sessions: {
      1: {
        linkedNoteId:      null,
        linkedNoteTitle:   null,
        lastSavedAt:       null,
        linkedNoteTrashed: false,
        linkedNoteDeleted: false,
        ragScope:          "all",   // ← add this
      },
      2: {
        linkedNoteId:      null,
        linkedNoteTitle:   null,
        lastSavedAt:       null,
        linkedNoteTrashed: false,
        linkedNoteDeleted: false,
        ragScope:          "all",   // ← add this
      },
    },
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
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteId).toBe("note-abc")
    expect(s.linkedNoteTitle).toBe("My Note")
  })

  it("does not affect pane 2 when pane 1 is linked", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    expect(useChatSessionStore.getState().isLinked(2)).toBe(false)
  })

  it("clears trashed and deleted flags on link", () => {
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteDeleted).toBe(false)
  })

  it("panes are independent — linking pane 2 does not affect pane 1", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-111", "Note 1")
    useChatSessionStore.getState().setLinkedNote(2, "note-222", "Note 2")
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-111")
    expect(useChatSessionStore.getState().getLinkedNoteId(2)).toBe("note-222")
  })
})

// ─── setLinkedNoteTitle ───────────────────────────────────────────────────────

describe("setLinkedNoteTitle", () => {
  it("updates title without affecting other fields", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNoteTitle(1, "New Title")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteTitle).toBe("New Title")
    expect(s.linkedNoteId).toBe("note-abc")
  })
})

// ─── stampSavedAt ─────────────────────────────────────────────────────────────

describe("stampSavedAt", () => {
  it("sets lastSavedAt to a recent timestamp", () => {
    const before = Date.now()
    useChatSessionStore.getState().stampSavedAt(1)
    const after = Date.now()
    const ts = useChatSessionStore.getState().getSession(1).lastSavedAt
    expect(ts).not.toBeNull()
    expect(ts!).toBeGreaterThanOrEqual(before)
    expect(ts!).toBeLessThanOrEqual(after)
  })

  it("does not affect pane 2", () => {
    useChatSessionStore.getState().stampSavedAt(1)
    expect(useChatSessionStore.getState().getSession(2).lastSavedAt).toBeNull()
  })
})

// ─── markLinkedNoteTrashed ────────────────────────────────────────────────────

describe("markLinkedNoteTrashed", () => {
  it("sets linkedNoteTrashed to true", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(true)
  })

  it("preserves linkedNoteId when trashed", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-abc")
  })
})

// ─── markLinkedNoteDeleted ────────────────────────────────────────────────────

describe("markLinkedNoteDeleted", () => {
  it("sets linkedNoteDeleted to true and clears linkedNoteId", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted(1)
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteDeleted).toBe(true)
    expect(s.linkedNoteId).toBeNull()
    expect(s.linkedNoteTitle).toBeNull()
    expect(s.linkedNoteTrashed).toBe(false)
  })

  it("isLinked returns false after deletion", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted(1)
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
  })
})

// ─── markLinkedNoteRestored ───────────────────────────────────────────────────

describe("markLinkedNoteRestored", () => {
  it("clears trashed flag and updates title", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    useChatSessionStore.getState().markLinkedNoteRestored(1, "My Note Restored")
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteTitle).toBe("My Note Restored")
  })
})

// ─── clearSession ─────────────────────────────────────────────────────────────

describe("clearSession", () => {
  it("resets pane 1 to empty session", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().stampSavedAt(1)
    useChatSessionStore.getState().clearSession(1)
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteId).toBeNull()
    expect(s.linkedNoteTitle).toBeNull()
    expect(s.lastSavedAt).toBeNull()
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteDeleted).toBe(false)
  })

  it("does not affect pane 2 when pane 1 is cleared", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-111", "Note 1")
    useChatSessionStore.getState().setLinkedNote(2, "note-222", "Note 2")
    useChatSessionStore.getState().clearSession(1)
    expect(useChatSessionStore.getState().getLinkedNoteId(2)).toBe("note-222")
  })
})

// ─── getSession selector ──────────────────────────────────────────────────────

describe("getSession", () => {
  it("returns full session object for the pane", () => {
    useChatSessionStore.getState().setLinkedNote(2, "note-xyz", "XYZ")
    const s = useChatSessionStore.getState().getSession(2)
    expect(s.linkedNoteId).toBe("note-xyz")
    expect(s.linkedNoteTitle).toBe("XYZ")
    expect(s.linkedNoteTrashed).toBe(false)
    expect(s.linkedNoteDeleted).toBe(false)
  })
})