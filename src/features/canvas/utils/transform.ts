// Transform utilities for canvas rendering

export type Transform = {
  x: number;
  y: number;
  zoom: number;
};

// Get CSS transform string for a node
export function getNodeTransform(x: number, y: number, zoom: number): string {
  return `translate(${x * zoom}px, ${y * zoom}px)`;
}

// Get CSS transform for viewport
export function getViewportTransform(x: number, y: number, zoom: number): string {
  return `translate(${x}px, ${y}px) scale(${zoom})`;
}

// Get inverse transform for screen-to-world calculations
export function getInverseTransform(transform: Transform): Transform {
  return {
    x: -transform.x / transform.zoom,
    y: -transform.y / transform.zoom,
    zoom: 1 / transform.zoom,
  };
}

// Snap a value to grid
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

// Calculate zoom level from delta
export function calculateZoom(currentZoom: number, delta: number, min = 0.1, max = 4): number {
  let newZoom = currentZoom * (1 - delta * 0.01);
  newZoom = Math.min(Math.max(newZoom, min), max);
  return newZoom;
}