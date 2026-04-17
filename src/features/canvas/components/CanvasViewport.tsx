import React, { useState, useCallback, useRef } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { CanvasBackground } from "./CanvasBackground";
import { EdgeRenderer } from "../edges/EdgeRenderer";
import { Node } from "../nodes/Node";
import { screenToWorld } from "../utils/geometry";
import type { CanvasNode, NodeId } from "../../../types/canvas";

const DEFAULT_NODE_WIDTH  = 180;
const DEFAULT_NODE_HEIGHT = 44;

interface CanvasViewportProps {
  noteId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const CanvasViewport: React.FC<CanvasViewportProps> = ({ noteId, containerRef }) => {
  const store = useCanvasStore();
  const addNode    = useCanvasStore((s) => s.addNode);
  const addEdge    = useCanvasStore((s) => s.addEdge);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const moveNode   = useCanvasStore((s) => s.moveNode);
  const pan        = useCanvasStore((s) => s.pan);

  const nodes           = store.getNodes(noteId);
  const edges           = store.getEdges(noteId);
  const viewport        = store.getViewport(noteId);
  const selectedNodeIds = store.getSelectedNodeIds(noteId);
  const clearSelection  = () => useCanvasStore.getState().clearSelection(noteId);
  const selectNodes     = (ids: string[]) => useCanvasStore.getState().selectNodes(noteId, ids);

  const [isPanning,       setIsPanning]       = useState(false);
  const [dragStart,       setDragStart]       = useState({ x: 0, y: 0 });
  const [isDraggingNode,  setIsDraggingNode]  = useState(false);
  const [draggedNodeId,   setDraggedNodeId]   = useState<NodeId | null>(null);
  const [editingNodeId,   setEditingNodeId]   = useState<NodeId | null>(null);
  const [connectingFromId, setConnectingFromId] = useState<NodeId | null>(null);
  const [connectingFromPt, setConnectingFromPt] = useState({ x: 0, y: 0 });
  const [draftEndPt,       setDraftEndPt]       = useState({ x: 0, y: 0 });

  const hoverTargetId        = useRef<NodeId | null>(null);
  const canvasPointerMoved   = useRef(false);

  const hitTestNode = useCallback((screenX: number, screenY: number): NodeId | null => {
    const { x: vx, y: vy, zoom } = viewport;
    for (const node of nodes) {
      const nx = node.x * zoom + vx;
      const ny = node.y * zoom + vy;
      const nw = node.width * zoom;
      const nh = node.height * zoom;
      if (screenX >= nx && screenX <= nx + nw && screenY >= ny && screenY <= ny + nh) {
        return node.id;
      }
    }
    return null;
  }, [nodes, viewport]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement) !== e.currentTarget) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const world = screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      viewport.x, viewport.y, viewport.zoom,
    );

    const id = crypto.randomUUID();
    addNode(noteId, {
      id, type: "text", content: "",
      x: world.x - DEFAULT_NODE_WIDTH / 2,
      y: world.y - DEFAULT_NODE_HEIGHT / 2,
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
    });
    selectNodes([id]);
    setEditingNodeId(id);
  }, [containerRef, viewport, addNode, selectNodes, noteId]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const isPanGesture = e.button === 1 || (e.button === 0 && e.altKey);
    if (isPanGesture) {
      e.preventDefault();
      setIsPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) canvasPointerMoved.current = false;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    canvasPointerMoved.current = true;

    if (connectingFromId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        setDraftEndPt({ x: sx, y: sy });
        const hit = hitTestNode(sx, sy);
        hoverTargetId.current = (hit && hit !== connectingFromId) ? hit : null;
      }
    }

    if (!isPanning) return;
    pan(noteId, e.clientX - dragStart.x, e.clientY - dragStart.y);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, [isPanning, dragStart, pan, connectingFromId, containerRef, hitTestNode, noteId]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setIsPanning(false);
    setIsDraggingNode(false);
    setDraggedNodeId(null);

    if (connectingFromId) {
      const toId = hoverTargetId.current;
      if (toId && toId !== connectingFromId) {
        addEdge(noteId, { id: crypto.randomUUID(), from: connectingFromId, to: toId });
      }
      setConnectingFromId(null);
      hoverTargetId.current = null;
    }

    if (!canvasPointerMoved.current && e.button === 0) {
      clearSelection();
      setEditingNodeId(null);
    }
  }, [connectingFromId, addEdge, clearSelection, noteId]);

  const handleNodeDragStart = useCallback((id: NodeId, e: React.PointerEvent) => {
    setIsDraggingNode(true);
    setDraggedNodeId(id);
    if (!e.shiftKey && !selectedNodeIds.includes(id)) selectNodes([id]);
  }, [selectedNodeIds, selectNodes]);

  const handleNodeDrag = useCallback((id: NodeId, e: React.PointerEvent) => {
    if (!isDraggingNode || draggedNodeId !== id) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      viewport.x, viewport.y, viewport.zoom,
    );
    const node = nodes.find((n: CanvasNode) => n.id === id);
    moveNode(noteId, id,
      world.x - (node?.width ?? DEFAULT_NODE_WIDTH) / 2,
      world.y - (node?.height ?? DEFAULT_NODE_HEIGHT) / 2
    );
  }, [isDraggingNode, draggedNodeId, containerRef, viewport, nodes, moveNode, noteId]);

  const handleNodeDragEnd = useCallback(() => {
    setIsDraggingNode(false);
    setDraggedNodeId(null);
  }, []);

  const handleEditStart  = useCallback((id: NodeId) => setEditingNodeId(id), []);

  const handleCommit = useCallback((id: NodeId, content: string) => {
    updateNode(noteId, id, { content });
    setEditingNodeId(null);
  }, [updateNode, noteId]);

  const handleDiscard = useCallback((id: NodeId) => {
    deleteNode(noteId, id);
    setEditingNodeId(null);
    clearSelection();
  }, [deleteNode, clearSelection, noteId]);

  const handleConnectStart = useCallback((id: NodeId, e: React.PointerEvent) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setConnectingFromId(id);
    setConnectingFromPt(pt);
    setDraftEndPt(pt);
    hoverTargetId.current = null;
    containerRef.current?.setPointerCapture(e.pointerId);
  }, [containerRef]);

  const handleConnectEnd = useCallback((_id: NodeId) => {}, []);

  const connectingTargetId = connectingFromId ? hoverTargetId.current : null;
  const draftEdge = connectingFromId
    ? { fromX: connectingFromPt.x, fromY: connectingFromPt.y, toX: draftEndPt.x, toY: draftEndPt.y }
    : null;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ cursor: isPanning ? "grabbing" : connectingFromId ? "crosshair" : "default" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      <CanvasBackground zoom={viewport.zoom} viewportX={viewport.x} viewportY={viewport.y} />

      <EdgeRenderer edges={edges} nodes={nodes} viewport={viewport} draftEdge={draftEdge} />

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {nodes.map((node: CanvasNode) => (
          <Node
            key={node.id}
            node={node}
            viewport={viewport}
            isSelected={selectedNodeIds.includes(node.id)}
            isEditing={editingNodeId === node.id}
            isConnecting={connectingFromId !== null && connectingTargetId === node.id}
            onDragStart={handleNodeDragStart}
            onDrag={handleNodeDrag}
            onDragEnd={handleNodeDragEnd}
            onEditStart={handleEditStart}
            onCommit={handleCommit}
            onDiscard={handleDiscard}
            onConnectStart={handleConnectStart}
            onConnectEnd={handleConnectEnd}
          />
        ))}
      </div>
    </div>
  );
};