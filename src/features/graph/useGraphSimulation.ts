// src/features/graph/useGraphSimulation.ts
//
// Builds the D3 graph once on mount. All mutations (create, rename, delete,
// link) patch the live D3 selections directly via callbacks — no rebuild,
// no re-simulation, no store reads inside the D3 world.
//
// Click interaction model (revised for Tier 2):
//   • Single-click node  → open node detail panel (onNodeClick)
//   • Double-click node  → open the note (previously single-click)
//   • Ctrl/Cmd-click     → open in new tab (unchanged)
//   • Shift-click        → focus/unfocus node in graph (unchanged)
//   • Right-click node   → delete confirmation (unchanged)
//   • Click edge         → open edge panel with backlink context (onEdgeClick)
//   • Drag canvas        → multi-select rubber-band box
//
// Multi-select:
//   A rubber-band rect is drawn on canvas drag (pointer not on any node/ring).
//   Nodes whose centres fall inside the rect are added to selectedNodeIds.
//   ESC or clicking empty canvas clears selection. Selected nodes get a
//   distinct stroke colour so they're visually identifiable.

import { useEffect, useCallback, MutableRefObject, useRef } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "./graphTypes";
import { getSuggestionFeedback } from "@/features/notes/db/queries";
import { buildFeedbackMap, getSimilarityResults } from "@/features/notes/similarity/similarityUtils";
import type { Note } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_BASE_RADIUS = 5;
const NODE_MAX_RADIUS  = 18;
const LINK_STROKE      = "rgba(150,150,150,0.25)";
const LINK_STROKE_HL   = "rgba(150,150,150,0.7)";
const LINK_STROKE_SEL  = "rgba(99,102,241,0.8)";   // selected edge highlight
const NODE_ISOLATED    = "var(--color-text-muted, #888)";
const LABEL_COLOR      = "var(--color-text, #e2e2e2)";
const MINIMAP_W        = 160;
const MINIMAP_H        = 100;
const TAG_PALETTE      = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#84cc16",
];

const TIMELINE_PAD_X = 80;
const TIMELINE_PAD_Y = 48;

const SUGGESTION_STROKE           = "rgba(99,102,241,0.25)";
const SUGGESTION_STROKE_DASHARRAY = "4,3";
const SUGGESTION_CONFIDENCE_MIN   = 6;
const SUGGESTION_NODE_LIMIT       = 200;

const RING_STROKE        = "rgba(255,255,255,0.5)";
const RING_STROKE_HOVER  = "rgba(99,102,241,0.9)";
const RING_WIDTH         = 3;
const RING_GAP           = 3;

const SELECT_STROKE      = "#6366f1";   // selected node outline
const SELECT_STROKE_W    = 2.5;
const SELECT_RECT_FILL   = "rgba(99,102,241,0.07)";
const SELECT_RECT_STROKE = "rgba(99,102,241,0.5)";

const ALPHA_DECAY = 0.04;

// ─── Zoom label constants ─────────────────────────────────────────────────────

const ZOOM_LABEL_THRESHOLD = 0.6; // labels visible at default zoom
const DEFAULT_ZOOM = 0.6;        // default zoom level on open
const LABEL_MAX_CHARS = 22;

// Label offset base values (at zoom = 1.0)
const LABEL_OFFSET_DEFAULT = 14;
const LABEL_OFFSET_HOVER = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateLabel(title: string): string {
  return title.length > LABEL_MAX_CHARS ? title.slice(0, LABEL_MAX_CHARS - 1) + "…" : title;
}

function getNodeColor(node: GraphNode, tagColorMap: Map<string, string>): string {
  if (node.linkCount === 0) return NODE_ISOLATED;
  if (node.tags.length > 0) return tagColorMap.get(node.tags[0]) ?? TAG_PALETTE[0];
  return TAG_PALETTE[0];
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function floorToMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

interface SuggestionEdge { sourceId: string; targetId: string; }

// ─── Edge midpoint in screen coordinates ─────────────────────────────────────

function edgeMidpointScreen(
  e:         GraphEdge,
  transform: d3.ZoomTransform,
): { x: number; y: number } {
  const sx = typeof e.source === "object" ? (e.source as GraphNode).x ?? 0 : 0;
  const sy = typeof e.source === "object" ? (e.source as GraphNode).y ?? 0 : 0;
  const tx = typeof e.target === "object" ? (e.target as GraphNode).x ?? 0 : 0;
  const ty = typeof e.target === "object" ? (e.target as GraphNode).y ?? 0 : 0;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  return { x: transform.applyX(mx), y: transform.applyY(my) };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EdgeClickData {
  sourceId:    string;
  targetId:    string;
  screenX:     number;
  screenY:     number;
}

export interface UseGraphSimulationProps {
  svgRef:               MutableRefObject<SVGSVGElement | null>;
  minimapRef:           MutableRefObject<SVGSVGElement | null>;
  containerRef:         MutableRefObject<HTMLDivElement | null>;
  zoomRef:              MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  simNodesRef:          MutableRefObject<GraphNode[]>;
  simEdgesRef:          MutableRefObject<GraphEdge[]>;
  simSettledRef:        MutableRefObject<boolean>;
  hoverExitTimerRef:    MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isHoveringPreviewRef: MutableRefObject<boolean>;

  visibleNodes:         GraphNode[];
  visibleEdges:         GraphEdge[];
  allNotes:             Note[];
  isLoading:            boolean;
  showTagColors:        boolean;
  tagColorMap:          Map<string, string>;
  focusNodeId:          string | null;
  timelineMode:         boolean;
  selectedNodeIds:      Set<string>;

  setActiveNote:        (id: string) => void;
  openTab:              (id: string) => void;
  setStats:             (s: { nodes: number; edges: number }) => void;
  setHoveredNode:       (n: GraphNode | null) => void;
  setFocusNodeId:       (fn: (prev: string | null) => string | null) => void;
  setSelectedNodeIds:   (ids: Set<string>) => void;
  showToast:            (msg: string) => void;
  handleClose:          () => void;
  onCreateNode:         (x: number, y: number, onCreated: (node: GraphNode) => void) => Promise<void>;
  onRenameNode:         (nodeId: string, newTitle: string, onRenamed: (nodeId: string, title: string) => void) => Promise<void>;
  onCreateLink:         (sourceId: string, targetId: string, onLinked: (edge: GraphEdge) => void) => Promise<void>;
  onDeleteNode:         (nodeId: string, onDeleted: (nodeId: string) => void) => Promise<void>;
  onRequestDeleteNode:  (nodeId: string, title: string) => void;
  // New Tier 2 callbacks
  onNodeClick:          (node: GraphNode) => void;
  onEdgeClick:          (data: EdgeClickData) => void;
}

export interface UseGraphSimulationResult {
  deleteNodeById:   (nodeId: string) => void;
  deleteLinkInD3:   (sourceId: string, targetId: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGraphSimulation({
  svgRef, minimapRef, containerRef, zoomRef,
  simNodesRef, simEdgesRef, simSettledRef,
  hoverExitTimerRef, isHoveringPreviewRef,
  visibleNodes, visibleEdges, allNotes, isLoading,
  showTagColors, tagColorMap, focusNodeId, timelineMode,
  selectedNodeIds,
  setActiveNote, openTab, setStats, setHoveredNode,
  setFocusNodeId, setSelectedNodeIds,
  showToast, handleClose,
  onCreateNode, onRenameNode, onCreateLink,
  onRequestDeleteNode,
  onNodeClick, onEdgeClick,
}: UseGraphSimulationProps): UseGraphSimulationResult {

  const nodeSelRef  = useRef<d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown> | null>(null);
  const ringSelRef  = useRef<d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown> | null>(null);
  const labelSelRef = useRef<d3.Selection<SVGTextElement,   GraphNode, SVGGElement, unknown> | null>(null);
  const linkSelRef  = useRef<d3.Selection<SVGLineElement,   GraphEdge, SVGGElement, unknown> | null>(null);
  const simRef      = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const rScaleRef   = useRef<d3.ScalePower<number, number> | null>(null);
  const currentZoomRef = useRef<number>(DEFAULT_ZOOM);

  const nodeGRef  = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const ringGRef  = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const labelGRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkGRef  = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);

  // Keep selectedNodeIds accessible inside D3 callbacks without causing rebuilds
  const selectedNodeIdsRef = useRef<Set<string>>(selectedNodeIds);
  useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds; }, [selectedNodeIds]);

  // ── Imperative delete-node handle ─────────────────────────────────────────
  const deleteNodeById = useCallback(() => {
    const nodeG  = nodeGRef.current;
    const ringG  = ringGRef.current;
    const labelG = labelGRef.current;
    const linkG  = linkGRef.current;
    if (!nodeG || !ringG || !labelG || !linkG) return;

    nodeSelRef.current = nodeG
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodesRef.current, (n) => n.id)
      .join(
        (enter) => enter as unknown as d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>,
        (update) => update,
        (exit)   => exit.remove(),
      ) as d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>;

    ringSelRef.current = ringG
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodesRef.current, (n) => n.id)
      .join(
        (enter) => enter as unknown as d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>,
        (update) => update,
        (exit)   => exit.remove(),
      ) as d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>;

    labelSelRef.current = labelG
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(simNodesRef.current, (n) => n.id)
      .join(
        (enter) => enter as unknown as d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown>,
        (update) => update,
        (exit)   => exit.remove(),
      ) as d3.Selection<SVGTextElement, GraphNode, SVGGElement, unknown>;

    linkSelRef.current = linkG
  .selectAll<SVGLineElement, GraphEdge>("line.visible")
  .data(simEdgesRef.current)
  .join(
    (enter) => enter as unknown as d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown>,
    (update) => update,
    (exit)   => exit.remove(),
  ) as d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown>;

    simRef.current?.nodes(simNodesRef.current);
    setStats({ nodes: simNodesRef.current.length, edges: simEdgesRef.current.length });
  }, [simNodesRef, simEdgesRef, setStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Imperative delete-link handle ─────────────────────────────────────────
  //
  // Called by GraphView after useGraphEdit.deleteLink has already patched
  // simEdgesRef and simNodesRef. This re-binds the D3 selections so the
  // removed line disappears and node sizes update.
  const deleteLinkInD3 = useCallback((sourceId: string, targetId: string) => {
    const linkG = linkGRef.current;
    if (!linkG) return;

    // Step 1: re-register edges with forceLink so it resolves refs
    const simulation = simRef.current;
    if (simulation) {
      const forceLink = simulation.force("link") as d3.ForceLink<GraphNode, GraphEdge>;
      forceLink.links(simEdgesRef.current);
    }

    // Step 2: rebind link selection — exit removes the deleted line
linkSelRef.current = linkG
  .selectAll<SVGLineElement, GraphEdge>("line.visible")
  .data(simEdgesRef.current, (e) => {
    const s = e.sourceId ?? (typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string);
    const t = e.targetId ?? (typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string);
    return `${s}|${t}`;
  })
      .join(
        (enter) => enter.append("line")
          .attr("stroke",         LINK_STROKE)
          .attr("stroke-width",   1)
          .attr("stroke-opacity", 0.25),
        (update) => update,
        (exit)   => exit.remove(),
      );

    // Step 3: update node/ring/label sizes since linkCount changed
    nodeSelRef.current?.attr("r",  (n) => rScaleRef.current!(n.linkCount));
    ringSelRef.current?.attr("r",  (n) => rScaleRef.current!(n.linkCount) + RING_GAP + RING_WIDTH);
    labelSelRef.current?.attr("dy",(n) => rScaleRef.current!(n.linkCount) + LABEL_OFFSET_DEFAULT);

    // Step 4: gentle kick so sim re-settles
    simulation?.alpha(0.1).restart();

    setStats({ nodes: simNodesRef.current.length, edges: simEdgesRef.current.length });

    void sourceId; void targetId; // used by caller for context but not needed here
  }, [simNodesRef, simEdgesRef, setStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Main D3 effect ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !minimapRef.current) return;
    if (visibleNodes.length === 0 && !isLoading) {
      d3.select(svgRef.current).selectAll("*").remove();
      return;
    }
    if (visibleNodes.length === 0) return;

    simSettledRef.current = false;

    const simNodes: GraphNode[] = visibleNodes.map((n) => ({ ...n }));
    // Carry sourceId/targetId through so handlers can always read raw IDs
    const simEdges: GraphEdge[] = visibleEdges.map((e) => {
      const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
      const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
      return { ...e, sourceId: sid, targetId: tid };
    });
    simNodesRef.current = simNodes;
    simEdgesRef.current = simEdges;

    setStats({ nodes: simNodes.length, edges: simEdges.length });

    const maxWeight          = Math.max(1, ...simEdges.map((e) => e.weight ?? 1));
    const strokeWidthScale   = d3.scaleLinear().domain([1, maxWeight]).range([1, 3]).clamp(true);
    const strokeOpacityScale = d3.scaleLinear().domain([1, maxWeight]).range([0.25, 0.5]).clamp(true);

    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");

    // ── rScale ────────────────────────────────────────────────────────────
    const maxLinks = Math.max(1, d3.max(simNodes, (n) => n.linkCount) ?? 1);
    const rScale   = d3.scaleSqrt().domain([0, maxLinks]).range([NODE_BASE_RADIUS, NODE_MAX_RADIUS]);
    rScaleRef.current = rScale;

    // ── Timeline layout ───────────────────────────────────────────────────
    const timestamps = simNodes.map((n) => n.created_at);
    const minTs      = Math.min(...timestamps);
    const maxTs      = Math.max(...timestamps);
    const minMonth   = floorToMonth(minTs);
    const maxMonth   = floorToMonth(maxTs === minTs ? maxTs + 1 : maxTs);

    const timelineX = d3.scaleTime()
      .domain([new Date(minMonth), new Date(maxMonth)])
      .range([TIMELINE_PAD_X, width - TIMELINE_PAD_X]);

    const monthTicks: Date[] = [];
    let cur = new Date(minMonth);
    while (cur <= new Date(maxMonth)) {
      monthTicks.push(new Date(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }

    const axisG = svg.append("g").attr("class", "timeline-axis");
    if (timelineMode) {
      axisG.append("line")
        .attr("x1", TIMELINE_PAD_X).attr("x2", width - TIMELINE_PAD_X)
        .attr("y1", height - TIMELINE_PAD_Y).attr("y2", height - TIMELINE_PAD_Y)
        .attr("stroke", "rgba(255,255,255,0.1)").attr("stroke-width", 1);

      const tickInterval = monthTicks.length > 18 ? 3 : 1;
      monthTicks.forEach((d, i) => {
        if (i % tickInterval !== 0) return;
        const x = timelineX(d);
        axisG.append("line")
          .attr("x1", x).attr("x2", x)
          .attr("y1", height - TIMELINE_PAD_Y).attr("y2", height - TIMELINE_PAD_Y + 5)
          .attr("stroke", "rgba(255,255,255,0.15)").attr("stroke-width", 1);
        axisG.append("line")
          .attr("x1", x).attr("x2", x)
          .attr("y1", 0).attr("y2", height - TIMELINE_PAD_Y)
          .attr("stroke", "rgba(255,255,255,0.04)").attr("stroke-width", 1)
          .attr("stroke-dasharray", "3,4");
        axisG.append("text")
          .attr("x", x).attr("y", height - TIMELINE_PAD_Y + 16)
          .attr("text-anchor", "middle").attr("font-size", 10)
          .attr("fill", LABEL_COLOR).attr("opacity", 0.4)
          .text(monthLabel(d));
      });
    }

    // ── Minimap ───────────────────────────────────────────────────────────
    const minimap = d3.select(minimapRef.current);
    minimap.selectAll("*").remove();
    minimap.append("rect")
      .attr("width", MINIMAP_W).attr("height", MINIMAP_H)
      .attr("fill", "rgba(0,0,0,0.5)").attr("rx", 6);
    const mmG = minimap.append("g").attr("class", "mm-nodes");
    minimap.append("rect").attr("class", "mm-viewport")
      .attr("fill", "rgba(255,255,255,0.06)")
      .attr("stroke", "rgba(255,255,255,0.2)").attr("stroke-width", 1).attr("rx", 2);

    function getMinimapScale(ns: GraphNode[]) {
      const xs = ns.map((n) => n.x ?? 0);
      const ys = ns.map((n) => n.y ?? 0);
      if (xs.length === 0) return { scale: 1, minX: 0, minY: 0 };
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const pad  = 10;
      const scale = Math.min(
        (MINIMAP_W - pad * 2) / (maxX - minX || 1),
        (MINIMAP_H - pad * 2) / (maxY - minY || 1),
      );
      return { scale, minX, minY };
    }

    function updateMinimapNodes() {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      const pad = 10;
      mmG.selectAll<SVGCircleElement, GraphNode>("circle")
        .data(ns, (d) => d.id).join("circle")
        .attr("cx", (d) => ((d.x ?? 0) - minX) * scale + pad)
        .attr("cy", (d) => ((d.y ?? 0) - minY) * scale + pad)
        .attr("r", 2)
        .attr("fill", (d) => showTagColors
          ? getNodeColor(d, tagColorMap)
          : (d.linkCount === 0 ? NODE_ISOLATED : TAG_PALETTE[0]))
        .attr("fill-opacity", 0.7);
    }

    function updateMinimapViewport(transform: d3.ZoomTransform, w: number, h: number) {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      const pad = 10;
      const topLeft     = transform.invert([0, 0]);
      const bottomRight = transform.invert([w, h]);
      minimap.select(".mm-viewport")
        .attr("x",      Math.max(0, (topLeft[0] - minX) * scale + pad))
        .attr("y",      Math.max(0, (topLeft[1] - minY) * scale + pad))
        .attr("width",  Math.min(MINIMAP_W, Math.max(0, (bottomRight[0] - topLeft[0]) * scale)))
        .attr("height", Math.min(MINIMAP_H, Math.max(0, (bottomRight[1] - topLeft[1]) * scale)));
    }

    minimap.style("cursor", "crosshair").on("click", function (event) {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      if (scale === 0) return;
      const pad = 10;
      const [mmX, mmY] = d3.pointer(event);
      const graphX = (mmX - pad) / scale + minX;
      const graphY = (mmY - pad) / scale + minY;
      const current = d3.zoomTransform(svgRef.current!);
      svg.transition().duration(300).call(zoom.transform,
        d3.zoomIdentity
          .translate(width / 2 - graphX * current.k, height / 2 - graphY * current.k)
          .scale(current.k),
      );
    });

    // ── Zoom ──────────────────────────────────────────────────────────────
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        updateMinimapViewport(event.transform, width, height);

        const k = event.transform.k;
        const wasAbove = currentZoomRef.current >= ZOOM_LABEL_THRESHOLD;
        const isAbove  = k >= ZOOM_LABEL_THRESHOLD;
        currentZoomRef.current = k;

        if (wasAbove !== isAbove) {
          // Threshold crossed — update all label visibility
          if (isAbove) {
            labelSelRef.current?.attr("opacity", 1);
          } else {
            labelSelRef.current?.attr("opacity", (n) => focusNodeId === n.id ? 1 : 0);
          }
        }
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    svg.on("dblclick.zoom", null);
    svgRef.current?.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    svg.on("touchstart", (e) => e.preventDefault(), { passive: false });
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(DEFAULT_ZOOM));

    if (timelineMode) {
      simNodes.forEach((n) => {
        n.fx = timelineX(new Date(floorToMonth(n.created_at)));
        if (n.y === undefined) n.y = height / 2 + (Math.random() - 0.5) * 200;
      });
    }

    // ── Link drag ghost line ──────────────────────────────────────────────
    let linkDragState = { active: false, sourceId: "", sourceX: 0, sourceY: 0 };

    const linkDragLine = svg.append("line")
      .attr("stroke", RING_STROKE_HOVER)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "5,3")
      .attr("pointer-events", "none")
      .attr("opacity", 0);

    // ── Multi-select rubber-band ──────────────────────────────────────────
    //
    // A transparent rect drawn on the svg (above the zoom layer) when the
    // user drags on empty canvas. On drag-end, any node whose centre falls
    // inside the rect is added to selectedNodeIds.
    const selectRect = svg.append("rect")
      .attr("class",          "select-rect")
      .attr("fill",           SELECT_RECT_FILL)
      .attr("stroke",         SELECT_RECT_STROKE)
      .attr("stroke-width",   1)
      .attr("stroke-dasharray","4,2")
      .attr("pointer-events", "none")
      .attr("rx",             3)
      .attr("opacity",        0);

    let selectDrag = { active: false, startX: 0, startY: 0 };

    svg.on("mousedown.select", function (event) {
      // Only start rubber-band on left-click on the raw SVG background
      // (not on nodes, rings, labels, or the rename overlay)
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (
        target.closest(".nodes")   ||
        target.closest(".rings")   ||
        target.closest(".labels")  ||
        target.closest(".edges")   ||
        target.closest(".rename-overlay")
      ) return;
      if (linkDragState.active) return;

      const [px, py] = d3.pointer(event, svgRef.current);
      selectDrag = { active: true, startX: px, startY: py };
      selectRect
        .attr("x",       px).attr("y",      py)
        .attr("width",   0) .attr("height", 0)
        .attr("opacity", 1);
    });

    svg.on("mousemove.select", function (event) {
      if (!selectDrag.active) return;
      const [px, py] = d3.pointer(event, svgRef.current);
      const rx = Math.min(px, selectDrag.startX);
      const ry = Math.min(py, selectDrag.startY);
      const rw = Math.abs(px - selectDrag.startX);
      const rh = Math.abs(py - selectDrag.startY);
      selectRect.attr("x", rx).attr("y", ry).attr("width", rw).attr("height", rh);
    });

    svg.on("mouseup.select", function (event) {
      if (!selectDrag.active) return;
      selectDrag.active = false;
      selectRect.attr("opacity", 0);

      const [px, py] = d3.pointer(event, svgRef.current);
      const rw = Math.abs(px - selectDrag.startX);
      const rh = Math.abs(py - selectDrag.startY);

      // Only register a selection if the drag was meaningful (>8px)
      if (rw < 8 && rh < 8) return;

      const transform = d3.zoomTransform(svgRef.current!);
      const x0 = Math.min(px, selectDrag.startX);
      const y0 = Math.min(py, selectDrag.startY);
      const x1 = Math.max(px, selectDrag.startX);
      const y1 = Math.max(py, selectDrag.startY);

      // Convert rect corners to graph space
      const [gx0, gy0] = transform.invert([x0, y0]);
      const [gx1, gy1] = transform.invert([x1, y1]);

      const selected = new Set<string>();
      for (const n of simNodesRef.current) {
        const nx = n.x ?? 0;
        const ny = n.y ?? 0;
        if (nx >= gx0 && nx <= gx1 && ny >= gy0 && ny <= gy1) {
          selected.add(n.id);
        }
      }

      setSelectedNodeIds(selected);

      // Update node stroke to reflect selection
      nodeSelRef.current
        ?.attr("stroke",       (n) => selected.has(n.id) ? SELECT_STROKE : (focusNodeId === n.id ? "#fff" : "transparent"))
        .attr("stroke-width",  (n) => selected.has(n.id) ? SELECT_STROKE_W : 2);
    });

    // ── Edges ─────────────────────────────────────────────────────────────
const linkG = g.append("g").attr("class", "edges");
linkGRef.current = linkG as any;

let link = linkG.selectAll<SVGLineElement, GraphEdge>("line.visible")
  .data(simEdges).join(
    (enter) => enter.append("line").attr("class", "visible"),
    (update) => update,
    (exit)   => exit.remove(),
  )
  .attr("stroke",         LINK_STROKE)
  .attr("stroke-width",   (e) => strokeWidthScale(e.weight ?? 1))
  .attr("stroke-opacity", (e) => strokeOpacityScale(e.weight ?? 1))
  .attr("pointer-events", "none"); // hit target handles clicks

let linkHit = linkG.selectAll<SVGLineElement, GraphEdge>("line.hit")
  .data(simEdges).join(
    (enter) => enter.append("line").attr("class", "hit"),
    (update) => update,
    (exit)   => exit.remove(),
  )
  .attr("stroke",       "transparent")
  .attr("stroke-width", 12)
  .attr("fill",         "none")
  .style("cursor",      "pointer");

// Edge click — opens the edge panel via the wide hit target
linkHit.on("click", function (event, e) {
  event.stopPropagation();
  if (linkDragState.active) return;

  const transform = d3.zoomTransform(svgRef.current!);
  const mid       = edgeMidpointScreen(e, transform);
  const rect      = containerRef.current!.getBoundingClientRect();

  // Highlight the clicked visible edge
  link
    .attr("stroke",       (d) => d === e ? LINK_STROKE_SEL : LINK_STROKE)
    .attr("stroke-width", (d) => d === e ? strokeWidthScale(d.weight ?? 1) + 1 : strokeWidthScale(d.weight ?? 1));

  onEdgeClick({
    sourceId: e.sourceId,
    targetId: e.targetId,
    screenX:  mid.x + rect.left,
    screenY:  mid.y + rect.top,
  });
});

linkSelRef.current = link as any;

    // Reset edge highlight when clicking elsewhere
    svg.on("click.edgereset", () => {
  link
    .attr("stroke",       LINK_STROKE)
    .attr("stroke-width", (e) => strokeWidthScale(e.weight ?? 1));
});

    linkSelRef.current = link as any;

    
    

    // ── Suggestion edges ──────────────────────────────────────────────────
    const suggestionG = g.append("g").attr("class", "suggestion-edges");

    const existingEdgeKeys = new Set<string>(
      simEdges.map((e) => {
        const sid = e.sourceId;
        const tid = e.targetId;
        return [sid, tid].sort().join("|");
      }),
    );

    let suggestionTimer: ReturnType<typeof setTimeout> | null = null;

    async function drawSuggestionEdges() {
      if (allNotes.length === 0 || simNodesRef.current.length > SUGGESTION_NODE_LIMIT) return;

      const feedback    = await getSuggestionFeedback();
      const feedbackMap = buildFeedbackMap(feedback);
      const pairs: SuggestionEdge[] = [];
      const seenPairs = new Set<string>();

      for (const sourceNode of simNodesRef.current) {
        const sourceNote = allNotes.find((n) => n.id === sourceNode.id);
        if (!sourceNote) continue;
        const backlinkIds = new Set<string>();
        simEdgesRef.current.forEach((e) => {
          const sid = e.sourceId;
          const tid = e.targetId;
          if (sid === sourceNode.id) backlinkIds.add(tid);
          if (tid === sourceNode.id) backlinkIds.add(sid);
        });
        const results = getSimilarityResults(sourceNote, allNotes, feedback, backlinkIds, 10);
        for (const r of results) {
          if (r.score < SUGGESTION_CONFIDENCE_MIN) continue;
          const key = [sourceNode.id, r.noteId].sort().join("|");
          if (seenPairs.has(key) || existingEdgeKeys.has(key)) continue;
          const pairFeedback = feedbackMap.get(sourceNode.id)?.get(r.noteId);
          if (pairFeedback === "ignored") continue;
          seenPairs.add(key);
          pairs.push({ sourceId: sourceNode.id, targetId: r.noteId });
        }
      }
      if (pairs.length === 0) return;
      const nodeById = new Map(simNodesRef.current.map((n) => [n.id, n]));
      suggestionG.selectAll("line").data(pairs).join("line")
        .attr("x1", (d) => nodeById.get(d.sourceId)?.x ?? 0)
        .attr("y1", (d) => nodeById.get(d.sourceId)?.y ?? 0)
        .attr("x2", (d) => nodeById.get(d.targetId)?.x ?? 0)
        .attr("y2", (d) => nodeById.get(d.targetId)?.y ?? 0)
        .attr("stroke",           SUGGESTION_STROKE)
        .attr("stroke-width",     1)
        .attr("stroke-dasharray", SUGGESTION_STROKE_DASHARRAY)
        .attr("pointer-events",   "none");
    }

    // ── Nodes ─────────────────────────────────────────────────────────────
    const nodeG = g.append("g").attr("class", "nodes");
    nodeGRef.current = nodeG as any;

    let node = nodeG.selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodes, (d) => d.id).join("circle")
      .attr("r",            (d) => rScale(d.linkCount))
      .attr("fill",         (d) => showTagColors
        ? getNodeColor(d, tagColorMap)
        : (d.linkCount === 0 ? NODE_ISOLATED : TAG_PALETTE[0]))
      .attr("fill-opacity", (d) => focusNodeId === d.id ? 1 : 0.85)
      .attr("stroke",       (d) => {
        if (selectedNodeIdsRef.current.has(d.id)) return SELECT_STROKE;
        return focusNodeId === d.id ? "#fff" : "transparent";
      })
      .attr("stroke-width", (d) => selectedNodeIdsRef.current.has(d.id) ? SELECT_STROKE_W : 2)
      .style("cursor", "pointer");
    nodeSelRef.current = node;

    // ── Rings ─────────────────────────────────────────────────────────────
    const ringG = g.append("g").attr("class", "rings");
    ringGRef.current = ringG as any;

    let ring = ringG.selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodes, (d) => d.id).join("circle")
      .attr("r",            (d) => rScale(d.linkCount) + RING_GAP + RING_WIDTH)
      .attr("fill",         "none")
      .attr("stroke",       RING_STROKE)
      .attr("stroke-width", RING_WIDTH)
      .attr("opacity",      0)
      .style("cursor", "crosshair");
    ringSelRef.current = ring;

    // ── Labels ────────────────────────────────────────────────────────────
    const labelG = g.append("g").attr("class", "labels");
    labelGRef.current = labelG as any;

    let label = labelG.selectAll<SVGTextElement, GraphNode>("text")
      .data(simNodes, (d) => d.id).join("text")
      .text((d) => truncateLabel(d.title))
      .attr("font-size",      11)
      .attr("fill",           LABEL_COLOR)
      .attr("text-anchor",    "middle")
      .attr("dy",             (d) => rScale(d.linkCount) + LABEL_OFFSET_DEFAULT)
      .attr("pointer-events", "all")
      .attr("opacity",        (d) => focusNodeId === d.id ? 1 : 0)
      .style("cursor", "text");
    labelSelRef.current = label;

    // ── Rename input ──────────────────────────────────────────────────────
    function showRenameInput(d: GraphNode, isCreation = false) {
      g.selectAll(".rename-overlay").remove();

      const r        = rScale(d.linkCount);
      const foWidth  = 180;
      const foHeight = 30;

      const fo = g.append("foreignObject")
        .attr("class", "rename-overlay")
        .attr("x",      (d.x ?? 0) - foWidth / 2)
        .attr("y",      (d.y ?? 0) - r - foHeight - 6)
        .attr("width",  foWidth)
        .attr("height", foHeight);

      const input = fo.append("xhtml:input")
        .attr("type",  "text")
        .attr("value", isCreation ? "" : d.title)
        .attr("placeholder", "Note title…")
        .style("width",         "100%")
        .style("height",        "100%")
        .style("background",    "rgba(24,24,24,0.97)")
        .style("border",        "1px solid rgba(99,102,241,0.7)")
        .style("border-radius", "5px")
        .style("color",         LABEL_COLOR)
        .style("font-size",     "12px")
        .style("padding",       "0 8px")
        .style("outline",       "none")
        .style("box-sizing",    "border-box");

      const inputEl = input.node() as HTMLInputElement;
      inputEl.focus();
      if (!isCreation) inputEl.select();

      let committed = false;

      function commit() {
        if (committed) return;
        committed = true;
        const newTitle = inputEl.value.trim();
        g.selectAll(".rename-overlay").remove();

        const finalTitle = newTitle || "Untitled";

        if (finalTitle === d.title && !isCreation) {
          d.fx = null; d.fy = null;
          return;
        }

        onRenameNode(d.id, finalTitle, (nodeId, title) => {
          labelSelRef.current
            ?.filter((n) => n.id === nodeId)
            .text(truncateLabel(title))
            .each(function(n) { n.title = title; });
          d.fx = null; d.fy = null;
        }).catch(console.error);
      }

      function cancel() {
        if (committed) return;
        committed = true;
        g.selectAll(".rename-overlay").remove();
        d.fx = null; d.fy = null;
      }

      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
        e.stopPropagation();
      });
      inputEl.addEventListener("blur", commit);
    }

    // ── Ring drag (link creation) ─────────────────────────────────────────
    const ringDrag = d3.drag<SVGCircleElement, GraphNode>()
      .on("start", (_event, d) => {
        linkDragState = { active: true, sourceId: d.id, sourceX: d.x ?? 0, sourceY: d.y ?? 0 };
        const transform = d3.zoomTransform(svgRef.current!);
        const sx = transform.applyX(d.x ?? 0);
        const sy = transform.applyY(d.y ?? 0);
        linkDragLine
          .attr("x1", sx).attr("y1", sy)
          .attr("x2", sx).attr("y2", sy)
          .attr("opacity", 1);
        ringSelRef.current?.filter((r) => r.id === d.id).attr("stroke", RING_STROKE_HOVER);
      })
      .on("drag", (event) => {
        if (!linkDragState.active) return;
        const [px, py] = d3.pointer(event, svgRef.current);
        linkDragLine.attr("x2", px).attr("y2", py);

        const transform = d3.zoomTransform(svgRef.current!);
        const [gx, gy]  = transform.invert([px, py]);
        let closest: GraphNode | null = null;
        let closestDist = Infinity;
        for (const n of simNodesRef.current) {
          if (n.id === linkDragState.sourceId) continue;
          const dx   = (n.x ?? 0) - gx;
          const dy   = (n.y ?? 0) - gy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const r    = rScaleRef.current!(n.linkCount);
          if (dist < r + RING_GAP + RING_WIDTH + 4 && dist < closestDist) {
            closest = n; closestDist = dist;
          }
        }
        nodeSelRef.current
          ?.attr("stroke",      (n) => n.id === closest?.id ? RING_STROKE_HOVER : "transparent")
          .attr("stroke-width", (n) => n.id === closest?.id ? 2 : 0);
      })
      .on("end", (event) => {
        if (!linkDragState.active) return;
        const [px, py]  = d3.pointer(event, svgRef.current);
        const transform = d3.zoomTransform(svgRef.current!);
        const [gx, gy]  = transform.invert([px, py]);

        let target: GraphNode | null = null;
        for (const n of simNodesRef.current) {
          if (n.id === linkDragState.sourceId) continue;
          const dx   = (n.x ?? 0) - gx;
          const dy   = (n.y ?? 0) - gy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const r    = rScaleRef.current!(n.linkCount);
          if (dist < r + RING_GAP + RING_WIDTH + 4) { target = n; break; }
        }

        if (target) {
          const sourceId = linkDragState.sourceId;
          const targetId = target.id;

          onCreateLink(sourceId, targetId, (_newEdge) => {
            const forceLink = simulation.force("link") as d3.ForceLink<GraphNode, GraphEdge>;
            forceLink.links(simEdgesRef.current);

            link = linkG.selectAll<SVGLineElement, GraphEdge>("line")
              .data(simEdgesRef.current, (e) => {
                const s = e.sourceId ?? (typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string);
                const t = e.targetId ?? (typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string);
                return `${s}|${t}`;
              })
              .join(
                (enter) => enter.append("line")
                  .attr("stroke",         LINK_STROKE)
                  .attr("stroke-width",   (e) => strokeWidthScale(e.weight ?? 1))
                  .attr("stroke-opacity", (e) => strokeOpacityScale(e.weight ?? 1))
                  .style("cursor",        "pointer")
                  .on("click", function (event, e) {
                    event.stopPropagation();
                    if (linkDragState.active) return;
                    const transform = d3.zoomTransform(svgRef.current!);
                    const mid       = edgeMidpointScreen(e, transform);
                    const rect      = containerRef.current!.getBoundingClientRect();
                    link
                      .attr("stroke",       (d) => d === e ? LINK_STROKE_SEL : LINK_STROKE)
                      .attr("stroke-width", (d) => d === e ? strokeWidthScale(d.weight ?? 1) + 1 : strokeWidthScale(d.weight ?? 1));
                    onEdgeClick({
                      sourceId: e.sourceId,
                      targetId: e.targetId,
                      screenX:  mid.x + rect.left,
                      screenY:  mid.y + rect.top,
                    });
                  }),
                (update) => update,
                (exit)   => exit.remove(),
              );
            linkSelRef.current = link;

            const nodeById = new Map(simNodesRef.current.map((n) => [n.id, n]));
            link.filter((e) => {
              const s = e.sourceId ?? (typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string);
              const t = e.targetId ?? (typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string);
              return (s === sourceId && t === targetId) || (s === targetId && t === sourceId);
            })
            .attr("x1", () => nodeById.get(sourceId)?.x ?? 0)
            .attr("y1", () => nodeById.get(sourceId)?.y ?? 0)
            .attr("x2", () => nodeById.get(targetId)?.x ?? 0)
            .attr("y2", () => nodeById.get(targetId)?.y ?? 0);

            nodeSelRef.current?.attr("r",  (n) => rScaleRef.current!(n.linkCount));
            ringSelRef.current?.attr("r",  (n) => rScaleRef.current!(n.linkCount) + RING_GAP + RING_WIDTH);
            labelSelRef.current?.attr("dy",(n) => rScaleRef.current!(n.linkCount) + LABEL_OFFSET_DEFAULT);

            simulation.alpha(0.1).restart();
            setStats({ nodes: simNodesRef.current.length, edges: simEdgesRef.current.length });
          }).catch(console.error);
        }

        linkDragState = { active: false, sourceId: "", sourceX: 0, sourceY: 0 };
        linkDragLine.attr("opacity", 0);
        nodeSelRef.current
          ?.attr("stroke",       (n) => {
            if (selectedNodeIdsRef.current.has(n.id)) return SELECT_STROKE;
            return focusNodeId === n.id ? "#fff" : "transparent";
          })
          .attr("stroke-width",  (n) => selectedNodeIdsRef.current.has(n.id) ? SELECT_STROKE_W : 2);
        ringSelRef.current?.attr("opacity", 0).attr("stroke", RING_STROKE);
      });

    ring.call(ringDrag);

    // ── Node events ───────────────────────────────────────────────────────
    function attachNodeEvents(
  sel: d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>,
) {
  sel
    .on("mouseenter", function (event, d) {
      void event; // D3 callback signature requires event parameter
      if (hoverExitTimerRef.current) clearTimeout(hoverExitTimerRef.current);
      ringSelRef.current?.filter((r) => r.id === d.id)
        .attr("opacity", 1).attr("stroke", RING_STROKE);

      const neighbourIds = new Set<string>();
      simEdgesRef.current.forEach((e) => {
        const sid = e.sourceId;
        const tid = e.targetId;
        if (sid === d.id) neighbourIds.add(tid);
        if (tid === d.id) neighbourIds.add(sid);
      });

      const isZoomedIn = currentZoomRef.current >= ZOOM_LABEL_THRESHOLD;
      
      // Dim non-hovered nodes (but not neighbours)
      nodeSelRef.current?.transition()
        .duration(300)
        .attr("fill-opacity", (n) => {
          if (n.id === d.id || neighbourIds.has(n.id)) return 1;
          return 0.3;
        });
      
      // Highlight connected links, dim others
      linkSelRef.current?.transition()
        .duration(300)
        .attr("stroke", (e) => {
          const sid = e.sourceId;
          const tid = e.targetId;
          return sid === d.id || tid === d.id ? LINK_STROKE_HL : LINK_STROKE;
        })
        .attr("stroke-width", (e) => {
          const sid = e.sourceId;
          const tid = e.targetId;
          return sid === d.id || tid === d.id ? strokeWidthScale(e.weight ?? 1) + 0.5 : 0.5;
        })
        .attr("stroke-opacity", (e) => {
          const sid = e.sourceId;
          const tid = e.targetId;
          return sid === d.id || tid === d.id ? 0.8 : 0.15;
        });
      
      // Handle label visibility
      if (isZoomedIn) {
        // Zoomed in: dim other labels, show hovered + neighbours at full opacity
        labelSelRef.current?.transition()
          .duration(300)
          .attr("opacity", (n) => {
            if (n.id === d.id || neighbourIds.has(n.id)) return 1;
            return 0.3;
          });
      } else {
        // Zoomed out: only show hovered + neighbours
        labelSelRef.current?.transition()
          .duration(300)
          .attr("opacity", (n) => {
            if (n.id === d.id || neighbourIds.has(n.id)) return 1;
            return 0;
          });
      }
      
      // Scale the hover offset based on current zoom level
      const zoomScale = currentZoomRef.current;
      const hoverOffset = LABEL_OFFSET_HOVER / zoomScale;
      
      // Force the hovered node's label to be visible and move it down
      labelSelRef.current
        ?.filter(function(n) { return n.id === d.id; })
        .transition()
        .duration(400)
        .attr("opacity", 1)
        .attr("dy", rScaleRef.current!(d.linkCount) + hoverOffset);

      setHoveredNode(d);
    })
    .on("mouseleave", function (event, d) {
      void event; // D3 callback signature requires event parameter
      if (!linkDragState.active) {
        ringSelRef.current?.filter((r) => r.id === d.id).attr("opacity", 0);
      }
      
      const isZoomedIn = currentZoomRef.current >= ZOOM_LABEL_THRESHOLD;
      
      // Scale the default offset based on current zoom level
      const zoomScale = currentZoomRef.current;
      const defaultOffset = LABEL_OFFSET_DEFAULT / zoomScale;
      
      // ONLY the hovered node's label moves back up
      labelSelRef.current
        ?.filter((n) => n.id === d.id)
        .transition()
        .duration(400)
        .attr("dy", rScaleRef.current!(d.linkCount) + defaultOffset);
      
      hoverExitTimerRef.current = setTimeout(() => {
        if (isHoveringPreviewRef.current) return;
        
        // Restore all nodes
        nodeSelRef.current?.transition()
          .duration(300)
          .attr("fill-opacity", (n) => focusNodeId === n.id ? 1 : 0.85);
        
        // Restore all links
        linkSelRef.current?.transition()
          .duration(300)
          .attr("stroke", LINK_STROKE)
          .attr("stroke-width", (e) => strokeWidthScale(e.weight ?? 1))
          .attr("stroke-opacity", (e) => strokeOpacityScale(e.weight ?? 1));
        
        // Restore labels based on zoom level
        if (isZoomedIn) {
          labelSelRef.current?.transition()
            .duration(300)
            .attr("opacity", 1)
            .attr("dy", (n) => rScaleRef.current!(n.linkCount) + LABEL_OFFSET_DEFAULT);
        } else {
          labelSelRef.current?.transition()
            .duration(300)
            .attr("opacity", (n) => focusNodeId === n.id ? 1 : 0)
            .attr("dy", (n) => rScaleRef.current!(n.linkCount) + LABEL_OFFSET_DEFAULT);
        }
        
        setHoveredNode(null);
      }, 400);
    })
    .on("click", (event, d) => {
      if (linkDragState.active) return;
      event.stopPropagation();

      // Triple-click → eject to real editor
      if (event.detail === 3) {
        setActiveNote(d.id);
        showToast(`Opening "${d.title}"…`);
        setTimeout(() => handleClose(), 300);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        openTab(d.id);
        setActiveNote(d.id);
        showToast(`Opened "${d.title}" in new tab`);
      } else if (event.shiftKey) {
        setFocusNodeId((prev) => prev === d.id ? null : d.id);
      } else {
        // Single-click → lock detail panel
        onNodeClick(d);
      }
    })
    .on("dblclick", (event, d) => {
      // Double-click → inline rename (edit title in graph)
      event.stopPropagation();
      if (linkDragState.active) return;
      showRenameInput(d, false);
    })
    .on("contextmenu", (event, d) => {
      event.preventDefault();
      onRequestDeleteNode(d.id, d.title);
    });
}

    attachNodeEvents(node);

    label
      .on("click", (event, d) => {
        event.stopPropagation();
        onNodeClick(d);
      })
      .on("dblclick", (event, d) => {
        event.stopPropagation();
        showRenameInput(d);
      });

    // ── Clear selection on empty canvas click ─────────────────────────────
    svg.on("click.clearselect", (event) => {
      const target = event.target as Element;
      if (
        target.closest(".nodes")  ||
        target.closest(".rings")  ||
        target.closest(".labels") ||
        target.closest(".edges")  ||
        target.closest(".rename-overlay")
      ) return;
      if (selectedNodeIdsRef.current.size > 0) {
        setSelectedNodeIds(new Set());
        nodeSelRef.current
          ?.attr("stroke",       (n) => focusNodeId === n.id ? "#fff" : "transparent")
          .attr("stroke-width",  2);
      }
    });

    // ── Reposition drag ───────────────────────────────────────────────────
    const drag = d3.drag<SVGCircleElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        if (!timelineMode) d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        if (!timelineMode) d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        if (!timelineMode) d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    // ── Double-click canvas → create node ────────────────────────────────
    svg.on("dblclick.create", function (event) {
      const target = event.target as Element;
      if (target.closest(".nodes") || target.closest(".rings") ||
          target.closest(".labels") || target.closest(".rename-overlay")) return;

      const transform = d3.zoomTransform(svgRef.current!);
      const [px, py]  = d3.pointer(event, svgRef.current);
      const [gx, gy]  = transform.invert([px, py]);

      onCreateNode(gx, gy, (newNode) => {
        simulation.nodes(simNodesRef.current);

        node = nodeG.selectAll<SVGCircleElement, GraphNode>("circle")
          .data(simNodesRef.current, (d) => d.id)
          .join(
            (enter) => enter.append("circle")
              .attr("r",            (d) => rScale(d.linkCount))
              .attr("fill",         TAG_PALETTE[0])
              .attr("fill-opacity", 0.85)
              .attr("stroke",       "transparent")
              .attr("stroke-width", 2)
              .attr("cx",           newNode.x ?? 0)
              .attr("cy",           newNode.y ?? 0)
              .style("cursor",      "pointer")
              .call((sel) => attachNodeEvents(sel)),
            (update) => update,
            (exit)   => exit.remove(),
          );
        nodeSelRef.current = node;

        ring = ringG.selectAll<SVGCircleElement, GraphNode>("circle")
          .data(simNodesRef.current, (d) => d.id)
          .join(
            (enter) => enter.append("circle")
              .attr("r",            (d) => rScale(d.linkCount) + RING_GAP + RING_WIDTH)
              .attr("fill",         "none")
              .attr("stroke",       RING_STROKE)
              .attr("stroke-width", RING_WIDTH)
              .attr("opacity",      0)
              .attr("cx",           newNode.x ?? 0)
              .attr("cy",           newNode.y ?? 0)
              .style("cursor",      "crosshair"),
            (update) => update,
            (exit)   => exit.remove(),
          );
        ringSelRef.current = ring;
        ring.call(ringDrag);

        label = labelG.selectAll<SVGTextElement, GraphNode>("text")
          .data(simNodesRef.current, (d) => d.id)
          .join(
            (enter) => enter.append("text")
              .text((d) => truncateLabel(d.title))
              .attr("font-size",      11)
              .attr("fill",           LABEL_COLOR)
              .attr("text-anchor",    "middle")
              .attr("dy",             (d) => rScale(d.linkCount) + LABEL_OFFSET_DEFAULT)
              .attr("pointer-events", "all")
              .attr("opacity",        1)
              .attr("x",              newNode.x ?? 0)
              .attr("y",              newNode.y ?? 0)
              .style("cursor",        "text")
              .call((sel) => sel
                .on("click",    (evt, d) => { evt.stopPropagation(); onNodeClick(d); })
                .on("dblclick", (evt, d) => { evt.stopPropagation(); showRenameInput(d, false); })
              ),
            (update) => update,
            (exit)   => exit.remove(),
          );
        labelSelRef.current = label;

        setStats({ nodes: simNodesRef.current.length, edges: simEdgesRef.current.length });
        showRenameInput(newNode, true);
      }).catch(console.error);
    });

    // ── Simulation ────────────────────────────────────────────────────────
    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .alphaDecay(ALPHA_DECAY)
      .force("link",    d3.forceLink<GraphNode, GraphEdge>(simEdges)
        .id((d) => d.id).distance(60).strength(timelineMode ? 0.1 : 0.4))
      .force("charge",  d3.forceManyBody().strength(timelineMode ? -120 : -180))
      .force("center",  timelineMode ? null : d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide<GraphNode>().radius((d) => rScale(d.linkCount) + 6))
      .force("y",       timelineMode ? d3.forceY(0).strength(0.05) : null)
      .on("tick", () => {
        linkSelRef.current
          ?.attr("x1", (e) => (e.source as GraphNode).x ?? 0)
          .attr("y1",  (e) => (e.source as GraphNode).y ?? 0)
          .attr("x2",  (e) => (e.target as GraphNode).x ?? 0)
          .attr("y2",  (e) => (e.target as GraphNode).y ?? 0);

          linkHit
    .attr("x1", (e) => (e.source as GraphNode).x ?? 0)
    .attr("y1", (e) => (e.source as GraphNode).y ?? 0)
    .attr("x2", (e) => (e.target as GraphNode).x ?? 0)
    .attr("y2", (e) => (e.target as GraphNode).y ?? 0);
    
        nodeSelRef.current?.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        ringSelRef.current?.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        labelSelRef.current?.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
        updateMinimapNodes();
      })
      .on("end", () => {
        simSettledRef.current = true;
        suggestionTimer = setTimeout(() => {
          drawSuggestionEdges().catch(console.error);
        }, 0);
      });

    simRef.current = simulation;

    return () => {
      simulation.stop();
      if (suggestionTimer !== null) clearTimeout(suggestionTimer);
    };
  }, [visibleNodes, visibleEdges, isLoading, showTagColors, tagColorMap,
      focusNodeId, timelineMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return { deleteNodeById, deleteLinkInD3 };
}