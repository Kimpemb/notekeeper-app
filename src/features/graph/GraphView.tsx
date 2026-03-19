// src/features/graph/GraphView.tsx

import { useEffect, useRef, useCallback, useState } from "react";
import * as d3 from "d3";
import { useGraphData } from "./useGraphData";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { GraphNode, GraphEdge } from "./graphTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_BASE_RADIUS = 5;
const NODE_MAX_RADIUS  = 18;
const LINK_STROKE      = "rgba(150,150,150,0.25)";
const LINK_STROKE_HL   = "rgba(150,150,150,0.7)";
const NODE_FILL        = "var(--color-accent, #6366f1)";
const NODE_ISOLATED    = "var(--color-text-muted, #888)";
const LABEL_COLOR      = "var(--color-text, #e2e2e2)";
const BG_COLOR         = "var(--color-bg-secondary, #141414)";

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphView() {
  const { data, isLoading, error } = useGraphData();
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const closeGraph    = useUIStore((s) => s.closeGraph);

  const svgRef        = useRef<SVGSVGElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  const [searchQuery, setSearch] = useState("");
  const [stats, setStats]        = useState({ nodes: 0, edges: 0 });

  // ── Build / rebuild the graph whenever data changes ──────────────────────
  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current) return;

    const { nodes, edges } = data;

    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n }));
    const simEdges: GraphEdge[] = edges.map((e) => ({ ...e }));

    setStats({ nodes: simNodes.length, edges: simEdges.length });

    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));

    svg.call(zoom);
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85)
    );

    const maxLinks = Math.max(1, d3.max(simNodes, (n) => n.linkCount) ?? 1);
    const rScale   = d3.scaleSqrt()
      .domain([0, maxLinks])
      .range([NODE_BASE_RADIUS, NODE_MAX_RADIUS]);

    const link = g.append("g")
      .attr("class", "edges")
      .selectAll("line")
      .data(simEdges)
      .join("line")
      .attr("stroke", LINK_STROKE)
      .attr("stroke-width", 1);

    const node = g.append("g")
      .attr("class", "nodes")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodes, (d) => d.id)
      .join("circle")
      .attr("r", (d) => rScale(d.linkCount))
      .attr("fill", (d) => d.linkCount === 0 ? NODE_ISOLATED : NODE_FILL)
      .attr("fill-opacity", 0.85)
      .attr("stroke", "transparent")
      .attr("stroke-width", 2)
      .style("cursor", "pointer");

    const label = g.append("g")
      .attr("class", "labels")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(simNodes, (d) => d.id)
      .join("text")
      .text((d) => d.title)
      .attr("font-size", 11)
      .attr("fill", LABEL_COLOR)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(rScale(d.linkCount) + 4))
      .attr("pointer-events", "none")
      .attr("opacity", 0);

    const drag = d3.drag<SVGCircleElement, GraphNode>()
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

    node
      .on("mouseenter", function (_, d) {
        const neighbourIds = new Set<string>();
        simEdges.forEach((e) => {
          const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
          const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
          if (sid === d.id) neighbourIds.add(tid);
          if (tid === d.id) neighbourIds.add(sid);
        });
        node.attr("fill-opacity", (n) =>
          n.id === d.id || neighbourIds.has(n.id) ? 1 : 0.2
        );
        link
          .attr("stroke", (e) => {
            const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
            const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
            return sid === d.id || tid === d.id ? LINK_STROKE_HL : LINK_STROKE;
          })
          .attr("stroke-width", (e) => {
            const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
            const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
            return sid === d.id || tid === d.id ? 1.5 : 0.5;
          });
        label.attr("opacity", (n) =>
          n.id === d.id || neighbourIds.has(n.id) ? 1 : 0
        );
      })
      .on("mouseleave", function () {
        node.attr("fill-opacity", 0.85);
        link.attr("stroke", LINK_STROKE).attr("stroke-width", 1);
        label.attr("opacity", 0);
      })
      .on("click", (_, d) => {
        setActiveNote(d.id);
        closeGraph();
      });

    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force("link",
        d3.forceLink<GraphNode, GraphEdge>(simEdges)
          .id((d) => d.id)
          .distance(80)
          .strength(0.4)
      )
      .force("charge", d3.forceManyBody().strength(-180))
      .force("center", d3.forceCenter(0, 0))
      .force("collide",
        d3.forceCollide<GraphNode>().radius((d) => rScale(d.linkCount) + 6)
      )
      .on("tick", () => {
        link
          .attr("x1", (e) => (e.source as GraphNode).x ?? 0)
          .attr("y1", (e) => (e.source as GraphNode).y ?? 0)
          .attr("x2", (e) => (e.target as GraphNode).x ?? 0)
          .attr("y2", (e) => (e.target as GraphNode).y ?? 0);
        node
          .attr("cx", (d) => d.x ?? 0)
          .attr("cy", (d) => d.y ?? 0);
        label
          .attr("x", (d) => d.x ?? 0)
          .attr("y", (d) => d.y ?? 0);
      });

    simulationRef.current = simulation;

    return () => { simulation.stop(); };
  }, [data, setActiveNote, closeGraph]);

  // ── Search highlight ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const q = searchQuery.trim().toLowerCase();

    svg.selectAll<SVGCircleElement, GraphNode>("circle")
      .attr("stroke", (d) =>
        q && d.title.toLowerCase().includes(q) ? "#fff" : "transparent"
      )
      .attr("fill-opacity", (d) => {
        if (!q) return 0.85;
        return d.title.toLowerCase().includes(q) ? 1 : 0.2;
      });

    svg.selectAll<SVGTextElement, GraphNode>("text")
      .attr("opacity", (d) =>
        q && d.title.toLowerCase().includes(q) ? 1 : 0
      );
  }, [searchQuery]);

  // ── Fit to screen ─────────────────────────────────────────────────────────
  const handleFit = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;
    const svg    = d3.select(svgRef.current);
    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    svg.transition().duration(400).call(
      d3.zoom<SVGSVGElement, unknown>().transform as any,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85)
    );
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        background: BG_COLOR,
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border, #2a2a2a)",
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: LABEL_COLOR, opacity: 0.9 }}>
          Graph
        </span>

        {!isLoading && (
          <span style={{ fontSize: 12, color: LABEL_COLOR, opacity: 0.4 }}>
            {stats.nodes} notes · {stats.edges} links
          </span>
        )}

        <input
          type="text"
          placeholder="Filter notes…"
          value={searchQuery}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            marginLeft: "auto",
            background: "var(--color-bg, #1e1e1e)",
            border: "1px solid var(--color-border, #2a2a2a)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 13,
            color: LABEL_COLOR,
            outline: "none",
            width: 180,
          }}
        />

        <button
          onClick={handleFit}
          title="Fit to screen"
          style={{
            background: "transparent",
            border: "1px solid var(--color-border, #2a2a2a)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            color: LABEL_COLOR,
            cursor: "pointer",
            opacity: 0.7,
          }}
        >
          Fit
        </button>

        <button
          onClick={closeGraph}
          title="Close graph"
          style={{
            background: "transparent",
            border: "none",
            fontSize: 18,
            color: LABEL_COLOR,
            cursor: "pointer",
            opacity: 0.5,
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {isLoading && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: LABEL_COLOR, opacity: 0.4, fontSize: 14,
          }}>
            Loading graph…
          </div>
        )}

        {error && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#f87171", fontSize: 14,
          }}>
            {error}
          </div>
        )}

        {!isLoading && data?.nodes.length === 0 && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: LABEL_COLOR, opacity: 0.4, fontSize: 14,
          }}>
            No notes yet.
          </div>
        )}

        <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

        <div style={{
          position: "absolute", bottom: 16, left: 16,
          display: "flex", flexDirection: "column", gap: 6,
          fontSize: 11, color: LABEL_COLOR, opacity: 0.45,
          pointerEvents: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="10" height="10">
              <circle cx="5" cy="5" r="5" fill={NODE_FILL} fillOpacity={0.85} />
            </svg>
            Connected note
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="10" height="10">
              <circle cx="5" cy="5" r="5" fill={NODE_ISOLATED} fillOpacity={0.85} />
            </svg>
            Isolated note
          </div>
          <div style={{ marginTop: 4, opacity: 0.7 }}>
            Scroll to zoom · Drag to pan · Click node to open
          </div>
        </div>
      </div>
    </div>
  );
}