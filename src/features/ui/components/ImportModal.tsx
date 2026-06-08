import { useEffect, useRef, useState, useCallback } from "react";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { importNotes, importNotesOverwrite, importNotesAsCopies } from "@/features/notes/db/queries";
import { importNotesFromFile } from "@/lib/tauri/fs";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Note } from "@/types";
import { importPDF } from "@/features/importer/lib/importPDF";
import { importDocx } from "@/features/importer/lib/importDocx";
import { importPptx } from "@/features/importer/lib/importPptx";
import { userFriendlyMessage } from "@/features/importer/lib/importErrors";

type Strategy = "skip" | "overwrite" | "copy";
type Stage = "idle" | "preview" | "importing" | "done" | "error";

interface Preview {
  notes: Note[];
  duplicateCount: number;
  newCount: number;
}

const STRATEGY_LABELS: Record<Strategy, { label: string; desc: string }> = {
  skip:      { label: "Skip duplicates",  desc: "Existing notes are left unchanged" },
  overwrite: { label: "Overwrite",        desc: "Existing notes are replaced with imported versions" },
  copy:      { label: "Import as copies", desc: "All notes imported with new IDs — no conflicts" },
};

// ── Markdown inline parser ────────────────────────────────────────────────────
function parseInlineContent(
  text: string,
  notesByTitle: Map<string, string>
): object[] {
  const nodes: object[] = [];
  const wikilinkRe = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = wikilinkRe.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push({ type: "text", text: text.slice(last, match.index) });
    }
    const label = match[1].trim();
    const linkedId = notesByTitle.get(label.toLowerCase());
    if (linkedId) {
      nodes.push({ type: "noteLink", attrs: { id: linkedId, label } });
    } else {
      nodes.push({ type: "text", text: match[0] });
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    nodes.push({ type: "text", text: text.slice(last) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text }];
}

function markdownToDoc(markdown: string, notesByTitle: Map<string, string>): object {
  const lines = markdown.split("\n");
  const contentNodes: object[] = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // ── Idemora HTML comment nodes ─────────────────────────────────────────
    const dataviewMatch = trimmed.match(/^<!-- dataview: (.+) -->$/);
    if (dataviewMatch) {
      try {
        const { query } = JSON.parse(dataviewMatch[1]);
        contentNodes.push({ type: "dataview", attrs: { query } });
      } catch { /* skip malformed */ }
      continue;
    }

    const blockrefMatch = trimmed.match(/^<!-- blockref: (.+) -->$/);
    if (blockrefMatch) {
      try {
        const { sourceNoteId, blockId, snapshot } = JSON.parse(blockrefMatch[1]);
        contentNodes.push({ type: "blockRef", attrs: { sourceNoteId, blockId, snapshot } });
      } catch { /* skip malformed */ }
      continue;
    }

    // ── Standard markdown ──────────────────────────────────────────────────
    if (trimmed.startsWith("### ")) {
      contentNodes.push({ type: "heading", attrs: { level: 3 }, content: parseInlineContent(trimmed.slice(4), notesByTitle) });
    } else if (trimmed.startsWith("## ")) {
      contentNodes.push({ type: "heading", attrs: { level: 2 }, content: parseInlineContent(trimmed.slice(3), notesByTitle) });
    } else if (trimmed.startsWith("# ")) {
      // Skip — title line
    } else if (trimmed === "") {
      // Skip blank lines
    } else {
      contentNodes.push({ type: "paragraph", content: parseInlineContent(trimmed, notesByTitle) });
    }
  }

  return { type: "doc", content: contentNodes.length > 0 ? contentNodes : [{ type: "paragraph" }] };
}

// ── YAML frontmatter parser ───────────────────────────────────────────────────
interface ParsedFrontmatter {
  tags: string | null;
  frontmatter: string | null;
  body: string;
}

function extractYamlFrontmatter(content: string): ParsedFrontmatter {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { tags: null, frontmatter: null, body: content };

  const yamlBlock = fmMatch[1];
  const body = fmMatch[2];

  let tags: string | null = null;
  let frontmatter: string | null = null;

  // Parse tags: ["foo", "bar"] or tags: foo, bar
  const tagsMatch = yamlBlock.match(/^tags:\s*(.+)$/m);
  if (tagsMatch) {
    const raw = tagsMatch[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) tags = JSON.stringify(parsed);
    } catch {
      // comma-separated fallback
      const items = raw.split(",").map((t) => t.trim()).filter(Boolean);
      if (items.length > 0) tags = JSON.stringify(items);
    }
  }

  // Parse frontmatter: {"status":"in progress"} or any remaining keys
  const fmMatch2 = yamlBlock.match(/^frontmatter:\s*(.+)$/m);
  if (fmMatch2) {
    try {
      JSON.parse(fmMatch2[1].trim()); // validate
      frontmatter = fmMatch2[1].trim();
    } catch { /* ignore malformed */ }
  }

  return { tags, frontmatter, body };
}

export function ImportModal() {
  const importOpen  = useUIStore((s) => s.importOpen);
  const closeImport = useUIStore((s) => s.closeImport);
  const loadNotes   = useNoteStore((s) => s.loadNotes);

  const panelRef = useRef<HTMLDivElement>(null);
  const dropRef  = useRef<HTMLDivElement>(null);

  const [stage,    setStage]    = useState<Stage>("idle");
  const [strategy, setStrategy] = useState<Strategy>("skip");
  const [preview,  setPreview]  = useState<Preview | null>(null);
  const [rawJson,  setRawJson]  = useState<string>("");
  const [imported, setImported] = useState<number>(0);
  const [error,    setError]    = useState<string>("");
  const [dragging, setDragging] = useState(false);
  
  // Add duplicate state
  const [duplicatePromise, setDuplicatePromise] = useState<{
    resolve: (action: "replace" | "copy" | "cancel") => void
    title: string
  } | null>(null)
  
  const [scannedPdfNoteId, setScannedPdfNoteId] = useState<string | null>(null)

  useEffect(() => {
    if (importOpen) {
      setStage("idle"); setStrategy("skip"); setPreview(null);
      setRawJson(""); setImported(0); setError("");
      setScannedPdfNoteId(null);
      setDuplicatePromise(null);
    }
  }, [importOpen]);

  useEffect(() => {
    if (!importOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); closeImport(); } }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [importOpen, closeImport]);

  useEffect(() => {
    if (!importOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeImport();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [importOpen, closeImport]);

  // Shared duplicate resolver — passed into all importers
  function makeDuplicateHandler() {
    return (_existingId: string, title: string): Promise<"replace" | "copy" | "cancel"> =>
      new Promise((resolve) => setDuplicatePromise({ resolve, title }))
  }

  const parseFile = useCallback(async (content: string, ext: string) => {
    try {
      let notes: Note[];

      if (ext === "md") {
        const existingNotes = useNoteStore.getState().notes;
        const maxSortOrder = existingNotes.reduce((max, n) => Math.max(max, n.sort_order ?? 0), -1);

        // Extract YAML frontmatter if present
        const { tags, frontmatter, body } = extractYamlFrontmatter(content);

        const lines = body.split("\n");
        const titleLine = lines.find((l) => l.startsWith("# "));
        const title = titleLine ? titleLine.replace(/^# /, "").trim() : "Imported Note";
        const bodyLines = lines.filter((l) => !l.startsWith("# ")).join("\n");

        const newNote: Note = {
          id: crypto.randomUUID(),
          title,
          content: "",
          plaintext: bodyLines.trim(),
          tags,
          frontmatter,
          parent_id: null,
          sync_id: crypto.randomUUID(),
          created_at: Date.now(),
          updated_at: Date.now(),
          deleted_at: null,
          sort_order: maxSortOrder + 1,
          is_canvas: false,
          canvas_state: null,
          rag_excluded: 0,
          source_type: "note",
        };

        const notesByTitle = new Map<string, string>(
          existingNotes.map((n) => [n.title.toLowerCase(), n.id])
        );
        notesByTitle.set(title.toLowerCase(), newNote.id);

        const doc = markdownToDoc(bodyLines, notesByTitle);
        newNote.content = JSON.stringify(doc);
        notes = [newNote];

      } else {
        const cleaned = content.replace(/^\uFEFF/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) throw new Error("File must contain a JSON array of notes.");
        if (parsed.length === 0) throw new Error("The file contains no notes.");
        const looksValid = parsed.every((n: unknown) =>
          typeof n === "object" && n !== null &&
          "id" in n && "title" in n && "content" in n && "created_at" in n
        );
        if (!looksValid) throw new Error("This file doesn't look like an Idemora export. Only .json files exported from Idemora can be imported.");
        
        // Ensure each note has rag_excluded (default to 0 if missing)
        notes = (parsed as Note[]).map((n) => ({
          ...n,
          rag_excluded: (n as any).rag_excluded ?? 0,
        }));
      }

      const existingIds = new Set(useNoteStore.getState().notes.map((n) => n.id));
      const duplicateCount = notes.filter((n) => existingIds.has(n.id)).length;
      setPreview({ notes, duplicateCount, newCount: notes.length - duplicateCount });
      setRawJson(JSON.stringify(notes));
      setStage("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid file.");
      setStage("error");
    }
  }, []);

  async function handlePickFile() {
    try {
      const result = await importNotesFromFile();
      if (result === null) return;
      await parseFile(result.content, result.ext);
    } catch (err) { setError(String(err)); setStage("error"); }
  }

  async function handleImportPDF() {
    setStage("importing")
    try {
      const noteId = await importPDF(makeDuplicateHandler())
      if (!noteId) {
        setStage("idle")  // user cancelled duplicate dialog
        return
      }
      closeImport()
      useUIStore.getState().openTab(noteId)
    } catch (err) {
      // Scanned PDF — note was created, just warn
      if (err instanceof Error && err.message.startsWith("__SCANNED__:")) {
        const noteId = err.message.split(":")[1]
        setScannedPdfNoteId(noteId)
        setStage("idle") // stay open to show warning
        return
      }
      setError(userFriendlyMessage(err))
      setStage("error")
    } finally {
      setDuplicatePromise(null)
    }
  }

  async function handleImportDocx() {
    setStage("importing")
    try {
      const noteId = await importDocx(makeDuplicateHandler())
      if (!noteId) {
        setStage("idle")  // user cancelled duplicate dialog
        return
      }
      closeImport()
      useUIStore.getState().openTab(noteId)
    } catch (err) {
      setError(userFriendlyMessage(err))
      setStage("error")
    } finally {
      setDuplicatePromise(null)
    }
  }

  async function handleImportPptx() {
    setStage("importing")
    try {
      const noteId = await importPptx(makeDuplicateHandler())
      if (!noteId) {
        setStage("idle")  // user cancelled duplicate dialog
        return
      }
      closeImport()
      useUIStore.getState().openTab(noteId)
    } catch (err) {
      setError(userFriendlyMessage(err))
      setStage("error")
    } finally {
      setDuplicatePromise(null)
    }
  }

  useEffect(() => {
    if (!importOpen) return;
    const win = getCurrentWindow();
    const unlisten = win.onDragDropEvent(async (event) => {
      if (event.payload.type === "over") { setDragging(true); }
      else if (event.payload.type === "leave") { setDragging(false); }
      else if (event.payload.type === "drop") {
        setDragging(false);
        const paths: string[] = event.payload.paths ?? [];
        const filePath = paths[0];
        if (!filePath) return;
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        if (ext !== "json" && ext !== "md") { setError("Only .json and .md files are supported."); setStage("error"); return; }
        try {
          const text = await invoke<string>("read_file", { path: filePath });
          await parseFile(text, ext);
        } catch (err) { setError(String(err)); setStage("error"); }
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [importOpen, parseFile]);

  async function handleImport() {
    if (!preview) return;
    setStage("importing");
    try {
      let count = 0;
      if (strategy === "skip")      count = await importNotes(rawJson);
      if (strategy === "overwrite") count = await importNotesOverwrite(rawJson);
      if (strategy === "copy")      count = await importNotesAsCopies(rawJson);
      await loadNotes();
      setImported(count);
      setStage("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = msg.includes("NOT NULL") ? "Some notes are missing required fields — they were filled with defaults."
        : msg.includes("FOREIGN KEY") ? "Some notes reference parents that don't exist. Try importing as copies instead."
        : msg.includes("UNIQUE") ? "Some notes already exist. Choose a merge strategy to handle duplicates."
        : msg;
      setError(friendly); setStage("error");
    }
  }

  if (!importOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 /50 backdrop-blur-sm" />
      <div ref={panelRef} className="relative w-full max-w-md mx-4 rounded-xl overflow-hidden bg-idemora-bg-primary border-idemora-border  shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b  border-idemora-border">
          <h2 className="text-base font-semibold text-idemora-text-normal">Import Notes</h2>
          <button onClick={closeImport} className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted     transition-colors duration-150">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="px-5 py-5">
          {stage === "idle" && (
            <div ref={dropRef} className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-10 px-6 transition-colors duration-150 cursor-default ${dragging ? "border-blue-400 bg-blue-50 /30" : "border-idemora-border   :"}`}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-idemora-text-normal ">
                <path d="M16 4v16M8 12l8-8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 24v2a2 2 0 002 2h20a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <div className="text-center">
                <p className="text-sm text-idemora-text-normal text-idemora-text-muted">Drop a <span className="font-medium">.json</span> or <span className="font-medium">.md</span> file here</p>
                <p className="text-xs text-idemora-text-muted  mt-0.5">or</p>
              </div>
              <button onClick={handlePickFile} className="px-4 py-2 rounded-lg text-sm font-medium bg-idemora-bg-primary  text-idemora-text-normal    transition-colors duration-150">Choose file</button>
              <div className="w-full border-t border-idemora-border pt-3 mt-1 flex flex-col items-center gap-2">
                <p className="text-xs text-idemora-text-muted">or import a document</p>
                <button
                  onClick={handleImportPDF}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-idemora-bg-primary text-idemora-text-normal border border-idemora-border hover:bg-idemora-bg-secondary transition-colors duration-150"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M8 1H3a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V5L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Import PDF
                </button>
                <button
                  onClick={handleImportDocx}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-idemora-bg-primary text-idemora-text-normal border border-idemora-border hover:bg-idemora-bg-secondary transition-colors duration-150"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M8 1H3a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V5L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Import Word
                </button>
                <button
                  onClick={handleImportPptx}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-idemora-bg-primary text-idemora-text-normal border border-idemora-border hover:bg-idemora-bg-secondary transition-colors duration-150"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M8 1H3a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V5L8 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Import PowerPoint
                </button>
              </div>

              <p className="text-xs text-idemora-text-muted text-center mt-1">
                <span className="font-medium">.md</span> imports text and wikilinks only.
                Use <span className="font-medium">.json</span> for full fidelity — tags, embeds, and dataview blocks.
              </p>
            </div>
          )}

          {stage === "preview" && preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-idemora-bg-primary  px-4 py-3">
                  <p className="text-2xl font-semibold text-idemora-text-normal">{preview.notes.length}</p>
                  <p className="text-xs text-idemora-text-muted mt-0.5">Total notes</p>
                </div>
                <div className={`rounded-lg px-4 py-3 ${preview.duplicateCount > 0 ? "bg-amber-50 /30" : "bg-idemora-bg-primary "}`}>
                  <p className={`text-2xl font-semibold ${preview.duplicateCount > 0 ? "text-amber-600 " : "text-idemora-text-normal"}`}>{preview.duplicateCount}</p>
                  <p className="text-xs text-idemora-text-muted mt-0.5">Duplicates</p>
                </div>
              </div>
              {preview.duplicateCount > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-idemora-text-muted">How to handle duplicates</p>
                  {(["skip", "overwrite", "copy"] as Strategy[]).map((s) => (
                    <label key={s} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer border transition-colors duration-100 ${strategy === s ? "  bg-idemora-bg-primary " : "border-idemora-border   /50"}`}>
                      <input type="radio" name="strategy" value={s} checked={strategy === s} onChange={() => setStrategy(s)} className="mt-0.5 accent-zinc-900 " />
                      <div>
                        <p className="text-sm font-medium text-idemora-text-normal">{STRATEGY_LABELS[s].label}</p>
                        <p className="text-xs text-idemora-text-muted mt-0.5">{STRATEGY_LABELS[s].desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <div className="rounded-lg border-idemora-border overflow-hidden">
                <div className="max-h-36 overflow-y-auto">
                  {preview.notes.slice(0, 20).map((n) => {
                    const isDup = useNoteStore.getState().notes.some((e) => e.id === n.id);
                    return (
                      <div key={n.id} className="flex items-center gap-2 px-3 py-2 border-b  border-idemora-border/50 last">
                        <span className="flex-1 text-sm text-idemora-text-normal text-idemora-text-muted truncate">{n.title}</span>
                        {isDup && <span className="text-xs text-amber-500 shrink-0">duplicate</span>}
                      </div>
                    );
                  })}
                  {preview.notes.length > 20 && <div className="px-3 py-2 text-xs text-idemora-text-muted text-center">+{preview.notes.length - 20} more notes</div>}
                </div>
              </div>
            </div>
          )}

          {stage === "importing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-8 h-8 border-2   border-t-zinc-800  rounded-full animate-spin" />
              <p className="text-sm text-idemora-text-muted">Importing notes…</p>
            </div>
          )}

          {stage === "done" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-10 h-10 rounded-full bg-green-100 /40 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9l4 4 6-7" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="text-center">
                {imported === 0 ? (
                  <>
                    <p className="text-sm font-medium text-idemora-text-normal">Nothing imported</p>
                    <p className="text-xs text-idemora-text-muted mt-0.5">All notes already exist — try "Overwrite" or "Import as copies".</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-idemora-text-normal">{imported} {imported === 1 ? "note" : "notes"} imported</p>
                    <p className="text-xs text-idemora-text-muted mt-0.5">Your notes are ready</p>
                  </>
                )}
              </div>
            </div>
          )}

          {stage === "error" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-10 h-10 rounded-full bg-red-100 /40 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 5v5M9 13h.01" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/><circle cx="9" cy="9" r="7.5" stroke="#ef4444" strokeWidth="1.5"/></svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-idemora-text-normal">Import failed</p>
                <p className="text-xs text-idemora-text-muted mt-1 max-w-xs">{error}</p>
              </div>
              <button onClick={() => setStage("idle")} className="text-sm text-idemora-text-muted   transition-colors duration-150">Try again</button>
            </div>
          )}
        </div>

        {(stage === "preview" || stage === "done") && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t  border-idemora-border">
            {stage === "preview" && (
              <>
                <button onClick={() => setStage("idle")} className="px-4 py-2 rounded-lg text-sm text-idemora-text-muted     transition-colors duration-150">Back</button>
                <button onClick={handleImport} className="px-4 py-2 rounded-lg text-sm font-medium bg-idemora-bg-primary  text-idemora-text-normal    transition-colors duration-150">
                  Import {preview?.notes.length ?? 0} {(preview?.notes.length ?? 0) === 1 ? "note" : "notes"}
                </button>
              </>
            )}
            {stage === "done" && (
              <button onClick={closeImport} className="px-4 py-2 rounded-lg text-sm font-medium bg-idemora-bg-primary  text-idemora-text-normal    transition-colors duration-150">Done</button>
            )}
          </div>
        )}

        {/* Duplicate detection dialog */}
        {duplicatePromise && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-xl">
            <div className="bg-idemora-bg-primary border border-idemora-border rounded-xl p-5 mx-4 w-full max-w-sm shadow-xl">
              <p className="text-sm font-medium text-idemora-text-normal mb-1">File already imported</p>
              <p className="text-xs text-idemora-text-muted mb-4">
                A note from <span className="font-medium">{duplicatePromise.title}</span> already exists.
              </p>
              <div className="flex flex-col gap-2">
                <button onClick={() => { duplicatePromise.resolve("replace"); setDuplicatePromise(null) }}
                  className="px-3 py-2 rounded-lg text-sm text-idemora-text-normal border border-idemora-border hover:bg-idemora-bg-secondary transition-colors">
                  Replace existing
                </button>
                <button onClick={() => { duplicatePromise.resolve("copy"); setDuplicatePromise(null) }}
                  className="px-3 py-2 rounded-lg text-sm text-idemora-text-normal border border-idemora-border hover:bg-idemora-bg-secondary transition-colors">
                  Import as new copy
                </button>
                <button onClick={() => { duplicatePromise.resolve("cancel"); setDuplicatePromise(null) }}
                  className="px-3 py-2 rounded-lg text-sm text-idemora-text-muted transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scanned PDF warning */}
        {scannedPdfNoteId && (
          <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-50/10 px-4 py-3 text-xs text-amber-600">
            <p className="font-medium mb-1">Image-only PDF detected</p>
            <p>This PDF appears to be scanned. It will open for reading but won't be searchable by AI.</p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => {
                const id = scannedPdfNoteId
                setScannedPdfNoteId(null)
                closeImport()
                useUIStore.getState().openTab(id)
              }} className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-100/20 border border-amber-400/30 text-amber-600 hover:bg-amber-100/40 transition-colors">
                Open anyway
              </button>
              <button onClick={() => setScannedPdfNoteId(null)}
                className="px-3 py-1.5 rounded-md text-xs text-idemora-text-muted transition-colors">
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}