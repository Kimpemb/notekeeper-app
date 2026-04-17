import { useState, useCallback, useRef } from "react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { CanvasViewport } from "./CanvasViewport";

interface Props {
  noteId: string;
  paneId?: 1 | 2;
}

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

  const canvasName = note?.title ?? "Untitled";

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); commitTitle(); }
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitleDraft(e.target.value);
    if (mirrorRef.current) {
      mirrorRef.current.textContent = e.target.value || " ";
      setInputWidth(Math.max(60, Math.min(mirrorRef.current.offsetWidth + 16, 400)));
    }
  };

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
      {/* Title bar */}
      <div
        className="flex items-center gap-1 px-2 shrink-0"
        style={{ height: 34, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <button
          onClick={() => paneId === 2 ? pane2GoBack() : goBack()}
          disabled={!canGoBack}
          title="Go back (Ctrl+[)"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 7H3M3 7l3.5-3.5M3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <button
          onClick={() => paneId === 2 ? pane2GoForward() : goForward()}
          disabled={!canGoForward}
          title="Go forward (Ctrl+])"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 7h6M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Mirror span for input width measurement */}
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
            onChange={handleDraftChange}
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
            {canvasName}
          </span>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <CanvasViewport noteId={noteId} containerRef={containerRef} />
      </div>
    </div>
  );
}