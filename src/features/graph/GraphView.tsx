// src/features/graph/GraphView.tsx

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import { useGraphData } from "./useGraphData";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { GraphNode, GraphEdge } from "./graphTypes";

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_BASE_RADIUS  = 5;
const NODE_MAX_RADIUS   = 18;
const LINK_STROKE       = "rgba(150,150,150,0.25)";
const LINK_STROKE_HL    = "rgba(150,150,150,0.7)";
const NODE_FILL         = "var(--color-accent, #6366f1)";
const NODE_ISOLATED     = "var(--color-text-muted, #888)";
const LABEL_COLOR       = "var(--color-text, #e2e2e2)";
const BG_COLOR          = "var(--color-bg-secondary, #141414)";
const MINIMAP_W         = 160;
const MINIMAP_H         = 100;
const DEFAULT_WIDTH_PCT = 0.66;
const MIN_WIDTH         = 320;
const TRANSITION_MS     = 280;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  linkCount: number;
  tagCount: number;
}

interface Toast {
  id: number;
  message: string;
}

// Imperative handle exposed to parent via ref
export interface GraphViewHandle {
  animatedClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GraphView = forwardRef<GraphViewHandle>(function GraphView(_, ref) {
  const { data, isLoading, error, refresh, lastUpdated } = useGraphData();
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const closeGraph    = useUIStore((s) => s.closeGraph);
  const openTab       = useUIStore((s) => s.openTab);

  const svgRef        = useRef<SVGSVGElement>(null);
  const minimapRef    = useRef<SVGSVGElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const panelRef      = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const zoomRef       = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodesRef   = useRef<GraphNode[]>([]);
  const toastCountRef = useRef(0);

  const [panelWidth, setPanelWidth]   = useState<number>(
    () => Math.round(window.innerWidth * DEFAULT_WIDTH_PCT)
  );
  const [isFullscreen, setFullscreen] = useState(false);
  const [mounted, setMounted]         = useState(false);

  const [searchQuery, setSearch] = useState("");
  const [stats, setStats]        = useState({ nodes: 0, edges: 0 });
  const [tooltip, setTooltip]    = useState<TooltipState>({
    visible: false, x: 0, y: 0, title: "", linkCount: 0, tagCount: 0,
  });
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Slide-in on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Animated close ────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    setMounted(false);
    setTimeout(() => closeGraph(), TRANSITION_MS);
  }, [closeGraph]);

  // Expose to parent so Ctrl+Shift+G can trigger animated close
  useImperativeHandle(ref, () => ({ animatedClose: handleClose }), [handleClose]);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((message: string) => {
    const id = ++toastCountRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2000);
  }, []);

  // ── Escape to close (animated) ────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // ── Fullscreen toggle ─────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => setFullscreen((f) => !f), []);

  // ── Resize handle ─────────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX     = e.clientX;
    const startWidth = panelRef.current?.offsetWidth ?? window.innerWidth * DEFAULT_WIDTH_PCT;

    function onMove(ev: MouseEvent) {
      const delta    = startX - ev.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(window.innerWidth - 60, startWidth + delta));
      setPanelWidth(newWidth);
      setFullscreen(false);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Build graph ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!data || !svgRef.current || !containerRef.current || !minimapRef.current) return;

    const { nodes, edges } = data;
    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n }));
    const simEdges: GraphEdge[] = edges.map((e) => ({ ...e }));
    simNodesRef.current = simNodes;

    setStats({ nodes: simNodes.length, edges: simEdges.length });

    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");

    // ── Minimap ───────────────────────────────────────────────────────────
    const minimap = d3.select(minimapRef.current);
    minimap.selectAll("*").remove();

    minimap.append("rect")
      .attr("width", MINIMAP_W).attr("height", MINIMAP_H)
      .attr("fill", "rgba(0,0,0,0.5)").attr("rx", 6);

    const mmG = minimap.append("g").attr("class", "mm-nodes");

    minimap.append("rect")
      .attr("class", "mm-viewport")
      .attr("fill", "rgba(255,255,255,0.06)")
      .attr("stroke", "rgba(255,255,255,0.2)")
      .attr("stroke-width", 1).attr("rx", 2);

    function getMinimapScale(ns: GraphNode[]): { scale: number; minX: number; minY: number } {
      const xs = ns.map((n) => n.x ?? 0);
      const ys = ns.map((n) => n.y ?? 0);
      if (xs.length === 0) return { scale: 1, minX: 0, minY: 0 };
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const pad  = 10;
      const scale: number = Math.min(
        (MINIMAP_W - pad * 2) / (maxX - minX || 1),
        (MINIMAP_H - pad * 2) / (maxY - minY || 1)
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
        .attr("fill", (d) => d.linkCount === 0 ? NODE_ISOLATED : NODE_FILL)
        .attr("fill-opacity", 0.7);
    }

    function updateMinimapViewport(transform: d3.ZoomTransform, w: number, h: number) {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      const pad         = 10;
      const topLeft     = transform.invert([0, 0]);
      const bottomRight = transform.invert([w, h]);
      const vx = (topLeft[0] - minX) * scale + pad;
      const vy = (topLeft[1] - minY) * scale + pad;
      const vw = (bottomRight[0] - topLeft[0]) * scale;
      const vh = (bottomRight[1] - topLeft[1]) * scale;
      minimap.select(".mm-viewport")
        .attr("x", Math.max(0, vx))
        .attr("y", Math.max(0, vy))
        .attr("width", Math.min(MINIMAP_W, Math.max(0, vw)))
        .attr("height", Math.min(MINIMAP_H, Math.max(0, vh)));
    }

    minimap.style("cursor", "crosshair").on("click", function (event) {
      const ns = simNodesRef.current;
      const { scale, minX, minY } = getMinimapScale(ns);
      if (scale === 0) return;
      const pad        = 10;
      const [mmX, mmY] = d3.pointer(event);
      const graphX     = (mmX - pad) / scale + minX;
      const graphY     = (mmY - pad) / scale + minY;
      const current    = d3.zoomTransform(svgRef.current!);
      const next       = d3.zoomIdentity
        .translate(width / 2 - graphX * current.k, height / 2 - graphY * current.k)
        .scale(current.k);
      svg.transition().duration(300).call(zoom.transform, next);
    });

    // ── Zoom ──────────────────────────────────────────────────────────────
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        updateMinimapViewport(event.transform, width, height);
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85));

    // ── Scales ────────────────────────────────────────────────────────────
    const maxLinks = Math.max(1, d3.max(simNodes, (n) => n.linkCount) ?? 1);
    const rScale   = d3.scaleSqrt().domain([0, maxLinks]).range([NODE_BASE_RADIUS, NODE_MAX_RADIUS]);

    // ── Edges ─────────────────────────────────────────────────────────────
    const link = g.append("g").attr("class", "edges")
      .selectAll("line").data(simEdges).join("line")
      .attr("stroke", LINK_STROKE).attr("stroke-width", 1);

    // ── Nodes ─────────────────────────────────────────────────────────────
    const node = g.append("g").attr("class", "nodes")
      .selectAll<SVGCircleElement, GraphNode>("circle")
      .data(simNodes, (d) => d.id).join("circle")
      .attr("r", (d) => rScale(d.linkCount))
      .attr("fill", (d) => d.linkCount === 0 ? NODE_ISOLATED : NODE_FILL)
      .attr("fill-opacity", 0.85)
      .attr("stroke", "transparent").attr("stroke-width", 2)
      .style("cursor", "pointer");

    // ── Labels ────────────────────────────────────────────────────────────
    const label = g.append("g").attr("class", "labels")
      .selectAll<SVGTextElement, GraphNode>("text")
      .data(simNodes, (d) => d.id).join("text")
      .text((d) => d.title)
      .attr("font-size", 11).attr("fill", LABEL_COLOR)
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(rScale(d.linkCount) + 4))
      .attr("pointer-events", "none").attr("opacity", 0);

    // ── Drag ──────────────────────────────────────────────────────────────
    const drag = d3.drag<SVGCircleElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      });

    node.call(drag);

    // ── Hover / tooltip / click ───────────────────────────────────────────
    node
      .on("mouseenter", function (event, d) {
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
            return sid === d.id || tid === d.id ? 1.5 : 0.5;
          });
        label.attr("opacity", (n) => n.id === d.id || neighbourIds.has(n.id) ? 1 : 0);
        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top - 14,
          title: d.title, linkCount: d.linkCount, tagCount: d.tags.length,
        });
      })
      .on("mousemove", function (event) {
        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip((prev) => ({
          ...prev,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top - 14,
        }));
      })
      .on("mouseleave", function () {
        node.attr("fill-opacity", 0.85);
        link.attr("stroke", LINK_STROKE).attr("stroke-width", 1);
        label.attr("opacity", 0);
        setTooltip((prev) => ({ ...prev, visible: false }));
      })
      .on("click", (event, d) => {
        if (event.ctrlKey || event.metaKey) {
          openTab(d.id);
          setActiveNote(d.id);
          showToast(`Opened "${d.title}" in new tab`);
        } else {
          setActiveNote(d.id);
          showToast(`Opening "${d.title}"…`);
          setTimeout(() => handleClose(), 300);
        }
      });

    // ── Simulation ────────────────────────────────────────────────────────
    const simulation = d3.forceSimulation<GraphNode>(simNodes)
      .force("link", d3.forceLink<GraphNode, GraphEdge>(simEdges).id((d) => d.id).distance(80).strength(0.4))
      .force("charge", d3.forceManyBody().strength(-180))
      .force("center", d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide<GraphNode>().radius((d) => rScale(d.linkCount) + 6))
      .on("tick", () => {
        link
          .attr("x1", (e) => (e.source as GraphNode).x ?? 0)
          .attr("y1", (e) => (e.source as GraphNode).y ?? 0)
          .attr("x2", (e) => (e.target as GraphNode).x ?? 0)
          .attr("y2", (e) => (e.target as GraphNode).y ?? 0);
        node.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
        label.attr("x", (d) => d.x ?? 0).attr("y", (d) => d.y ?? 0);
        updateMinimapNodes();
      });

    simulationRef.current = simulation;
    return () => { simulation.stop(); };
  }, [data, setActiveNote, handleClose, openTab, showToast]);

  // ── Search highlight ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const q   = searchQuery.trim().toLowerCase();
    svg.selectAll<SVGCircleElement, GraphNode>("circle")
      .attr("stroke", (d) => q && d.title.toLowerCase().includes(q) ? "#fff" : "transparent")
      .attr("fill-opacity", (d) => {
        if (!q) return 0.85;
        return d.title.toLowerCase().includes(q) ? 1 : 0.2;
      });
    svg.selectAll<SVGTextElement, GraphNode>("text")
      .attr("opacity", (d) => q && d.title.toLowerCase().includes(q) ? 1 : 0);
  }, [searchQuery]);

  // ── Fit to screen ─────────────────────────────────────────────────────────
  const handleFit = useCallback(() => {
    if (!svgRef.current || !containerRef.current || !zoomRef.current) return;
    const svg    = d3.select(svgRef.current);
    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    svg.transition().duration(400).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85)
    );
  }, []);

  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const currentWidth = isFullscreen ? window.innerWidth : panelWidth;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0, zIndex: 49,
          background: "rgba(0,0,0,0.4)",
          opacity: mounted ? 1 : 0,
          transition: `opacity ${TRANSITION_MS}ms ease`,
          pointerEvents: mounted ? "auto" : "none",
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: "fixed", top: 0, bottom: 0, right: 0, zIndex: 50,
          display: "flex", flexDirection: "column",
          background: BG_COLOR,
          boxShadow: "-4px 0 32px rgba(0,0,0,0.5)",
          transform: mounted ? "translateX(0)" : "translateX(100%)",
          transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), width 220ms cubic-bezier(0.32, 0.72, 0, 1)`,
          width: currentWidth,
        }}
      >
        {/* Resize handle */}
        {!isFullscreen && (
          <div
            onMouseDown={onResizeMouseDown}
            style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 5,
              cursor: "ew-resize", zIndex: 10, background: "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          />
        )}

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
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
          {lastUpdatedLabel && (
            <span style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.3 }}>
              updated {lastUpdatedLabel}
            </span>
          )}
          <input
            type="text" placeholder="Filter notes…" value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              marginLeft: "auto",
              background: "var(--color-bg, #1e1e1e)",
              border: "1px solid var(--color-border, #2a2a2a)",
              borderRadius: 6, padding: "4px 10px",
              fontSize: 13, color: LABEL_COLOR, outline: "none", width: 160,
            }}
          />
          <button onClick={refresh} title="Refresh graph" disabled={isLoading}
            style={{
              background: "transparent", border: "1px solid var(--color-border, #2a2a2a)",
              borderRadius: 6, padding: "4px 8px", fontSize: 13, color: LABEL_COLOR,
              cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.3 : 0.7,
            }}
          >
            {isLoading ? "…" : "↺"}
          </button>
          <button onClick={handleFit} title="Fit to screen"
            style={{
              background: "transparent", border: "1px solid var(--color-border, #2a2a2a)",
              borderRadius: 6, padding: "4px 8px", fontSize: 12,
              color: LABEL_COLOR, cursor: "pointer", opacity: 0.7,
            }}
          >
            Fit
          </button>
          <button onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            style={{
              background: "transparent", border: "1px solid var(--color-border, #2a2a2a)",
              borderRadius: 6, padding: "4px 8px", fontSize: 12,
              color: LABEL_COLOR, cursor: "pointer", opacity: 0.7, lineHeight: 1,
            }}
          >
            {isFullscreen ? "⊡" : "⊞"}
          </button>
          <button onClick={handleClose} title="Close graph (Esc)"
            style={{
              background: "transparent", border: "none", fontSize: 18,
              color: LABEL_COLOR, cursor: "pointer", opacity: 0.5, lineHeight: 1, padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Canvas */}
        <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {isLoading && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: LABEL_COLOR, opacity: 0.4, fontSize: 14,
            }}>Loading graph…</div>
          )}
          {error && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#f87171", fontSize: 14,
            }}>{error}</div>
          )}
          {!isLoading && data?.nodes.length === 0 && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: LABEL_COLOR, opacity: 0.4, fontSize: 14,
            }}>No notes yet.</div>
          )}

          <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

          {/* Tooltip */}
          {tooltip.visible && (
            <div style={{
              position: "absolute", left: tooltip.x, top: tooltip.y,
              background: "rgba(24,24,24,0.95)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, padding: "8px 12px", pointerEvents: "none", zIndex: 10, minWidth: 140,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: LABEL_COLOR, marginBottom: 4 }}>
                {tooltip.title}
              </div>
              <div style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.5, display: "flex", flexDirection: "column", gap: 2 }}>
                <span>{tooltip.linkCount} {tooltip.linkCount === 1 ? "link" : "links"}</span>
                {tooltip.tagCount > 0 && <span>{tooltip.tagCount} {tooltip.tagCount === 1 ? "tag" : "tags"}</span>}
                <span style={{ marginTop: 4, opacity: 0.6, fontSize: 10 }}>
                  Click to open · Ctrl+click for new tab
                </span>
              </div>
            </div>
          )}

          {/* Minimap */}
          {!isLoading && data && data.nodes.length > 0 && (
            <svg ref={minimapRef} width={MINIMAP_W} height={MINIMAP_H}
              style={{
                position: "absolute", bottom: 16, right: 16,
                borderRadius: 8, overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.08)", cursor: "crosshair",
              }}
            />
          )}

          {/* Toasts */}
          <div style={{
            position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            pointerEvents: "none", zIndex: 20,
          }}>
            {toasts.map((t) => (
              <div key={t.id} style={{
                background: "rgba(30,30,30,0.95)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, padding: "7px 14px", fontSize: 12, color: LABEL_COLOR,
                animation: "graphToastIn 200ms ease", whiteSpace: "nowrap",
              }}>
                {t.message}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div style={{
            position: "absolute", bottom: 16, left: 16,
            display: "flex", flexDirection: "column", gap: 6,
            fontSize: 11, color: LABEL_COLOR, opacity: 0.45, pointerEvents: "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" fill={NODE_FILL} fillOpacity={0.85} /></svg>
              Connected note
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="10" height="10"><circle cx="5" cy="5" r="5" fill={NODE_ISOLATED} fillOpacity={0.85} /></svg>
              Isolated note
            </div>
            <div style={{ marginTop: 4, opacity: 0.7 }}>Scroll to zoom · Drag to pan · Esc to close</div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes graphToastIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
});