// src/features/importer/lib/importDocx.ts

import { pickDocxFile } from "@/lib/tauri/fs"
import { useNoteStore } from "@/features/notes/store/useNoteStore"
import { convertDocx } from "./convertDocx"
import { invoke } from "@tauri-apps/api/core"
import type { NoteSourceMeta } from "@/types"

// Reuse the markdown→ProseMirror pipeline already in the codebase

export async function importDocx(): Promise<string | null> {
  // 1. Pick file
  const srcPath = await pickDocxFile()
  if (!srcPath) return null

  // 2. Read bytes via Tauri
  const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath })
  const arrayBuffer = new Uint8Array(bytes).buffer

  // 3. Original filename for display and fallback title
  const originalName = srcPath.replace(/\\/g, "/").split("/").pop() ?? "document.docx"
  const filenameWithoutExt = originalName.replace(/\.docx$/i, "")

  // 4. Convert DOCX → markdown with filename as fallback
  const { doc, markdown, title, pageCount } = await convertDocx(arrayBuffer, filenameWithoutExt)

  const content = JSON.stringify(doc)

  const plaintext = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .trim()

  const meta: NoteSourceMeta = {
    pageCount,
    originalName,
    importedAt: Date.now(),
    fileSize:   bytes.length,
  }

  // 5. Create note row — DOCX becomes a normal editable note
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