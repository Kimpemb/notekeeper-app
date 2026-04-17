import React from "react";
import type { CanvasEdge, CanvasNode, Viewport } from "../../../types/canvas";

interface DraftEdge {
  fromX: number;
  fromY: number;
  toX:   number;
  toY:   number;
}

interface EdgeRendererProps {
  edges:     CanvasEdge[];
  nodes:     CanvasNode[];
  viewport:  Viewport;
  draftEdge: DraftEdge | null;
}

function nodeCenter(node: CanvasNode, vp: Viewport) {
  return {
    x: (node.x + node.width  / 2) * vp.zoom + vp.x,
    y: (node.y + node.height / 2) * vp.zoom + vp.y,
  };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export const EdgeRenderer: React.FC<EdgeRendererProps> = ({
  edges,
  nodes,
  viewport,
  draftEdge,
}) => {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: "none", overflow: "visible" }}
    >
      <defs>
        <marker
          id="arrow-saved"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="rgba(124,58,237,0.6)" />
        </marker>
        <marker
          id="arrow-draft"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#7c3aed" />
        </marker>
      </defs>

      {/* Saved edges */}
      {edges.map((edge) => {
        const from = nodeMap.get(edge.from);
        const to   = nodeMap.get(edge.to);
        if (!from || !to) return null;
        const a = nodeCenter(from, viewport);
        const b = nodeCenter(to,   viewport);
        return (
          <path
            key={edge.id}
            d={bezierPath(a.x, a.y, b.x, b.y)}
            fill="none"
            stroke="rgba(124,58,237,0.45)"
            strokeWidth={1.5}
            markerEnd="url(#arrow-saved)"
          />
        );
      })}

      {/* Draft edge while dragging */}
      {draftEdge && (
        <path
          d={bezierPath(
            draftEdge.fromX, draftEdge.fromY,
            draftEdge.toX,   draftEdge.toY,
          )}
          fill="none"
          stroke="#7c3aed"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          markerEnd="url(#arrow-draft)"
        />
      )}
    </svg>
  );
};