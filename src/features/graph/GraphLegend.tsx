// src/features/graph/GraphLegend.tsx
// Bottom-left legend: tag colours, connected/isolated, controls hint.

const NODE_ISOLATED = "var(--color-text-muted, #888)";
const LABEL_COLOR   = "var(--color-text, #e2e2e2)";
const TAG_PALETTE   = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#84cc16",
];

interface GraphLegendProps {
  showTagColors: boolean;
  allTags: string[];
  tagColorMap: Map<string, string>;
}

export function GraphLegend({ showTagColors, allTags, tagColorMap }: GraphLegendProps) {
  return (
    <div style={{
      position: "absolute", bottom: 16, left: 16,
      display: "flex", flexDirection: "column", gap: 5,
      fontSize: 11, color: LABEL_COLOR, opacity: 0.45,
      pointerEvents: "none", maxWidth: 160,
    }}>
      {showTagColors && allTags.length > 0 ? (
        <>
          {allTags.slice(0, 6).map((tag) => (
            <div key={tag} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="10" height="10">
                <circle cx="5" cy="5" r="5" fill={tagColorMap.get(tag)} fillOpacity={0.85} />
              </svg>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag}</span>
            </div>
          ))}
          {allTags.length > 6 && (
            <span style={{ opacity: 0.6 }}>+{allTags.length - 6} more tags</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <svg width="10" height="10">
              <circle cx="5" cy="5" r="5" fill={NODE_ISOLATED} fillOpacity={0.85} />
            </svg>
            Isolated
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="10" height="10">
              <circle cx="5" cy="5" r="5" fill={TAG_PALETTE[0]} fillOpacity={0.85} />
            </svg>
            Connected
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="10" height="10">
              <circle cx="5" cy="5" r="5" fill={NODE_ISOLATED} fillOpacity={0.85} />
            </svg>
            Isolated
          </div>
        </>
      )}
      <div style={{ marginTop: 4, opacity: 0.7, lineHeight: 1.5 }}>
        Scroll to zoom · Drag to pan<br />
        Shift+click to focus · Esc to close
      </div>
    </div>
  );
}