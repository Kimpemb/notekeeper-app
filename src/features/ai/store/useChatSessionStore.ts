// src/features/ai/store/useChatSessionStore.ts
//
// Holds per-pane linked note state for the Context Vault save flow.
// Intentionally thin — only what M2–M5 need. Extended in later milestones.
//
// One session per pane (1 | 2). A session is created implicitly on first
// save and cleared when the user clicks "New conversation".

import { create } from "zustand"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatSession {
  /** ID of the note this chat is linked to. null = unlinked. */
  linkedNoteId:   string | null
  /** Title at the time of last save — used for the indicator label.
   *  Kept in sync reactively in M5 via Zustand subscription. */
  linkedNoteTitle: string | null
  /** Unix ms timestamp of the last successful save. Used for conflict
   *  detection in M4: compare against notes.updated_at. */
  lastSavedAt:    number | null
  /** Whether the linked note has been trashed since the last save. */
  linkedNoteTrashed: boolean
  /** Whether the linked note has been permanently deleted. */
  linkedNoteDeleted: boolean
}

interface ChatSessionStore {
  sessions: Record<1 | 2, ChatSession>

  // Called after every successful save
  setLinkedNote: (pane: 1 | 2, noteId: string, noteTitle: string) => void

  // Update the cached title when the note is renamed/moved
  setLinkedNoteTitle: (pane: 1 | 2, title: string) => void

  // Stamp last_saved_at — called immediately after DB write completes
  stampSavedAt: (pane: 1 | 2) => void

  // Lifecycle events for linked note (M5)
  markLinkedNoteTrashed:  (pane: 1 | 2) => void
  markLinkedNoteDeleted:  (pane: 1 | 2) => void
  markLinkedNoteRestored: (pane: 1 | 2, title: string) => void

  // Called by "New conversation" button — resets everything for the pane
  clearSession: (pane: 1 | 2) => void

  // Selectors
  getSession:       (pane: 1 | 2) => ChatSession
  isLinked:         (pane: 1 | 2) => boolean
  getLinkedNoteId:  (pane: 1 | 2) => string | null
}

// ─── Default session ──────────────────────────────────────────────────────────

function emptySession(): ChatSession {
  return {
    linkedNoteId:      null,
    linkedNoteTitle:   null,
    lastSavedAt:       null,
    linkedNoteTrashed: false,
    linkedNoteDeleted: false,
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useChatSessionStore = create<ChatSessionStore>((set, get) => ({
  sessions: {
    1: emptySession(),
    2: emptySession(),
  },

  setLinkedNote: (pane, noteId, noteTitle) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [pane]: {
          ...s.sessions[pane],
          linkedNoteId:      noteId,
          linkedNoteTitle:   noteTitle,
          linkedNoteTrashed: false,
          linkedNoteDeleted: false,
        },
      },
    })),

  setLinkedNoteTitle: (pane, title) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [pane]: { ...s.sessions[pane], linkedNoteTitle: title },
      },
    })),

  stampSavedAt: (pane) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [pane]: { ...s.sessions[pane], lastSavedAt: Date.now() },
      },
    })),

  markLinkedNoteTrashed: (pane) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [pane]: { ...s.sessions[pane], linkedNoteTrashed: true },
      },
    })),

  markLinkedNoteDeleted: (pane) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [pane]: {
          ...s.sessions[pane],
          linkedNoteId:      null,
          linkedNoteTitle:   null,
          linkedNoteTrashed: false,
          linkedNoteDeleted: true,
        },
      },
    })),

  markLinkedNoteRestored: (pane, title) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [pane]: {
          ...s.sessions[pane],
          linkedNoteTrashed: false,
          linkedNoteTitle:   title,
        },
      },
    })),

  clearSession: (pane) =>
    set((s) => ({
      sessions: { ...s.sessions, [pane]: emptySession() },
    })),

  getSession:      (pane) => get().sessions[pane],
  isLinked:        (pane) => get().sessions[pane].linkedNoteId !== null,
  getLinkedNoteId: (pane) => get().sessions[pane].linkedNoteId,
}))