import React, { useState, useCallback, useRef, useEffect } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { CanvasBackground } from "./CanvasBackground";
import { EdgeRenderer } from "../edges/EdgeRenderer";
import { Node } from "../nodes/Node";
import { screenToWorld } from "../utils/geometry";
import type { CanvasNode, NodeId, SelectionRect } from "../../../types/canvas";

const DEFAULT_NODE_WIDTH  = 180;
const DEFAULT_NODE_HEIGHT = 44;

interface CanvasViewportProps {
  noteId:       string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const CanvasViewport: React.FC<CanvasViewportProps> = ({ noteId, containerRef }) => {
  const store      = useCanvasStore();
  const addNode    = useCanvasStore((s) => s.addNode);
  const addEdge    = useCanvasStore((s) => s.addEdge);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const pan        = useCanvasStore((s) => s.pan);
  const zoom       = useCanvasStore((s) => s.zoom);
  const flushDrag  = useCanvasStore((s) => s.flushDrag);

  const nodes           = store.getNodes(noteId);
  const edges           = store.getEdges(noteId);
  const viewport        = store.getViewport(noteId);
  const selectedNodeIds = store.getSelectedNodeIds(noteId);

  const clearSelection = useCallback(
    () => useCanvasStore.getState().clearSelection(noteId), [noteId],
  );
  const selectNodes = useCallback(
    (ids: string[]) => useCanvasStore.getState().selectNodes(noteId, ids), [noteId],
  );

  const [editingNodeId,  setEditingNodeId]  = useState<NodeId | null>(null);
  const [isPanning,      setIsPanning]      = useState(false);
  const [panStart,       setPanStart]       = useState({ x: 0, y: 0 });
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [draggedNodeId,  setDraggedNodeId]  = useState<NodeId | null>(null);
  const dragWorldOrigin  = useRef({ x: 0, y: 0 });
  const dragNodeSnapshot = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodeRefs         = useRef<Map<string, HTMLDivElement>>(new Map());
  const [selectionRect,  setSelectionRect]  = useState<SelectionRect>(null);
  const selectionStart   = useRef({ x: 0, y: 0 });
  const [connectingFromId, setConnectingFromId] = useState<NodeId | null>(null);
  const [connectingFromPt, setConnectingFromPt] = useState({ x: 0, y: 0 });
  const [draftEndPt,       setDraftEndPt]       = useState({ x: 0, y: 0 });
  const hoverTargetId      = useRef<NodeId | null>(null);
  const canvasPointerMoved = useRef(false);
  const dragMoved          = useRef(false);

  // ─── Delete key ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (editingNodeId) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedNodeIds.length === 0) return;
      e.preventDefault();
      selectedNodeIds.forEach((id) => deleteNode(noteId, id));
      clearSelection();
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [editingNodeId, selectedNodeIds, deleteNode, clearSelection, noteId, containerRef]);

  // ─── Scroll to pan + trackpad pinch to zoom ───────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        zoom(noteId, -e.deltaY * 0.8, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        pan(noteId, -e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [containerRef, pan, zoom, noteId]);

  // ─── Touch pinch to zoom (touchscreen devices) ────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastDist = 0;

    const getDistance = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getMidpoint = (touches: TouchList, rect: DOMRect) => ({
      x: ((touches[0].clientX + touches[1].clientX) / 2) - rect.left,
      y: ((touches[0].clientY + touches[1].clientY) / 2) - rect.top,
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        lastDist = getDistance(e.touches);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dist = getDistance(e.touches);
      const mid  = getMidpoint(e.touches, rect);
      const delta = (dist - lastDist) * 0.5;
      zoom(noteId, delta, mid.x, mid.y);
      lastDist = dist;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove",  onTouchMove,  { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove",  onTouchMove);
    };
  }, [containerRef, zoom, noteId]);

  // ─── Hit test ─────────────────────────────────────────────────────────────────
  const hitTestNode = useCallback(
    (screenX: number, screenY: number): NodeId | null => {
      const { x: vx, y: vy, zoom: vz } = viewport;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const nx = n.x * vz + vx;
        const ny = n.y * vz + vy;
        const nw = n.width  * vz;
        const nh = n.height * vz;
        if (screenX >= nx && screenX <= nx + nw && screenY >= ny && screenY <= ny + nh) {
          return n.id;
        }
      }
      return null;
    },
    [nodes, viewport],
  );

  // ─── Double-click on empty canvas → create node ───────────────────────────────
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement) !== e.currentTarget) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const world = screenToWorld(
        e.clientX - rect.left, e.clientY - rect.top,
        viewport.x, viewport.y, viewport.zoom,
      );
      const id = crypto.randomUUID();
      addNode(noteId, {
        id, type: "text", content: "",
        x: world.x - DEFAULT_NODE_WIDTH  / 2,
        y: world.y - DEFAULT_NODE_HEIGHT / 2,
        width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT,
      });
      selectNodes([id]);
      setEditingNodeId(id);
    },
    [containerRef, viewport, addNode, selectNodes, noteId],
  );

  // ─── Pointer down ─────────────────────────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      canvasPointerMoved.current = false;

      if (e.button === 1) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = hitTestNode(sx, sy);

      if (!hit) {
        selectionStart.current = { x: sx, y: sy };
        setSelectionRect({ startX: sx, startY: sy, endX: sx, endY: sy });
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    },
    [containerRef, hitTestNode],
  );

  // ─── Pointer move ─────────────────────────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      canvasPointerMoved.current = true;

      if (connectingFromId) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          setDraftEndPt({ x: sx, y: sy });
          const hit = hitTestNode(sx, sy);
          hoverTargetId.current = hit && hit !== connectingFromId ? hit : null;
        }
      }

      if (isPanning) {
        pan(noteId, e.clientX - panStart.x, e.clientY - panStart.y);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      if (selectionRect) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          setSelectionRect((r) =>
            r ? { ...r, endX: e.clientX - rect.left, endY: e.clientY - rect.top } : r,
          );
        }
      }
    },
    [isPanning, panStart, pan, connectingFromId, containerRef,
     hitTestNode, selectionRect, noteId],
  );

  // ─── Pointer up ───────────────────────────────────────────────────────────────
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setIsPanning(false);

      if (connectingFromId) {
        const toId = hoverTargetId.current;
        if (toId && toId !== connectingFromId) {
          addEdge(noteId, { id: crypto.randomUUID(), from: connectingFromId, to: toId });
        }
        setConnectingFromId(null);
        hoverTargetId.current = null;
        setSelectionRect(null);
        return;
      }

      if (selectionRect && canvasPointerMoved.current) {
        const minX = Math.min(selectionRect.startX, selectionRect.endX);
        const maxX = Math.max(selectionRect.startX, selectionRect.endX);
        const minY = Math.min(selectionRect.startY, selectionRect.endY);
        const maxY = Math.max(selectionRect.startY, selectionRect.endY);
        const { x: vx, y: vy, zoom: vz } = viewport;
        const hit = nodes.filter((n: CanvasNode) => {
          const nx = n.x * vz + vx;
          const ny = n.y * vz + vy;
          const nw = n.width  * vz;
          const nh = n.height * vz;
          return nx < maxX && nx + nw > minX && ny < maxY && ny + nh > minY;
        });
        if (hit.length > 0) selectNodes(hit.map((n) => n.id));
        else clearSelection();
      } else if (!canvasPointerMoved.current && e.button === 0) {
        clearSelection();
        setEditingNodeId(null);
      }

      setSelectionRect(null);
    },
    [connectingFromId, addEdge, selectionRect, viewport, nodes,
     selectNodes, clearSelection, noteId],
  );

  // ─── Node drag start ──────────────────────────────────────────────────────────
  const handleNodeDragStart = useCallback(
    (id: NodeId, e: React.PointerEvent) => {
      dragMoved.current = false;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const idsToMove = selectedNodeIds.includes(id) ? selectedNodeIds : [id];
      if (!selectedNodeIds.includes(id)) selectNodes([id]);
      const snap = new Map<string, { x: number; y: number }>();
      nodes.forEach((n: CanvasNode) => {
        if (idsToMove.includes(n.id)) snap.set(n.id, { x: n.x, y: n.y });
      });
      dragNodeSnapshot.current = snap;
      dragWorldOrigin.current = screenToWorld(
        e.clientX - rect.left, e.clientY - rect.top,
        viewport.x, viewport.y, viewport.zoom,
      );
      setIsDraggingNode(true);
      setDraggedNodeId(id);
      setSelectionRect(null);
    },
    [containerRef, selectedNodeIds, selectNodes, nodes, viewport],
  );

  // ─── Node drag (direct DOM manipulation - no React re-renders) ────────────────
  const handleNodeDrag = useCallback(
    (id: NodeId, e: React.PointerEvent) => {
      if (!isDraggingNode || draggedNodeId !== id) return;
      e.preventDefault();

      dragMoved.current = true;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const world = screenToWorld(
        e.clientX - rect.left, e.clientY - rect.top,
        viewport.x, viewport.y, viewport.zoom,
      );

      const dx = world.x - dragWorldOrigin.current.x;
      const dy = world.y - dragWorldOrigin.current.y;
      const { x: vx, y: vy, zoom: vz } = viewport;

      // Direct DOM manipulation — no React re-renders during drag
      dragNodeSnapshot.current.forEach((pos, nodeId) => {
        const nodeEl = nodeRefs.current.get(nodeId);
        if (nodeEl) {
          const worldX = pos.x + dx;
          const worldY = pos.y + dy;
          const screenX = worldX * vz + vx;
          const screenY = worldY * vz + vy;
          nodeEl.style.transform = `translate(${screenX}px, ${screenY}px)`;
          // Store final world position so drag end can read it
          (nodeEl as any)._dragWorldX = worldX;
          (nodeEl as any)._dragWorldY = worldY;
        }
      });
    },
    [isDraggingNode, draggedNodeId, containerRef, viewport],
  );

  // ─── Node drag end (commit final positions to store + DB) ─────────────────────
  const handleNodeDragEnd = useCallback(() => {
    const updates: { id: string; x: number; y: number }[] = [];

    dragNodeSnapshot.current.forEach((_pos, nodeId) => {
      const nodeEl = nodeRefs.current.get(nodeId);
      if (nodeEl) {
        const draggedX = (nodeEl as any)._dragWorldX;
        const draggedY = (nodeEl as any)._dragWorldY;

        if (draggedX !== undefined && draggedY !== undefined) {
          // Node actually moved — clear the DOM transform and record final position.
          // React will re-render with the committed position immediately after flushDrag.
          nodeEl.style.transform = '';
          delete (nodeEl as any)._dragWorldX;
          delete (nodeEl as any)._dragWorldY;
          updates.push({ id: nodeId, x: draggedX, y: draggedY });
        }
        // If _dragWorldX is undefined the node never moved (pure click).
        // Leave the transform untouched — React's existing transform is correct.
      }
    });

    if (updates.length > 0) {
      // Build the final dragCache entry in one shot from current noteStore state,
      // then call flushDrag which: (1) writes noteStore in-memory, (2) clears dragCache,
      // (3) persists to DB async — zero frames with stale getNodes() data.
      const noteStoreNote = useNoteStore.getState().notes.find((n) => n.id === noteId);
      const currentData = noteStoreNote?.canvas_state
        ? JSON.parse(noteStoreNote.canvas_state)
        : { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

      const finalNodes = currentData.nodes.map((n: any) => {
        const upd = updates.find((u) => u.id === n.id);
        return upd ? { ...n, x: upd.x, y: upd.y } : n;
      });

      useCanvasStore.setState((s) => ({
        dragCache: {
          ...s.dragCache,
          [noteId]: { ...currentData, nodes: finalNodes },
        },
      }));

      flushDrag(noteId);
    }

    setIsDraggingNode(false);
    setDraggedNodeId(null);
    dragNodeSnapshot.current = new Map();
  }, [flushDrag, noteId]);

  // ─── Register node refs ───────────────────────────────────────────────────────
  const registerNodeRef = useCallback((nodeId: string, element: HTMLDivElement | null) => {
    if (element) {
      nodeRefs.current.set(nodeId, element);
    } else {
      nodeRefs.current.delete(nodeId);
    }
  }, []);

  // ─── Edit / commit ────────────────────────────────────────────────────────────
  const handleEditStart = useCallback((id: NodeId) => setEditingNodeId(id), []);
  const handleCommit = useCallback(
    (id: NodeId, content: string, height: number) => {
      updateNode(noteId, id, { content, height });
      setEditingNodeId(null);
    },
    [updateNode, noteId],
  );
  const handleDiscard = useCallback(
    (id: NodeId) => {
      deleteNode(noteId, id);
      setEditingNodeId(null);
      clearSelection();
    },
    [deleteNode, clearSelection, noteId],
  );
  const handleResize = useCallback((_id: NodeId, _height: number) => {}, []);

  // ─── Edge connect ─────────────────────────────────────────────────────────────
  const handleConnectStart = useCallback(
    (id: NodeId, e: React.PointerEvent) => {
      e.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setConnectingFromId(id);
      setConnectingFromPt(pt);
      setDraftEndPt(pt);
      hoverTargetId.current = null;
      containerRef.current?.setPointerCapture(e.pointerId);
    },
    [containerRef],
  );
  const handleConnectEnd = useCallback((_id: NodeId) => {}, []);

  // ─── Derived ──────────────────────────────────────────────────────────────────
  const connectingTargetId = connectingFromId ? hoverTargetId.current : null;
  const draftEdge = connectingFromId
    ? { fromX: connectingFromPt.x, fromY: connectingFromPt.y, toX: draftEndPt.x, toY: draftEndPt.y }
    : null;

  const cursor = isPanning        ? "grabbing"
    : connectingFromId            ? "crosshair"
    : isDraggingNode              ? "grabbing"
    : "default";

  const selBoxStyle: React.CSSProperties | null =
    selectionRect && canvasPointerMoved.current
      ? {
          position:        "absolute",
          left:   Math.min(selectionRect.startX, selectionRect.endX),
          top:    Math.min(selectionRect.startY, selectionRect.endY),
          width:  Math.abs(selectionRect.endX - selectionRect.startX),
          height: Math.abs(selectionRect.endY - selectionRect.startY),
          border: "1px solid rgba(124,58,237,0.6)",
          backgroundColor: "rgba(124,58,237,0.07)",
          borderRadius: 3,
          pointerEvents: "none",
        }
      : null;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ cursor }}
      tabIndex={0}
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
            onResize={handleResize}
            onConnectStart={handleConnectStart}
            onConnectEnd={handleConnectEnd}
            registerRef={registerNodeRef}
          />
        ))}
      </div>

      {selBoxStyle && <div style={selBoxStyle} />}
    </div>
  );
};