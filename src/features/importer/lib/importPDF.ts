// src/features/importer/lib/importPDF.ts

import { pickPdfFile, copyPdfToAttachments } from "@/lib/tauri/fs";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { NoteSourceMeta } from "@/types";

function inferTitle(filePath: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? "Document";
  return name.replace(/\.pdf$/i, "");
}

export async function importPDF(): Promise<string | null> {
  // 1. Pick file
  const srcPath = await pickPdfFile();
  if (!srcPath) return null;

  // 2. Get page count via pdfjs (lazy-loaded, non-fatal if it fails)
  let pageCount = 0;
  try {
    const pdfjs = await import("pdfjs-dist");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url
      ).href;
    }
    // Read bytes we already have from Tauri rather than fetching via URL
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[]>("read_file_bytes", { path: srcPath });
    const data = new Uint8Array(bytes).buffer;
    const doc = await pdfjs.getDocument({ data }).promise;
    pageCount = doc.numPages;
    doc.cleanup();
  } catch {
    // non-fatal — viewer will still open, pageCount stays 0
  }

  // 3. Copy to $APPDATA/attachments/{uuid}.pdf
  const uuid = crypto.randomUUID();
  const destFileName = `${uuid}.pdf`;
  await copyPdfToAttachments(srcPath, destFileName);

  // 4. Build source_meta
  const originalName = inferTitle(srcPath) + ".pdf";
  const meta: NoteSourceMeta = {
    pageCount,
    originalName,
    importedAt: Date.now(),
    fileSize: 0,
  };

  // 5. Create note row
  const note = await useNoteStore.getState().createNote({
    title: inferTitle(srcPath),
    content: JSON.stringify({ type: "doc", content: [] }),
    plaintext: "",
    source_type: "pdf",
    source_file: destFileName,
    source_meta: JSON.stringify(meta),
  });

  // Insert a pdfLink block into the currently active note (if any and different from the PDF note)
  const { activeNoteId, notes: storeNotes, updateNote } = useNoteStore.getState();
  if (activeNoteId && activeNoteId !== note.id) {
    const activeNote = storeNotes.find((n) => n.id === activeNoteId);
    if (activeNote && activeNote.source_type === "note") {
      let doc: { type: string; content: unknown[] };
      try {
        doc = activeNote.content ? JSON.parse(activeNote.content) : { type: "doc", content: [] };
      } catch {
        doc = { type: "doc", content: [] };
      }
      if (!Array.isArray(doc.content)) doc.content = [];
      doc.content.push({ type: "pdfLink", attrs: { noteId: note.id, title: note.title } });
      await updateNote(activeNoteId, { content: JSON.stringify(doc) });
      window.dispatchEvent(new CustomEvent("idemora:content-updated", {
        detail: { noteId: activeNoteId, content: JSON.stringify(doc) },
      }));
    }
  }

  return note.id;
}