// src/features/canvas/engine/renderer.ts

import type { Viewport, CanvasNode } from "@/types/canvas";
import type { World } from "./world";
import type { InputState } from "./inputHandler";
import { getVisibleNodes } from "./world";

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT_FAMILY  = 'ui-sans-serif, system-ui, sans-serif';
const FONT_SIZE    = 14;   // world-space px
const PAD_H        = 10;   // world-space px
const PAD_V        = 8;    // world-space px
const LINE_H       = 1.55;
const CORNER_R     = 8;    // world-space px
const HANDLE_R     = 5;    // screen-space px (always same size regardless of zoom)
const MIN_CORNER_R = 5;    // screen-space minimum

// Colours
const COL_BG         = "#1a1b26";
const COL_BORDER     = "rgba(255,255,255,0.22)";
const COL_BORDER_SEL = "#7c3aed";
const COL_BORDER_CON = "#10b981";
const COL_TEXT       = "rgba(226,232,240,0.88)";
const COL_PLACEHOLDER= "rgba(148,163,184,0.35)";
const COL_SHADOW     = "rgba(0,0,0,0.25)";
const COL_SHADOW_SEL = "rgba(124,58,237,0.15)";
const COL_SHADOW_CON = "rgba(16,185,129,0.2)";
const COL_EDGE       = "rgba(148,163,184,0.45)";
const COL_EDGE_DRAFT = "rgba(124,58,237,0.7)";
const COL_SEL_FILL   = "rgba(124,58,237,0.07)";
const COL_SEL_BORDER = "rgba(124,58,237,0.6)";
const COL_GRID       = "rgba(255,255,255,0.04)";
const COL_HANDLE_FILL= "rgba(255,255,255,0.88)";

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

function edgeMidpoints(
  x: number, y: number, w: number, h: number,
): { t: [number,number]; r: [number,number]; b: [number,number]; l: [number,number] } {
  return {
    t: [x + w / 2, y],
    r: [x + w,     y + h / 2],
    b: [x + w / 2, y + h],
    l: [x,         y + h / 2],
  };
}

function closestHandles(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): { from: [number,number]; to: [number,number] } {
  const aH = edgeMidpoints(ax, ay, aw, ah);
  const bH = edgeMidpoints(bx, by, bw, bh);
  let best = Infinity;
  let from: [number,number] = aH.r;
  let to:   [number,number] = bH.l;
  for (const ap of Object.values(aH) as [number,number][]) {
    for (const bp of Object.values(bH) as [number,number][]) {
      const d = (ap[0]-bp[0])**2 + (ap[1]-bp[1])**2;
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
  ctx.fillStyle = COL_BG;
  ctx.fillRect(0, 0, width, height);

  const spacing = 24 * viewport.zoom;
  if (spacing < 6) return; // too dense to draw

  const offsetX = ((viewport.x % spacing) + spacing) % spacing;
  const offsetY = ((viewport.y % spacing) + spacing) % spacing;

  ctx.fillStyle = COL_GRID;
  const dotR = Math.max(0.5, viewport.zoom * 0.8);

  for (let x = offsetX; x < width; x += spacing) {
    for (let y = offsetY; y < height; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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

// ─── Draft edge (while connecting) ───────────────────────────────────────────

function drawDraftEdge(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX:   number, toY:   number,
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
  const { x: vx, y: vy, zoom } = viewport;
  const sx = node.x * zoom + vx;
  const sy = node.y * zoom + vy;
  const sw = node.width  * zoom;
  const sh = node.height * zoom;
  const r  = Math.max(MIN_CORNER_R, CORNER_R * zoom);

  // ── Shadow ──
  ctx.save();
  ctx.shadowColor   = isConnecting ? COL_SHADOW_CON : isSelected ? COL_SHADOW_SEL : COL_SHADOW;
  ctx.shadowBlur    = isSelected || isConnecting ? 16 : 10;
  ctx.shadowOffsetY = 2;

  // ── Fill ──
  roundRect(ctx, sx, sy, sw, sh, r);
  ctx.fillStyle = COL_BG;
  ctx.fill();
  ctx.restore();

  // ── Border ──
  roundRect(ctx, sx, sy, sw, sh, r);
  ctx.strokeStyle = isConnecting ? COL_BORDER_CON : isSelected ? COL_BORDER_SEL : COL_BORDER;
  ctx.lineWidth   = isSelected || isConnecting ? 2 : 1;
  ctx.stroke();

  // ── Text (skip if React textarea is active) ──
  if (!isEditing) {
    const fontSize = FONT_SIZE * zoom;
    ctx.font      = `${fontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = node.content ? COL_TEXT : COL_PLACEHOLDER;

    const text    = node.content || "Double-click to edit";
    const maxW    = sw - PAD_H * 2 * zoom;
    const lineH   = fontSize * LINE_H;
    const startX  = sx + PAD_H * zoom;
    const startY  = sy + PAD_V * zoom + fontSize;

    // Simple word-wrap
    const words = text.split(" ");
    let line  = "";
    let lineY = startY;

    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, startX, lineY);
        line  = word;
        lineY += lineH;
        if (lineY > sy + sh - PAD_V * zoom) break; // clip overflow
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, startX, lineY);
  }

  // ── Connection handles ──
  if (showHandles) {
    const handles: [number, number][] = [
      [sx + sw / 2, sy],
      [sx + sw,     sy + sh / 2],
      [sx + sw / 2, sy + sh],
      [sx,          sy + sh / 2],
    ];
    for (const [hx, hy] of handles) {
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle   = COL_HANDLE_FILL;
      ctx.fill();
      ctx.strokeStyle = COL_BORDER_SEL;
      ctx.lineWidth   = 2;
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
  endX:   number, endY:   number,
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
  world:           World;
  viewport:        Viewport;
  selectedIds:     Set<string>;
  editingId:       string | null;
  hoveredId:       string | null;
  inputState:      InputState;
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
      inputState.startX, inputState.startY,
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