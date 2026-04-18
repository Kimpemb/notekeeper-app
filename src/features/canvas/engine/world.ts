// src/features/canvas/engine/world.ts

import type { CanvasNode, CanvasEdge, Viewport, NodeId, EdgeId } from "@/types/canvas";

// ─── Types ────────────────────────────────────────────────────────────────────

export type World = {
  nodes: Map<string, CanvasNode>;
  edges: CanvasEdge[];
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createWorld(
  nodes: CanvasNode[] = [],
  edges: CanvasEdge[] = [],
): World {
  return {
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
  };
}

// ─── Serialise / deserialise ──────────────────────────────────────────────────

export function worldToJSON(world: World, viewport: Viewport): string {
  return JSON.stringify({
    nodes:    [...world.nodes.values()],
    edges:    world.edges,
    viewport,
  });
}

export function worldFromJSON(json: string): { world: World; viewport: Viewport } {
  const parsed = JSON.parse(json);
  return {
    world:    createWorld(parsed.nodes ?? [], parsed.edges ?? []),
    viewport: parsed.viewport ?? { x: 0, y: 0, zoom: 0.6 },
  };
}

// ─── Node mutations ───────────────────────────────────────────────────────────

export function addNode(world: World, node: CanvasNode): void {
  world.nodes.set(node.id, node);
}

export function removeNode(world: World, id: NodeId): void {
  world.nodes.delete(id);
  // also remove all edges touching this node
  world.edges = world.edges.filter((e) => e.from !== id && e.to !== id);
}

export function updateNode(world: World, id: NodeId, updates: Partial<CanvasNode>): void {
  const node = world.nodes.get(id);
  if (!node) return;
  world.nodes.set(id, { ...node, ...updates });
}

export function moveNode(world: World, id: NodeId, x: number, y: number): void {
  const node = world.nodes.get(id);
  if (!node) return;
  world.nodes.set(id, { ...node, x, y });
}

export function moveNodes(world: World, ids: NodeId[], dx: number, dy: number): void {
  for (const id of ids) {
    const node = world.nodes.get(id);
    if (!node) continue;
    world.nodes.set(id, { ...node, x: node.x + dx, y: node.y + dy });
  }
}

// ─── Edge mutations ───────────────────────────────────────────────────────────

export function connect(world: World, edge: CanvasEdge): void {
  // prevent duplicate edges between the same pair
  const exists = world.edges.some(
    (e) => e.from === edge.from && e.to === edge.to,
  );
  if (!exists) world.edges.push(edge);
}

export function removeEdge(world: World, id: EdgeId): void {
  world.edges = world.edges.filter((e) => e.id !== id);
}

// ─── Hit testing ──────────────────────────────────────────────────────────────

/**
 * Returns the topmost node id whose screen-space bounding box contains
 * (screenX, screenY), or null if none.
 * Iterates in reverse insertion order so later-added nodes are on top.
 */
export function hitTest(
  world: World,
  screenX: number,
  screenY: number,
  viewport: Viewport,
): NodeId | null {
  const { x: vx, y: vy, zoom } = viewport;
  const nodes = [...world.nodes.values()];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n  = nodes[i];
    const nx = n.x * zoom + vx;
    const ny = n.y * zoom + vy;
    const nw = n.width  * zoom;
    const nh = n.height * zoom;
    if (screenX >= nx && screenX <= nx + nw && screenY >= ny && screenY <= ny + nh) {
      return n.id;
    }
  }
  return null;
}

/**
 * Returns all node ids whose screen-space bounding boxes intersect the
 * given screen-space rectangle. Used for rubber-band multi-select.
 */
export function hitTestRect(
  world: World,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  viewport: Viewport,
): NodeId[] {
  const { x: vx, y: vy, zoom } = viewport;
  const result: NodeId[] = [];
  for (const n of world.nodes.values()) {
    const nx = n.x * zoom + vx;
    const ny = n.y * zoom + vy;
    const nw = n.width  * zoom;
    const nh = n.height * zoom;
    if (nx < maxX && nx + nw > minX && ny < maxY && ny + nh > minY) {
      result.push(n.id);
    }
  }
  return result;
}

/**
 * Returns nodes that are visible within the canvas dimensions.
 * Pass canvas width/height in screen pixels.
 * Used by the renderer to skip culled nodes.
 */
export function getVisibleNodes(
  world: World,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): CanvasNode[] {
  const { x: vx, y: vy, zoom } = viewport;
  const result: CanvasNode[] = [];
  for (const n of world.nodes.values()) {
    const nx = n.x * zoom + vx;
    const ny = n.y * zoom + vy;
    const nw = n.width  * zoom;
    const nh = n.height * zoom;
    if (nx + nw > 0 && nx < canvasWidth && ny + nh > 0 && ny < canvasHeight) {
      result.push(n);
    }
  }
  return result;
}

// ─── Viewport helpers ─────────────────────────────────────────────────────────

/**
 * Convert screen-space (sx, sy) to world-space coordinates.
 */
export function screenToWorld(
  sx: number,
  sy: number,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (sx - viewport.x) / viewport.zoom,
    y: (sy - viewport.y) / viewport.zoom,
  };
}

/**
 * Return a new viewport panned by (dx, dy) screen pixels.
 */
export function panViewport(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

/**
 * Return a new viewport zoomed by `delta` with the zoom origin at
 * (originX, originY) in screen space. Clamps zoom between 0.1 and 3.
 */
export function zoomViewport(
  viewport: Viewport,
  delta: number,
  originX: number,
  originY: number,
): Viewport {
  const factor   = delta > 0 ? 1.08 : 0.92;
  const newZoom  = Math.min(Math.max(viewport.zoom * factor, 0.1), 3);
  const ratio    = newZoom / viewport.zoom;
  return {
    x:    originX - (originX - viewport.x) * ratio,
    y:    originY - (originY - viewport.y) * ratio,
    zoom: newZoom,
  };
}