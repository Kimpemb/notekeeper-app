import { pickDocxFile } from "@/lib/tauri/fs"
import { useNoteStore } from "@/features/notes/store/useNoteStore"
import { getDb } from "@/features/notes/db/client"
import { convertDocx } from "./convertDocx"
import { invoke } from "@tauri-apps/api/core"
import type { NoteSourceMeta } from "@/types"
import { checkFileSize, ImportError, userFriendlyMessage, type ImportResult } from "./importErrors"

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

// ── Single-file import — core logic, parameterized on srcPath ───────────────
async function importDocxFromPath(
  srcPath: string,
  onDuplicateFound?: (existingId: string, title: string) => Promise<"replace" | "copy" | "cancel">,
  parentId?: string | null
): Promise<string | null> {
  const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath })

  checkFileSize(bytes.length)

  const originalName = srcPath.replace(/\\/g, "/").split("/").pop() ?? "document.docx"
  const filenameWithoutExt = originalName.replace(/\.docx$/i, "")

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
  let pageCount: number
  let doc: { content: unknown[] }

  try {
    const result = await convertDocx(arrayBuffer, filenameWithoutExt)
    markdown = result.markdown
    title = result.title
    pageCount = result.pageCount
    doc = result.doc as { content: unknown[] }
  } catch {
    throw new ImportError("CORRUPT_FILE", "This file could not be read. It may be damaged.")
  }

  if (!markdown.trim() || markdown.replace(/\s/g, "").length < 100) {
    throw new ImportError("EMPTY_CONVERSION", "This file appears to have no readable text content.")
  }

  const content = JSON.stringify({ type: "doc", content: doc.content ?? [] })
  const plaintext = markdown.replace(/^#+\s+/gm, "").replace(/[*_`~]/g, "").trim()

  const meta: NoteSourceMeta = {
    pageCount,
    originalName,
    importedAt: Date.now(),
    fileSize: bytes.length,
  }

  const note = await useNoteStore.getState().createNote({
    title,
    content,
    plaintext,
    source_type: "docx",
    source_file: originalName,
    source_meta: JSON.stringify(meta),
    parent_id: parentId ?? null,
  })

  return note.id
}

// ── Batch entry point ────────────────────────────────────────────────────────
export async function importDocx(
  onDuplicateFound?: (existingId: string, title: string) => Promise<"replace" | "copy" | "cancel">,
  parentId?: string | null
): Promise<ImportResult[] | null> {
  const srcPaths = await pickDocxFile()
  if (!srcPaths || srcPaths.length === 0) return null

  const results: ImportResult[] = []

  for (const srcPath of srcPaths) {
    const fileName = srcPath.replace(/\\/g, "/").split("/").pop() ?? "document.docx"
    try {
      const noteId = await importDocxFromPath(srcPath, onDuplicateFound, parentId)
      if (noteId === null) {
        results.push({ fileName, cancelled: true })
      } else {
        results.push({ fileName, noteId })
      }
    } catch (err) {
      results.push({ fileName, error: userFriendlyMessage(err) })
    }
  }

  return results
}