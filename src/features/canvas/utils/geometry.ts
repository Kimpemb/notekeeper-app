// Geometry utilities for canvas operations

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

// Convert screen coordinates to world coordinates
export function screenToWorld(
  screenX: number,
  screenY: number,
  viewportX: number,
  viewportY: number,
  zoom: number
): Point {
  return {
    x: (screenX - viewportX) / zoom,
    y: (screenY - viewportY) / zoom,
  };
}

// Convert world coordinates to screen coordinates
export function worldToScreen(
  worldX: number,
  worldY: number,
  viewportX: number,
  viewportY: number,
  zoom: number
): Point {
  return {
    x: worldX * zoom + viewportX,
    y: worldY * zoom + viewportY,
  };
}

// Check if point is inside rect
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// Get distance between two points
export function distance(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Clamp a value between min and max
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Get center of a rect
export function rectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

// Create a selection box from drag start to end
export function getSelectionBox(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

// Check if two rects intersect
export function rectIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}