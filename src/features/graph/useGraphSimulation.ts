// src/features/graph/useGraphSimulation.ts
// Owns the entire D3 build/rebuild cycle: nodes, links, labels,
// drag, zoom, minimap, simulation.
//
// Timeline mode: pins each node's X position to its creation month,
// lets Y float freely via force layout — constellation effect.

import { useEffect, MutableRefObject } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "./graphTypes";

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

function getNodeColor(node: GraphNode, tagColorMap: Map<string, string>): string {
  if (node.linkCount === 0) return NODE_ISOLATED;
  if (node.tags.length > 0) return tagColorMap.get(node.tags[0]) ?? TAG_PALETTE[0];
  return TAG_PALETTE[0];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function floorToMonth(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

interface UseGraphSimulationProps {
  svgRef: MutableRefObject<SVGSVGElement | null>;
  minimapRef: MutableRefObject<SVGSVGElement | null>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  simNodesRef: MutableRefObject<GraphNode[]>;
  simSettledRef: MutableRefObject<boolean>;
  hoverExitTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isHoveringPreviewRef: MutableRefObject<boolean>;
  visibleNodes: GraphNode[];
  visibleEdges: GraphEdge[];
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
}

export function useGraphSimulation({
  svgRef, minimapRef, containerRef, zoomRef,
  simNodesRef, simSettledRef, hoverExitTimerRef, isHoveringPreviewRef,
  visibleNodes, visibleEdges, isLoading,
  showTagColors, tagColorMap, focusNodeId, timelineMode,
  setActiveNote, openTab, setStats, setTooltip, setHoveredNode,
  setFocusNodeId, showToast, handleClose,
}: UseGraphSimulationProps) {

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !minimapRef.current) return;
    if (visibleNodes.length === 0 && !isLoading) {
      d3.select(svgRef.current).selectAll("*").remove();
      return;
    }
    if (visibleNodes.length === 0) return;

    simSettledRef.current = false;

    const simNodes: GraphNode[] = visibleNodes.map((n) => ({ ...n }));
    const simEdges: GraphEdge[] = visibleEdges.map((e) => ({ ...e }));
    simNodesRef.current = simNodes;

    setStats({ nodes: simNodes.length, edges: simEdges.length });

    // ── Link strength weighting ───────────────────────────────────────────
    const pairCount = new Map<string, number>();
    for (const e of visibleEdges) {
      const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
      const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
      const key = pairKey(sid, tid);
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
    const maxPairCount       = Math.max(1, ...Array.from(pairCount.values()));
    const strokeWidthScale   = d3.scaleLinear().domain([1, maxPairCount]).range([1, 3]).clamp(true);
    const strokeOpacityScale = d3.scaleLinear().domain([1, maxPairCount]).range([0.25, 0.5]).clamp(true);

    function edgePairCount(e: GraphEdge): number {
      const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
      const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
      return pairCount.get(pairKey(sid, tid)) ?? 1;
    }

    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
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

    // ── Timeline axis ─────────────────────────────────────────────────────
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
    const minimap = d3.select(minimapRef.current);
    minimap.selectAll("*").remove();
    minimap.append("rect").attr("width", MINIMAP_W).attr("height", MINIMAP_H).attr("fill", "rgba(0,0,0,0.5)").attr("rx", 6);
    const mmG = minimap.append("g").attr("class", "mm-nodes");
    minimap.append("rect").attr("class", "mm-viewport").attr("fill", "rgba(255,255,255,0.06)").attr("stroke", "rgba(255,255,255,0.2)").attr("stroke-width", 1).attr("rx", 2);

    function getMinimapScale(ns: GraphNode[]) {
      const xs = ns.map((n) => n.x ?? 0), ys = ns.map((n) => n.y ?? 0);
      if (xs.length === 0) return { scale: 1, minX: 0, minY: 0 };
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const pad  = 10;
      const scale = Math.min((MINIMAP_W - pad * 2) / (maxX - minX || 1), (MINIMAP_H - pad * 2) / (maxY - minY || 1));
      return { scale, minX, minY };
    }

    function updateMinimapNodes() {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      const pad = 10;
      mmG.selectAll<SVGCircleElement, GraphNode>("circle").data(ns, (d) => d.id).join("circle")
        .attr("cx", (d) => ((d.x ?? 0) - minX) * scale + pad)
        .attr("cy", (d) => ((d.y ?? 0) - minY) * scale + pad)
        .attr("r", 2)
        .attr("fill", (d) => showTagColors ? getNodeColor(d, tagColorMap) : (d.linkCount === 0 ? NODE_ISOLATED : TAG_PALETTE[0]))
        .attr("fill-opacity", 0.7);
    }

    function updateMinimapViewport(transform: d3.ZoomTransform, w: number, h: number) {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      const pad = 10;
      const topLeft = transform.invert([0, 0]), bottomRight = transform.invert([w, h]);
      minimap.select(".mm-viewport")
        .attr("x", Math.max(0, (topLeft[0] - minX) * scale + pad))
        .attr("y", Math.max(0, (topLeft[1] - minY) * scale + pad))
        .attr("width", Math.min(MINIMAP_W, Math.max(0, (bottomRight[0] - topLeft[0]) * scale)))
        .attr("height", Math.min(MINIMAP_H, Math.max(0, (bottomRight[1] - topLeft[1]) * scale)));
    }

    minimap.style("cursor", "crosshair").on("click", function (event) {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      if (scale === 0) return;
      const pad = 10;
      const [mmX, mmY] = d3.pointer(event);
      const graphX = (mmX - pad) / scale + minX, graphY = (mmY - pad) / scale + minY;
      const current = d3.zoomTransform(svgRef.current!);
      svg.transition().duration(300).call(zoom.transform,
        d3.zoomIdentity.translate(width / 2 - graphX * current.k, height / 2 - graphY * current.k).scale(current.k)
      );
    });

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        updateMinimapViewport(event.transform, width, height);
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    // Forward trackpad pinch to D3 zoom
svgRef.current?.addEventListener("wheel", (e) => {
  e.preventDefault();
}, { passive: false });
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

    const link = g.append("g").attr("class", "edges")
      .selectAll("line").data(simEdges).join("line")
      .attr("stroke", LINK_STROKE)
      .attr("stroke-width",   (e) => strokeWidthScale(edgePairCount(e)))
      .attr("stroke-opacity", (e) => strokeOpacityScale(edgePairCount(e)));

    const node = g.append("g").attr("class", "nodes")
      .selectAll<SVGCircleElement, GraphNode>("circle").data(simNodes, (d) => d.id).join("circle")
      .attr("r", (d) => rScale(d.linkCount))
      .attr("fill", (d) => showTagColors ? getNodeColor(d, tagColorMap) : (d.linkCount === 0 ? NODE_ISOLATED : TAG_PALETTE[0]))
      .attr("fill-opacity", (d) => focusNodeId === d.id ? 1 : 0.85)
      .attr("stroke", (d) => focusNodeId === d.id ? "#fff" : "transparent")
      .attr("stroke-width", 2).style("cursor", "pointer");

    const label = g.append("g").attr("class", "labels")
      .selectAll<SVGTextElement, GraphNode>("text").data(simNodes, (d) => d.id).join("text")
      .text((d) => d.title)
      .attr("font-size", 11).attr("fill", LABEL_COLOR).attr("text-anchor", "middle")
      .attr("dy", (d) => -(rScale(d.linkCount) + 4))
      .attr("pointer-events", "none")
      .attr("opacity", (d) => focusNodeId === d.id ? 1 : 0);

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

    node
      .on("mouseenter", function (event, d) {
        if (hoverExitTimerRef.current) clearTimeout(hoverExitTimerRef.current);
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
            return sid === d.id || tid === d.id ? strokeWidthScale(edgePairCount(e)) + 0.5 : 0.5;
          });
        label.attr("opacity", (n) => n.id === d.id || neighbourIds.has(n.id) ? 1 : 0);
        const rect = containerRef.current!.getBoundingClientRect();
        // ── createdAt included in tooltip for both force and timeline mode ──
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top - 14,
          title: d.title,
          linkCount: d.linkCount,
          tags: d.tags,
          createdAt: d.created_at,
        });
        setHoveredNode(d);
      })
      .on("mousemove", function (event) {
        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip((prev: any) => ({ ...prev, x: event.clientX - rect.left + 14, y: event.clientY - rect.top - 14 }));
      })
      .on("mouseleave", function () {
        hoverExitTimerRef.current = setTimeout(() => {
          if (isHoveringPreviewRef.current) return;
          node.attr("fill-opacity", (d) => focusNodeId === d.id ? 1 : 0.85);
          link
            .attr("stroke", LINK_STROKE)
            .attr("stroke-width",   (e) => strokeWidthScale(edgePairCount(e)))
            .attr("stroke-opacity", (e) => strokeOpacityScale(edgePairCount(e)));
          label.attr("opacity", (d) => focusNodeId === d.id ? 1 : 0);
          setTooltip((prev: any) => ({ ...prev, visible: false }));
          setHoveredNode(null);
        }, 400);
      })
      .on("click", (event, d) => {
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
      });

    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force("link",    d3.forceLink<GraphNode, GraphEdge>(simEdges).id((d) => d.id).distance(60).strength(timelineMode ? 0.1 : 0.4))
      .force("charge",  d3.forceManyBody().strength(timelineMode ? -120 : -180))
      .force("center",  timelineMode ? null : d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide<GraphNode>().radius((d) => rScale(d.linkCount) + 6))
      .force("y",       timelineMode ? d3.forceY(0).strength(0.05) : null)
      .on("tick", () => {
        link
          .attr("x1", (e) => (e.source as GraphNode).x ?? 0).attr("y1", (e) => (e.source as GraphNode).y ?? 0)
          .attr("x2", (e) => (e.target as GraphNode).x ?? 0).attr("y2", (e) => (e.target as GraphNode).y ?? 0);
        node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
        updateMinimapNodes();
      })
      .on("end", () => { simSettledRef.current = true; });

    return () => { simulation.stop(); };
  }, [visibleNodes, visibleEdges, isLoading, showTagColors, tagColorMap, focusNodeId, timelineMode, setActiveNote, handleClose, openTab, showToast]); // eslint-disable-line react-hooks/exhaustive-deps
}