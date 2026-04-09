// src/features/graph/GraphNodeDetailPanel.tsx
//
// Fixed panel anchored to the left edge of the graph canvas.
// Opens when the user single-clicks a node. Replaces the old
// single-click-to-open behavior (opening the note is now double-click).
//
// Shows:
//   • Note title (clickable → open note)
//   • Created date
//   • Word count (derived from plaintext in the store)
//   • Tags
//   • Backlinks list (notes that link TO this node)
//
// Data flow: GraphView fetches backlinks once when the panel opens and
// passes them down as a prop. The panel itself is presentational.

import type { GraphNode } from "./graphTypes";
import type { Note } from "@/types";

const LABEL_COLOR = "var(--color-text, #e2e2e2)";
const BG          = "rgba(18,18,18,0.97)";
const BORDER      = "rgba(255,255,255,0.08)";
const ACCENT      = "#6366f1";
const TAG_PALETTE = [
  "#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6",
  "#ec4899","#14b8a6","#f97316","#8b5cf6","#84cc16",
];

interface Props {
  node:          GraphNode;
  backlinks:     Note[];          // notes that link TO this node — fetched by GraphView
  tagColorMap:   Map<string, string>;
  wordCount:     number;
  isLoading:     boolean;
  onOpen:        (id: string) => void;
  onClose:       () => void;
  onFocus:       (id: string) => void;
  onOpenBacklink:(id: string) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function pluralise(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

export function GraphNodeDetailPanel({
  node,
  backlinks,
  tagColorMap,
  wordCount,
  isLoading,
  onOpen,
  onClose,
  onFocus,
  onOpenBacklink,
}: Props) {
  return (
    <div
      style={{
        position:    "absolute",
        top:         12,
        left:        12,
        width:       240,
        background:  BG,
        border:      `1px solid ${BORDER}`,
        borderRadius: 12,
        boxShadow:   "0 8px 32px rgba(0,0,0,0.45)",
        zIndex:      100,
        color:       LABEL_COLOR,
        fontSize:    12,
        overflow:    "hidden",
        display:     "flex",
        flexDirection: "column",
        maxHeight:   "calc(100% - 24px)",
      }}
      // Prevent node hover events from propagating through the panel
      onMouseEnter={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <button
            onClick={() => onOpen(node.id)}
            style={{
              background:     "none",
              border:         "none",
              color:          LABEL_COLOR,
              cursor:         "pointer",
              fontSize:       13,
              fontWeight:     600,
              textAlign:      "left",
              padding:        0,
              lineHeight:     1.4,
              flex:           1,
              wordBreak:      "break-word",
            }}
            title="Double-click to open note"
          >
            {node.title}
          </button>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => onFocus(node.id)}
              title="Focus graph on this node"
              style={{
                background:   "none",
                border:       `1px solid ${BORDER}`,
                borderRadius: 5,
                color:        LABEL_COLOR,
                cursor:       "pointer",
                fontSize:     11,
                opacity:      0.6,
                padding:      "2px 6px",
                lineHeight:   1.4,
              }}
            >
              Focus
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border:     "none",
                color:      LABEL_COLOR,
                opacity:    0.35,
                cursor:     "pointer",
                fontSize:   16,
                lineHeight: 1,
                padding:    "0 2px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Meta row */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, opacity: 0.5, fontSize: 11 }}>
          <span>{formatDate(node.created_at)}</span>
          <span>{pluralise(wordCount, "word")}</span>
          <span>{pluralise(node.linkCount, "link")}</span>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ overflowY: "auto", flex: 1, padding: "10px 14px 14px" }}>

        {/* Tags */}
        {node.tags.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, opacity: 0.4, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>
              Tags
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {node.tags.map((tag) => {
                const color = tagColorMap.get(tag) ?? TAG_PALETTE[0];
                return (
                  <span
                    key={tag}
                    style={{
                      background:   `${color}22`,
                      border:       `1px solid ${color}55`,
                      borderRadius: 4,
                      color:        color,
                      fontSize:     10,
                      padding:      "2px 7px",
                      fontWeight:   500,
                    }}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Backlinks */}
        <div>
          <div style={{ fontSize: 10, opacity: 0.4, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>
            Backlinks ({backlinks.length})
          </div>

          {isLoading && (
            <div style={{ fontSize: 11, opacity: 0.35, fontStyle: "italic" }}>Loading…</div>
          )}

          {!isLoading && backlinks.length === 0 && (
            <div style={{ fontSize: 11, opacity: 0.3, fontStyle: "italic" }}>No backlinks yet</div>
          )}

          {!isLoading && backlinks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {backlinks.map((bl) => (
                <button
                  key={bl.id}
                  onClick={() => onOpenBacklink(bl.id)}
                  style={{
                    background:     "none",
                    border:         "none",
                    borderRadius:   5,
                    color:          LABEL_COLOR,
                    cursor:         "pointer",
                    fontSize:       11,
                    textAlign:      "left",
                    padding:        "5px 7px",
                    opacity:        0.75,
                    transition:     "background 120ms, opacity 120ms",
                    display:        "flex",
                    alignItems:     "center",
                    gap:            6,
                    wordBreak:      "break-word",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.opacity    = "1";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "none";
                    e.currentTarget.style.opacity    = "0.75";
                  }}
                >
                  <span style={{ color: ACCENT, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>↗</span>
                  {bl.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Open note CTA */}
        <button
          onClick={() => onOpen(node.id)}
          style={{
            marginTop:    14,
            width:        "100%",
            background:   `${ACCENT}18`,
            border:       `1px solid ${ACCENT}44`,
            borderRadius: 6,
            color:        ACCENT,
            cursor:       "pointer",
            fontSize:     11,
            fontWeight:   500,
            padding:      "6px 0",
            transition:   "background 150ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = `${ACCENT}30`)}
          onMouseLeave={(e) => (e.currentTarget.style.background = `${ACCENT}18`)}
        >
          Open note →
        </button>
      </div>
    </div>
  );
}