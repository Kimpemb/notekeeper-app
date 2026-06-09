// src/features/notes/hooks/useNoteSearch.ts
import { useState, useEffect, useRef } from "react"
import { searchNotes } from "@/features/notes/db/queries"
import type { SearchResult } from "@/features/notes/db/queries"

export function useNoteSearch(query: string, delayMs = 150) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      try {
        const res = await searchNotes(query)
        setResults(res)
      } catch {
        setResults([])
        setError("Search failed. Please try again.")
      } finally {
        setLoading(false)
      }
    }, delayMs)

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query, delayMs])

  return { results, loading, error }
}