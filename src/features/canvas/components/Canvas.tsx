import React, { useRef, useEffect, useState, useCallback } from "react";
import { CanvasViewport } from "./CanvasViewport";
import { useCanvasStore } from "../store/useCanvasStore";

interface CanvasProps {
  canvasId: string;
}

export const Canvas: React.FC<CanvasProps> = ({ canvasId }) => {
  const containerRef   = useRef<HTMLDivElement>(null);
  const titleInputRef  = useRef<HTMLInputElement>(null);
  const mirrorRef      = useRef<HTMLSpanElement>(null);
  const [inputWidth, setInputWidth] = useState(80);

  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const canvas = useCanvasStore((s) => s.canvases[canvasId]);
  const updateName = useCanvasStore((s) => s.updateCanvasName);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft,   setTitleDraft]   = useState("");
  const [hovered,      setHovered]      = useState(false);

  const canvasName = canvas?.name ?? "";
  const loading = canvas?.loading ?? true;

  useEffect(() => { loadCanvas(canvasId); }, [canvasId, loadCanvas]);

  // Keep draft in sync when canvasName changes externally (e.g. after load)
  useEffect(() => {
    if (!editingTitle) setTitleDraft(canvasName || "");
  }, [canvasName, editingTitle]);

  // Mirror span drives the input width naturally
  useEffect(() => {
    if (mirrorRef.current) {
      const w = mirrorRef.current.offsetWidth;
      setInputWidth(Math.max(60, Math.min(w + 16, 400)));
    }
  }, [titleDraft]);

  const startEditTitle = useCallback(() => {
    setTitleDraft(canvasName || "");
    setEditingTitle(true);
    setTimeout(() => {
      titleInputRef.current?.select();
    }, 0);
  }, [canvasName]);

  const commitTitle = useCallback(() => {
    const trimmed = titleDraft.trim();
    updateName(canvasId, trimmed || "Untitled").catch(console.error);
    setEditingTitle(false);
  }, [titleDraft, updateName, canvasId]);

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      commitTitle();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-idemora-bg-primary">
        <p className="text-sm text-idemora-text-muted animate-pulse">Loading canvas…</p>
      </div>
    );
  }

  // "Untitled" is placeholder-styled; any real name renders at full opacity
  const isUntitled    = !canvasName || canvasName === "Untitled";
  const displayName   = isUntitled ? "Untitled" : canvasName;
  const labelOpacity  = isUntitled
    ? (hovered ? 0.45 : 0.28)
    : (hovered ? 0.80 : 0.55);

  return (
    <div className="flex flex-col w-full h-full bg-idemora-bg-primary overflow-hidden">

      {/* ── Title bar ── */}
      <div
        className="flex items-center px-4 shrink-0"
        style={{
          height:       34,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {/* Hidden mirror span — measures text width for the input */}
        <span
          ref={mirrorRef}
          aria-hidden
          style={{
            position:    "absolute",
            visibility:  "hidden",
            whiteSpace:  "pre",
            fontSize:    13,
            fontWeight:  500,
            letterSpacing: "0.02em",
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
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={handleTitleKeyDown}
            placeholder="Untitled"
            autoFocus
            style={{
              width:       inputWidth,
              background:  "transparent",
              border:      "none",
              outline:     "none",
              fontSize:    13,
              fontWeight:  500,
              letterSpacing: "0.02em",
              color:       "rgba(226,232,240,0.85)",
              padding:     0,
              fontFamily:  "inherit",
            }}
          />
        ) : (
          <span
            onDoubleClick={startEditTitle}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title="Double-click to rename"
            style={{
              fontSize:      13,
              fontWeight:    500,
              letterSpacing: "0.02em",
              color:         `rgba(226,232,240,${labelOpacity})`,
              cursor:        "default",
              userSelect:    "none",
              transition:    "color 0.2s ease",
              fontStyle:     isUntitled ? "italic" : "normal",
            }}
          >
            {displayName}
          </span>
        )}
      </div>

      {/* ── Canvas area ── */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
      >
        <CanvasViewport canvasId={canvasId} containerRef={containerRef} />
      </div>
    </div>
  );
};

export default Canvas;