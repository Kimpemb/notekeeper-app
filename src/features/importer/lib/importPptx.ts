// src/features/importer/lib/importPptx.ts
import { pickPptxFile }  from "@/lib/tauri/fs"
import { useNoteStore }  from "@/features/notes/store/useNoteStore"
import { convertPptx }  from "./convertPptx"
import { invoke }        from "@tauri-apps/api/core"
import type { NoteSourceMeta } from "@/types"
import { markdownToDoc } from "@/features/ai/lib/save/parseMarkdown"
import { checkFileSize, ImportError } from "./importErrors"
import { getDb } from "@/features/notes/db/client"

async function checkDuplicate(originalName: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.select<{ id: string }[]>(
    `SELECT id FROM notes
     WHERE source_file = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [originalName]
  )
  return rows[0]?.id ?? null
}

export async function importPptx(
  onDuplicateFound?: (existingId: string, title: string) => Promise<"replace" | "copy" | "cancel">,
  parentId?: string | null
): Promise<string | null> {
  const srcPath = await pickPptxFile()
  if (!srcPath) return null

  const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath })

  checkFileSize(bytes.length)

  const originalName = srcPath.replace(/\\/g, "/").split("/").pop() ?? "presentation.pptx"

  const existingId = await checkDuplicate(originalName)
  if (existingId && onDuplicateFound) {
    const existing = useNoteStore.getState().notes.find(n => n.id === existingId)
    const action = await onDuplicateFound(existingId, existing?.title ?? originalName)
    if (action === "cancel") return null
    if (action === "replace") await useNoteStore.getState().deleteNote(existingId)
  }

  const arrayBuffer = new Uint8Array(bytes).buffer

  let markdown: string
  let title: string
  let slideCount: number

  try {
    const result = await convertPptx(arrayBuffer)
    markdown  = result.markdown
    title     = result.title
    slideCount = result.slideCount
  } catch {
    throw new ImportError("CORRUPT_FILE", "This file could not be read. It may be damaged.")
  }

  if (!markdown.trim() || markdown.replace(/\s/g, "").length < 100) {
    throw new ImportError("EMPTY_CONVERSION", "This file appears to have no readable text content.")
  }

  const doc     = markdownToDoc(markdown) as { content: unknown[] }
  const content = JSON.stringify({ type: "doc", content: doc.content ?? [] })

  const plaintext = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .trim()

  const meta: NoteSourceMeta = {
    pageCount:  slideCount,
    importedAt: Date.now(),
    originalName,
    fileSize:   bytes.length,
  }

  const note = await useNoteStore.getState().createNote({
    title,
    content,
    plaintext,
    source_type: "pptx",
    source_file: originalName,
    source_meta: JSON.stringify(meta),
    parent_id: parentId ?? null,
  })

  return note.id
}