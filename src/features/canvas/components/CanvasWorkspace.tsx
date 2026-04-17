import { useEffect, useRef, useState, useCallback } from "react";
import { useCanvasStore } from "@/features/canvas/store/useCanvasStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { Breadcrumb } from "@/features/editor/components/Editor/Breadcrumb";
import { CanvasViewport } from "./CanvasViewport";

interface Props {
  canvasId: string;
  paneId?: 1 | 2;
}

export function CanvasWorkspace({ canvasId, paneId = 1 }: Props) {
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const canvas = useCanvasStore((s) => s.canvases[canvasId]);
  const updateCanvasName = useCanvasStore((s) => s.updateCanvasName);

  // Nav — pane 1
  const goBack            = useNoteStore((s) => s.goBack);
  const goForward         = useNoteStore((s) => s.goForward);
  const pane1CanGoBack    = useNoteStore((s) => s.canGoBack());
  const pane1CanGoForward = useNoteStore((s) => s.canGoForward());

  // Nav — pane 2
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

  const canvasName = canvas?.name ?? "";
  const loading = canvas?.loading ?? true;

  useEffect(() => {
    loadCanvas(canvasId);
  }, [canvasId, loadCanvas]);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(canvasName || "");
  }, [canvasName, editingTitle]);

  useEffect(() => {
    if (mirrorRef.current) {
      const w = mirrorRef.current.offsetWidth;
      setInputWidth(Math.max(60, Math.min(w + 16, 400)));
    }
  }, [titleDraft]);

  const startEdit = useCallback(() => {
    setTitleDraft(canvasName || "");
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }, [canvasName]);

  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim() || "Untitled";
    updateCanvasName(canvasId, trimmed).catch(console.error);
    setEditingTitle(false);
  }, [titleDraft, canvasId, updateCanvasName]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); commitTitle(); }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-idemora-bg-primary">
        <p className="text-sm text-idemora-text-muted animate-pulse">Loading canvas…</p>
      </div>
    );
  }

  const isUntitled   = !canvasName || canvasName === "Untitled";
  const displayName  = isUntitled ? "Untitled" : canvasName;
  const labelOpacity = isUntitled
    ? (hovered ? 0.45 : 0.28)
    : (hovered ? 0.80 : 0.55);

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-w-0 min-h-0">

      {/* ── Title bar (mirrors editor nav bar) ── */}
      <div
        className="flex items-center gap-1 px-2 shrink-0"
        style={{ height: 34, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        {/* Back button */}
        <button
          onClick={() => paneId === 2 ? pane2GoBack() : goBack()}
          disabled={!canGoBack}
          title="Go back (Ctrl+[)"
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
        >
          <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
            <path d="M9 7H3M3 7l3.5-3.5M3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Forward button */}
        <button
          onClick={() => paneId === 2 ? pane2GoForward() : goForward()}
          disabled={!canGoForward}
          title="Go forward (Ctrl+])"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
        >
          <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
            <path d="M5 7h6M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Breadcrumb navigation */}
        <Breadcrumb noteId={canvasId} paneId={paneId} />

        {/* Hidden mirror — drives input width */}
        <span
          ref={mirrorRef}
          aria-hidden
          style={{
            position: "absolute", visibility: "hidden", whiteSpace: "pre",
            fontSize: 13, fontWeight: 500, letterSpacing: "0.02em", fontFamily: "inherit",
            pointerEvents: "none",
          }}
        >
          {titleDraft || " "}
        </span>

        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={handleKeyDown}
            placeholder="Untitled"
            autoFocus
            style={{
              width: inputWidth, background: "transparent", border: "none", outline: "none",
              fontSize: 13, fontWeight: 500, letterSpacing: "0.02em",
              color: "rgba(226,232,240,0.85)", padding: 0, fontFamily: "inherit",
            }}
          />
        ) : (
          <span
            onDoubleClick={startEdit}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title="Double-click to rename"
            style={{
              fontSize: 13, fontWeight: 500, letterSpacing: "0.02em",
              color: `rgba(226,232,240,${labelOpacity})`,
              cursor: "default", userSelect: "none",
              transition: "color 0.2s ease",
              fontStyle: isUntitled ? "italic" : "normal",
            }}
          >
            {displayName}
          </span>
        )}
      </div>

      {/* ── Canvas ── */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <CanvasViewport canvasId={canvasId} containerRef={containerRef} />
      </div>

    </div>
  );
}