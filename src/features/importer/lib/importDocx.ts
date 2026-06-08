// src/features/importer/lib/importDocx.ts

import { pickDocxFile } from "@/lib/tauri/fs"
import { useNoteStore } from "@/features/notes/store/useNoteStore"
import { convertDocx } from "./convertDocx"
import { invoke } from "@tauri-apps/api/core"
import type { NoteSourceMeta } from "@/types"

// Reuse the markdown→ProseMirror pipeline already in the codebase
import { markdownToDoc } from "@/features/ai/lib/save/parseMarkdown"

export async function importDocx(): Promise<string | null> {
  // 1. Pick file
  const srcPath = await pickDocxFile()
  if (!srcPath) return null

  // 2. Read bytes via Tauri
  const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath })
  const arrayBuffer = new Uint8Array(bytes).buffer

  // 3. Convert DOCX → markdown
  const { markdown, title, pageCount } = await convertDocx(arrayBuffer)

  // 4. markdown → ProseMirror JSON
  const doc = markdownToDoc(markdown) as { content: unknown[] }
  const content = JSON.stringify({ type: "doc", content: doc.content ?? [] })

  // 5. Extract plaintext
  const plaintext = markdown.replace(/^#+\s+/gm, "").replace(/[*_`~]/g, "").trim()

  // 6. Original filename for display
  const originalName = srcPath.replace(/\\/g, "/").split("/").pop() ?? "document.docx"

  const meta: NoteSourceMeta = {
    pageCount,
    originalName,
    importedAt: Date.now(),
    fileSize:   bytes.length,
  }

  // 7. Create note row — DOCX becomes a normal editable note
  const note = await useNoteStore.getState().createNote({
    title,
    content,
    plaintext,
    source_type: "docx",
    source_file: originalName,
    source_meta: JSON.stringify(meta),
  })

  return note.id
}