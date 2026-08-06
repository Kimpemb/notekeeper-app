// src/features/graph/useThoughtGraphSimulation.ts
//
// Adapted from useGraphSimulation.ts (design doc §4.2, implementation doc Step 10).
// Same force-sim/zoom/minimap/drag/hover-dim scaffolding as the Note Graph,
// with the following deltas:
//
//   - ThoughtNode/ThoughtEdge instead of GraphNode/GraphEdge.
//   - Node fill = THOUGHT_TYPE_COLOR[type]; fill-opacity driven by
//     THOUGHT_STATE_OPACITY[state] instead of tag-color/isolated logic.
//   - v1 SIMPLIFICATION (flagged, not in the design doc): all nodes render
//     as circles. The design doc calls for diamond/square/hexagon shapes
//     per type but never specifies the path geometry or the type→shape
//     mapping — building that blind risks a class of rendering bugs that
//     can't be visually verified here. THOUGHT_TYPE_COLOR already gives
//     strong visual distinction across all 7 types. Revisit if the design
//     doc's shape system gets specced out.
//   - No linkCount field on ThoughtNode — node "size" is computed locally
//     from edge degree within this hook (see degreeMap below), same rScale
//     domain/range as the Note Graph.
//   - Removed entirely: ringDrag (link creation is AI-only for thought
//     edges — design doc §4.2), showRenameInput + dblclick rename wiring,
//     double-click-canvas → create node, suggestion edges (no similarity
//     model for thought nodes), timelineMode (never listed as retained,
//     and Thought Graph mode has no timeline toggle), note-opening
//     interactions (triple-click-to-editor, ctrl/cmd-click-new-tab) since
//     thought nodes aren't notes.
//   - Retained as-is: zoom/pan, minimap sync, rubber-band multi-select,
//     hover-dim neighbour highlighting, drag-to-reposition, the
//     deleteNodeById/deleteLinkInD3 imperative handles (repurposed for the
//     confirmation gate's undo path rather than direct D3 edit).
//   - Edge click (onEdgeClick) passes { sourceId, targetId, relation,
//     screenX, screenY } instead of resolving backlink snippet text —
//     thought edges have no note content to extract from; the edge panel
//     shows relation + both endpoints' summaries directly from the nodes.

import { useEffect, useCallback, MutableRefObject, useRef } from "react";
import * as d3 from "d3";
import type { ThoughtNode, ThoughtEdge, ThoughtEdgeRelation } from "./graphTypes";
import { THOUGHT_TYPE_COLOR, THOUGHT_STATE_OPACITY } from "./graphTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_BASE_RADIUS = 5;
const NODE_MAX_RADIUS  = 18;
const LINK_STROKE      = "rgba(150,150,150,0.25)";
const LINK_STROKE_HL   = "rgba(150,150,150,0.7)";
const LINK_STROKE_SEL  = "rgba(99,102,241,0.8)";
const LABEL_COLOR      = "var(--color-text, #e2e2e2)";
const MINIMAP_W        = 160;
const MINIMAP_H        = 100;

const RING_STROKE = "rgba(255,255,255,0.5)";
const RING_WIDTH  = 3;
const RING_GAP    = 3;

const SELECT_STROKE      = "#6366f1";
const SELECT_STROKE_W    = 2.5;
const SELECT_RECT_FILL   = "rgba(99,102,241,0.07)";
const SELECT_RECT_STROKE = "rgba(99,102,241,0.5)";

// Active-episode highlight (design doc §0.1) — nodes belonging to the
// currently-open conversation episode get a distinct stroke so it's clear
// where new AI-proposed nodes will land, vs. nodes from past episodes in
// the same merged multi-episode canvas.
const ACTIVE_EPISODE_STROKE = "rgba(139,92,246,0.6)";

const ALPHA_DECAY = 0.04;

const ZOOM_LABEL_THRESHOLD = 0.6;
const DEFAULT_ZOOM         = 0.6;
const LABEL_MAX_CHARS      = 28;

const LABEL_OFFSET_DEFAULT = 14;
const LABEL_OFFSET_HOVER   = 30;

// Dim factor applied to a node/label's base opacity when a different node
// is hovered — multiplies THOUGHT_STATE_OPACITY[state] rather than using a
// fixed value, so a "parked" node dims from an already-low baseline instead
// of jumping to the same dim level as an "open" node.
const HOVER_DIM_FACTOR = 0.35;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateLabel(summary: string): string {
  return summary.length > LABEL_MAX_CHARS ? summary.slice(0, LABEL_MAX_CHARS - 1) + "…" : summary;
}

function getThoughtNodeColor(node: ThoughtNode): string {
  return THOUGHT_TYPE_COLOR[node.type];
}

function getThoughtNodeOpacity(node: ThoughtNode): number {
  return THOUGHT_STATE_OPACITY[node.state];
}

function defaultNodeStroke(
  n: ThoughtNode,
  focusNodeId: string | null,
  activeGraphId: string | null,
): string {
  if (focusNodeId === n.id) return "#fff";
  if (activeGraphId && n.graphId === activeGraphId) return ACTIVE_EPISODE_STROKE;
  return "transparent";
}

function edgeMidpointScreen(
  e:         ThoughtEdge,
  transform: d3.ZoomTransform,
): { x: number; y: number } {
  const sx = typeof e.source === "object" ? (e.source as ThoughtNode).x ?? 0 : 0;
  const sy = typeof e.source === "object" ? (e.source as ThoughtNode).y ?? 0 : 0;
  const tx = typeof e.target === "object" ? (e.target as ThoughtNode).x ?? 0 : 0;
  const ty = typeof e.target === "object" ? (e.target as ThoughtNode).y ?? 0 : 0;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  return { x: transform.applyX(mx), y: transform.applyY(my) };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThoughtEdgeClickData {
  sourceId: string;
  targetId: string;
  relation: ThoughtEdgeRelation;
  screenX:  number;
  screenY:  number;
}

export interface UseThoughtGraphSimulationProps {
  svgRef:               MutableRefObject<SVGSVGElement | null>;
  minimapRef:           MutableRefObject<SVGSVGElement | null>;
  containerRef:         MutableRefObject<HTMLDivElement | null>;
  zoomRef:              MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  simNodesRef:          MutableRefObject<ThoughtNode[]>;
  simEdgesRef:          MutableRefObject<ThoughtEdge[]>;
  simSettledRef:        MutableRefObject<boolean>;
  hoverExitTimerRef:    MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isHoveringPreviewRef: MutableRefObject<boolean>;

  visibleNodes:         ThoughtNode[];
  visibleEdges:         ThoughtEdge[];
  isLoading:            boolean;
  focusNodeId:          string | null;
  activeGraphId:        string | null;
  selectedNodeIds:      Set<string>;

  setStats:             (s: { nodes: number; edges: number }) => void;
  setHoveredNode:       (n: ThoughtNode | null) => void;
  setFocusNodeId:       (fn: (prev: string | null) => string | null) => void;
  setSelectedNodeIds:   (ids: Set<string>) => void;

  onNodeClick:          (node: ThoughtNode) => void;
  onEdgeClick:          (data: ThoughtEdgeClickData) => void;

  // Pixel width of any floating panel covering the right side of the canvas
  // (the embedded ChatPanel in Thought Graph mode). Shifts the initial pan
  // so nodes render in the actually-visible area instead of centering on
  // the full container width and landing partly under the panel.
  canvasRightInset?: number;
  // Pixel width reserved on the left for the node preview panel (Thought
  // Graph's GraphNotePanel, side="left"). Combined with canvasRightInset,
  // this centers the graph in the strip between both floating panels
  // instead of the full container width.
  canvasLeftInset?: number;
}

export interface UseThoughtGraphSimulationResult {
  deleteNodeById: (nodeId: string) => void;
  deleteLinkInD3: (sourceId: string, targetId: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useThoughtGraphSimulation({
  svgRef, minimapRef, containerRef, zoomRef,
  simNodesRef, simEdgesRef, simSettledRef,
  hoverExitTimerRef, isHoveringPreviewRef,
  visibleNodes, visibleEdges, isLoading,
  focusNodeId, activeGraphId, selectedNodeIds,
  setStats, setHoveredNode,
  setFocusNodeId, setSelectedNodeIds,
  onNodeClick, onEdgeClick,
  canvasRightInset = 0,
  canvasLeftInset = 0,
}: UseThoughtGraphSimulationProps): UseThoughtGraphSimulationResult {

  const nodeSelRef  = useRef<d3.Selection<SVGCircleElement, ThoughtNode, SVGGElement, unknown> | null>(null);
  const ringSelRef  = useRef<d3.Selection<SVGCircleElement, ThoughtNode, SVGGElement, unknown> | null>(null);
  const labelSelRef = useRef<d3.Selection<SVGTextElement,   ThoughtNode, SVGGElement, unknown> | null>(null);
  const linkSelRef  = useRef<d3.Selection<SVGLineElement,   ThoughtEdge, SVGGElement, unknown> | null>(null);
  const simRef      = useRef<d3.Simulation<ThoughtNode, ThoughtEdge> | null>(null);
  const rScaleRef   = useRef<d3.ScalePower<number, number> | null>(null);
  const currentZoomRef = useRef<number>(DEFAULT_ZOOM);

  const nodeGRef  = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const ringGRef  = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const labelGRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkGRef  = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);

  const selectedNodeIdsRef = useRef<Set<string>>(selectedNodeIds);
  useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds; }, [selectedNodeIds]);

  // ── Imperative delete-node handle ─────────────────────────────────────────
  // Mirrors useGraphSimulation.ts exactly: assumes the caller (confirmation
  // gate's undo path) has already spliced simNodesRef/simEdgesRef, and this
  // just re-binds D3 selections to the current ref contents.
  const deleteNodeById = useCallback((_nodeId: string) => {
    const nodeG  = nodeGRef.current;
    const ringG  = ringGRef.current;
    const labelG = labelGRef.current;
    const linkG  = linkGRef.current;
    if (!nodeG || !ringG || !labelG || !linkG) return;

    nodeSelRef.current = nodeG
      .selectAll<SVGCircleElement, ThoughtNode>("circle")
      .data(simNodesRef.current, (n) => n.id)
      .join(
        (enter) => enter as unknown as d3.Selection<SVGCircleElement, ThoughtNode, SVGGElement, unknown>,
        (update) => update,
        (exit)   => exit.remove(),
      ) as d3.Selection<SVGCircleElement, ThoughtNode, SVGGElement, unknown>;

    ringSelRef.current = ringG
      .selectAll<SVGCircleElement, ThoughtNode>("circle")
      .data(simNodesRef.current, (n) => n.id)
      .join(
        (enter) => enter as unknown as d3.Selection<SVGCircleElement, ThoughtNode, SVGGElement, unknown>,
        (update) => update,
        (exit)   => exit.remove(),
      ) as d3.Selection<SVGCircleElement, ThoughtNode, SVGGElement, unknown>;

    labelSelRef.current = labelG
      .selectAll<SVGTextElement, ThoughtNode>("text")
      .data(simNodesRef.current, (n) => n.id)
      .join(
        (enter) => enter as unknown as d3.Selection<SVGTextElement, ThoughtNode, SVGGElement, unknown>,
        (update) => update,
        (exit)   => exit.remove(),
      ) as d3.Selection<SVGTextElement, ThoughtNode, SVGGElement, unknown>;

    linkSelRef.current = linkG
      .selectAll<SVGLineElement, ThoughtEdge>("line.visible")
      .data(simEdgesRef.current)
      .join(
        (enter) => enter as unknown as d3.Selection<SVGLineElement, ThoughtEdge, SVGGElement, unknown>,
        (update) => update,
        (exit)   => exit.remove(),
      ) as d3.Selection<SVGLineElement, ThoughtEdge, SVGGElement, unknown>;

    simRef.current?.nodes(simNodesRef.current);
    setStats({ nodes: simNodesRef.current.length, edges: simEdgesRef.current.length });
  }, [simNodesRef, simEdgesRef, setStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Imperative delete-link handle ─────────────────────────────────────────
  const deleteLinkInD3 = useCallback((sourceId: string, targetId: string) => {
    const linkG = linkGRef.current;
    if (!linkG) return;

    const simulation = simRef.current;
    if (simulation) {
      const forceLink = simulation.force("link") as d3.ForceLink<ThoughtNode, ThoughtEdge>;
      forceLink.links(simEdgesRef.current);
    }

    linkSelRef.current = linkG
      .selectAll<SVGLineElement, ThoughtEdge>("line.visible")
      .data(simEdgesRef.current, (e) => {
        const s = e.sourceId ?? (typeof e.source === "object" ? (e.source as ThoughtNode).id : e.source as string);
        const t = e.targetId ?? (typeof e.target === "object" ? (e.target as ThoughtNode).id : e.target as string);
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

    nodeSelRef.current?.attr("r",  (n) => rScaleRef.current!(degreeOf(n.id)));
    ringSelRef.current?.attr("r",  (n) => rScaleRef.current!(degreeOf(n.id)) + RING_GAP + RING_WIDTH);
    labelSelRef.current?.attr("dy",(n) => rScaleRef.current!(degreeOf(n.id)) + LABEL_OFFSET_DEFAULT);

    simulation?.alpha(0.1).restart();
    setStats({ nodes: simNodesRef.current.length, edges: simEdgesRef.current.length });

    void sourceId; void targetId;

    // Local degree lookup — recomputed from the current ref contents since
    // ThoughtNode carries no precomputed linkCount field (unlike GraphNode).
    function degreeOf(nodeId: string): number {
      let count = 0;
      for (const e of simEdgesRef.current) {
        if (e.sourceId === nodeId || e.targetId === nodeId) count++;
      }
      return count;
    }
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

    const simNodes: ThoughtNode[] = visibleNodes.map((n) => ({ ...n }));
    const simEdges: ThoughtEdge[] = visibleEdges.map((e) => {
      const sid = typeof e.source === "object" ? (e.source as ThoughtNode).id : e.source as string;
      const tid = typeof e.target === "object" ? (e.target as ThoughtNode).id : e.target as string;
      return { ...e, sourceId: sid, targetId: tid };
    });
    simNodesRef.current = simNodes;
    simEdgesRef.current = simEdges;

    setStats({ nodes: simNodes.length, edges: simEdges.length });

    // Degree map — substitute for GraphNode.linkCount, computed locally
    // since ThoughtNode has no equivalent precomputed field.
    const degreeMap = new Map<string, number>();
    simEdges.forEach((e) => {
      degreeMap.set(e.sourceId, (degreeMap.get(e.sourceId) ?? 0) + 1);
      degreeMap.set(e.targetId, (degreeMap.get(e.targetId) ?? 0) + 1);
    });
    const degree = (n: ThoughtNode) => degreeMap.get(n.id) ?? 0;

    const strokeWidthScale   = d3.scaleLinear().domain([0, Math.max(1, ...simEdges.map(() => 1))]).range([1, 2]).clamp(true);
    const strokeOpacityScale = d3.scaleLinear().domain([0, 1]).range([0.25, 0.5]).clamp(true);

    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");

    // ── rScale ────────────────────────────────────────────────────────────
    const maxDegree = Math.max(1, d3.max(simNodes, (n) => degree(n)) ?? 1);
    const rScale    = d3.scaleSqrt().domain([0, maxDegree]).range([NODE_BASE_RADIUS, NODE_MAX_RADIUS]);
    rScaleRef.current = rScale;

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

    function getMinimapScale(ns: ThoughtNode[]) {
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
      mmG.selectAll<SVGCircleElement, ThoughtNode>("circle")
        .data(ns, (d) => d.id).join("circle")
        .attr("cx", (d) => ((d.x ?? 0) - minX) * scale + pad)
        .attr("cy", (d) => ((d.y ?? 0) - minY) * scale + pad)
        .attr("r", 2)
        .attr("fill", (d) => getThoughtNodeColor(d))
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
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2 + (canvasLeftInset - canvasRightInset) / 2, height / 2).scale(DEFAULT_ZOOM));

    // ── Multi-select rubber-band ──────────────────────────────────────────
    const selectRect = svg.append("rect")
      .attr("class",           "select-rect")
      .attr("fill",            SELECT_RECT_FILL)
      .attr("stroke",          SELECT_RECT_STROKE)
      .attr("stroke-width",    1)
      .attr("stroke-dasharray","4,2")
      .attr("pointer-events",  "none")
      .attr("rx",              3)
      .attr("opacity",         0);

    let selectDrag = { active: false, startX: 0, startY: 0 };

    svg.on("mousedown.select", function (event) {
      if (event.button !== 0) return;
      const target = event.target as Element;
      if (
        target.closest(".nodes")  ||
        target.closest(".rings")  ||
        target.closest(".labels") ||
        target.closest(".edges")
      ) return;

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

      if (rw < 8 && rh < 8) return;

      const transform = d3.zoomTransform(svgRef.current!);
      const x0 = Math.min(px, selectDrag.startX);
      const y0 = Math.min(py, selectDrag.startY);
      const x1 = Math.max(px, selectDrag.startX);
      const y1 = Math.max(py, selectDrag.startY);

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

      nodeSelRef.current
        ?.attr("stroke",      (n) => selected.has(n.id) ? SELECT_STROKE : defaultNodeStroke(n, focusNodeId, activeGraphId))
        .attr("stroke-width", (n) => selected.has(n.id) ? SELECT_STROKE_W : 2);
    });

    // ── Edges ─────────────────────────────────────────────────────────────
    const linkG = g.append("g").attr("class", "edges");
    linkGRef.current = linkG as any;

    const link = linkG.selectAll<SVGLineElement, ThoughtEdge>("line.visible")
      .data(simEdges).join(
        (enter) => enter.append("line").attr("class", "visible"),
        (update) => update,
        (exit)   => exit.remove(),
      )
      .attr("stroke",         LINK_STROKE)
      .attr("stroke-width",   () => strokeWidthScale(1))
      .attr("stroke-opacity", () => strokeOpacityScale(1))
      .attr("pointer-events", "none");

    const linkHit = linkG.selectAll<SVGLineElement, ThoughtEdge>("line.hit")
      .data(simEdges).join(
        (enter) => enter.append("line").attr("class", "hit"),
        (update) => update,
        (exit)   => exit.remove(),
      )
      .attr("stroke",       "transparent")
      .attr("stroke-width", 12)
      .attr("fill",         "none")
      .style("cursor",      "pointer");

    linkHit.on("click", function (event, e) {
      event.stopPropagation();

      const transform = d3.zoomTransform(svgRef.current!);
      const mid       = edgeMidpointScreen(e, transform);
      const rect      = containerRef.current!.getBoundingClientRect();

      link.attr("stroke", (d) => d === e ? LINK_STROKE_SEL : LINK_STROKE);

      onEdgeClick({
        sourceId: e.sourceId,
        targetId: e.targetId,
        relation: e.relation,
        screenX:  mid.x + rect.left,
        screenY:  mid.y + rect.top,
      });
    });

    linkSelRef.current = link as any;

    svg.on("click.edgereset", () => {
      link.attr("stroke", LINK_STROKE);
    });

    // ── Nodes ─────────────────────────────────────────────────────────────
    const nodeG = g.append("g").attr("class", "nodes");
    nodeGRef.current = nodeG as any;

    const node = nodeG.selectAll<SVGCircleElement, ThoughtNode>("circle")
      .data(simNodes, (d) => d.id).join("circle")
      .attr("r",            (d) => rScale(degree(d)))
      .attr("fill",         (d) => getThoughtNodeColor(d))
      .attr("fill-opacity", (d) => getThoughtNodeOpacity(d))
      .attr("stroke",       (d) => {
        if (selectedNodeIdsRef.current.has(d.id)) return SELECT_STROKE;
        return defaultNodeStroke(d, focusNodeId, activeGraphId);
      })
      .attr("stroke-width", (d) => selectedNodeIdsRef.current.has(d.id) ? SELECT_STROKE_W : 2)
      .style("cursor", "pointer");
    nodeSelRef.current = node;

    // ── Rings (hover highlight only — no drag, link creation is AI-only) ──
    const ringG = g.append("g").attr("class", "rings");
    ringGRef.current = ringG as any;

    const ring = ringG.selectAll<SVGCircleElement, ThoughtNode>("circle")
      .data(simNodes, (d) => d.id).join("circle")
      .attr("r",            (d) => rScale(degree(d)) + RING_GAP + RING_WIDTH)
      .attr("fill",         "none")
      .attr("stroke",       RING_STROKE)
      .attr("stroke-width", RING_WIDTH)
      .attr("opacity",      0)
      .attr("pointer-events", "none");
    ringSelRef.current = ring;

    // ── Labels ────────────────────────────────────────────────────────────
    const labelG = g.append("g").attr("class", "labels");
    labelGRef.current = labelG as any;

    const label = labelG.selectAll<SVGTextElement, ThoughtNode>("text")
      .data(simNodes, (d) => d.id).join("text")
      .text((d) => truncateLabel(d.summary))
      .attr("font-size",      11)
      .attr("fill",           LABEL_COLOR)
      .attr("text-anchor",    "middle")
      .attr("dy",             (d) => rScale(degree(d)) + LABEL_OFFSET_DEFAULT)
      .attr("pointer-events", "all")
      .attr("opacity",        (d) => focusNodeId === d.id ? 1 : 0)
      .style("cursor", "pointer");
    labelSelRef.current = label;

    label.on("click", (event, d) => {
      event.stopPropagation();
      onNodeClick(d);
    });

    // ── Node events ───────────────────────────────────────────────────────
    function attachNodeEvents(
      sel: d3.Selection<SVGCircleElement, ThoughtNode, SVGGElement, unknown>,
    ) {
      sel
        .on("mouseenter", function (event, d) {
          void event;
          if (hoverExitTimerRef.current) clearTimeout(hoverExitTimerRef.current);
          ringSelRef.current?.filter((r) => r.id === d.id)
            .attr("opacity", 1).attr("stroke", RING_STROKE);

          const neighbourIds = new Set<string>();
          simEdgesRef.current.forEach((e) => {
            if (e.sourceId === d.id) neighbourIds.add(e.targetId);
            if (e.targetId === d.id) neighbourIds.add(e.sourceId);
          });

          const isZoomedIn = currentZoomRef.current >= ZOOM_LABEL_THRESHOLD;

          nodeSelRef.current?.transition()
            .duration(300)
            .attr("fill-opacity", (n) => {
              if (n.id === d.id || neighbourIds.has(n.id)) return getThoughtNodeOpacity(n);
              return getThoughtNodeOpacity(n) * HOVER_DIM_FACTOR;
            });

          linkSelRef.current?.transition()
            .duration(300)
            .attr("stroke", (e) => e.sourceId === d.id || e.targetId === d.id ? LINK_STROKE_HL : LINK_STROKE);

          if (isZoomedIn) {
            labelSelRef.current?.transition()
              .duration(300)
              .attr("opacity", (n) => (n.id === d.id || neighbourIds.has(n.id)) ? 1 : 0.3);
          } else {
            labelSelRef.current?.transition()
              .duration(300)
              .attr("opacity", (n) => (n.id === d.id || neighbourIds.has(n.id)) ? 1 : 0);
          }

          const zoomScale   = currentZoomRef.current;
          const hoverOffset = LABEL_OFFSET_HOVER / zoomScale;

          labelSelRef.current
            ?.filter(function (n) { return n.id === d.id; })
            .transition()
            .duration(400)
            .attr("opacity", 1)
            .attr("dy", rScaleRef.current!(degree(d)) + hoverOffset);

          setHoveredNode(d);
        })
        .on("mouseleave", function (event, d) {
          void event;
          ringSelRef.current?.filter((r) => r.id === d.id).attr("opacity", 0);

          const isZoomedIn = currentZoomRef.current >= ZOOM_LABEL_THRESHOLD;
          const zoomScale     = currentZoomRef.current;
          const defaultOffset = LABEL_OFFSET_DEFAULT / zoomScale;

          labelSelRef.current
            ?.filter((n) => n.id === d.id)
            .transition()
            .duration(400)
            .attr("dy", rScaleRef.current!(degree(d)) + defaultOffset);

          hoverExitTimerRef.current = setTimeout(() => {
            if (isHoveringPreviewRef.current) return;

            nodeSelRef.current?.transition()
              .duration(300)
              .attr("fill-opacity", (n) => getThoughtNodeOpacity(n));

            linkSelRef.current?.transition()
              .duration(300)
              .attr("stroke", LINK_STROKE);

            if (isZoomedIn) {
              labelSelRef.current?.transition()
                .duration(300)
                .attr("opacity", 1)
                .attr("dy", (n) => rScaleRef.current!(degree(n)) + LABEL_OFFSET_DEFAULT);
            } else {
              labelSelRef.current?.transition()
                .duration(300)
                .attr("opacity", (n) => focusNodeId === n.id ? 1 : 0)
                .attr("dy", (n) => rScaleRef.current!(degree(n)) + LABEL_OFFSET_DEFAULT);
            }

            setHoveredNode(null);
          }, 400);
        })
        .on("click", (event, d) => {
          event.stopPropagation();
          if (event.shiftKey) {
            setFocusNodeId((prev) => prev === d.id ? null : d.id);
          } else {
            onNodeClick(d);
          }
        });
    }

    attachNodeEvents(node);

    // ── Clear selection on empty canvas click ─────────────────────────────
    svg.on("click.clearselect", (event) => {
      const target = event.target as Element;
      if (
        target.closest(".nodes")  ||
        target.closest(".rings")  ||
        target.closest(".labels") ||
        target.closest(".edges")
      ) return;
      if (selectedNodeIdsRef.current.size > 0) {
        setSelectedNodeIds(new Set());
        nodeSelRef.current
          ?.attr("stroke",      (n) => defaultNodeStroke(n, focusNodeId, activeGraphId))
          .attr("stroke-width", 2);
      }
    });

    // ── Reposition drag ───────────────────────────────────────────────────
    const drag = d3.drag<SVGCircleElement, ThoughtNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    // ── Simulation ────────────────────────────────────────────────────────
    const simulation = d3.forceSimulation<ThoughtNode>(simNodes)
      .alphaDecay(ALPHA_DECAY)
      .force("link",    d3.forceLink<ThoughtNode, ThoughtEdge>(simEdges)
        .id((d) => d.id).distance(60).strength(0.4))
      .force("charge",  d3.forceManyBody().strength(-180))
      .force("center",  d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide<ThoughtNode>().radius((d) => rScale(degree(d)) + 6))
      .on("tick", () => {
        linkSelRef.current
          ?.attr("x1", (e) => (e.source as ThoughtNode).x ?? 0)
          .attr("y1",  (e) => (e.source as ThoughtNode).y ?? 0)
          .attr("x2",  (e) => (e.target as ThoughtNode).x ?? 0)
          .attr("y2",  (e) => (e.target as ThoughtNode).y ?? 0);

        linkHit
          .attr("x1", (e) => (e.source as ThoughtNode).x ?? 0)
          .attr("y1", (e) => (e.source as ThoughtNode).y ?? 0)
          .attr("x2", (e) => (e.target as ThoughtNode).x ?? 0)
          .attr("y2", (e) => (e.target as ThoughtNode).y ?? 0);

        nodeSelRef.current?.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        ringSelRef.current?.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        labelSelRef.current?.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
        updateMinimapNodes();
      })
      .on("end", () => {
        simSettledRef.current = true;
      });

    simRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [visibleNodes, visibleEdges, isLoading, focusNodeId, activeGraphId, canvasRightInset, canvasLeftInset]); // eslint-disable-line react-hooks/exhaustive-deps

  return { deleteNodeById, deleteLinkInD3 };
}