// src/features/importer/lib/extractPDFText.ts
//
// Extracts text from a PDF file page by page and inserts into note_blocks
// so the RAG indexer can embed and search it.

export async function extractAndIndexPDF(
  noteId:      string,
  arrayBuffer: ArrayBuffer,
): Promise<void> {
  try {
    console.log("[extractPDFText] starting extraction for note:", noteId)
    const pdfjs = await import("pdfjs-dist")
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url
      ).href
    }


    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
    const total = pdf.numPages

    const { getDb } = await import("@/features/notes/db/client")
    const db = await getDb()
    const now = Date.now()

    for (let i = 1; i <= total; i++) {
      const page    = await pdf.getPage(i)
      const content = await page.getTextContent()

      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()

      if (!pageText) continue

      const blockId     = crypto.randomUUID()
      const contentHash = await hashText(pageText)

      await db.execute(
        `INSERT INTO note_blocks
           (block_id, note_id, block_type, plaintext, chunk_heading,
            chunk_index, source_type, block_created_at, block_updated_at, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(block_id) DO NOTHING`,
        [
          blockId,
          noteId,
          "paragraph",
          pageText,
          `Page ${i}`,
          i - 1,
          "pdf",
          now,
          now,
          contentHash,
        ]
      )
    }

    pdf.cleanup()
    console.log("[extractPDFText] extraction complete, enqueuing for indexing")

    // Enqueue for embedding — indexer picks up automatically
    const { enqueueNoteForIndexing } = await import("@/features/ai/lib/indexer")
    await enqueueNoteForIndexing(noteId)

  } catch (err) {
    // Non-fatal — PDF is still viewable, just won't be RAG-searchable
    console.warn("[extractPDFText] extraction failed:", err)
  }
}

// Simple hash for content deduplication
async function hashText(text: string): Promise<string> {
  const buf    = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
}