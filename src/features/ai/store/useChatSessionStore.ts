// src/features/ai/store/useChatSessionStore.ts
//
// Chat session store — keyed by noteId, not pane.
// Panes hold a pointer (paneNoteId) to whichever noteId they're showing.
// Persistence: messages + durable metadata only. Ephemeral UI state stays local.

import { create } from "zustand"
import {
  getChatSession,
  saveChatSession,
  deleteChatSession,
  type PersistedMeta,
  type PersistedChatSession,
} from "@/features/notes/db/queries"
import type { ChatMessage } from "@/features/ai/lib/chat"


// ─── Types ────────────────────────────────────────────────────────────────────

export type { PersistedMeta }

export interface RuntimeSession extends PersistedChatSession {
  linkedNoteTrashed: boolean
  linkedNoteDeleted: boolean
  isLoading:         boolean
}

interface ChatSessionStore {
  sessions:    Record<string, RuntimeSession>
  paneNoteId:  Record<1 | 2, string | null>

  // ── Pane pointer ────────────────────────────────────────────────────────────
  setPaneNote: (pane: 1 | 2, noteId: string) => Promise<void>

  // ── DB load / save ──────────────────────────────────────────────────────────
  loadSession: (noteId: string) => Promise<void>
  saveSession: (noteId: string) => Promise<void>

  // ── Message mutations (in-memory only — DB written after completion) ────────
  addMessage:        (noteId: string, message: ChatMessage) => void
  setMessageContent: (noteId: string, messageId: string, content: string) => void
  setPersistedMeta:  (noteId: string, messageId: string, meta: PersistedMeta) => void

  // ── Session metadata ────────────────────────────────────────────────────────
  setLinkedNote:       (noteId: string, linkedId: string, title: string) => void
  setLinkedNoteTitle:  (noteId: string, title: string) => void
  stampSavedAt:        (noteId: string) => void
  setRagScope:         (noteId: string, scope: "all" | "note") => void
  setWebSearchEnabled: (noteId: string, enabled: boolean) => void

  // ── Note lifecycle events ───────────────────────────────────────────────────
  markLinkedNoteTrashed:  (noteId: string) => void
  markLinkedNoteDeleted:  (noteId: string) => void
  markLinkedNoteRestored: (noteId: string, title: string) => void

  // ── Clear ───────────────────────────────────────────────────────────────────
  clearSession: (noteId: string) => Promise<void>

  // ── Selectors ───────────────────────────────────────────────────────────────
  getSession:        (pane: 1 | 2) => RuntimeSession
  getSessionByNoteId:(noteId: string) => RuntimeSession
  isLinked:          (pane: 1 | 2) => boolean
  getLinkedNoteId:   (pane: 1 | 2) => string | null
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function emptySession(): RuntimeSession {
  return {
    messages:          [],
    persistedMeta:     [],
    linkedNoteId:      null,
    linkedNoteTitle:   null,
    lastSavedAt:       null,
    ragScope:          "all",
    webSearchEnabled:  false,
    updatedAt:         Date.now(),
    linkedNoteTrashed: false,
    linkedNoteDeleted: false,
    isLoading:         false,
  }
}

function toPersistedSession(s: RuntimeSession): PersistedChatSession {
  return {
    messages:         s.messages,
    persistedMeta:    s.persistedMeta,
    linkedNoteId:     s.linkedNoteId,
    linkedNoteTitle:  s.linkedNoteTitle,
    lastSavedAt:      s.lastSavedAt,
    ragScope:         s.ragScope,
    webSearchEnabled: s.webSearchEnabled,
    updatedAt:        s.updatedAt,
  }
}

// ─── Debounce helper ──────────────────────────────────────────────────────────

const _saveTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function debouncedSave(noteId: string, fn: () => void, ms = 500) {
  clearTimeout(_saveTimers[noteId])
  _saveTimers[noteId] = setTimeout(fn, ms)
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useChatSessionStore = create<ChatSessionStore>((set, get) => ({
  sessions:   {},
  paneNoteId: { 1: null, 2: null },

  // ── setPaneNote ─────────────────────────────────────────────────────────────
  setPaneNote: async (pane, noteId) => {
    set((s) => ({ paneNoteId: { ...s.paneNoteId, [pane]: noteId } }))
    if (!get().sessions[noteId]) {
      await get().loadSession(noteId)
    }
  },

  // ── loadSession ─────────────────────────────────────────────────────────────
  loadSession: async (noteId) => {
    set((s) => ({
      sessions: {
        ...s.sessions,
        [noteId]: { ...(s.sessions[noteId] ?? emptySession()), isLoading: true },
      },
    }))
    try {
      const persisted = await getChatSession(noteId)
      set((s) => ({
        sessions: {
          ...s.sessions,
          [noteId]: {
            ...(persisted ?? {}),
            messages:          persisted?.messages         ?? [],
            persistedMeta:     persisted?.persistedMeta    ?? [],
            linkedNoteId:      persisted?.linkedNoteId     ?? null,
            linkedNoteTitle:   persisted?.linkedNoteTitle  ?? null,
            lastSavedAt:       persisted?.lastSavedAt      ?? null,
            ragScope:          persisted?.ragScope         ?? "all",
            webSearchEnabled:  persisted?.webSearchEnabled ?? false,
            updatedAt:         persisted?.updatedAt        ?? Date.now(),
            linkedNoteTrashed: false,
            linkedNoteDeleted: false,
            isLoading:         false,
          },
        },
      }))
    } catch {
      set((s) => ({
        sessions: {
          ...s.sessions,
          [noteId]: { ...(s.sessions[noteId] ?? emptySession()), isLoading: false },
        },
      }))
    }
  },

  // ── saveSession ─────────────────────────────────────────────────────────────
  saveSession: async (noteId) => {
    const session = get().sessions[noteId]
    if (!session) return
    await saveChatSession(noteId, toPersistedSession(session))
  },

  // ── addMessage ──────────────────────────────────────────────────────────────
  addMessage: (noteId, message) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      return {
        sessions: {
          ...s.sessions,
          [noteId]: { ...session, messages: [...session.messages, message] },
        },
      }
    })
  },

  // ── setMessageContent ────────────────────────────────────────────────────────
  setMessageContent: (noteId, messageId, content) => {
    set((s) => {
      const session = s.sessions[noteId]
      if (!session) return s
      return {
        sessions: {
          ...s.sessions,
          [noteId]: {
            ...session,
            messages: session.messages.map((m) =>
              m.id === messageId ? { ...m, content } : m
            ),
          },
        },
      }
    })
  },

  // ── setPersistedMeta ─────────────────────────────────────────────────────────
  setPersistedMeta: (noteId, messageId, meta) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      const existing = session.persistedMeta.filter((m) => m.messageId !== messageId)
      const updated = { ...session, persistedMeta: [...existing, meta], updatedAt: Date.now() }
      debouncedSave(noteId, () => saveChatSession(noteId, toPersistedSession(get().sessions[noteId])))
      return { sessions: { ...s.sessions, [noteId]: updated } }
    })
  },

  // ── setLinkedNote ────────────────────────────────────────────────────────────
  setLinkedNote: (noteId, linkedId, title) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      const updated = {
        ...session,
        linkedNoteId:      linkedId,
        linkedNoteTitle:   title,
        linkedNoteTrashed: false,
        linkedNoteDeleted: false,
        updatedAt:         Date.now(),
      }
      debouncedSave(noteId, () => saveChatSession(noteId, toPersistedSession(get().sessions[noteId])))
      return { sessions: { ...s.sessions, [noteId]: updated } }
    })
  },

  // ── setLinkedNoteTitle ───────────────────────────────────────────────────────
  setLinkedNoteTitle: (noteId, title) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      const updated = { ...session, linkedNoteTitle: title, updatedAt: Date.now() }
      debouncedSave(noteId, () => saveChatSession(noteId, toPersistedSession(get().sessions[noteId])))
      return { sessions: { ...s.sessions, [noteId]: updated } }
    })
  },

  // ── stampSavedAt ─────────────────────────────────────────────────────────────
  stampSavedAt: (noteId) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      const updated = { ...session, lastSavedAt: Date.now(), updatedAt: Date.now() }
      debouncedSave(noteId, () => saveChatSession(noteId, toPersistedSession(get().sessions[noteId])))
      return { sessions: { ...s.sessions, [noteId]: updated } }
    })
  },

  // ── setRagScope ──────────────────────────────────────────────────────────────
  setRagScope: (noteId, scope) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      const updated = { ...session, ragScope: scope, updatedAt: Date.now() }
      debouncedSave(noteId, () => saveChatSession(noteId, toPersistedSession(get().sessions[noteId])))
      return { sessions: { ...s.sessions, [noteId]: updated } }
    })
  },

  // ── setWebSearchEnabled ──────────────────────────────────────────────────────
  setWebSearchEnabled: (noteId, enabled) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      const updated = { ...session, webSearchEnabled: enabled, updatedAt: Date.now() }
      debouncedSave(noteId, () => saveChatSession(noteId, toPersistedSession(get().sessions[noteId])))
      return { sessions: { ...s.sessions, [noteId]: updated } }
    })
  },

  // ── markLinkedNoteTrashed ────────────────────────────────────────────────────
  markLinkedNoteTrashed: (noteId) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      return { sessions: { ...s.sessions, [noteId]: { ...session, linkedNoteTrashed: true } } }
    })
  },

  // ── markLinkedNoteDeleted ────────────────────────────────────────────────────
  markLinkedNoteDeleted: (noteId) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      return {
        sessions: {
          ...s.sessions,
          [noteId]: {
            ...session,
            linkedNoteId:      null,
            linkedNoteTitle:   null,
            linkedNoteTrashed: false,
            linkedNoteDeleted: true,
          },
        },
      }
    })
  },

  // ── markLinkedNoteRestored ───────────────────────────────────────────────────
  markLinkedNoteRestored: (noteId, title) => {
    set((s) => {
      const session = s.sessions[noteId] ?? emptySession()
      return {
        sessions: {
          ...s.sessions,
          [noteId]: { ...session, linkedNoteTrashed: false, linkedNoteTitle: title },
        },
      }
    })
  },

  // ── clearSession ─────────────────────────────────────────────────────────────
  clearSession: async (noteId) => {
    await deleteChatSession(noteId)
    set((s) => {
      const next = { ...s.sessions }
      delete next[noteId]
      return { sessions: next }
    })
  },

  // ── Selectors ────────────────────────────────────────────────────────────────
  getSession: (pane) => {
    const noteId = get().paneNoteId[pane]
    if (!noteId) return emptySession()
    return get().sessions[noteId] ?? emptySession()
  },

  getSessionByNoteId: (noteId) => {
    return get().sessions[noteId] ?? emptySession()
  },

  isLinked: (pane) => {
    return get().getSession(pane).linkedNoteId !== null
  },

  getLinkedNoteId: (pane) => {
    return get().getSession(pane).linkedNoteId
  },
}))