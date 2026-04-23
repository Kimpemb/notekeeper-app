// src/features/canvas/engine/renderer.ts

import type { Viewport, CanvasNode } from "@/types/canvas";
import type { World } from "./world";
import type { InputState } from "./inputHandler";
import { getVisibleNodes } from "./world";

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT_FAMILY   = 'ui-sans-serif, system-ui, sans-serif';
const FONT_SIZE     = 14;
const PAD_H         = 10;
const PAD_V         = 8;
const LINE_H        = 1.55;
const CORNER_R      = 8;
const HANDLE_R      = 5;
const MIN_CORNER_R  = 5;

// Static colors (don't depend on dark mode)
const COL_BORDER_SEL  = "#7c3aed";
const COL_BORDER_CON  = "#10b981";
const COL_EDGE        = "rgba(148,163,184,0.45)";
const COL_EDGE_DRAFT  = "rgba(124,58,237,0.7)";
const COL_SEL_FILL    = "rgba(124,58,237,0.07)";
const COL_SEL_BORDER  = "rgba(124,58,237,0.6)";

// ─── Dynamic colors based on dark mode ─────────────────────────────────────────

function getColors() {
  const dark = document.documentElement.classList.contains("dark");
  return {
    BG: dark ? "#1e1e1e" : "#ffffff",
    BORDER:      dark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.12)",
    TEXT:        dark ? "rgba(226,232,240,0.88)"  : "rgba(30,30,30,0.85)",
    PLACEHOLDER: dark ? "rgba(148,163,184,0.35)"  : "rgba(100,100,100,0.35)",
    GRID:        dark ? "rgba(255,255,255,0.04)"  : "rgba(0,0,0,0.06)",
    HANDLE_FILL: dark ? "rgba(255,255,255,0.88)"  : "rgba(255,255,255,0.95)",
  };
}

// ─── Text layout cache ────────────────────────────────────────────────────────
// Keyed by `${nodeId}:${content}:${zoom.toFixed(2)}:${maxW.toFixed(0)}`
// Avoids re-measuring text on every frame when nothing changed.

interface CachedLayout {
  lines: string[];
  fontSize: number;
  lineH: number;
}

const layoutCache = new Map<string, CachedLayout>();
const MAX_CACHE   = 500;

function getCacheKey(id: string, content: string, zoom: number, maxW: number): string {
  return `${id}:${content}:${zoom.toFixed(2)}:${maxW.toFixed(0)}`;
}

function getTextLayout(
  ctx: CanvasRenderingContext2D,
  node: CanvasNode,
  zoom: number,
): CachedLayout {
  const content = node.content ?? "";
  const sw   = node.width * zoom;
  const maxW = sw - PAD_H * 2 * zoom;
  const key  = getCacheKey(node.id, content, zoom, maxW);

  const cached = layoutCache.get(key);
  if (cached) return cached;

  const fontSize = FONT_SIZE * zoom;
  ctx.font       = `${fontSize}px ${FONT_FAMILY}`;

  const words: string[] = content.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const layout: CachedLayout = { lines, fontSize, lineH: fontSize * LINE_H };

  if (layoutCache.size >= MAX_CACHE) {
    const firstKey = layoutCache.keys().next().value;
    if (firstKey !== undefined) layoutCache.delete(firstKey);
  }
  layoutCache.set(key, layout);
  return layout;
}

/** Call when a node's content changes so stale entries don't linger. */
export function invalidateNodeLayout(nodeId: string): void {
  for (const key of layoutCache.keys()) {
    if (key.startsWith(`${nodeId}:`)) layoutCache.delete(key);
  }
}

// ─── Grid (offscreen cache) ───────────────────────────────────────────────────
// The dot grid is redrawn onto an offscreen canvas only when zoom changes,
// then blit onto the main canvas each frame — much cheaper than re-drawing
// hundreds of dots per frame.

interface GridCache {
  zoom:   number;
  dark:   boolean;
  canvas: OffscreenCanvas;
}

let gridCache: GridCache | null = null;

export function invalidateGridCache(): void {
  gridCache = null;
}

function getGridCanvas(zoom: number, width: number, height: number): OffscreenCanvas {
  const spacing = 24 * zoom;
  const colors = getColors();
  const dark = document.documentElement.classList.contains("dark");

  if (
    gridCache &&
    gridCache.dark === dark &&
    Math.abs(gridCache.zoom - zoom) < 0.001 &&
    gridCache.canvas.width  >= width &&
    gridCache.canvas.height >= height
  ) {
    return gridCache.canvas;
  }

  const oc  = new OffscreenCanvas(width, height);
  const oct = oc.getContext("2d")!;

  oct.clearRect(0, 0, width, height);

  if (spacing >= 6) {
    const dotR = Math.max(0.5, zoom * 0.8);
    oct.fillStyle = colors.GRID;
    for (let x = 0; x < width; x += spacing) {
      for (let y = 0; y < height; y += spacing) {
        oct.beginPath();
        oct.arc(x, y, dotR, 0, Math.PI * 2);
        oct.fill();
      }
    }
  }

  gridCache = { zoom, dark, canvas: oc };
  return oc;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

function edgeMidpoints(x: number, y: number, w: number, h: number) {
  return {
    t: [x + w / 2, y]         as [number, number],
    r: [x + w,     y + h / 2] as [number, number],
    b: [x + w / 2, y + h]     as [number, number],
    l: [x,         y + h / 2] as [number, number],
  };
}

function closestHandles(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): { from: [number, number]; to: [number, number] } {
  const aH = edgeMidpoints(ax, ay, aw, ah);
  const bH = edgeMidpoints(bx, by, bw, bh);
  let best = Infinity;
  let from: [number, number] = aH.r;
  let to:   [number, number] = bH.l;
  for (const ap of Object.values(aH)) {
    for (const bp of Object.values(bH)) {
      const d = (ap[0] - bp[0]) ** 2 + (ap[1] - bp[1]) ** 2;
      if (d < best) { best = d; from = ap; to = bp; }
    }
  }
  return { from, to };
}

// ─── Background ───────────────────────────────────────────────────────────────

function drawBackground(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  width: number,
  height: number,
): void {
  const colors = getColors();
  
  ctx.fillStyle = colors.BG;
  ctx.fillRect(0, 0, width, height);

  const spacing = 24 * viewport.zoom;
  if (spacing < 6) return;

  // Blit the pre-rendered grid, offset by viewport pan
  const grid    = getGridCanvas(viewport.zoom, width + Math.ceil(spacing), height + Math.ceil(spacing));
  const offsetX = (((-viewport.x * viewport.zoom) % spacing) + spacing) % spacing;
  const offsetY = (((-viewport.y * viewport.zoom) % spacing) + spacing) % spacing;
  ctx.drawImage(grid, offsetX - spacing, offsetY - spacing);
}

// ─── Edges ────────────────────────────────────────────────────────────────────

function drawEdges(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewport: Viewport,
): void {
  const { x: vx, y: vy, zoom } = viewport;
  ctx.strokeStyle = COL_EDGE;
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([]);

  for (const edge of world.edges) {
    const a = world.nodes.get(edge.from);
    const b = world.nodes.get(edge.to);
    if (!a || !b) continue;

    const ax = a.x * zoom + vx, ay = a.y * zoom + vy;
    const aw = a.width * zoom,  ah = a.height * zoom;
    const bx = b.x * zoom + vx, by = b.y * zoom + vy;
    const bw = b.width * zoom,  bh = b.height * zoom;

    const { from, to } = closestHandles(ax, ay, aw, ah, bx, by, bw, bh);
    const cpx = (from[0] + to[0]) / 2;

    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.bezierCurveTo(cpx, from[1], cpx, to[1], to[0], to[1]);
    ctx.stroke();
  }
}

// ─── Draft edge ───────────────────────────────────────────────────────────────

function drawDraftEdge(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number,   toY: number,
): void {
  ctx.strokeStyle = COL_EDGE_DRAFT;
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([5, 4]);
  const cpx = (fromX + toX) / 2;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.bezierCurveTo(cpx, fromY, cpx, toY, toX, toY);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Nodes ────────────────────────────────────────────────────────────────────

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: CanvasNode,
  viewport: Viewport,
  isSelected: boolean,
  isConnecting: boolean,
  isEditing: boolean,
  showHandles: boolean,
): void {
  const colors = getColors();
  const { x: vx, y: vy, zoom } = viewport;
  const sx = node.x * zoom + vx;
  const sy = node.y * zoom + vy;
  const sw = node.width  * zoom;
  const sh = node.height * zoom;
  const r  = Math.max(MIN_CORNER_R, CORNER_R * zoom);

  // ── Fill ──
  roundRect(ctx, sx, sy, sw, sh, r);
  ctx.fillStyle = colors.BG;
  ctx.fill();

  // ── Selection glow: drawn as a slightly larger rect behind the node ──
  // Much cheaper than shadowBlur — avoids save/restore and GPU compositing
  if (isSelected || isConnecting) {
    const glow = 3;
    roundRect(ctx, sx - glow, sy - glow, sw + glow * 2, sh + glow * 2, r + glow);
    ctx.strokeStyle = isConnecting ? COL_BORDER_CON : COL_BORDER_SEL;
    ctx.lineWidth   = 3;
    ctx.globalAlpha = 0.25;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── Border ──
  roundRect(ctx, sx, sy, sw, sh, r);
  ctx.strokeStyle = isConnecting ? COL_BORDER_CON : isSelected ? COL_BORDER_SEL : colors.BORDER;
  ctx.lineWidth   = isSelected || isConnecting ? 2 : 1;
  ctx.stroke();

  // ── Text (skip if React textarea is active) ──
  if (!isEditing) {
    if (!node.content) {
      const fontSize = FONT_SIZE * zoom;
      ctx.font      = `${fontSize}px ${FONT_FAMILY}`;
      ctx.fillStyle = colors.PLACEHOLDER;
      ctx.fillText("Double-click to edit", sx + PAD_H * zoom, sy + PAD_V * zoom + fontSize);
    } else {
      const layout  = getTextLayout(ctx, node, zoom);
      ctx.font      = `${layout.fontSize}px ${FONT_FAMILY}`;
      ctx.fillStyle = colors.TEXT;

      const startX = sx + PAD_H * zoom;
      let   lineY  = sy + PAD_V * zoom + layout.fontSize;
      const maxY   = sy + sh - PAD_V * zoom;

      for (const line of layout.lines) {
        if (lineY > maxY) break;
        ctx.fillText(line, startX, lineY);
        lineY += layout.lineH;
      }
    }
  }

  // ── Connection handles ──
  if (showHandles) {
    const handles: [number, number][] = [
      [sx + sw / 2, sy],
      [sx + sw,     sy + sh / 2],
      [sx + sw / 2, sy + sh],
      [sx,          sy + sh / 2],
    ];
    ctx.fillStyle   = colors.HANDLE_FILL;
    ctx.strokeStyle = COL_BORDER_SEL;
    ctx.lineWidth   = 2;
    for (const [hx, hy] of handles) {
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
  selectedIds: Set<string>,
  editingId: string | null,
  hoveredId: string | null,
  connectingFromId: string | null,
): void {
  const visible = getVisibleNodes(world, viewport, canvasWidth, canvasHeight);
  for (const node of visible) {
    const isSelected   = selectedIds.has(node.id);
    const isConnecting = connectingFromId !== null && hoveredId === node.id;
    const isEditing    = editingId === node.id;
    const showHandles  = (isSelected || hoveredId === node.id) && !isEditing;
    drawNode(ctx, node, viewport, isSelected, isConnecting, isEditing, showHandles);
  }
}

// ─── Selection rect ───────────────────────────────────────────────────────────

function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  startX: number, startY: number,
  endX: number,   endY: number,
): void {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);
  ctx.fillStyle   = COL_SEL_FILL;
  ctx.strokeStyle = COL_SEL_BORDER;
  ctx.lineWidth   = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
}

// ─── Main draw call ───────────────────────────────────────────────────────────

export type RenderState = {
  world:       World;
  viewport:    Viewport;
  selectedIds: Set<string>;
  editingId:   string | null;
  hoveredId:   string | null;
  inputState:  InputState;
};

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
): void {
  const { world, viewport, selectedIds, editingId, hoveredId, inputState } = state;
  const { width, height } = ctx.canvas;

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, viewport, width, height);
  drawEdges(ctx, world, viewport);
  drawNodes(
    ctx, world, viewport, width, height,
    selectedIds, editingId, hoveredId,
    inputState.type === "connecting" ? inputState.fromId : null,
  );

  if (inputState.type === "selecting") {
    drawSelectionRect(
      ctx,
      inputState.startX,   inputState.startY,
      inputState.currentX, inputState.currentY,
    );
  }

  if (inputState.type === "connecting") {
    drawDraftEdge(
      ctx,
      inputState.fromScreenX, inputState.fromScreenY,
      inputState.currentX,    inputState.currentY,
    );
  }
}