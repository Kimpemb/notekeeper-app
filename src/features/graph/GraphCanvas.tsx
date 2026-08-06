// src/features/graph/GraphCanvas.tsx
//
// Houses the raw D3 canvas (svg + minimap) and the mode-specific simulation
// hook. Extracted out of GraphView because GraphView can't conditionally
// call useGraphSimulation vs useThoughtGraphSimulation in one component body
// — that violates React's rules of hooks. Instead:
//
//   GraphView renders <GraphCanvas key={graphMode} mode={graphMode} .../>
//
// The key forces a full unmount/remount on every mode switch, so within any
// single mount of GraphCanvas, `mode` never changes — GraphCanvas picks one
// of two child components (NotesCanvas / ThoughtCanvas), each of which calls
// exactly one hook, unconditionally, for its own entire lifetime. No hook
// ever gets called conditionally within a single component instance.
//
// GraphView still owns all panel/toast/history/delete-confirm state — only
// the <svg>/minimap DOM and the simulation hook call live here.

import { forwardRef, useImperativeHandle } from "react";
import type { MutableRefObject } from "react";
import * as d3 from "d3";
import { useGraphSimulation } from "./useGraphSimulation";
import type { EdgeClickData } from "./useGraphSimulation";
import { useThoughtGraphSimulation } from "./useThoughtGraphSimulation";
import type { ThoughtEdgeClickData } from "./useThoughtGraphSimulation";
import type { GraphNode, GraphEdge, ThoughtNode, ThoughtEdge } from "./graphTypes";
import type { Note } from "@/types";

const MINIMAP_W = 160;
const MINIMAP_H = 100;

// ─── Imperative handle ──────────────────────────────────────────────────────
// Exposed so GraphView can still call deleteNodeById/deleteLinkInD3 after
// its own callbacks (useGraphEdit etc.) have already patched the sim refs —
// same imperative pattern the hook itself already used before extraction.

export interface GraphCanvasHandle {
  deleteNodeById: (nodeId: string) => void;
  deleteLinkInD3: (sourceId: string, targetId: string) => void;
}

// ─── Shared props (both modes) ──────────────────────────────────────────────

interface SharedProps {
  svgRef:               MutableRefObject<SVGSVGElement | null>;
  minimapRef:           MutableRefObject<SVGSVGElement | null>;
  containerRef:         MutableRefObject<HTMLDivElement | null>;
  zoomRef:              MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  simSettledRef:        MutableRefObject<boolean>;
  hoverExitTimerRef:    MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isHoveringPreviewRef: MutableRefObject<boolean>;
  isLoading:            boolean;
  setStats:             (s: { nodes: number; edges: number }) => void;
}

// ─── Notes-mode props ────────────────────────────────────────────────────────

export interface NotesCanvasProps extends SharedProps {
  simNodesRef:     MutableRefObject<GraphNode[]>;
  simEdgesRef:     MutableRefObject<GraphEdge[]>;
  visibleNodes:    GraphNode[];
  visibleEdges:    GraphEdge[];
  allNotes:        Note[];
  showTagColors:   boolean;
  tagColorMap:     Map<string, string>;
  focusNodeId:     string | null;
  timelineMode:    boolean;
  selectedNodeIds: Set<string>;
  setActiveNote:      (id: string) => void;
  openTab:            (id: string) => void;
  setHoveredNode:     (n: GraphNode | null) => void;
  setFocusNodeId:     (fn: (prev: string | null) => string | null) => void;
  setSelectedNodeIds: (ids: Set<string>) => void;
  showToast:           (msg: string) => void;
  handleClose:         () => void;
  onCreateNode:        (x: number, y: number, onCreated: (node: GraphNode) => void) => Promise<void>;
  onRenameNode:        (nodeId: string, newTitle: string, onRenamed: (nodeId: string, title: string) => void) => Promise<void>;
  onCreateLink:        (sourceId: string, targetId: string, onLinked: (edge: GraphEdge) => void) => Promise<void>;
  onDeleteNode:        (nodeId: string, onDeleted: (nodeId: string) => void) => Promise<void>;
  onRequestDeleteNode: (nodeId: string, title: string) => void;
  onNodeClick:         (node: GraphNode) => void;
  onEdgeClick:         (data: EdgeClickData) => void;
}

// ─── Thought-mode props ──────────────────────────────────────────────────────

export interface ThoughtCanvasProps extends SharedProps {
  simNodesRef:     MutableRefObject<ThoughtNode[]>;
  simEdgesRef:     MutableRefObject<ThoughtEdge[]>;
  visibleNodes:    ThoughtNode[];
  visibleEdges:    ThoughtEdge[];
  focusNodeId:     string | null;
  activeGraphId:   string | null;
  selectedNodeIds: Set<string>;
  setHoveredNode:     (n: ThoughtNode | null) => void;
  setFocusNodeId:     (fn: (prev: string | null) => string | null) => void;
  setSelectedNodeIds: (ids: Set<string>) => void;
  onNodeClick: (node: ThoughtNode) => void;
  onEdgeClick: (data: ThoughtEdgeClickData) => void;
  canvasRightInset?: number;
  canvasLeftInset?: number;
  minimapPosition?: "left" | "right";
}

// ─── Shared SVG/minimap markup ───────────────────────────────────────────────

function CanvasSurface({
  svgRef, minimapRef, isLoading, showMinimap, minimapPosition = "right",
}: {
  svgRef:      MutableRefObject<SVGSVGElement | null>;
  minimapRef:  MutableRefObject<SVGSVGElement | null>;
  isLoading:   boolean;
  showMinimap: boolean;
  minimapPosition?: "left" | "right";
}) {
  return (
    <>
      <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      {!isLoading && showMinimap && (
        <svg
          ref={minimapRef}
          width={MINIMAP_W}
          height={MINIMAP_H}
          style={{
            position: "absolute", bottom: 16,
            ...(minimapPosition === "right" ? { right: 16 } : { left: 16 }),
            borderRadius: 8,
            overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)",
            cursor: "crosshair",
          }}
        />
      )}
    </>
  );
}

// ─── Notes canvas ─────────────────────────────────────────────────────────────

const NotesCanvas = forwardRef<GraphCanvasHandle, NotesCanvasProps>(function NotesCanvas(props, ref) {
  const { deleteNodeById, deleteLinkInD3 } = useGraphSimulation({
    svgRef:               props.svgRef,
    minimapRef:           props.minimapRef,
    containerRef:         props.containerRef,
    zoomRef:              props.zoomRef,
    simNodesRef:          props.simNodesRef,
    simEdgesRef:          props.simEdgesRef,
    simSettledRef:        props.simSettledRef,
    hoverExitTimerRef:    props.hoverExitTimerRef,
    isHoveringPreviewRef: props.isHoveringPreviewRef,
    visibleNodes:         props.visibleNodes,
    visibleEdges:         props.visibleEdges,
    allNotes:             props.allNotes,
    isLoading:            props.isLoading,
    showTagColors:        props.showTagColors,
    tagColorMap:          props.tagColorMap,
    focusNodeId:          props.focusNodeId,
    timelineMode:         props.timelineMode,
    selectedNodeIds:      props.selectedNodeIds,
    setActiveNote:        props.setActiveNote,
    openTab:              props.openTab,
    setStats:             props.setStats,
    setHoveredNode:       props.setHoveredNode,
    setFocusNodeId:       props.setFocusNodeId,
    setSelectedNodeIds:   props.setSelectedNodeIds,
    showToast:            props.showToast,
    handleClose:          props.handleClose,
    onCreateNode:         props.onCreateNode,
    onRenameNode:         props.onRenameNode,
    onCreateLink:         props.onCreateLink,
    onDeleteNode:         props.onDeleteNode,
    onRequestDeleteNode:  props.onRequestDeleteNode,
    onNodeClick:          props.onNodeClick,
    onEdgeClick:          props.onEdgeClick,
  });

  useImperativeHandle(ref, () => ({ deleteNodeById, deleteLinkInD3 }), [deleteNodeById, deleteLinkInD3]);

  return <CanvasSurface svgRef={props.svgRef} minimapRef={props.minimapRef} isLoading={props.isLoading} showMinimap={props.visibleNodes.length > 0} />;
});

// ─── Thought canvas ───────────────────────────────────────────────────────────

const ThoughtCanvas = forwardRef<GraphCanvasHandle, ThoughtCanvasProps>(function ThoughtCanvas(props, ref) {
  const { deleteNodeById, deleteLinkInD3 } = useThoughtGraphSimulation({
    svgRef:               props.svgRef,
    minimapRef:           props.minimapRef,
    containerRef:         props.containerRef,
    zoomRef:              props.zoomRef,
    simNodesRef:          props.simNodesRef,
    simEdgesRef:          props.simEdgesRef,
    simSettledRef:        props.simSettledRef,
    hoverExitTimerRef:    props.hoverExitTimerRef,
    isHoveringPreviewRef: props.isHoveringPreviewRef,
    visibleNodes:         props.visibleNodes,
    visibleEdges:         props.visibleEdges,
    isLoading:            props.isLoading,
    focusNodeId:          props.focusNodeId,
    activeGraphId:        props.activeGraphId,
    selectedNodeIds:      props.selectedNodeIds,
    setStats:             props.setStats,
    setHoveredNode:       props.setHoveredNode,
    setFocusNodeId:       props.setFocusNodeId,
    setSelectedNodeIds:   props.setSelectedNodeIds,
    onNodeClick:          props.onNodeClick,
    onEdgeClick:          props.onEdgeClick,
    canvasRightInset:     props.canvasRightInset,
    canvasLeftInset:      props.canvasLeftInset,
  });

  // v1: no manual node/edge deletion UI for Thought Graph (design doc §6 —
  // deferred). These stubs satisfy GraphCanvasHandle's shape; GraphView
  // never calls them in thought mode since there's no delete-confirm flow
  // wired up for thought nodes yet.
  useImperativeHandle(ref, () => ({ deleteNodeById, deleteLinkInD3 }), [deleteNodeById, deleteLinkInD3]);

  return <CanvasSurface svgRef={props.svgRef} minimapRef={props.minimapRef} isLoading={props.isLoading} showMinimap={props.visibleNodes.length > 0} minimapPosition="left" />;
});

// ─── Public component ─────────────────────────────────────────────────────────

export type GraphCanvasProps =
  | ({ mode: "notes" } & NotesCanvasProps)
  | ({ mode: "thought" } & ThoughtCanvasProps);

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(props, ref) {
  if (props.mode === "notes") {
    const { mode: _mode, ...rest } = props;
    return <NotesCanvas ref={ref} {...rest} />;
  }
  const { mode: _mode, ...rest } = props;
  return <ThoughtCanvas ref={ref} {...rest} />;
});