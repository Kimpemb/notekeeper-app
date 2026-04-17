import React, { useRef, useEffect, useState, useCallback } from "react";
import { CanvasViewport } from "./CanvasViewport";
import { useCanvasStore } from "../store/useCanvasStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";

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
  
  // Global navigation from note store (pane 1)
  const goBack = useNoteStore((s) => s.goBack);
  const goForward = useNoteStore((s) => s.goForward);
  const canGoBack = useNoteStore((s) => s.canGoBack());
  const canGoForward = useNoteStore((s) => s.canGoForward());
  
  // Global navigation from UI store (pane 2)
  const pane2GoBack = useUIStore((s) => s.pane2GoBack);
  const pane2GoForward = useUIStore((s) => s.pane2GoForward);
  const pane2CanGoBack = useUIStore((s) => s.pane2CanGoBack());
  const pane2CanGoForward = useUIStore((s) => s.pane2CanGoForward());
  const activePaneId = useUIStore((s) => s.activePaneId);
  
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft,   setTitleDraft]   = useState("");
  const [hovered,      setHovered]      = useState(false);

  const canvasName = canvas?.name ?? "";
  const loading = canvas?.loading ?? true;

  useEffect(() => { loadCanvas(canvasId); }, [canvasId, loadCanvas]);
  
  // Push to navigation history when canvas loads
  useEffect(() => {
    if (!loading && canvasId) {
      setActiveNote(canvasId, false);
    }
  }, [canvasId, loading, setActiveNote]);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(canvasName || "");
  }, [canvasName, editingTitle]);

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

  const handleGoBack = () => {
    if (activePaneId === 2) {
      pane2GoBack();
    } else {
      goBack();
    }
  };

  const handleGoForward = () => {
    if (activePaneId === 2) {
      pane2GoForward();
    } else {
      goForward();
    }
  };

  const isBackDisabled = activePaneId === 2 ? !pane2CanGoBack : !canGoBack;
  const isForwardDisabled = activePaneId === 2 ? !pane2CanGoForward : !canGoForward;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-idemora-bg-primary">
        <p className="text-sm text-idemora-text-muted animate-pulse">Loading canvas…</p>
      </div>
    );
  }

  const isUntitled    = !canvasName || canvasName === "Untitled";
  const displayName   = isUntitled ? "Untitled" : canvasName;
  const labelOpacity  = isUntitled
    ? (hovered ? 0.45 : 0.28)
    : (hovered ? 0.80 : 0.55);

  return (
    <div className="flex flex-col w-full h-full bg-idemora-bg-primary overflow-hidden">
      {/* Title bar with back/forward buttons */}
      <div
        className="flex items-center px-3 gap-2 shrink-0 relative"
        style={{
          height: 34,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {/* Back button */}
        <button
          onClick={handleGoBack}
          disabled={isBackDisabled}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0 disabled:opacity-30 enabled:hover:bg-black/6 dark:enabled:hover:bg-white/7 enabled:cursor-pointer text-white"
          title="Go back (Ctrl+[)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>

        {/* Forward button */}
        <button
          onClick={handleGoForward}
          disabled={isForwardDisabled}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors shrink-0 disabled:opacity-30 enabled:hover:bg-black/6 dark:enabled:hover:bg-white/7 enabled:cursor-pointer text-white"
          title="Go forward (Ctrl+])"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>

        {/* Hidden mirror span - absolutely positioned */}
        <span
          ref={mirrorRef}
          aria-hidden
          className="absolute invisible whitespace-pre pointer-events-none"
          style={{
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "0.02em",
            fontFamily: "inherit",
          }}
        >
          {titleDraft || " "}
        </span>

        {/* Title */}
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={handleTitleKeyDown}
            placeholder="Untitled"
            autoFocus
            className="bg-transparent border-none outline-none p-0 font-medium"
            style={{
              width: inputWidth,
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.02em",
              color: "rgba(226,232,240,0.85)",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <span
            onDoubleClick={startEditTitle}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title="Double-click to rename"
            className="cursor-default select-none transition-colors duration-200"
            style={{
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.02em",
              color: `rgba(226,232,240,${labelOpacity})`,
              fontStyle: isUntitled ? "italic" : "normal",
            }}
          >
            {displayName}
          </span>
        )}
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <CanvasViewport canvasId={canvasId} containerRef={containerRef} />
      </div>
    </div>
  );
};

export default Canvas;