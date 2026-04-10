// src/features/graph/GraphControls.tsx
// Header bar: title, stats, filter input, depth slider, all buttons.

import type { GraphNode } from "./graphTypes";

const LABEL_COLOR = "var(--color-text, #e2e2e2)";
const BORDER      = "var(--color-border, #2a2a2a)";
const BG          = "var(--color-bg, #1e1e1e)";
const ACCENT      = "#6366f1";

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

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function IconRefresh({ size = 14, color = LABEL_COLOR }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <path d="M12.5 2.5A6 6 0 1 1 7 1" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <polyline points="7,1 10,1 10,4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function IconFit({ size = 14, color = LABEL_COLOR }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <polyline points="1,4 1,1 4,1"   stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="10,1 13,1 13,4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="1,10 1,13 4,13" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="10,13 13,13 13,10" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function IconExport({ size = 14, color = LABEL_COLOR }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <line x1="7" y1="1" x2="7" y2="9"   stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <polyline points="4,6 7,10 10,6"     stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <line x1="2" y1="13" x2="12" y2="13" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

function IconFullscreen({ size = 14, color = LABEL_COLOR, compress = false }: { size?: number; color?: string; compress?: boolean }) {
  return compress ? (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <polyline points="1,4 4,4 4,1"   stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="10,1 10,4 13,4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="4,13 4,10 1,10" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="13,10 10,10 10,13" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <polyline points="1,4 1,1 4,1"   stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="10,1 13,1 13,4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="1,10 1,13 4,13" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="10,13 13,13 13,10" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <line x1="1" y1="1" x2="5" y2="5"   stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.35"/>
      <line x1="13" y1="1" x2="9" y2="5"  stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.35"/>
      <line x1="1" y1="13" x2="5" y2="9"  stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.35"/>
      <line x1="13" y1="13" x2="9" y2="9" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.35"/>
    </svg>
  );
}

function IconClose({ size = 14, color = LABEL_COLOR }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <line x1="2" y1="2" x2="12" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="12" y1="2" x2="2"  y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function IconOrphans({ size = 14, color = LABEL_COLOR }: { size?: number; color?: string }) {
  // Hexagon outline
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <polygon points="7,1 12.2,4 12.2,10 7,13 1.8,10 1.8,4" stroke={color} strokeWidth="1.3" fill="none" strokeLinejoin="round"/>
    </svg>
  );
}

function IconTagColors({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="4.5" cy="8"   r="3" fill="#6366f1"/>
      <circle cx="9.5" cy="8"   r="3" fill="#10b981"/>
      <circle cx="7"   cy="4.5" r="3" fill="#f59e0b"/>
    </svg>
  );
}

function IconTimeline({ size = 14, color = LABEL_COLOR }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.3"/>
      <line x1="7" y1="3" x2="7" y2="7"   stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="7" y1="7" x2="10" y2="9"  stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

// ── Shared button style factory ───────────────────────────────────────────────

function iconBtnStyle(active = false, activeColor?: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 26,
    borderRadius: 5,
    border: `1px solid ${active && activeColor ? activeColor + "55" : BORDER}`,
    background: active ? (activeColor ? activeColor + "18" : "rgba(255,255,255,0.08)") : "transparent",
    cursor: "pointer",
    opacity: active ? 1 : 0.6,
    flexShrink: 0,
    transition: "opacity 120ms, background 120ms",
  };
}

function divider() {
  return (
    <div style={{ width: 1, height: 16, background: BORDER, flexShrink: 0, opacity: 0.7 }} />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GraphControls({
  isLocalGraph, isLoading, stats, focusedNode, focusNodeId, initialFocusNoteId,
  searchQuery, matchIndex, matchCount, depth, showOrphans,
  orphanCount, showTagColors, isFullscreen, timelineMode,
  onSearchChange, onDepthChange, onToggleOrphans, onToggleTagColors,
  onToggleTimeline, onRefresh, onFit, onToggleFullscreen, onExport, onClose,
}: GraphControlsProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "0 12px",
      height: 48,
      borderBottom: `1px solid ${BORDER}`,
      flexShrink: 0,
      minWidth: 0,
    }}>

      {/* ── Left: title + stats + badges ──────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: LABEL_COLOR, opacity: 0.9, whiteSpace: "nowrap" }}>
          {isLocalGraph ? "Local Graph" : "Graph"}
        </span>

        {!isLoading && (
          <span style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.35, whiteSpace: "nowrap" }}>
            {stats.nodes} · {stats.edges}
          </span>
        )}

        {focusedNode && (
          <span style={{ fontSize: 10, color: ACCENT, background: ACCENT + "18", borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }}>
            {isLocalGraph && focusNodeId === initialFocusNoteId ? "Local: " : "Focus: "}{focusedNode.title}
          </span>
        )}

        {timelineMode && (
          <span style={{ fontSize: 10, color: "#10b981", background: "rgba(16,185,129,0.12)", borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap" }}>
            Timeline
          </span>
        )}
      </div>

      {/* ── Center: depth + search ────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0 }}>

        {/* Depth */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.4, whiteSpace: "nowrap" }}>
            D{depth}
          </span>
          <input
            type="range" min={1} max={6} value={depth}
            onChange={(e) => onDepthChange(Number(e.target.value))}
            style={{ width: 56, accentColor: ACCENT, cursor: "pointer" }}
            title="Depth — active in focus mode"
          />
        </div>

        {divider()}

        {/* Search */}
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Filter nodes…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              background: BG,
              border: `1px solid ${searchQuery.trim() ? ACCENT + "66" : BORDER}`,
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              color: LABEL_COLOR,
              outline: "none",
              width: 140,
              transition: "border-color 150ms",
            }}
          />
          {searchQuery.trim() && (
            <span style={{
              position: "absolute",
              right: 8,
              fontSize: 10,
              color: matchCount > 0 ? LABEL_COLOR : "#f87171",
              opacity: matchCount > 0 ? 0.45 : 0.8,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}>
              {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : "–"}
            </span>
          )}
        </div>

        {divider()}

        {/* Fit — view control, lives near search */}
        <button onClick={onFit} title="Fit graph to view" style={iconBtnStyle()}>
          <IconFit />
        </button>
      </div>

      {/* ── Right: toggles | actions | close ─────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>

        {/* View toggles */}
        <button onClick={onToggleOrphans} title={showOrphans ? `Hide orphans (${orphanCount})` : `Show orphans (${orphanCount})`} style={iconBtnStyle(showOrphans)}>
          <IconOrphans color={showOrphans ? LABEL_COLOR : LABEL_COLOR} />
        </button>

        <button onClick={onToggleTagColors} title="Toggle tag colours" style={iconBtnStyle(showTagColors)}>
          <IconTagColors />
        </button>

        <button onClick={onToggleTimeline} title="Timeline mode — arrange notes by creation date" style={iconBtnStyle(timelineMode, "#10b981")}>
          <IconTimeline color={timelineMode ? "#10b981" : LABEL_COLOR} />
        </button>

        {divider()}

        {/* Actions */}
        <button onClick={onRefresh} disabled={isLoading} title="Refresh graph" style={{ ...iconBtnStyle(), opacity: isLoading ? 0.25 : 0.6, cursor: isLoading ? "not-allowed" : "pointer" }}>
          <IconRefresh />
        </button>

        <button onClick={onExport} title="Export graph as PNG" style={iconBtnStyle()}>
          <IconExport />
        </button>

        <button onClick={onToggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} style={iconBtnStyle(isFullscreen)}>
          <IconFullscreen compress={isFullscreen} />
        </button>

        {divider()}

        {/* Close */}
        <button onClick={onClose} title="Close (Esc)" style={{ ...iconBtnStyle(), opacity: 0.4, width: 26 }}>
          <IconClose />
        </button>
      </div>
    </div>
  );
}