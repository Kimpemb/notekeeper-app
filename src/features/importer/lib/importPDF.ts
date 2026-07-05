import { pickPdfFile, copyPdfToAttachments } from "@/lib/tauri/fs"
import { useNoteStore } from "@/features/notes/store/useNoteStore"
import { getDb } from "@/features/notes/db/client"
import type { NoteSourceMeta } from "@/types"
import {
  ImportError,
  checkFileSize,
  userFriendlyMessage,
  type ImportResult,
} from "./importErrors"

const SCANNED_PDF_CHARS_PER_PAGE = 50

function inferTitle(filePath: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? "Document"
  return name.replace(/\.pdf$/i, "")
}

async function checkDuplicate(originalName: string): Promise<string | null> {
  const db = await getDb()
  const rows = await db.select<{ id: string; title: string }[]>(
    `SELECT id, title FROM notes
     WHERE source_file IS NOT NULL
       AND source_meta LIKE $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [`%"originalName":"${originalName}"%`]
  )
  return rows[0]?.id ?? null
}

// ── Single-file import — same logic as before, just parameterized on srcPath
// instead of calling the picker itself. `scanned` is now a plain return field
// instead of the old __SCANNED__ sentinel thrown as an error message. ────────
async function importPDFFromPath(
  srcPath: string,
  onDuplicateFound?: (existingId: string, title: string) => Promise<"replace" | "copy" | "cancel">,
  parentId?: string | null
): Promise<{ noteId: string; scanned: boolean } | null> {
  const { invoke } = await import("@tauri-apps/api/core")
  const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath })

  checkFileSize(bytes.length)

  const originalName = (srcPath.replace(/\\/g, "/").split("/").pop() ?? "document.pdf")

  const existingId = await checkDuplicate(originalName)
  if (existingId && onDuplicateFound) {
    const existing = useNoteStore.getState().notes.find(n => n.id === existingId)
    const action = await onDuplicateFound(existingId, existing?.title ?? originalName)
    if (action === "cancel") return null
    if (action === "replace") {
      await useNoteStore.getState().deleteNote(existingId)
    }
  }

  const arrayBuffer = new Uint8Array(bytes).buffer

  let pageCount = 0
  let isScanned = false

  try {
    const pdfjs = await import("pdfjs-dist")
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url
      ).href
    }

    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>>["promise"] extends Promise<infer T> ? T : never
    try {
      doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    } catch (e) {
      const msg = String(e)
      if (msg.toLowerCase().includes("password")) {
        throw new ImportError("ENCRYPTED_PDF", "This PDF is password-protected and cannot be imported.")
      }
      throw new ImportError("CORRUPT_FILE", "This file could not be read. It may be damaged.")
    }

    pageCount = doc.numPages

    const samplePages = Math.min(5, pageCount)
    let totalChars = 0
    for (let i = 1; i <= samplePages; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()
      totalChars += textContent.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join("").length
    }
    const avgCharsPerPage = samplePages > 0 ? totalChars / samplePages : 0
    isScanned = avgCharsPerPage < SCANNED_PDF_CHARS_PER_PAGE

    doc.cleanup()
  } catch (e) {
    if (e instanceof ImportError) throw e
    throw new ImportError("CORRUPT_FILE", "This file could not be read. It may be damaged.")
  }

  const uuid = crypto.randomUUID()
  const destFileName = `${uuid}.pdf`
  await copyPdfToAttachments(srcPath, destFileName)

  const meta: NoteSourceMeta = {
    pageCount,
    originalName,
    importedAt: Date.now(),
    fileSize: bytes.length,
  }

  const note = await useNoteStore.getState().createNote({
    title: inferTitle(srcPath),
    content: JSON.stringify({ type: "doc", content: [] }),
    plaintext: "",
    source_type: "pdf",
    source_file: destFileName,
    source_meta: JSON.stringify(meta),
    parent_id: parentId ?? null,
  })

  try {
    const { extractAndIndexPDF } = await import("./extractPDFText")
    extractAndIndexPDF(note.id, arrayBuffer) // intentionally not awaited
  } catch { /* non-fatal */ }

  const { activeNoteId, notes: storeNotes, updateNote } = useNoteStore.getState()
  if (activeNoteId && activeNoteId !== note.id) {
    const activeNote = storeNotes.find(n => n.id === activeNoteId)
    if (activeNote?.source_type === "note") {
      let doc: { type: string; content: unknown[] }
      try {
        doc = activeNote.content ? JSON.parse(activeNote.content) : { type: "doc", content: [] }
      } catch {
        doc = { type: "doc", content: [] }
      }
      if (!Array.isArray(doc.content)) doc.content = []
      doc.content.push({ type: "pdfLink", attrs: { noteId: note.id, title: note.title } })
      await updateNote(activeNoteId, { content: JSON.stringify(doc) })
      window.dispatchEvent(new CustomEvent("idemora:content-updated", {
        detail: { noteId: activeNoteId, content: JSON.stringify(doc) },
      }))
    }
  }

  return { noteId: note.id, scanned: isScanned }
}

// ── Batch entry point — picks one or more PDFs and imports each in turn.
// A failure on one file does not abort the rest; every file's outcome is
// reported back independently in the returned array. ────────────────────────
export async function importPDF(
  onDuplicateFound?: (existingId: string, title: string) => Promise<"replace" | "copy" | "cancel">,
  parentId?: string | null
): Promise<ImportResult[] | null> {
  const srcPaths = await pickPdfFile()
  if (!srcPaths || srcPaths.length === 0) return null

  const results: ImportResult[] = []

  for (const srcPath of srcPaths) {
    const fileName = srcPath.replace(/\\/g, "/").split("/").pop() ?? "document.pdf"
    try {
      const outcome = await importPDFFromPath(srcPath, onDuplicateFound, parentId)
      if (outcome === null) {
        results.push({ fileName, cancelled: true })
      } else {
        results.push({ fileName, noteId: outcome.noteId, scanned: outcome.scanned })
      }
    } catch (err) {
      results.push({ fileName, error: userFriendlyMessage(err) })
    }
  }

  return results
}