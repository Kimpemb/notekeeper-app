// src/features/ai/store/useChatSessionStore.m5.test.ts
//
// M5 — Reactive linked note lifecycle tests

import { describe, it, expect, beforeEach } from "vitest"
import { useChatSessionStore } from "./useChatSessionStore"

beforeEach(() => {
  useChatSessionStore.setState({
    sessions: {
      1: {
        linkedNoteId:      null,
        linkedNoteTitle:   null,
        lastSavedAt:       null,
        linkedNoteTrashed: false,
        linkedNoteDeleted: false,
      },
      2: {
        linkedNoteId:      null,
        linkedNoteTitle:   null,
        lastSavedAt:       null,
        linkedNoteTrashed: false,
        linkedNoteDeleted: false,
      },
    },
  })
})

// ─── Title updates ────────────────────────────────────────────────────────────

describe("setLinkedNoteTitle", () => {
  it("updates title when note is renamed", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNoteTitle(1, "New Title")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTitle).toBe("New Title")
  })

  it("does not affect linkedNoteId on rename", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNoteTitle(1, "New Title")
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-abc")
  })

  it("does not affect pane 2 when pane 1 title updates", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "Old Title")
    useChatSessionStore.getState().setLinkedNote(2, "note-xyz", "Pane 2 Note")
    useChatSessionStore.getState().setLinkedNoteTitle(1, "New Title")
    expect(useChatSessionStore.getState().getSession(2).linkedNoteTitle).toBe("Pane 2 Note")
  })
})

// ─── Trash lifecycle ──────────────────────────────────────────────────────────

describe("markLinkedNoteTrashed", () => {
  it("sets linkedNoteTrashed to true", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(true)
  })

  it("preserves linkedNoteId and title when trashed", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteId).toBe("note-abc")
    expect(s.linkedNoteTitle).toBe("My Note")
  })

  it("isLinked still returns true when trashed", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    expect(useChatSessionStore.getState().isLinked(1)).toBe(true)
  })
})

// ─── Restore lifecycle ────────────────────────────────────────────────────────

describe("markLinkedNoteRestored", () => {
  it("clears trashed flag after restore", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    useChatSessionStore.getState().markLinkedNoteRestored(1, "My Note")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(false)
  })

  it("updates title on restore", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "Old Title")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    useChatSessionStore.getState().markLinkedNoteRestored(1, "Restored Title")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTitle).toBe("Restored Title")
  })

  it("preserves linkedNoteId after restore", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    useChatSessionStore.getState().markLinkedNoteRestored(1, "My Note")
    expect(useChatSessionStore.getState().getLinkedNoteId(1)).toBe("note-abc")
  })
})

// ─── Permanent deletion ───────────────────────────────────────────────────────

describe("markLinkedNoteDeleted", () => {
  it("sets linkedNoteDeleted and clears linkedNoteId", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted(1)
    const s = useChatSessionStore.getState().getSession(1)
    expect(s.linkedNoteDeleted).toBe(true)
    expect(s.linkedNoteId).toBeNull()
    expect(s.linkedNoteTitle).toBeNull()
  })

  it("isLinked returns false after permanent deletion", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteDeleted(1)
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
  })

  it("clears trashed flag on permanent deletion", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "My Note")
    useChatSessionStore.getState().markLinkedNoteTrashed(1)
    useChatSessionStore.getState().markLinkedNoteDeleted(1)
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(false)
  })

  it("does not affect pane 2 when pane 1 note is deleted", () => {
    useChatSessionStore.getState().setLinkedNote(1, "note-abc", "Note 1")
    useChatSessionStore.getState().setLinkedNote(2, "note-xyz", "Note 2")
    useChatSessionStore.getState().markLinkedNoteDeleted(1)
    expect(useChatSessionStore.getState().isLinked(2)).toBe(true)
  })
})

// ─── Full lifecycle ───────────────────────────────────────────────────────────

describe("full lifecycle", () => {
  it("link → trash → restore → delete flows correctly", () => {
    const store = useChatSessionStore.getState()

    store.setLinkedNote(1, "note-abc", "My Note")
    expect(store.isLinked(1)).toBe(true)

    store.markLinkedNoteTrashed(1)
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(true)

    store.markLinkedNoteRestored(1, "My Note")
    expect(useChatSessionStore.getState().getSession(1).linkedNoteTrashed).toBe(false)

    store.markLinkedNoteDeleted(1)
    expect(useChatSessionStore.getState().isLinked(1)).toBe(false)
    expect(useChatSessionStore.getState().getSession(1).linkedNoteDeleted).toBe(true)
  })
})