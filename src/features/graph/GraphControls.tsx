// src/features/graph/GraphControls.tsx
// Header bar: title, stats, filter input, depth slider, all buttons.

import type { GraphNode } from "./graphTypes";

const LABEL_COLOR = "var(--color-text, #e2e2e2)";
const TAG_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#84cc16",
];

interface GraphControlsProps {
  isLocalGraph: boolean;
  isLoading: boolean;
  stats: { nodes: number; edges: number };
  focusedNode: GraphNode | null;
  focusNodeId: string | null;
  initialFocusNoteId?: string | null;
  lastUpdatedLabel: string | null;
  searchQuery: string;
  matchIndex: number;
  matchCount: number;
  depth: number;
  showOrphans: boolean;
  orphanCount: number;
  showTagColors: boolean;
  isFullscreen: boolean;
  timelineMode: boolean;
  onSearchChange: (q: string) => void;
  onDepthChange: (d: number) => void;
  onToggleOrphans: () => void;
  onToggleTagColors: () => void;
  onToggleTimeline: () => void;
  onRefresh: () => void;
  onFit: () => void;
  onToggleFullscreen: () => void;
  onExport: () => void;
  onClose: () => void;
}

export function GraphControls({
  isLocalGraph, isLoading, stats, focusedNode, focusNodeId, initialFocusNoteId,
  lastUpdatedLabel, searchQuery, matchIndex, matchCount, depth, showOrphans,
  orphanCount, showTagColors, isFullscreen, timelineMode,
  onSearchChange, onDepthChange, onToggleOrphans, onToggleTagColors,
  onToggleTimeline, onRefresh, onFit, onToggleFullscreen, onExport, onClose,
}: GraphControlsProps) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 16px",
      borderBottom: "1px solid var(--color-border, #2a2a2a)",
      flexShrink: 0, flexWrap: "wrap",
    }}>
      {/* Title */}
      <span style={{ fontWeight: 600, fontSize: 14, color: LABEL_COLOR, opacity: 0.9 }}>
        {isLocalGraph ? "Local Graph" : "Graph"}
      </span>

      {/* Stats */}
      {!isLoading && (
        <span style={{ fontSize: 12, color: LABEL_COLOR, opacity: 0.4 }}>
          {stats.nodes} notes · {stats.edges} links
        </span>
      )}

      {/* Focus badge */}
      {focusedNode && (
        <span style={{ fontSize: 11, color: TAG_PALETTE[0], opacity: 0.9, background: "rgba(99,102,241,0.15)", borderRadius: 4, padding: "2px 7px" }}>
          {isLocalGraph && focusNodeId === initialFocusNoteId ? "Local: " : "Focus: "}{focusedNode.title}
        </span>
      )}

      {/* Timeline mode badge */}
      {timelineMode && (
        <span style={{ fontSize: 11, color: "#10b981", opacity: 0.9, background: "rgba(16,185,129,0.12)", borderRadius: 4, padding: "2px 7px" }}>
          Timeline
        </span>
      )}

      {/* Last updated */}
      {lastUpdatedLabel && (
        <span style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.3 }}>
          updated {lastUpdatedLabel}
        </span>
      )}

      {/* Right-side controls */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>

        {/* Search input */}
        <input
          type="text"
          placeholder="Filter…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ background: "var(--color-bg, #1e1e1e)", border: "1px solid var(--color-border, #2a2a2a)", borderRadius: 6, padding: "4px 10px", fontSize: 13, color: LABEL_COLOR, outline: "none", width: 130 }}
        />

        {/* Match counter */}
        {searchQuery.trim() && (
          matchCount > 0 ? (
            <span style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.45, whiteSpace: "nowrap" }}>
              {matchIndex + 1} / {matchCount}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "#f87171", opacity: 0.7, whiteSpace: "nowrap" }}>
              no match
            </span>
          )
        )}

        {/* Depth slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.5, whiteSpace: "nowrap" }}>
            Depth {depth}
          </span>
          <input
            type="range" min={1} max={6} value={depth}
            onChange={(e) => onDepthChange(Number(e.target.value))}
            style={{ width: 70, accentColor: TAG_PALETTE[0] }}
            title="Depth — active in focus mode"
          />
        </div>

        {/* Orphans toggle */}
        <button
          onClick={onToggleOrphans}
          style={{ background: showOrphans ? "rgba(255,255,255,0.08)" : "transparent", border: "1px solid var(--color-border, #2a2a2a)", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: LABEL_COLOR, cursor: "pointer", opacity: showOrphans ? 1 : 0.5, whiteSpace: "nowrap" }}>
          {showOrphans ? `⬡ ${orphanCount}` : "⬡ off"}
        </button>

        {/* Tag colours toggle */}
        <button
          onClick={onToggleTagColors}
          style={{ background: showTagColors ? "rgba(255,255,255,0.08)" : "transparent", border: "1px solid var(--color-border, #2a2a2a)", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: LABEL_COLOR, cursor: "pointer", opacity: showTagColors ? 1 : 0.5 }}>
          🎨
        </button>

        {/* Timeline toggle */}
        <button
          onClick={onToggleTimeline}
          title="Timeline mode — arrange notes by creation date"
          style={{ background: timelineMode ? "rgba(16,185,129,0.15)" : "transparent", border: `1px solid ${timelineMode ? "rgba(16,185,129,0.4)" : "var(--color-border, #2a2a2a)"}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, color: timelineMode ? "#10b981" : LABEL_COLOR, cursor: "pointer", opacity: timelineMode ? 1 : 0.6, whiteSpace: "nowrap" }}>
          ⏱
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh} disabled={isLoading}
          style={{ background: "transparent", border: "1px solid var(--color-border, #2a2a2a)", borderRadius: 6, padding: "4px 8px", fontSize: 13, color: LABEL_COLOR, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.3 : 0.7 }}>
          {isLoading ? "…" : "↺"}
        </button>

        {/* Fit */}
        <button
          onClick={onFit}
          style={{ background: "transparent", border: "1px solid var(--color-border, #2a2a2a)", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: LABEL_COLOR, cursor: "pointer", opacity: 0.7 }}>
          Fit
        </button>

        {/* Export PNG */}
        <button
          onClick={onExport}
          title="Export graph as PNG"
          style={{ background: "transparent", border: "1px solid var(--color-border, #2a2a2a)", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: LABEL_COLOR, cursor: "pointer", opacity: 0.7 }}>
          ↓
        </button>

        {/* Fullscreen */}
        <button
          onClick={onToggleFullscreen}
          style={{ background: "transparent", border: "1px solid var(--color-border, #2a2a2a)", borderRadius: 6, padding: "4px 8px", fontSize: 12, color: LABEL_COLOR, cursor: "pointer", opacity: 0.7, lineHeight: 1 }}>
          {isFullscreen ? "⊡" : "⊞"}
        </button>

        {/* Close */}
        <button
          onClick={onClose} title="Close (Esc)"
          style={{ background: "transparent", border: "none", fontSize: 18, color: LABEL_COLOR, cursor: "pointer", opacity: 0.5, lineHeight: 1, padding: "0 4px" }}>
          ✕
        </button>
      </div>
    </div>
  );
}