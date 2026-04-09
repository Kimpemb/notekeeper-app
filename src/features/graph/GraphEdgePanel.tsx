// src/features/graph/GraphEdgePanel.tsx
//
// Floating popover that appears when the user clicks an edge.
// Shows: which note contains the link, the sentence/line of text that
// contains the [[link]], and a delete button that removes the link
// from the source note's content.
//
// Positioning: caller passes the SVG midpoint in screen coordinates.
// The panel flips left/right and up/down to stay within the viewport.

import { useEffect, useRef } from "react";

const LABEL_COLOR = "var(--color-text, #e2e2e2)";
const BG         = "rgba(20,20,20,0.97)";
const BORDER     = "rgba(255,255,255,0.1)";
const ACCENT     = "#6366f1";
const DANGER     = "#ef4444";

export interface EdgePanelData {
  sourceId:    string;
  targetId:    string;
  sourceTitle: string;
  targetTitle: string;
  // The plaintext snippet from the source note that contains the link.
  // Extracted by the caller from the note content.
  snippet:     string;
  // Screen coordinates of the edge midpoint
  screenX:     number;
  screenY:     number;
}

interface Props {
  data:        EdgePanelData;
  onDelete:    (sourceId: string, targetId: string) => void;
  onOpenNote:  (noteId: string) => void;
  onDismiss:   () => void;
}

export function GraphEdgePanel({ data, onDelete, onOpenNote, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on click-outside
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    // Use capture so we catch clicks on the SVG too
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onDismiss]);

  // Dismiss on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onDismiss]);

  // Compute position — flip if too close to viewport edges
  const panelW = 280;
  const panelH = 140; // approximate
  const margin = 12;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = data.screenX + margin;
  let top  = data.screenY - panelH / 2;

  if (left + panelW > vw - margin) left = data.screenX - panelW - margin;
  if (top < margin)                top  = margin;
  if (top + panelH > vh - margin)  top  = vh - panelH - margin;

  // Highlight the target title inside the snippet
  function renderSnippet(snippet: string, targetTitle: string) {
    if (!targetTitle || !snippet) return snippet;
    const idx = snippet.toLowerCase().indexOf(targetTitle.toLowerCase());
    if (idx === -1) return snippet;
    return (
      <>
        {snippet.slice(0, idx)}
        <mark style={{ background: `${ACCENT}44`, color: LABEL_COLOR, borderRadius: 2, padding: "0 2px" }}>
          {snippet.slice(idx, idx + targetTitle.length)}
        </mark>
        {snippet.slice(idx + targetTitle.length)}
      </>
    );
  }

  return (
    <div
      ref={ref}
      style={{
        position:     "fixed",
        left,
        top,
        width:        panelW,
        background:   BG,
        border:       `1px solid ${BORDER}`,
        borderRadius: 10,
        boxShadow:    "0 8px 32px rgba(0,0,0,0.5)",
        padding:      "12px 14px",
        zIndex:       200,
        color:        LABEL_COLOR,
        fontSize:     12,
        pointerEvents: "all",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, opacity: 0.45, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Link
        </span>
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", color: LABEL_COLOR, opacity: 0.4, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
        >
          ×
        </button>
      </div>

      {/* Source → Target */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => onOpenNote(data.sourceId)}
          style={{ background: "none", border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 5, color: LABEL_COLOR, cursor: "pointer", fontSize: 11, padding: "3px 7px", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={data.sourceTitle}
        >
          {data.sourceTitle}
        </button>
        <span style={{ opacity: 0.4, fontSize: 11 }}>→</span>
        <button
          onClick={() => onOpenNote(data.targetId)}
          style={{ background: "none", border: `1px solid ${ACCENT}55`, borderRadius: 5, color: ACCENT, cursor: "pointer", fontSize: 11, padding: "3px 7px", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={data.targetTitle}
        >
          {data.targetTitle}
        </button>
      </div>

      {/* Snippet */}
      {data.snippet ? (
        <div style={{
          background:   "rgba(255,255,255,0.04)",
          border:       `1px solid ${BORDER}`,
          borderRadius: 6,
          padding:      "6px 9px",
          fontSize:     11,
          lineHeight:   1.6,
          marginBottom: 10,
          color:        LABEL_COLOR,
          opacity:      0.8,
          wordBreak:    "break-word",
          maxHeight:    64,
          overflow:     "hidden",
        }}>
          "{renderSnippet(data.snippet, data.targetTitle)}"
        </div>
      ) : (
        <div style={{ fontSize: 11, opacity: 0.35, marginBottom: 10, fontStyle: "italic" }}>
          No text context found
        </div>
      )}

      {/* Delete button */}
      <button
        onClick={() => onDelete(data.sourceId, data.targetId)}
        style={{
          width:        "100%",
          background:   `${DANGER}18`,
          border:       `1px solid ${DANGER}44`,
          borderRadius: 6,
          color:        DANGER,
          cursor:       "pointer",
          fontSize:     11,
          fontWeight:   500,
          padding:      "5px 0",
          transition:   "background 150ms",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = `${DANGER}30`)}
        onMouseLeave={(e) => (e.currentTarget.style.background = `${DANGER}18`)}
      >
        Remove link
      </button>
    </div>
  );
}