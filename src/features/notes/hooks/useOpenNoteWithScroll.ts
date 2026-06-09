// src/features/notes/hooks/useOpenNoteWithScroll.ts
import { useCallback } from "react"
import { useNoteStore } from "@/features/notes/store/useNoteStore"
import { useUIStore }   from "@/features/ui/store/useUIStore"

export function useOpenNoteWithScroll(paneId: 1 | 2) {
  const setActiveNote = useNoteStore((s) => s.setActiveNote)

  return useCallback((noteId: string, query?: string) => {
    if (paneId === 1) {
      useUIStore.getState().replaceTab(noteId)
      setActiveNote(noteId, true)
    } else {
      useUIStore.getState().replacePane2Tab(noteId)
    }

    if (query?.trim()) {
      setTimeout(() => {
        useUIStore.getState().setPendingScrollQuery(query.trim())
      }, 350)
    }
  }, [paneId, setActiveNote])
}