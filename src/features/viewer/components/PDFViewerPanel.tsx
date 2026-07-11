// src/features/viewer/components/PDFViewerPanel.tsx
//
// Renders a PDF stored in $APPDATA/attachments/ via the Tauri asset protocol.
// pdfjs-dist is lazy-loaded on first render — it never touches the initial bundle.
//
// Layout mirrors the Editor: a nav bar at the top, scrollable canvas area below.
// The note row is source_type='pdf', source_file='{uuid}.pdf',
// source_meta=JSON with { pageCount, originalName, importedAt, fileSize }.
//
// Text extraction for RAG happens in importPDF (M1.4), not here.
// This panel is read-only — no editing surface.

import { useEffect, useRef, useState, useCallback } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { getAppDataDir } from "@/lib/tauri/fs";
import type { NoteSourceMeta } from "@/types";

// pdfjs types — imported lazily so the type-only import doesn't pull the bundle
type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
type PDFPageProxy    = import("pdfjs-dist").PDFPageProxy;

interface PDFViewerPanelProps {
  noteId: string;
  paneId: 1 | 2;
}

type LoadState = "idle" | "loading" | "ready" | "error";

// AFTER
// Singleton pdfjs worker — created once for the lifetime of the app.
// Multiple PDFViewerPanel instances share it; none of them destroy it.
let pdfjsWorkerInitialised = false;

async function initialisePdfjsWorker() {
  if (pdfjsWorkerInitialised) return;
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url
    ).href;
  }
  pdfjsWorkerInitialised = true;
}
const MIN_SCALE = 0.5;const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;

export function PDFViewerPanel({ noteId, paneId }: PDFViewerPanelProps) {
  const note = useNoteStore(
    useCallback((s) => s.notes.find((n) => n.id === noteId) ?? null, [noteId])
  );

  const goBack        = useNoteStore((s) => s.goBack);
  const goForward     = useNoteStore((s) => s.goForward);
  const canGoBack     = useNoteStore((s) => s.canGoBack());
  const canGoForward  = useNoteStore((s) => s.canGoForward());
  const pane2GoBack   = useUIStore((s) => s.pane2GoBack);
  const pane2GoForward = useUIStore((s) => s.pane2GoForward);
  const pane2CanGoBack    = useUIStore((s) => s.pane2CanGoBack());
  const pane2CanGoForward = useUIStore((s) => s.pane2CanGoForward());
  const activePaneId  = useUIStore((s) => s.activePaneId);
  const chatOpen1     = useUIStore((s) => s.chatOpen1);
  const chatOpen2     = useUIStore((s) => s.chatOpen2);
  const rightPanelOpen    = useUIStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);

  const navGoBack    = paneId === 2 ? pane2GoBack    : goBack;
  const navGoForward = paneId === 2 ? pane2GoForward : goForward;
  const navCanBack   = paneId === 2 ? pane2CanGoBack    : canGoBack;
  const navCanFwd    = paneId === 2 ? pane2CanGoForward : canGoForward;

  const pane1ActiveNoteId = useUIStore((s) => s.activeTabNoteId());
  const pane2ActiveNoteId = useUIStore((s) => s.paneActiveNoteId(2));
  const isActiveTab = paneId === 1
    ? pane1ActiveNoteId === noteId
    : pane2ActiveNoteId === noteId;
  const showButtons = isActiveTab && activePaneId === paneId;
  const chatActive  = paneId === 1 ? chatOpen1 : chatOpen2;

  const [loadState, setLoadState]   = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [pdfDoc, setPdfDoc]         = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount]   = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale]   = useState(1.25);
  const [fitWidth, setFitWidth] = useState(false);

  const scrollRef    = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const sourceMeta: NoteSourceMeta | null = (() => {
    if (!note?.source_meta) return null;
    try { return JSON.parse(note.source_meta) as NoteSourceMeta; }
    catch { return null; }
  })();

  const originalName = sourceMeta?.originalName ?? note?.title ?? "Document";

  // ── Load PDF ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!note?.source_file) return;
    let cancelled = false;


    async function load() {
    setLoadState("loading");
    setErrorMsg(null);

    try {
        await initialisePdfjsWorker();
        const pdfjs = await import("pdfjs-dist");

const appDataDir = await getAppDataDir();

let loadingTask;
if (import.meta.env.DEV) {
  const { invoke } = await import("@tauri-apps/api/core");
  const sep = appDataDir.includes("\\") ? "\\" : "/";
  const fullPath = `${appDataDir}${sep}attachments${sep}${note!.source_file}`;
  await new Promise(r => setTimeout(r, 0));
  const data = await invoke<ArrayBuffer>("read_file_bytes", { path: fullPath });
  loadingTask = pdfjs.getDocument({ data });
} else {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const sep = appDataDir.includes("\\") ? "\\" : "/";
  const fullPath = `${appDataDir}${sep}attachments${sep}${note!.source_file}`;
  const assetUrl = convertFileSrc(fullPath);
  loadingTask = pdfjs.getDocument({ url: assetUrl });
}
        const doc = await loadingTask.promise;
        if (cancelled) { doc.cleanup(); return; }

        setPdfDoc(doc);
        setPageCount(doc.numPages);
        setLoadState("ready");
    } catch (err) {
        if (cancelled) return;
        const msg = String(err);
        if (msg.toLowerCase().includes("password")) {
        setErrorMsg("This PDF is password-protected and cannot be opened.");
        } else {
        setErrorMsg("This PDF could not be opened. The file may be damaged.");
        }
        setLoadState("error");
    }
    }

    load();
    return () => { cancelled = true; };
  }, [note?.source_file]);

  // ── Render current page ─────────────────────────────────────────────────────

  useEffect(() => {
    if (loadState !== "ready" || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    async function render() {
      if (!pdfDoc || !canvasRef.current) return;

      // Cancel any in-progress render
      renderTaskRef.current?.cancel();

      let page: PDFPageProxy | null = null;
      try {
        page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;

        const container = scrollRef.current;
        const containerWidth = container?.clientWidth ?? 800;

        // Compute effective scale
        let effectiveScale = scale;
        if (fitWidth) {
          const viewport = page.getViewport({ scale: 1 });
          effectiveScale = Math.max(0.1, (containerWidth - 48) / viewport.width);
        }

        const viewport = page.getViewport({ scale: effectiveScale });
        const canvas   = canvasRef.current;
        const ctx      = canvas.getContext("2d");
        if (!ctx) return;

        // Respect device pixel ratio for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.floor(viewport.width  * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width  = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.scale(dpr, dpr);

        const renderTask = page.render({ canvasContext: ctx, viewport, canvas: canvasRef.current! });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        renderTaskRef.current = null;
      } catch (err) {
        // RenderingCancelledException is expected on rapid navigation — ignore it
        const msg = String(err);
        if (!msg.includes("cancelled") && !msg.includes("Rendering cancelled")) {
          console.error("[PDFViewer] render error:", err);
        }
      } finally {
        page?.cleanup();
      }
    }

    render();
    return () => { cancelled = true; renderTaskRef.current?.cancel(); };
  }, [pdfDoc, currentPage, scale, fitWidth, loadState]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

useEffect(() => {
  return () => {
    renderTaskRef.current?.cancel();
    // cleanup() frees rendering resources; destroy() releases the document
    // and allows the worker to GC its memory for this document
    if (pdfDoc) {
      pdfDoc.cleanup();
    }
  };
}, [pdfDoc]);

  // ── Page navigation ─────────────────────────────────────────────────────────

  function goToPage(page: number) {
    setCurrentPage(Math.max(1, Math.min(pageCount, page)));
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function prevPage() { goToPage(currentPage - 1); }
  function nextPage() { goToPage(currentPage + 1); }

  function zoomIn()  { setFitWidth(false); setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP)); }
  function zoomOut() { setFitWidth(false); setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP)); }
  function resetZoom() { setFitWidth(true); }

  // Keyboard: arrow keys for page navigation when viewer is focused
  useEffect(() => {
    if (!isActiveTab) return;
    function handle(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); nextPage(); }
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   { e.preventDefault(); prevPage(); }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [isActiveTab, currentPage, pageCount]);

  if (!note) return null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full overflow-hidden flex-col">

      {/* ── Nav bar (mirrors Editor's) ── */}
      <div className="flex items-center justify-between gap-2 px-3 h-9 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={navGoBack}
            disabled={!navCanBack}
            title="Go back (Ctrl+[)"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
          >
            <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
              <path d="M9 7H3M3 7l3.5-3.5M3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={navGoForward}
            disabled={!navCanFwd}
            title="Go forward (Ctrl+])"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
          >
            <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
              <path d="M5 7h6M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Filename breadcrumb */}
          <span className="text-xs text-idemora-text-muted ml-1 truncate max-w-50" title={originalName}>
            {originalName}
          </span>
        </div>

        {showButtons && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={`flex items-center gap-1.5 transition-all duration-200 ease-in-out overflow-hidden ${rightPanelOpen ? "w-auto opacity-100" : "w-0 opacity-0"}`}>
              <button
                onClick={() => {
                  const { openChat, closeChat } = useUIStore.getState();
                  if (chatActive) { closeChat(paneId); setRightPanelOpen(false); }
                  else { openChat(paneId); setRightPanelOpen(true); }
                }}
                className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all duration-150 border ${
                  chatActive
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                    : "bg-idemora-bg-primary text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary border-idemora-border"
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                  <path d="M2.5 2.5h9a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 011 10V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <path d="M3.5 5h7M3.5 7h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                </svg>
                AI Chat
              </button>
            </div>
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className="w-7 h-7 flex items-center justify-center rounded-full text-xs font-medium transition-all duration-150 border bg-idemora-bg-primary text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary border-idemora-border"
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className={`transition-transform duration-200 ${rightPanelOpen ? "" : "rotate-180"}`}>
                <path d="M3 2l3 2.5L3 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* ── PDF toolbar ── */}
      <div className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-idemora-border bg-idemora-bg-header">

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={prevPage}
            disabled={currentPage <= 1 || loadState !== "ready"}
            className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2L5 7l4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div className="flex items-center gap-1 text-xs text-idemora-text-muted">
            <input
              type="number"
              value={currentPage}
              min={1}
              max={pageCount}
              disabled={loadState !== "ready"}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) goToPage(v);
              }}
              className="w-10 h-6 text-center text-xs rounded border border-idemora-border bg-idemora-bg-secondary text-idemora-text-normal outline-none focus:border-blue-500/50 disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span>/</span>
            <span>{pageCount || "–"}</span>
          </div>

          <button
            onClick={nextPage}
            disabled={currentPage >= pageCount || loadState !== "ready"}
            className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="w-px h-5 bg-idemora-border shrink-0" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={loadState !== "ready" || (!fitWidth && scale <= MIN_SCALE)}
            className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Zoom out"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M4 6h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>

          <button
            onClick={resetZoom}
            className={`px-2 h-6 rounded text-xs transition-colors ${
              fitWidth
                ? "bg-blue-500/10 text-blue-400"
                : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
            }`}
            title="Fit to width"
          >
            {fitWidth ? "Fit" : `${Math.round(scale * 100)}%`}
          </button>

          <button
            onClick={zoomIn}
            disabled={loadState !== "ready" || (!fitWidth && scale >= MAX_SCALE)}
            className="w-7 h-7 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Zoom in"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M4 6h4M6 4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Source meta info — right aligned */}
        {sourceMeta && (
          <div className="ml-auto text-xs text-idemora-text-faint shrink-0">
            {sourceMeta.pageCount} {sourceMeta.pageCount === 1 ? "page" : "pages"}
          </div>
        )}
      </div>

      {/* ── Canvas area ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-idemora-bg-secondary"
        style={{ scrollbarGutter: "stable" }}
      >
        {loadState === "loading" && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-idemora-text-muted animate-pulse">Loading…</p>
          </div>
        )}

        {loadState === "error" && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-sm text-center space-y-2">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="mx-auto text-idemora-text-faint">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M14 2v6h6M12 11v4M12 17.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p className="text-sm text-idemora-text-muted">{errorMsg}</p>
            </div>
          </div>
        )}

        {loadState === "ready" && (
        <div className="flex justify-center py-6 px-6 min-w-max">
            <div
            className="shadow-lg rounded-sm overflow-hidden bg-white"
            style={{ display: "inline-block" }}
            >
            <canvas ref={canvasRef} />
            </div>
        </div>
        )}

        {loadState === "idle" && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-idemora-text-faint">No file selected.</p>
          </div>
        )}
      </div>
    </div>
  );
}