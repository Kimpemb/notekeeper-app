import type { Note } from "@/types"

// A notepad is invisible to every AI path while it is excluded from RAG.
// Opting in sets rag_excluded = 0, which makes it an ordinary note again.
export function isAIHidden(
  note: Pick<Note, "source_type" | "rag_excluded"> | null | undefined
): boolean {
  return !!note && note.source_type === "notepad" && note.rag_excluded === 1
}

// SQL fragment for queries that join or select from notes under `alias`.
export function aiVisibleSql(alias = "n"): string {
  return `NOT (${alias}.source_type = 'notepad' AND COALESCE(${alias}.rag_excluded, 0) = 1)`
}