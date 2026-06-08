// src/features/importer/lib/importPptx.ts
import { pickPptxFile }  from "@/lib/tauri/fs"
import { useNoteStore }  from "@/features/notes/store/useNoteStore"
import { convertPptx }  from "./convertPptx"
import { invoke }        from "@tauri-apps/api/core"
import type { NoteSourceMeta } from "@/types"
import { markdownToDoc } from "@/features/ai/lib/save/parseMarkdown"

export async function importPptx(): Promise<string | null> {
  const srcPath = await pickPptxFile()
  if (!srcPath) return null

  const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath })
  const arrayBuffer = new Uint8Array(bytes).buffer

  const { markdown, title, slideCount } = await convertPptx(arrayBuffer)

  const doc     = markdownToDoc(markdown) as { content: unknown[] }
  const content = JSON.stringify({ type: "doc", content: doc.content ?? [] })

  const plaintext = markdown
    .replace(/^#+\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .trim()

  const originalName = srcPath.replace(/\\/g, "/").split("/").pop() ?? "presentation.pptx"

  const meta: NoteSourceMeta = {
    pageCount:    slideCount,
    importedAt:   Date.now(),
    originalName,
    fileSize:     bytes.length,
  }

  const note = await useNoteStore.getState().createNote({
    title,
    content,
    plaintext,
    source_type: "pptx",
    source_file: originalName,
    source_meta: JSON.stringify(meta),
  })

  return note.id
}
