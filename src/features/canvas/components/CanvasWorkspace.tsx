// src/features/canvas/components/CanvasWorkspace.tsx
import { useState, useCallback, useRef } from "react";
import { useNoteStore }  from "@/features/notes/store/useNoteStore";
import { useUIStore }    from "@/features/ui/store/useUIStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { CanvasViewport } from "./CanvasViewport";
import {
  exportAsJson,
  exportAsPng,
  exportAsMarkdown,
  exportAsSvg,
  type CanvasExportData,
} from "../lib/exportCanvas";
import type { CanvasExportFormat } from "@/types/canvas";

interface Props {
  noteId: string;
  paneId?: 1 | 2;
}

// ─── Export menu ──────────────────────────────────────────────────────────────

const EXPORT_OPTIONS: { format: CanvasExportFormat; label: string; hint: string }[] = [
  { format: "json", label: "JSON",     hint: "Full data · backup & import" },
  { format: "png",  label: "PNG",      hint: "Rendered image"              },
  { format: "md",   label: "Markdown", hint: "Text outline"                },
  { format: "svg",  label: "SVG",      hint: "Vector graphic"              },
];

interface ExportMenuProps {
  onExport: (format: CanvasExportFormat) => void;
  onClose:  () => void;
  exporting: CanvasExportFormat | null;
}

function ExportMenu({ onExport, onClose, exporting }: ExportMenuProps) {
  return (
    <>
      {/* backdrop */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 49 }}
        onPointerDown={onClose}
      />
      <div
        style={{
          position:        "absolute",
          top:             "calc(100% + 6px)",
          right:           0,
          zIndex:          50,
          minWidth:        192,
          backgroundColor: "var(--color-idemora-bg-secondary, #1e1f2e)",
          border:          "1px solid rgba(255,255,255,0.1)",
          borderRadius:    10,
          boxShadow:       "0 8px 32px rgba(0,0,0,0.45)",
          overflow:        "hidden",
          padding:         "4px 0",
        }}
      >
        <p
          style={{
            fontSize:    11,
            fontWeight:  600,
            letterSpacing: "0.08em",
            color:       "rgba(148,163,184,0.5)",
            padding:     "6px 14px 4px",
            userSelect:  "none",
          }}
        >
          EXPORT AS
        </p>
        {EXPORT_OPTIONS.map(({ format, label, hint }) => {
          const busy = exporting === format;
          return (
            <button
              key={format}
              onClick={() => !busy && onExport(format)}
              disabled={busy}
              style={{
                display:         "flex",
                alignItems:      "center",
                justifyContent:  "space-between",
                width:           "100%",
                padding:         "8px 14px",
                background:      "transparent",
                border:          "none",
                cursor:          busy ? "default" : "pointer",
                opacity:         busy ? 0.5 : 1,
                transition:      "background 0.1s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(226,232,240,0.85)" }}>
                {busy ? "Exporting…" : label}
              </span>
              <span style={{ fontSize: 11, color: "rgba(148,163,184,0.45)", marginLeft: 12 }}>
                {hint}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ─── CanvasWorkspace ──────────────────────────────────────────────────────────

export function CanvasWorkspace({ noteId, paneId = 1 }: Props) {
  const note       = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNoteStore((s) => s.updateNote);

  const goBack            = useNoteStore((s) => s.goBack);
  const goForward         = useNoteStore((s) => s.goForward);
  const pane1CanGoBack    = useNoteStore((s) => s.canGoBack());
  const pane1CanGoForward = useNoteStore((s) => s.canGoForward());

  const pane2CanGoBack    = useUIStore((s) => s.pane2CanGoBack());
  const pane2CanGoForward = useUIStore((s) => s.pane2CanGoForward());
  const pane2GoBack       = useUIStore((s) => s.pane2GoBack);
  const pane2GoForward    = useUIStore((s) => s.pane2GoForward);

  const canGoBack    = paneId === 2 ? pane2CanGoBack    : pane1CanGoBack;
  const canGoForward = paneId === 2 ? pane2CanGoForward : pane1CanGoForward;

  const containerRef  = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const mirrorRef     = useRef<HTMLSpanElement>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft,   setTitleDraft]   = useState("");
  const [inputWidth,   setInputWidth]   = useState(80);
  const [hovered,      setHovered]      = useState(false);
  const [showExport,   setShowExport]   = useState(false);
  const [exporting,    setExporting]    = useState<CanvasExportFormat | null>(null);
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done">("idle");

  const canvasName = note?.title ?? "Untitled";

  // ─── Title editing ──────────────────────────────────────────────────────────
  const startEdit = useCallback(() => {
    setTitleDraft(canvasName);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [canvasName]);

  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim() || "Untitled";
    updateNote(noteId, { title: trimmed }).catch(console.error);
    setEditingTitle(false);
  }, [titleDraft, noteId, updateNote]);

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); commitTitle(); }
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitleDraft(e.target.value);
    if (mirrorRef.current) {
      mirrorRef.current.textContent = e.target.value || " ";
      setInputWidth(Math.max(60, Math.min(mirrorRef.current.offsetWidth + 16, 400)));
    }
  };

  // ─── Export ─────────────────────────────────────────────────────────────────
  const handleExport = useCallback(
    async (format: CanvasExportFormat) => {
      if (!note) return;
      setExporting(format);
      setShowExport(false);
      setExportStatus("exporting");

      const store = useCanvasStore.getState();
      const exportData: CanvasExportData = {
        noteId:   noteId,
        title:    canvasName,
        nodes:    store.getNodes(noteId),
        edges:    store.getEdges(noteId),
        viewport: store.getViewport(noteId),
      };

      try {
        switch (format) {
          case "json": exportAsJson(exportData);             break;
          case "png":  await exportAsPng(exportData);        break;
          case "md":   exportAsMarkdown(exportData);         break;
          case "svg":  exportAsSvg(exportData);              break;
        }
        setExportStatus("done");
        setTimeout(() => setExportStatus("idle"), 2500);
      } catch (err) {
        console.error("Canvas export failed:", err);
        setExportStatus("idle");
      } finally {
        setExporting(null);
      }
    },
    [note, noteId, canvasName],
  );

  // ─── Loading state ───────────────────────────────────────────────────────────
  if (!note) {
    return (
      <div className="flex flex-1 items-center justify-center bg-idemora-bg-primary">
        <p className="text-sm text-idemora-text-muted animate-pulse">Loading…</p>
      </div>
    );
  }

  const isUntitled   = !canvasName || canvasName === "Untitled";
  const labelOpacity = isUntitled
    ? (hovered ? 0.45 : 0.28)
    : (hovered ? 0.80 : 0.55);

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-w-0 min-h-0">

      {/* ── Title bar ──────────────────────────────────────────────────────── */}
      <div
        className="relative flex items-center justify-center px-3 shrink-0"
        style={{ height: 44, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        {/* Left: Navigation */}
        <div className="absolute left-3 flex items-center gap-2">
          <button
            onClick={() => paneId === 2 ? pane2GoBack() : goBack()}
            disabled={!canGoBack}
            title="Go back (Ctrl+[)"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
          >
            <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
              <path d="M9 7H3M3 7l3.5-3.5M3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <button
            onClick={() => paneId === 2 ? pane2GoForward() : goForward()}
            disabled={!canGoForward}
            title="Go forward (Ctrl+])"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
          >
            <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
              <path d="M5 7h6M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Center: Title */}
        <div className="flex items-center justify-center">
          <span
            ref={mirrorRef}
            aria-hidden
            style={{
              position:    "absolute",
              visibility:  "hidden",
              whiteSpace:  "pre",
              fontSize:    15,
              fontWeight:  500,
              fontFamily:  "inherit",
              pointerEvents: "none",
            }}
          >
            {titleDraft || " "}
          </span>

          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={handleDraftChange}
              onBlur={commitTitle}
              onKeyDown={handleTitleKeyDown}
              placeholder="Untitled"
              autoFocus
              style={{
                width:      inputWidth,
                background: "transparent",
                border:     "none",
                outline:    "none",
                fontSize:   15,
                fontWeight: 500,
                color:      "rgba(226,232,240,0.85)",
                padding:    0,
                fontFamily: "inherit",
                textAlign:  "center",
              }}
            />
          ) : (
            <span
              onDoubleClick={startEdit}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              title="Double-click to rename"
              style={{
                fontSize:   15,
                fontWeight: 500,
                color:      `rgba(226,232,240,${labelOpacity})`,
                cursor:     "default",
                userSelect: "none",
                transition: "color 0.2s ease",
                fontStyle:  isUntitled ? "italic" : "normal",
              }}
            >
              {canvasName}
            </span>
          )}
        </div>

        {/* Right: Export button */}
        <div className="absolute right-3 flex items-center">
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowExport((v) => !v)}
              title="Export canvas"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md transition-colors text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
              style={{ opacity: exporting ? 0.5 : 1 }}
            >
              {exporting ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: "spin 0.8s linear infinite" }}>
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round"/>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 10V3M8 3L5.5 5.5M8 3L10.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 11v1.5A1.5 1.5 0 004.5 14h7A1.5 1.5 0 0013 12.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              )}
            </button>

            {showExport && (
              <ExportMenu
                onExport={handleExport}
                onClose={() => setShowExport(false)}
                exporting={exporting}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <CanvasViewport noteId={noteId} containerRef={containerRef} />

        {exportStatus !== "idle" && (
          <div style={{
            position:      "absolute",
            bottom:        16,
            left:          "50%",
            transform:     "translateX(-50%)",
            background:    "rgba(20,20,32,0.92)",
            border:        "1px solid rgba(255,255,255,0.1)",
            borderRadius:  8,
            padding:       "7px 16px",
            fontSize:      12,
            color:         exportStatus === "done"
              ? "rgba(134,239,172,0.9)"
              : "rgba(226,232,240,0.7)",
            display:       "flex",
            alignItems:    "center",
            gap:           8,
            pointerEvents: "none",
            whiteSpace:    "nowrap",
          }}>
            {exportStatus === "exporting" ? (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                  style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"
                    strokeDasharray="20" strokeDashoffset="7" strokeLinecap="round"/>
                </svg>
                Exporting…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                  style={{ flexShrink: 0 }}>
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Exported
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}