// src/features/graph/GraphView.tsx

import { useEffect, useRef, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import { useGraphData } from "./useGraphData";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { GraphNode, GraphEdge } from "./graphTypes";
import { GraphNotePanel } from "./GraphNotePanel";
import type { EdgeContext } from "./GraphNotePanel";
import { GraphLegend } from "./GraphLegend";
import { GraphControls } from "./GraphControls";
import { useGraphSimulation } from "./useGraphSimulation";
import type { EdgeClickData } from "./useGraphSimulation";
import { useGraphSearch } from "./useGraphSearch";
import { useGraphEdit } from "./useGraphEdit";
import { ConfirmModal } from "@/features/ui/components/ConfirmModal";

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
  const result   = new Set<string>([focusId]);
  let frontier   = new Set<string>([focusId]);
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

function extractLinkSnippet(content: string | null | undefined, targetTitle: string): string {
  if (!content) return "";
  try {
    const doc = JSON.parse(content);
    function walkForSnippet(nodes: any[]): string {
      for (const node of nodes) {
        if (node.type === "noteLink" && node.attrs?.label) {
          return node.attrs.label;
        }
        if (node.content && Array.isArray(node.content)) {
          const hasLink = node.content.some(
            (c: any) => c.type === "noteLink" && c.attrs?.label?.toLowerCase() === targetTitle.toLowerCase()
          );
          if (hasLink) {
            const text = node.content.map((c: any) => {
              if (c.type === "text")     return c.text ?? "";
              if (c.type === "noteLink") return c.attrs?.label ?? "";
              return "";
            }).join("").trim();
            return text.length > 100 ? text.slice(0, 97) + "…" : text;
          }
          const nested = walkForSnippet(node.content);
          if (nested) return nested;
        }
      }
      return "";
    }
    return walkForSnippet(doc.content ?? []);
  } catch { return ""; }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(
  function GraphView({ initialFocusNoteId }, ref) {

  const { data, isLoading, error, refresh, lastUpdated, patchData } = useGraphData();
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
  const simEdgesRef          = useRef<GraphEdge[]>([]);
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
  const [toasts, setToasts]               = useState<Toast[]>([]);
  const [showOrphans, setShowOrphans]     = useState(savedState.showOrphans);
  const [showTagColors, setShowTagColors] = useState(savedState.showTagColors);
  const [depth, setDepth]                 = useState(savedState.depth);
  const [timelineMode, setTimelineMode]   = useState(false);
  const [focusNodeId, setFocusNodeId]     = useState<string | null>(
    initialFocusNoteId ?? savedState.focusNodeId
  );

  // ── Navigation history ────────────────────────────────────────────────────
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

  const pushToHistory = useCallback((nodeId: string) => {
    const currentIndex = historyIndexRef.current;
    setHistoryStack((prev) => {
      const newStack = prev.slice(0, currentIndex + 1);
      if (newStack[newStack.length - 1] === nodeId) return newStack;
      return [...newStack, nodeId];
    });
    const newIndex = currentIndex + 1;
    setHistoryIndex(newIndex);
    historyIndexRef.current = newIndex;
  }, []);

  const handleNavigateToNode = useCallback((nodeId: string) => {
    setFocusNodeId(nodeId);
    const targetNode = data?.nodes.find((n) => n.id === nodeId);
    if (targetNode) {
      setDetailNode(targetNode);
      setEditNodeId(null);
      setEdgeContext(null);
    }
    pushToHistory(nodeId);
  }, [data, pushToHistory]);

  const handleOpenInEditor = useCallback((nodeId: string) => {
    const targetNode = data?.nodes.find((n) => n.id === nodeId);
    if (!targetNode) return;
    setEditNodeId(nodeId);
    setFullscreen(true);
    setDetailNode(targetNode);
    setEdgeContext(null);
    setFocusNodeId(nodeId);
    pushToHistory(nodeId);
  }, [data, pushToHistory]);

  const handleGoBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex   = historyIndex - 1;
    const prevNodeId = historyStack[newIndex];
    if (!prevNodeId) return;
    setFocusNodeId(prevNodeId);
    const targetNode = data?.nodes.find((n) => n.id === prevNodeId);
    if (targetNode) {
      setDetailNode(targetNode);
      setEditNodeId((prev) => prev !== null ? prevNodeId : null);
      setEdgeContext(null);
    }
    setHistoryIndex(newIndex);
    historyIndexRef.current = newIndex;
  }, [historyIndex, historyStack, data]);

  const handleGoForward = useCallback(() => {
    if (historyIndex >= historyStack.length - 1) return;
    const newIndex   = historyIndex + 1;
    const nextNodeId = historyStack[newIndex];
    if (!nextNodeId) return;
    setFocusNodeId(nextNodeId);
    const targetNode = data?.nodes.find((n) => n.id === nextNodeId);
    if (targetNode) {
      setDetailNode(targetNode);
      setEditNodeId((prev) => prev !== null ? nextNodeId : null);
      setEdgeContext(null);
    }
    setHistoryIndex(newIndex);
    historyIndexRef.current = newIndex;
  }, [historyIndex, historyStack, data]);

  // ── Multi-select ──────────────────────────────────────────────────────────
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());

  // ── Unified panel state ───────────────────────────────────────────────────
  const [detailNode,  setDetailNode]  = useState<GraphNode | null>(null);
  const [edgeContext, setEdgeContext] = useState<EdgeContext | null>(null);
  const [editNodeId,  setEditNodeId]  = useState<string | null>(null);

  // ── Delete confirmation ───────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState<{ nodeId: string; title: string } | null>(null);

  // ── Pending node IDs ──────────────────────────────────────────────────────
  const [pendingNodeIds, setPendingNodeIds] = useState<Set<string>>(new Set());

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

  // ── Search — hoisted above visibleNodes so matchedIds is available ────────
  const { matchIndex, matchCount, matchedIds, currentMatchId } = useGraphSearch({
    searchQuery, focusNodeId,
    svgRef, zoomRef, containerRef, simNodesRef, simSettledRef,
  });

  // ── Auto-surface current match in detail panel as user cycles ─────────────
  useEffect(() => {
    if (!currentMatchId || !data) return;
    const matchNode = data.nodes.find((n) => n.id === currentMatchId);
    if (matchNode) setDetailNode(matchNode);
  }, [currentMatchId, data]);

  // ── Visible nodes/edges ───────────────────────────────────────────────────
  // Guard: only apply matchedIds filter when query is active AND results have
  // resolved (matchedIds.size > 0). An empty Set on a non-empty query means
  // the async FTS5 result hasn't come back yet — don't filter in that case.
  const { visibleNodes, visibleEdges } = useMemo(() => {
    if (!data) return { visibleNodes: [], visibleEdges: [] };

    let nodes = data.nodes;
    let edges = data.edges;

    if (!showOrphans) {
      nodes = nodes.filter((n) => n.linkCount > 0 || pendingNodeIds.has(n.id));
    }

    if (focusNodeId) {
      const neighbourhood = getNeighbourhood(focusNodeId, edges, depth);
      nodes = nodes.filter((n) => neighbourhood.has(n.id) || pendingNodeIds.has(n.id));
    }

    // FTS5 filter — only when query is active AND results have resolved.
    // matchedIds.size === 0 on an active query means async hasn't returned yet
    // — skip filtering entirely to avoid wiping the canvas during the gap.
    if (searchQuery.trim() && matchedIds.size > 0) {
      const neighbourhood = new Set<string>();
      for (const id of matchedIds) {
        const expanded = getNeighbourhood(id, edges, 1);
        for (const nid of expanded) neighbourhood.add(nid);
      }
      nodes = nodes.filter((n) => neighbourhood.has(n.id) || pendingNodeIds.has(n.id));
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => {
      const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
      const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
      return nodeIds.has(sid) && nodeIds.has(tid);
    });

    return { visibleNodes: nodes, visibleEdges: edges };
  }, [data, showOrphans, focusNodeId, depth, pendingNodeIds, searchQuery, matchedIds]);

  // ── Slide-in on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Animated close — clears search so it doesn't persist next open ────────
  const handleClose = useCallback(() => {
    setSearch("");
    setMounted(false);
    setTimeout(() => closeGraph(), TRANSITION_MS);
  }, [closeGraph]);

  useImperativeHandle(ref, () => ({ animatedClose: handleClose }), [handleClose]);

  const showToast = useCallback((message: string) => {
    const id = ++toastCountRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2500);
  }, []);

  // ── Graph edit hook ───────────────────────────────────────────────────────
  const { createNodeAt, deleteNode, renameNode, createLink, deleteLink } = useGraphEdit({
    simNodesRef,
    simEdgesRef,
    showToast,
  });

  // ── Node single-click → lock panel in detail mode ────────────────────────
  const handleNodeClick = useCallback((node: GraphNode) => {
    if (editNodeId === node.id) return;
    setEditNodeId(null);
    if (detailNode?.id === node.id) {
      setDetailNode(null);
      return;
    }
    setEdgeContext(null);
    setDetailNode(node);
    pushToHistory(node.id);
  }, [detailNode, editNodeId, pushToHistory]);

  // ── Edge click → switch panel to edge mode ────────────────────────────────
  const handleEdgeClick = useCallback(async (data: EdgeClickData) => {
    setDetailNode(null);
    setEditNodeId(null);
    const sourceNote = notes.find((n) => n.id === data.sourceId);
    const targetNote = notes.find((n) => n.id === data.targetId);
    if (!sourceNote || !targetNote) return;
    const snippet = extractLinkSnippet(sourceNote.content, targetNote.title);
    setEdgeContext({
      sourceId:    data.sourceId,
      targetId:    data.targetId,
      sourceTitle: sourceNote.title,
      targetTitle: targetNote.title,
      snippet,
    });
  }, [notes]);

  // ── Delete link (from panel) ──────────────────────────────────────────────
  const handleDeleteLink = useCallback((sourceId: string, targetId: string) => {
    setEdgeContext(null);
    deleteLink(sourceId, targetId, (sid, tid) => {
      deleteLinkInD3(sid, tid);
      patchData.removeEdge(sid, tid);
    });
  }, [deleteLink, patchData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enter edit mode ───────────────────────────────────────────────────────
  const handleEnterEdit = useCallback(() => {
    if (!detailNode) return;
    setEditNodeId(detailNode.id);
    setFullscreen(true);
  }, [detailNode]);

  // ── Exit edit mode ────────────────────────────────────────────────────────
  const handleExitEdit = useCallback(() => {
    setEditNodeId(null);
    setFullscreen(false);
  }, []);

  // ── patchData-wired adapters ──────────────────────────────────────────────

  const handleCreateNode = useCallback(async (
    x: number, y: number,
    onCreated: (node: GraphNode) => void,
  ) => {
    await createNodeAt(x, y, onCreated);
  }, [createNodeAt]);

  const handleRenameNode = useCallback(async (
    nodeId: string, newTitle: string,
    onRenamed: (nodeId: string, title: string) => void,
  ) => {
    const isNewNode = !data?.nodes.some((n) => n.id === nodeId);
    await renameNode(nodeId, newTitle, (id, title) => {
      if (isNewNode) {
        const simNode = simNodesRef.current.find((n) => n.id === id);
        if (simNode) {
          setPendingNodeIds((prev) => new Set(prev).add(id));
          patchData.addNode({ ...simNode, title });
        }
      } else {
        patchData.updateNodeTitle(id, title);
      }
      setDetailNode((prev) => prev?.id === id ? { ...prev, title } : prev);
      onRenamed(id, title);
    });
  }, [renameNode, data, simNodesRef, patchData]);

  const handleCreateLink = useCallback(async (
    sourceId: string, targetId: string,
    onLinked: (edge: GraphEdge) => void,
  ) => {
    await createLink(sourceId, targetId, (newEdge) => {
      onLinked(newEdge);
      patchData.addEdge(newEdge);
      setPendingNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        next.delete(targetId);
        return next;
      });
    });
  }, [createLink, patchData]);

  const handleDeleteNode = useCallback(async (
    nodeId: string,
    onDeleted: (nodeId: string) => void,
  ) => {
    await deleteNode(nodeId, (id) => {
      onDeleted(id);
      patchData.removeNode(id);
      setPendingNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setDetailNode((prev) => prev?.id === id ? null : prev);
      if (editNodeId === id) { setEditNodeId(null); setFullscreen(false); }
    });
  }, [deleteNode, patchData, editNodeId]);

  // ── Delete confirmation ───────────────────────────────────────────────────
  const requestDeleteNode = useCallback((nodeId: string, title: string) => {
    setConfirmDelete({ nodeId, title });
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
    const img        = new Image();
    img.onload = () => {
      const canvas  = document.createElement("canvas");
      canvas.width  = svgWidth;
      canvas.height = svgHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const link    = document.createElement("a");
      link.download = `idemora-graph-${Date.now()}.png`;
      link.href     = canvas.toDataURL("image/png");
      link.click();
      showToast("Graph saved as PNG ✓");
    };
    img.src = url;
  }, [showToast]);

  // ── Escape key ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmDelete) return;
      if (edgeContext)              { setEdgeContext(null);  return; }
      if (editNodeId)               { handleExitEdit();      return; }
      if (detailNode)               { setDetailNode(null);   return; }
      if (selectedNodeIds.size > 0) { setSelectedNodeIds(new Set()); return; }
      if (focusNodeId)              { setFocusNodeId(null);  return; }
      handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, focusNodeId, confirmDelete, edgeContext, editNodeId, detailNode, selectedNodeIds, handleExitEdit]);

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
    const nodes = simNodesRef.current;
    if (nodes.length === 0) return;
    const width  = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bboxW = maxX - minX || 1;
    const bboxH = maxY - minY || 1;
    const PADDING = 80;
    const scale = Math.min(
      (width  - PADDING * 2) / bboxW,
      (height - PADDING * 2) / bboxH,
      1.5,
    );
    const tx = width  / 2 - scale * (minX + bboxW / 2);
    const ty = height / 2 - scale * (minY + bboxH / 2);
    d3.select(svgRef.current)
      .transition().duration(400)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }, []);

  // ── D3 simulation ─────────────────────────────────────────────────────────
  const { deleteNodeById, deleteLinkInD3 } = useGraphSimulation({
    svgRef, minimapRef, containerRef, zoomRef,
    simNodesRef, simEdgesRef,
    simSettledRef, hoverExitTimerRef, isHoveringPreviewRef,
    visibleNodes, visibleEdges, allNotes: notes, isLoading,
    showTagColors, tagColorMap, focusNodeId, timelineMode,
    selectedNodeIds,
    setActiveNote, openTab, setStats, setHoveredNode,
    setFocusNodeId, setSelectedNodeIds,
    showToast, handleClose,
    onCreateNode:        handleCreateNode,
    onRenameNode:        handleRenameNode,
    onCreateLink:        handleCreateLink,
    onDeleteNode:        handleDeleteNode,
    onRequestDeleteNode: requestDeleteNode,
    onNodeClick:         handleNodeClick,
    onEdgeClick:         handleEdgeClick,
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const currentWidth = isFullscreen ? window.innerWidth : panelWidth;
  const orphanCount  = data ? data.nodes.filter((n) => n.linkCount === 0).length : 0;
  const focusedNode  = focusNodeId ? data?.nodes.find((n) => n.id === focusNodeId) : null;
  const canGoBack    = historyIndex > 0;
  const canGoForward = historyIndex < historyStack.length - 1;

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

          {/* ── Unified note + edge panel ── */}
          <GraphNotePanel
            hoveredNode={hoveredNode}
            detailNode={detailNode}
            edgeContext={edgeContext}
            editNodeId={editNodeId}
            tagColorMap={tagColorMap}
            notes={notes}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onGoBack={handleGoBack}
            onGoForward={handleGoForward}
            onNavigateToNode={handleNavigateToNode}
            onOpenInEditor={handleOpenInEditor}
            onPanelMouseEnter={() => {
              isHoveringPreviewRef.current = true;
              if (hoverExitTimerRef.current) clearTimeout(hoverExitTimerRef.current);
            }}
            onPanelMouseLeave={() => {
              isHoveringPreviewRef.current = false;
              if (!detailNode && !edgeContext && !editNodeId) setHoveredNode(null);
            }}
            onOpen={(id, headingText) => {
              setActiveNote(id);
              if (headingText) setPendingScrollHeading(headingText);
              const node = detailNode ?? hoveredNode;
              showToast(`Opening "${node?.title ?? ""}"…`);
              setTimeout(() => handleClose(), 300);
            }}
            onCloseDetail={() => setDetailNode(null)}
            onCloseEdge={() => setEdgeContext(null)}
            onEnterEdit={handleEnterEdit}
            onExitEdit={handleExitEdit}
            onDeleteEdge={handleDeleteLink}
            onFocusNode={(id) => setFocusNodeId((prev) => prev === id ? null : id)}
            onOpenBacklink={(id) => {
              setActiveNote(id);
              showToast("Opening note…");
              setTimeout(() => handleClose(), 300);
            }}
          />

          {!isLoading && visibleNodes.length > 0 && (
            <div style={{
              position: "absolute", top: 12, left: 12,
              fontSize: 11, color: LABEL_COLOR, opacity: 0.3,
              pointerEvents: "none", lineHeight: 1.6,
            }}>
              Click node to inspect · Press E to edit · Double-click to rename · Drag ring to link · Right-click to delete
              {selectedNodeIds.size > 0 && (
                <div style={{ marginTop: 4, color: "#6366f1", opacity: 1 }}>
                  {selectedNodeIds.size} node{selectedNodeIds.size === 1 ? "" : "s"} selected
                </div>
              )}
            </div>
          )}

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
              {data?.nodes.length === 0
                ? "No notes yet — double-click anywhere to create one"
                : "No notes match current filters."}
            </div>
          )}

          <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />

          {!isLoading && visibleNodes.length > 0 && (
            <svg ref={minimapRef} width={MINIMAP_W} height={MINIMAP_H} style={{ position: "absolute", bottom: 16, right: 16, borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", cursor: "crosshair" }} />
          )}

          <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none", zIndex: 20 }}>
            {toasts.map((t) => (
              <div key={t.id} style={{ background: "rgba(30,30,30,0.95)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "7px 14px", fontSize: 12, color: LABEL_COLOR, animation: "graphToastIn 200ms ease", whiteSpace: "nowrap" }}>
                {t.message}
              </div>
            ))}
          </div>

          <GraphLegend
            showTagColors={showTagColors}
            allTags={allTags}
            tagColorMap={tagColorMap}
          />
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <ConfirmModal
          open
          danger
          title="Delete note?"
          message={`Move "${confirmDelete.title}" to trash? You can restore it from the sidebar.`}
          confirmLabel="Move to trash"
          onConfirm={() => {
            const { nodeId } = confirmDelete;
            setConfirmDelete(null);
            handleDeleteNode(nodeId, (_id) => {
              deleteNodeById(nodeId);
            });
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <style>{`
        @keyframes graphToastIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes graphPulse {
          0%   { stroke-width: 1; stroke-opacity: 0.8; }
          100% { stroke-width: 0.5; stroke-opacity: 0; }
        }
        @keyframes searchPulse {
          0%, 100% { stroke-opacity: 0.5; stroke-width: 3; }
          50%       { stroke-opacity: 1;   stroke-width: 4; }
        }
        .search-current {
          animation: searchPulse 1.2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
});