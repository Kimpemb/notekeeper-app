// src/features/graph/useGraphSimulation.ts
// Owns the entire D3 build/rebuild cycle: nodes, links, labels,
// drag, zoom, minimap, simulation.
//
// Tier 1 graph editing:
//   - Double-click canvas      → create note at cursor, camera flies to it,
//                                node pulses + inline rename opens immediately
//   - Double-click node label  → inline rename
//   - Drag from outer ring     → draw link, release on node to connect
//   - Right-click node         → delete (with 2.5s undo window)

import { useEffect, MutableRefObject } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "./graphTypes";
import { getSuggestionFeedback } from "@/features/notes/db/queries";
import { buildFeedbackMap, getSimilarityResults } from "@/features/notes/similarity/similarityUtils";
import type { Note } from "@/types";

const NODE_BASE_RADIUS = 5;
const NODE_MAX_RADIUS  = 18;
const LINK_STROKE      = "rgba(150,150,150,0.25)";
const LINK_STROKE_HL   = "rgba(150,150,150,0.7)";
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

const RING_STROKE       = "rgba(255,255,255,0.5)";
const RING_STROKE_HOVER = "rgba(99,102,241,0.9)";
const RING_WIDTH        = 3;
const RING_GAP          = 3;

const CREATE_FLY_DURATION = 450;
const CREATE_FLY_SCALE    = 1.4;
const CREATE_PULSE_COUNT  = 3;

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

interface SuggestionEdge {
  sourceId: string;
  targetId: string;
}

export interface UseGraphSimulationProps {
  svgRef: MutableRefObject<SVGSVGElement | null>;
  minimapRef: MutableRefObject<SVGSVGElement | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  simNodesRef: MutableRefObject<GraphNode[]>;
  simEdgesRef: MutableRefObject<GraphEdge[]>;
  simSettledRef: MutableRefObject<boolean>;
  hoverExitTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isHoveringPreviewRef: MutableRefObject<boolean>;
  visibleNodes: GraphNode[];
  visibleEdges: GraphEdge[];
  allNotes: Note[];
  isLoading: boolean;
  showTagColors: boolean;
  tagColorMap: Map<string, string>;
  focusNodeId: string | null;
  timelineMode: boolean;
  setActiveNote: (id: string) => void;
  openTab: (id: string) => void;
  setStats: (s: { nodes: number; edges: number }) => void;
  setTooltip: (t: any) => void;
  setHoveredNode: (n: GraphNode | null) => void;
  setFocusNodeId: (fn: (prev: string | null) => string | null) => void;
  showToast: (msg: string) => void;
  handleClose: () => void;
  onCreateNode: (x: number, y: number) => Promise<GraphNode | null>;
  onRenameNode: (nodeId: string, newTitle: string) => Promise<void>;
  onCreateLink: (sourceId: string, targetId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
}

export function useGraphSimulation({
  svgRef, minimapRef, containerRef, zoomRef,
  simNodesRef, simEdgesRef, simSettledRef,
  hoverExitTimerRef, isHoveringPreviewRef,
  visibleNodes, visibleEdges, allNotes, isLoading,
  showTagColors, tagColorMap, focusNodeId, timelineMode,
  setActiveNote, openTab, setStats, setTooltip, setHoveredNode,
  setFocusNodeId, showToast, handleClose,
  onCreateNode, onRenameNode, onCreateLink, onDeleteNode,
}: UseGraphSimulationProps) {

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    // Always sync refs before any early return
    const simNodes: GraphNode[] = visibleNodes.map((n) => ({ ...n }));
    const simEdges: GraphEdge[] = visibleEdges.map((e) => ({ ...e }));
    simNodesRef.current = simNodes;
    simEdgesRef.current = simEdges;

    if (visibleNodes.length === 0 && !isLoading) {
      const svgEl = d3.select(svgRef.current);
      svgEl.selectAll(".rename-overlay").remove();
      svgEl.selectAll("*").remove();
      return;
    }
    if (visibleNodes.length === 0) return;

    const hasMinimapRef = !!minimapRef.current;

    simSettledRef.current = false;
    setStats({ nodes: simNodes.length, edges: simEdges.length });

    const maxWeight          = Math.max(1, ...simEdges.map((e) => e.weight ?? 1));
    const strokeWidthScale   = d3.scaleLinear().domain([1, maxWeight]).range([1, 3]).clamp(true);
    const strokeOpacityScale = d3.scaleLinear().domain([1, maxWeight]).range([0.25, 0.5]).clamp(true);

    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll(".rename-overlay").remove();
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");

    // ── Timeline x-scale ─────────────────────────────────────────────────
    const timestamps = simNodes.map((n) => n.created_at);
    const minTs      = Math.min(...timestamps);
    const maxTs      = Math.max(...timestamps);
    const minMonth   = floorToMonth(minTs);
    const maxMonth   = floorToMonth(maxTs === minTs ? maxTs + 1 : maxTs);

    const timelineX = d3.scaleTime()
      .domain([new Date(minMonth), new Date(maxMonth)])
      .range([TIMELINE_PAD_X, width - TIMELINE_PAD_X]);

    const monthTicks: Date[] = [];
    let cursor = new Date(minMonth);
    const endDate = new Date(maxMonth);
    while (cursor <= endDate) {
      monthTicks.push(new Date(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    // ── Timeline axis ────────────────────────────────────────────────────
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

    // ── Minimap ──────────────────────────────────────────────────────────
    let mmG: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;

    if (hasMinimapRef) {
      const minimap = d3.select(minimapRef.current!);
      minimap.selectAll("*").remove();
      minimap.append("rect").attr("width", MINIMAP_W).attr("height", MINIMAP_H)
        .attr("fill", "rgba(0,0,0,0.5)").attr("rx", 6);
      mmG = minimap.append("g").attr("class", "mm-nodes");
      minimap.append("rect").attr("class", "mm-viewport")
        .attr("fill", "rgba(255,255,255,0.06)")
        .attr("stroke", "rgba(255,255,255,0.2)").attr("stroke-width", 1).attr("rx", 2);
    }

    function getMinimapScale(ns: GraphNode[]) {
      const xs = ns.map((n) => n.x ?? 0), ys = ns.map((n) => n.y ?? 0);
      if (xs.length === 0) return { scale: 1, minX: 0, minY: 0 };
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const pad  = 10;
      const scale = Math.min(
        (MINIMAP_W - pad * 2) / (maxX - minX || 1),
        (MINIMAP_H - pad * 2) / (maxY - minY || 1)
      );
      return { scale, minX, minY };
    }

    function updateMinimapNodes() {
      if (!mmG) return;
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
      if (!hasMinimapRef) return;
      const minimap = d3.select(minimapRef.current!);
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

    if (hasMinimapRef) {
      const minimap = d3.select(minimapRef.current!);
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
            .scale(current.k)
        );
      });
    }

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        updateMinimapViewport(event.transform, width, height);
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    svg.on("dblclick.zoom", null);
    svgRef.current?.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
    svg.on("touchstart", (e) => e.preventDefault(), { passive: false });
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85));

    const maxLinks = Math.max(1, d3.max(simNodes, (n) => n.linkCount) ?? 1);
    const rScale   = d3.scaleSqrt().domain([0, maxLinks]).range([NODE_BASE_RADIUS, NODE_MAX_RADIUS]);

    if (timelineMode) {
      simNodes.forEach((n) => {
        n.fx = timelineX(new Date(floorToMonth(n.created_at)));
        if (n.y === undefined) n.y = height / 2 + (Math.random() - 0.5) * 200;
      });
    }

    // ── Link-drawing state machine ────────────────────────────────────────
    let linkDragState: {
      active: boolean;
      sourceId: string;
      sourceX: number;
      sourceY: number;
    } = { active: false, sourceId: "", sourceX: 0, sourceY: 0 };

    const linkDragLine = svg.append("line")
      .attr("class", "link-drag-line")
      .attr("stroke", RING_STROKE_HOVER)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "5,3")
      .attr("pointer-events", "none")
      .attr("opacity", 0);

    // ── Real edges ────────────────────────────────────────────────────────
    const link = g.append("g").attr("class", "edges")
      .selectAll("line").data(simEdges).join("line")
      .attr("stroke", LINK_STROKE)
      .attr("stroke-width",   (e) => strokeWidthScale(e.weight ?? 1))
      .attr("stroke-opacity", (e) => strokeOpacityScale(e.weight ?? 1));

    // ── Suggestion edges ──────────────────────────────────────────────────
    const suggestionG = g.append("g").attr("class", "suggestion-edges");

    const existingEdgeKeys = new Set<string>(
      simEdges.map((e) => {
        const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
        const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
        return [sid, tid].sort().join("|");
      })
    );

    async function drawSuggestionEdges() {
      if (allNotes.length === 0) return;
      const feedback    = await getSuggestionFeedback();
      const feedbackMap = buildFeedbackMap(feedback);
      const pairs: SuggestionEdge[] = [];
      const seenPairs = new Set<string>();

      for (const sourceNode of simNodes) {
        const sourceNote = allNotes.find((n) => n.id === sourceNode.id);
        if (!sourceNote) continue;
        const backlinkIds = new Set<string>();
        simEdges.forEach((e) => {
          const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
          const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
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
      const nodeById = new Map(simNodes.map((n) => [n.id, n]));
      suggestionG.selectAll("line").data(pairs).join("line")
        .attr("x1", (d) => nodeById.get(d.sourceId)?.x ?? 0)
        .attr("y1", (d) => nodeById.get(d.sourceId)?.y ?? 0)
        .attr("x2", (d) => nodeById.get(d.targetId)?.x ?? 0)
        .attr("y2", (d) => nodeById.get(d.targetId)?.y ?? 0)
        .attr("stroke", SUGGESTION_STROKE)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", SUGGESTION_STROKE_DASHARRAY)
        .attr("pointer-events", "none");
    }

    // ── Nodes ─────────────────────────────────────────────────────────────
    const node = g.append("g").attr("class", "nodes")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodes, (d) => d.id).join("circle")
      .attr("r", (d) => rScale(d.linkCount))
      .attr("fill", (d) => showTagColors
        ? getNodeColor(d, tagColorMap)
        : (d.linkCount === 0 ? NODE_ISOLATED : TAG_PALETTE[0]))
      .attr("fill-opacity", (d) => focusNodeId === d.id ? 1 : 0.85)
      .attr("stroke", (d) => focusNodeId === d.id ? "#fff" : "transparent")
      .attr("stroke-width", 2)
      .style("cursor", "pointer");

    // ── Outer ring handles ────────────────────────────────────────────────
    const ring = g.append("g").attr("class", "rings")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodes, (d) => d.id).join("circle")
      .attr("r", (d) => rScale(d.linkCount) + RING_GAP + RING_WIDTH)
      .attr("fill", "none")
      .attr("stroke", RING_STROKE)
      .attr("stroke-width", RING_WIDTH)
      .attr("opacity", 0)
      .style("cursor", "crosshair");

    // ── Labels ────────────────────────────────────────────────────────────
    const label = g.append("g").attr("class", "labels")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(simNodes, (d) => d.id).join("text")
      .text((d) => d.title)
      .attr("font-size", 11)
      .attr("fill", LABEL_COLOR)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(rScale(d.linkCount) + 4))
      .attr("pointer-events", "all")
      .attr("opacity", (d) => focusNodeId === d.id ? 1 : 0)
      .style("cursor", "text");

    // ── Inline rename overlay ─────────────────────────────────────────────
    let renameOverlay: d3.Selection<SVGForeignObjectElement, unknown, null, undefined> | null = null;

    function showRenameInput(d: GraphNode) {
      svg.selectAll(".rename-overlay").remove();

      const transform = d3.zoomTransform(svgRef.current!);
      const sx = transform.applyX(d.x ?? 0);
      const sy = transform.applyY(d.y ?? 0);
      const r  = rScale(d.linkCount);

      const foWidth  = 180;
      const foHeight = 30;
      const foX      = sx - foWidth / 2;
      const foY      = sy - r - foHeight - 8;

      renameOverlay = svg.append("foreignObject")
        .attr("class", "rename-overlay")
        .attr("x", foX).attr("y", foY)
        .attr("width", foWidth).attr("height", foHeight);

      const input = renameOverlay.append("xhtml:input")
        .attr("type", "text")
        .attr("value", d.title)
        .attr("placeholder", "Note title…")
        .style("width", "100%")
        .style("height", "100%")
        .style("background", "rgba(20,20,20,0.97)")
        .style("border", "1.5px solid rgba(99,102,241,0.85)")
        .style("border-radius", "6px")
        .style("color", LABEL_COLOR)
        .style("font-size", "13px")
        .style("font-weight", "500")
        .style("padding", "0 10px")
        .style("outline", "none")
        .style("box-sizing", "border-box")
        .style("box-shadow", "0 0 0 3px rgba(99,102,241,0.18)");

      const inputEl = input.node() as HTMLInputElement;
      requestAnimationFrame(() => {
        inputEl.focus();
        inputEl.select();
      });

      let committed = false;

      function commit() {
        if (committed) return;
        committed = true;
        const newTitle = inputEl.value.trim();
        if (renameOverlay && svgRef.current?.contains(renameOverlay.node())) {
          svg.selectAll(".rename-overlay").remove();
        }
        renameOverlay = null;
        const finalTitle = newTitle || "Untitled";
        if (finalTitle !== d.title) {
          onRenameNode(d.id, finalTitle).catch(console.error);
        }
      }

      function cancel() {
        if (committed) return;
        committed = true;
        if (renameOverlay && svgRef.current?.contains(renameOverlay.node())) {
          svg.selectAll(".rename-overlay").remove();
        }
        renameOverlay = null;
      }

      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
        e.stopPropagation();
      });

      inputEl.addEventListener("blur", commit);
    }

    // ── Pulse animation ───────────────────────────────────────────────────
    function emitCreationPulse(d: GraphNode) {
      const r     = rScale(d.linkCount);
      const color = showTagColors ? getNodeColor(d, tagColorMap) : TAG_PALETTE[0];

      for (let i = 0; i < CREATE_PULSE_COUNT; i++) {
        const delay = i * 120;
        setTimeout(() => {
          if (!svgRef.current) return;
          const pulse = g.append("circle")
            .attr("class", "creation-pulse")
            .attr("cx", d.x ?? 0)
            .attr("cy", d.y ?? 0)
            .attr("r", r + 2)
            .attr("fill", "none")
            .attr("stroke", color)
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.8)
            .attr("pointer-events", "none");

          pulse.transition()
            .duration(600)
            .ease(d3.easeCubicOut)
            .attr("r", r + 28)
            .attr("opacity", 0)
            .attr("stroke-width", 0.5)
            .on("end", () => pulse.remove());
        }, delay);
      }

      node.filter((n) => n.id === d.id)
        .attr("stroke", "rgba(99,102,241,0.9)")
        .attr("stroke-width", 2.5)
        .transition()
        .duration(CREATE_FLY_DURATION + CREATE_PULSE_COUNT * 120 + 200)
        .attr("stroke", "transparent")
        .attr("stroke-width", 2);
    }

    // ── Fly camera to node ────────────────────────────────────────────────
    function flyToNode(d: GraphNode, onDone?: () => void) {
      if (!svgRef.current) return;
      const currentTransform = d3.zoomTransform(svgRef.current);
      const targetK  = Math.max(currentTransform.k, CREATE_FLY_SCALE);
      const targetTx = width  / 2 - (d.x ?? 0) * targetK;
      const targetTy = height / 2 - (d.y ?? 0) * targetK;

      svg.transition()
        .duration(CREATE_FLY_DURATION)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform, d3.zoomIdentity.translate(targetTx, targetTy).scale(targetK))
        .on("end", () => onDone?.());
    }

    // ── Double-click canvas → create node ────────────────────────────────
    svg.on("dblclick.create", function (event) {
      const t = event.target as SVGElement;
      const tag = t.tagName?.toLowerCase();
      if (tag === "circle" || tag === "text" || tag === "input" || tag === "foreignobject") return;
      const parentClass = (t.parentElement?.getAttribute("class") ?? "") +
                          (t.parentNode instanceof Element
                            ? (t.parentNode as Element).getAttribute("class") ?? ""
                            : "");
      if (parentClass.includes("nodes") || parentClass.includes("rings") || parentClass.includes("labels")) return;

      const transform = d3.zoomTransform(svgRef.current!);
      const [px, py]  = d3.pointer(event, svgRef.current);
      const [gx, gy]  = transform.invert([px, py]);

      onCreateNode(gx, gy).then((newNode) => {
        if (!newNode) return;

        simNodes.push(newNode);
        simNodesRef.current = simNodes;

        node.data(simNodes, (d) => d.id).join("circle")
          .attr("r",            (d) => rScale(d.linkCount))
          .attr("fill",         (d) => showTagColors ? getNodeColor(d, tagColorMap) : TAG_PALETTE[0])
          .attr("fill-opacity", 0.85)
          .attr("stroke",       "transparent")
          .attr("stroke-width", 2)
          .style("cursor", "pointer");

        label.data(simNodes, (d) => d.id).join("text")
          .text((d) => d.title)
          .attr("font-size", 11)
          .attr("fill", LABEL_COLOR)
          .attr("text-anchor", "middle")
          .attr("dy", (d) => -(rScale(d.linkCount) + 4))
          .attr("pointer-events", "all")
          .attr("opacity", (d) => d.id === newNode.id ? 1 : (focusNodeId === d.id ? 1 : 0))
          .style("cursor", "text");

        ring.data(simNodes, (d) => d.id).join("circle")
          .attr("r", (d) => rScale(d.linkCount) + RING_GAP + RING_WIDTH)
          .attr("fill", "none")
          .attr("stroke", RING_STROKE)
          .attr("stroke-width", RING_WIDTH)
          .attr("opacity", 0)
          .style("cursor", "crosshair");

        simulation.nodes(simNodes);
        simulation.alpha(0.2).restart();

        emitCreationPulse(newNode);

        flyToNode(newNode, () => {
          const live = simNodesRef.current.find((n) => n.id === newNode.id);
          if (live) showRenameInput(live);
        });
      }).catch(console.error);
    });

    // ── Node interactions ─────────────────────────────────────────────────
    node
      .on("mouseenter", function (event, d) {
        if (hoverExitTimerRef.current) clearTimeout(hoverExitTimerRef.current);

        ring.filter((r) => r.id === d.id)
          .attr("opacity", 1)
          .attr("stroke", RING_STROKE);

        const neighbourIds = new Set<string>();
        simEdges.forEach((e) => {
          const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
          const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
          if (sid === d.id) neighbourIds.add(tid);
          if (tid === d.id) neighbourIds.add(sid);
        });

        node.attr("fill-opacity", (n) => n.id === d.id || neighbourIds.has(n.id) ? 1 : 0.2);
        link
          .attr("stroke", (e) => {
            const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
            const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
            return sid === d.id || tid === d.id ? LINK_STROKE_HL : LINK_STROKE;
          })
          .attr("stroke-width", (e) => {
            const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
            const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
            return sid === d.id || tid === d.id ? strokeWidthScale(e.weight ?? 1) + 0.5 : 0.5;
          });
        label.attr("opacity", (n) => n.id === d.id || neighbourIds.has(n.id) ? 1 : 0);

        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top  - 14,
          title: d.title, linkCount: d.linkCount,
          tags: d.tags, createdAt: d.created_at,
        });
        setHoveredNode(d);
      })
      .on("mousemove", function (event) {
        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip((prev: any) => ({
          ...prev,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top  - 14,
        }));
      })
      .on("mouseleave", function (_, d) {
        if (!linkDragState.active) {
          ring.filter((r) => r.id === d.id).attr("opacity", 0);
        }
        hoverExitTimerRef.current = setTimeout(() => {
          if (isHoveringPreviewRef.current) return;
          node.attr("fill-opacity", (d) => focusNodeId === d.id ? 1 : 0.85);
          link
            .attr("stroke", LINK_STROKE)
            .attr("stroke-width",   (e) => strokeWidthScale(e.weight ?? 1))
            .attr("stroke-opacity", (e) => strokeOpacityScale(e.weight ?? 1));
          label.attr("opacity", (d) => focusNodeId === d.id ? 1 : 0);
          setTooltip((prev: any) => ({ ...prev, visible: false }));
          setHoveredNode(null);
        }, 400);
      })
      .on("click", (event, d) => {
        if (linkDragState.active) return;
        if (event.ctrlKey || event.metaKey) {
          openTab(d.id); setActiveNote(d.id);
          showToast(`Opened "${d.title}" in new tab`);
        } else if (event.shiftKey) {
          setFocusNodeId((prev) => prev === d.id ? null : d.id);
        } else {
          setActiveNote(d.id);
          showToast(`Opening "${d.title}"…`);
          setTimeout(() => handleClose(), 300);
        }
      })
      .on("contextmenu", (event, d) => {
        event.preventDefault();
        showToast(`Deleting "${d.title}"… (Esc to undo)`);
        const tid = setTimeout(() => {
          onDeleteNode(d.id).catch(console.error);
        }, 2500);
        function onEsc(e: KeyboardEvent) {
          if (e.key !== "Escape") return;
          clearTimeout(tid);
          showToast("Deletion cancelled");
          window.removeEventListener("keydown", onEsc);
        }
        window.addEventListener("keydown", onEsc);
      });

    // ── Double-click label → rename ───────────────────────────────────────
    label.on("dblclick", (event, d) => {
      event.stopPropagation();
      showRenameInput(d);
    });

    // ── Ring drag → create link ───────────────────────────────────────────
    const ringDrag = d3.drag<SVGCircleElement, GraphNode>()
      .on("start", (_event, d) => {
        linkDragState = {
          active:   true,
          sourceId: d.id,
          sourceX:  d.x ?? 0,
          sourceY:  d.y ?? 0,
        };

        setTooltip((prev: any) => ({ ...prev, visible: false }));

        const transform = d3.zoomTransform(svgRef.current!);
        const sx = transform.applyX(d.x ?? 0);
        const sy = transform.applyY(d.y ?? 0);
        linkDragLine
          .attr("x1", sx).attr("y1", sy)
          .attr("x2", sx).attr("y2", sy)
          .attr("opacity", 1);

        ring.filter((r) => r.id === d.id).attr("stroke", RING_STROKE_HOVER);
      })
      .on("drag", (event) => {
        if (!linkDragState.active) return;
        const [px, py] = d3.pointer(event, svgRef.current);
        linkDragLine.attr("x2", px).attr("y2", py);

        const transform = d3.zoomTransform(svgRef.current!);
        const [gx, gy]  = transform.invert([px, py]);

        let closest: GraphNode | null = null;
        let closestDist = Infinity;
        for (const n of simNodes) {
          if (n.id === linkDragState.sourceId) continue;
          const dx   = (n.x ?? 0) - gx;
          const dy   = (n.y ?? 0) - gy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < rScale(n.linkCount) + RING_GAP + RING_WIDTH + 4 && dist < closestDist) {
            closest     = n;
            closestDist = dist;
          }
        }

        node.attr("stroke", (n) => {
          if (n.id === linkDragState.sourceId) return "transparent";
          return n.id === closest?.id ? RING_STROKE_HOVER : "transparent";
        }).attr("stroke-width", (n) => n.id === closest?.id ? 2 : 0);
      })
      .on("end", (event) => {
        if (!linkDragState.active) return;

        const [px, py]  = d3.pointer(event, svgRef.current);
        const transform = d3.zoomTransform(svgRef.current!);
        const [gx, gy]  = transform.invert([px, py]);

        let target: GraphNode | null = null;
        for (const n of simNodes) {
          if (n.id === linkDragState.sourceId) continue;
          const dx   = (n.x ?? 0) - gx;
          const dy   = (n.y ?? 0) - gy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < rScale(n.linkCount) + RING_GAP + RING_WIDTH + 4) {
            target = n;
            break;
          }
        }

        if (target) {
          onCreateLink(linkDragState.sourceId, target.id).catch(console.error);
        }

        linkDragState = { active: false, sourceId: "", sourceX: 0, sourceY: 0 };
        linkDragLine.attr("opacity", 0);
        node.attr("stroke", (d) => focusNodeId === d.id ? "#fff" : "transparent")
            .attr("stroke-width", 2);
        ring.attr("opacity", 0).attr("stroke", RING_STROKE);
      });

    ring.call(ringDrag);

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

    // ── Simulation ────────────────────────────────────────────────────────
    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force("link",    d3.forceLink<GraphNode, GraphEdge>(simEdges)
        .id((d) => d.id).distance(60).strength(timelineMode ? 0.1 : 0.4))
      .force("charge",  d3.forceManyBody().strength(timelineMode ? -120 : -180))
      .force("center",  timelineMode ? null : d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide<GraphNode>().radius((d) => rScale(d.linkCount) + 6))
      .force("y",       timelineMode ? d3.forceY(0).strength(0.05) : null)
      .on("tick", () => {
        link
          .attr("x1", (e) => (e.source as GraphNode).x ?? 0)
          .attr("y1", (e) => (e.source as GraphNode).y ?? 0)
          .attr("x2", (e) => (e.target as GraphNode).x ?? 0)
          .attr("y2", (e) => (e.target as GraphNode).y ?? 0);
        node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        ring.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
        updateMinimapNodes();
      })
      .on("end", () => {
        simSettledRef.current = true;
        drawSuggestionEdges().catch(console.error);
      });

    return () => { simulation.stop(); };
  }, [visibleNodes, visibleEdges, allNotes, isLoading, showTagColors, tagColorMap,
      focusNodeId, timelineMode, setActiveNote, handleClose, openTab, showToast,
      onCreateNode, onRenameNode, onCreateLink, onDeleteNode]); // eslint-disable-line react-hooks/exhaustive-deps
}