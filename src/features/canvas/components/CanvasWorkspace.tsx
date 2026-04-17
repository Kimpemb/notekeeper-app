import { useEffect, useRef, useState, useCallback } from "react";
import { useCanvasStore } from "@/features/canvas/store/useCanvasStore";
import { CanvasViewport } from "./CanvasViewport";

interface Props {
  canvasId: string;
}

export function CanvasWorkspace({ canvasId }: Props) {
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const canvas = useCanvasStore((s) => s.canvases[canvasId]);
  const updateCanvasName = useCanvasStore((s) => s.updateCanvasName);
  
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

  // Sync draft when name loads
  useEffect(() => {
    if (!editingTitle) setTitleDraft(canvasName || "");
  }, [canvasName, editingTitle]);

  // Mirror span → input width
  useEffect(() => {
    if (mirrorRef.current) {
      const w = mirrorRef.current.offsetWidth;
      setInputWidth(Math.max(60, Math.min(w + 16, 400)));
    }
  }, [titleDraft]);

  useEffect(() => {
    console.log("🔍 CanvasWorkspace mounted - canvasId:", canvasId, "canvasName:", canvasName);
  }, [canvasId, canvasName]);

  useEffect(() => {
    console.log("📝 Title draft changed:", titleDraft);
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

      {/* ── Title bar ── */}
      <div
        className="flex items-center px-4 shrink-0"
        style={{ height: 34, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
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
        <CanvasViewport containerRef={containerRef} />
      </div>

    </div>
  );
}