// src/features/graph/GraphView.tsx

import { useEffect, useRef, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import { useGraphData } from "./useGraphData";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { GraphNode, GraphEdge } from "./graphTypes";
import { GraphNotePreview } from "./GraphNotePreview";
import { GraphLegend } from "./GraphLegend";
import { GraphControls } from "./GraphControls";
import { useGraphSimulation } from "./useGraphSimulation";
import { useGraphSearch } from "./useGraphSearch";

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL_COLOR       = "var(--color-text, #e2e2e2)";
const BG_COLOR          = "var(--color-bg-secondary, #141414)";
const MINIMAP_W         = 160;
const MINIMAP_H         = 100;
const DEFAULT_WIDTH_PCT = 0.66;
const MIN_WIDTH         = 320;
const TRANSITION_MS     = 280;

const TAG_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#ec4899", "#14b8a6", "#f97316", "#8b5cf6", "#84cc16",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  linkCount: number;
  tags: string[];
  createdAt: number;
}

interface Toast {
  id: number;
  message: string;
}

export interface GraphViewHandle {
  animatedClose: () => void;
}

interface GraphViewProps {
  initialFocusNoteId?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTagColorMap(nodes: GraphNode[]): Map<string, string> {
  const allTags = Array.from(new Set(nodes.flatMap((n) => n.tags)));
  const map = new Map<string, string>();
  allTags.forEach((tag, i) => map.set(tag, TAG_PALETTE[i % TAG_PALETTE.length]));
  return map;
}

function getNeighbourhood(focusId: string, edges: GraphEdge[], depth: number): Set<string> {
  const result = new Set<string>([focusId]);
  let frontier = new Set<string>([focusId]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const e of edges) {
      const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
      const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
      if (frontier.has(sid) && !result.has(tid)) { result.add(tid); next.add(tid); }
      if (frontier.has(tid) && !result.has(sid)) { result.add(sid); next.add(sid); }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(
  function GraphView({ initialFocusNoteId }, ref) {

  const { data, isLoading, error, refresh, lastUpdated } = useGraphData();
  const setActiveNote           = useNoteStore((s) => s.setActiveNote);
  const notes                   = useNoteStore((s) => s.notes);
  const closeGraph              = useUIStore((s) => s.closeGraph);
  const openTab                 = useUIStore((s) => s.openTab);
  const clearGraphFocusNoteId   = useUIStore((s) => s.clearGraphFocusNoteId);
  const savedState              = useUIStore((s) => s.graphViewState);
  const saveGraphViewState      = useUIStore((s) => s.saveGraphViewState);
  const setPendingScrollHeading = useUIStore((s) => s.setPendingScrollHeading);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const svgRef               = useRef<SVGSVGElement | null>(null);
  const minimapRef           = useRef<SVGSVGElement | null>(null);
  const containerRef         = useRef<HTMLDivElement | null>(null);
  const panelRef             = useRef<HTMLDivElement | null>(null);
  const zoomRef              = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodesRef          = useRef<GraphNode[]>([]);
  const toastCountRef        = useRef(0);
  const simSettledRef        = useRef(false);
  const hoverExitTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringPreviewRef = useRef(false);

  // ── State ─────────────────────────────────────────────────────────────────
  const [panelWidth, setPanelWidth]       = useState<number>(() => Math.round(window.innerWidth * DEFAULT_WIDTH_PCT));
  const [isFullscreen, setFullscreen]     = useState(false);
  const [mounted, setMounted]             = useState(false);
  const [hoveredNode, setHoveredNode]     = useState<GraphNode | null>(null);
  const [searchQuery, setSearch]          = useState(savedState.searchQuery);
  const [stats, setStats]                 = useState({ nodes: 0, edges: 0 });
  const [tooltip, setTooltip]             = useState<TooltipState>({ visible: false, x: 0, y: 0, title: "", linkCount: 0, tags: [], createdAt: 0 });
  const [toasts, setToasts]               = useState<Toast[]>([]);
  const [showOrphans, setShowOrphans]     = useState(savedState.showOrphans);
  const [showTagColors, setShowTagColors] = useState(savedState.showTagColors);
  const [depth, setDepth]                 = useState(savedState.depth);
  const [timelineMode, setTimelineMode]   = useState(false);
  const [focusNodeId, setFocusNodeId]     = useState<string | null>(
    initialFocusNoteId ?? savedState.focusNodeId
  );

  const isLocalGraph = !!initialFocusNoteId;

  useEffect(() => {
    if (initialFocusNoteId) clearGraphFocusNoteId();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveGraphViewState({ searchQuery, showOrphans, showTagColors, depth, focusNodeId });
  }, [searchQuery, showOrphans, showTagColors, depth, focusNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagColorMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return buildTagColorMap(data.nodes);
  }, [data]);

  const allTags = useMemo(() => Array.from(tagColorMap.keys()), [tagColorMap]);

  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (!data) return { visibleNodes: [], visibleEdges: [] };
    let nodes = data.nodes;
    let edges = data.edges;
    if (!showOrphans) nodes = nodes.filter((n) => n.linkCount > 0);
    if (focusNodeId) {
      const neighbourhood = getNeighbourhood(focusNodeId, edges, depth);
      nodes = nodes.filter((n) => neighbourhood.has(n.id));
    }
    const nodeIds = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => {
      const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
      const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
      return nodeIds.has(sid) && nodeIds.has(tid);
    });
    return { visibleNodes: nodes, visibleEdges: edges };
  }, [data, showOrphans, focusNodeId, depth]);

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

  useImperativeHandle(ref, () => ({ animatedClose: handleClose }), [handleClose]);

  const showToast = useCallback((message: string) => {
    const id = ++toastCountRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2000);
  }, []);

  const handleExport = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    showToast("Exporting graph…");

    const svgEl     = svgRef.current;
    const svgWidth  = containerRef.current.clientWidth;
    const svgHeight = containerRef.current.clientHeight;

    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width",  String(svgWidth));
    bg.setAttribute("height", String(svgHeight));
    bg.setAttribute("fill",   "#141414");
    clone.insertBefore(bg, clone.firstChild);

    const serialized = new XMLSerializer().serializeToString(clone);
    const blob       = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const url        = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas  = document.createElement("canvas");
      canvas.width  = svgWidth;
      canvas.height = svgHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const link    = document.createElement("a");
      link.download = `notekeeper-graph-${Date.now()}.png`;
      link.href     = canvas.toDataURL("image/png");
      link.click();

      showToast("Graph saved as PNG ✓");
    };
    img.src = url;
  }, [showToast]);

  // ── Escape key ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (focusNodeId) { setFocusNodeId(null); return; }
        handleClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, focusNodeId]);

  const toggleFullscreen = useCallback(() => setFullscreen((f) => !f), []);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX     = e.clientX;
    const startWidth = panelRef.current?.offsetWidth ?? window.innerWidth * DEFAULT_WIDTH_PCT;
    function onMove(ev: MouseEvent) {
      const newWidth = Math.max(MIN_WIDTH, Math.min(window.innerWidth - 60, startWidth + (startX - ev.clientX)));
      setPanelWidth(newWidth); setFullscreen(false);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const handleFit = useCallback(() => {
    if (!svgRef.current || !containerRef.current || !zoomRef.current) return;
    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    d3.select(svgRef.current).transition().duration(400)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.85));
  }, []);

  // ── D3 simulation ─────────────────────────────────────────────────────────
  useGraphSimulation({
    svgRef, minimapRef, containerRef, zoomRef,
    simNodesRef, simSettledRef, hoverExitTimerRef, isHoveringPreviewRef,
    visibleNodes, visibleEdges, allNotes: notes, isLoading,
    showTagColors, tagColorMap, focusNodeId, timelineMode,
    setActiveNote, openTab, setStats, setTooltip, setHoveredNode,
    setFocusNodeId, showToast, handleClose,
  });

  // ── Search ────────────────────────────────────────────────────────────────
  const { matchIndex, matchCount } = useGraphSearch({
    searchQuery, focusNodeId,
    svgRef, zoomRef, containerRef, simNodesRef, simSettledRef,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const currentWidth = isFullscreen ? window.innerWidth : panelWidth;
  const orphanCount  = data ? data.nodes.filter((n) => n.linkCount === 0).length : 0;
  const focusedNode  = focusNodeId ? data?.nodes.find((n) => n.id === focusNodeId) : null;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 49,
        background: "rgba(0,0,0,0.4)",
        opacity: mounted ? 1 : 0,
        transition: `opacity ${TRANSITION_MS}ms ease`,
        pointerEvents: "none",
      }} />

      {/* Panel */}
      <div ref={panelRef} style={{
        position: "fixed", top: 0, bottom: 0, right: 0, zIndex: 50,
        display: "flex", flexDirection: "column",
        background: BG_COLOR, boxShadow: "-4px 0 32px rgba(0,0,0,0.5)",
        transform: mounted ? "translateX(0)" : "translateX(100%)",
        transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.32, 0.72, 0, 1), width 220ms cubic-bezier(0.32, 0.72, 0, 1)`,
        width: currentWidth,
      }}>
        {!isFullscreen && (
          <div
            onMouseDown={onResizeMouseDown}
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, cursor: "ew-resize", zIndex: 10, background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          />
        )}

        {/* Header */}
        <GraphControls
          isLocalGraph={isLocalGraph}
          isLoading={isLoading}
          stats={stats}
          focusedNode={focusedNode ?? null}
          focusNodeId={focusNodeId}
          initialFocusNoteId={initialFocusNoteId}
          lastUpdatedLabel={lastUpdatedLabel}
          searchQuery={searchQuery}
          matchIndex={matchIndex}
          matchCount={matchCount}
          depth={depth}
          showOrphans={showOrphans}
          orphanCount={orphanCount}
          showTagColors={showTagColors}
          isFullscreen={isFullscreen}
          timelineMode={timelineMode}
          onSearchChange={setSearch}
          onDepthChange={setDepth}
          onToggleOrphans={() => setShowOrphans((v) => !v)}
          onToggleTagColors={() => setShowTagColors((v) => !v)}
          onToggleTimeline={() => setTimelineMode((v) => !v)}
          onRefresh={refresh}
          onFit={handleFit}
          onToggleFullscreen={toggleFullscreen}
          onExport={handleExport}
          onClose={handleClose}
        />

        {/* Canvas */}
        <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>

          {/* Note preview */}
          <GraphNotePreview
            node={hoveredNode}
            tagColorMap={tagColorMap}
            onPanelMouseEnter={() => {
              isHoveringPreviewRef.current = true;
              if (hoverExitTimerRef.current) clearTimeout(hoverExitTimerRef.current);
            }}
            onPanelMouseLeave={() => {
              isHoveringPreviewRef.current = false;
              setHoveredNode(null);
            }}
            onOpen={(id, headingText) => {
              setActiveNote(id);
              if (headingText) setPendingScrollHeading(headingText);
              showToast(`Opening "${hoveredNode?.title ?? ""}"…`);
              setTimeout(() => handleClose(), 300);
            }}
          />

          {isLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: LABEL_COLOR, opacity: 0.4, fontSize: 14 }}>
              Loading graph…
            </div>
          )}
          {error && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 14 }}>
              {error}
            </div>
          )}
          {!isLoading && visibleNodes.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: LABEL_COLOR, opacity: 0.4, fontSize: 14 }}>
              {data?.nodes.length === 0 ? "No notes yet." : "No notes match current filters."}
            </div>
          )}

          <svg ref={svgRef} style={{
            width: "100%",
            height: "100%",
            display: "block",
            touchAction: "none",
          }} />

          {/* Cursor tooltip */}
          {tooltip.visible && (
            <div style={{ position: "absolute", left: tooltip.x, top: tooltip.y, background: "rgba(24,24,24,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", pointerEvents: "none", zIndex: 10, minWidth: 140 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: LABEL_COLOR, marginBottom: 4 }}>{tooltip.title}</div>
              <div style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.5, display: "flex", flexDirection: "column", gap: 2 }}>
                <span>{tooltip.linkCount} {tooltip.linkCount === 1 ? "link" : "links"}</span>
                {tooltip.createdAt > 0 && (
                  <span>
                    {new Date(tooltip.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
                {tooltip.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                    {tooltip.tags.map((t) => (
                      <span key={t} style={{ background: tagColorMap.get(t) ? `${tagColorMap.get(t)}33` : "rgba(255,255,255,0.08)", border: `1px solid ${tagColorMap.get(t) ?? "rgba(255,255,255,0.15)"}`, borderRadius: 3, padding: "1px 5px", fontSize: 10, color: tagColorMap.get(t) ?? LABEL_COLOR }}>{t}</span>
                    ))}
                  </div>
                )}
                <span style={{ marginTop: 4, opacity: 0.6, fontSize: 10 }}>Click to open · Shift+click to focus · Ctrl+click new tab</span>
              </div>
            </div>
          )}

          {/* Minimap */}
          {!isLoading && visibleNodes.length > 0 && (
            <svg ref={minimapRef} width={MINIMAP_W} height={MINIMAP_H} style={{ position: "absolute", bottom: 16, right: 16, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", cursor: "crosshair" }} />
          )}

          {/* Toasts */}
          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none", zIndex: 20 }}>
            {toasts.map((t) => (
              <div key={t.id} style={{ background: "rgba(30,30,30,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12, color: LABEL_COLOR, animation: "graphToastIn 200ms ease", whiteSpace: "nowrap" }}>
                {t.message}
              </div>
            ))}
          </div>

          {/* Legend */}
          <GraphLegend
            showTagColors={showTagColors}
            allTags={allTags}
            tagColorMap={tagColorMap}
          />
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