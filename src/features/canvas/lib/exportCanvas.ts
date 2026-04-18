// src/features/canvas/lib/exportCanvas.ts
//
// Four export formats for a canvas note.
// All functions are pure: they receive data, return a Blob or trigger a download.
// No DOM reads of the live canvas — everything is derived from stored data.

import type { CanvasNode, CanvasEdge, Viewport } from "@/types/canvas";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface CanvasExportData {
  noteId:   string;
  title:    string;
  nodes:    CanvasNode[];
  edges:    CanvasEdge[];
  viewport: Viewport;
}

// ─── Utility: trigger a file download ────────────────────────────────────────

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function safeFilename(title: string, ext: string): string {
  return `${title.replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "canvas"}.${ext}`;
}

// ─── Utility: bounding box of all nodes ──────────────────────────────────────

interface BoundingBox {
  minX: number; minY: number;
  maxX: number; maxY: number;
  width: number; height: number;
}

function getBoundingBox(nodes: CanvasNode[], padding = 48): BoundingBox {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };
  }
  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
    width:  (maxX - minX) + padding * 2,
    height: (maxY - minY) + padding * 2,
  };
}

// ─── 1. JSON ──────────────────────────────────────────────────────────────────

export function exportAsJson(data: CanvasExportData): void {
  const payload = {
    version:    1,
    id:         data.noteId,
    title:      data.title,
    exportedAt: new Date().toISOString(),
    nodes:      data.nodes,
    edges:      data.edges,
    viewport:   data.viewport,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  download(blob, safeFilename(data.title, "json"));
}

// ─── 2. PNG ───────────────────────────────────────────────────────────────────
//
// Draws onto an offscreen canvas using Canvas 2D primitives.
// No HTML rendering — works in all environments.

const PNG_SCALE        = 2;       // retina-quality output
const NODE_RADIUS      = 8;
const NODE_BG          = "#1a1b26";
const NODE_BORDER      = "rgba(255,255,255,0.22)";
const NODE_TEXT        = "rgba(226,232,240,0.88)";
const EDGE_COLOR       = "rgba(148,163,184,0.5)";
const CANVAS_BG        = "#13131f";
const FONT_SIZE        = 13;
const PADDING_H        = 10;
const PADDING_V        = 8;
const LINE_HEIGHT      = FONT_SIZE * 1.55;

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(" ");
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    lines.push(current);
  }
  return lines;
}

export async function exportAsPng(data: CanvasExportData): Promise<void> {
  const bb  = getBoundingBox(data.nodes);
  const w   = bb.width  * PNG_SCALE;
  const h   = bb.height * PNG_SCALE;

  const canvas = document.createElement("canvas");
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PNG_SCALE, PNG_SCALE);

  // Background
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, bb.width, bb.height);

  // Subtle dot grid
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  const gridSpacing = 24;
  for (let gx = 0; gx < bb.width; gx += gridSpacing) {
    for (let gy = 0; gy < bb.height; gy += gridSpacing) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Node lookup for edge endpoints
  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  // Edges (drawn below nodes)
  ctx.strokeStyle = EDGE_COLOR;
  ctx.lineWidth   = 1.5;
  for (const edge of data.edges) {
    const from = nodeMap.get(edge.from);
    const to   = nodeMap.get(edge.to);
    if (!from || !to) continue;

    const fx = (from.x + from.width  / 2) - bb.minX;
    const fy = (from.y + from.height / 2) - bb.minY;
    const tx = (to.x   + to.width   / 2) - bb.minX;
    const ty = (to.y   + to.height  / 2) - bb.minY;

    // Simple quadratic bezier for a gentle curve
    const cx = (fx + tx) / 2;
    const cy = (fy + ty) / 2 - Math.abs(tx - fx) * 0.2;

    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(cx, cy, tx, ty);
    ctx.stroke();

    // Arrowhead
    const angle  = Math.atan2(ty - cy, tx - cx);
    const arrowL = 10;
    const arrowA = 0.4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - arrowL * Math.cos(angle - arrowA), ty - arrowL * Math.sin(angle - arrowA));
    ctx.lineTo(tx - arrowL * Math.cos(angle + arrowA), ty - arrowL * Math.sin(angle + arrowA));
    ctx.closePath();
    ctx.fillStyle = EDGE_COLOR;
    ctx.fill();
  }

  // Nodes
  ctx.font = `${FONT_SIZE}px ui-monospace, monospace`;
  for (const node of data.nodes) {
    const nx = node.x - bb.minX;
    const ny = node.y - bb.minY;
    const nw = node.width;
    const nh = node.height;

    // Fill
    ctx.fillStyle = NODE_BG;
    drawRoundedRect(ctx, nx, ny, nw, nh, NODE_RADIUS);
    ctx.fill();

    // Border
    ctx.strokeStyle = NODE_BORDER;
    ctx.lineWidth   = 1;
    drawRoundedRect(ctx, nx, ny, nw, nh, NODE_RADIUS);
    ctx.stroke();

    // Text
    if (node.content) {
      ctx.fillStyle = NODE_TEXT;
      const textMaxW = nw - PADDING_H * 2;
      const lines    = wrapText(ctx, node.content, textMaxW);
      lines.forEach((line, i) => {
        ctx.fillText(line, nx + PADDING_H, ny + PADDING_V + FONT_SIZE + i * LINE_HEIGHT, textMaxW);
      });
    }
  }

  // Resolve as blob then download
  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("PNG export failed")); return; }
      download(blob, safeFilename(data.title, "png"));
      resolve();
    }, "image/png");
  });
}

// ─── 3. Markdown ──────────────────────────────────────────────────────────────
//
// Attempts a topological sort so connected nodes flow naturally.
// Falls back to flat list for graphs with cycles.

function topoSort(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  const nodeMap  = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const adj      = new Map(nodes.map((n) => [n.id, [] as string[]]));

  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue  = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0);
  const sorted: CanvasNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const toId of (adj.get(node.id) ?? [])) {
      const newDeg = (inDegree.get(toId) ?? 1) - 1;
      inDegree.set(toId, newDeg);
      if (newDeg === 0) {
        const toNode = nodeMap.get(toId);
        if (toNode) queue.push(toNode);
      }
    }
  }

  // If cycle detected, fall back to original order
  return sorted.length === nodes.length ? sorted : nodes;
}

export function exportAsMarkdown(data: CanvasExportData): void {
  const sorted   = topoSort(data.nodes, data.edges);
  const nodeMap  = new Map(data.nodes.map((n) => [n.id, n]));
  const lines: string[] = [];

  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(`> Exported from Idemora canvas · ${new Date().toLocaleDateString()}`);
  lines.push("");

  if (sorted.length > 0) {
    lines.push("## Nodes");
    lines.push("");
    for (const node of sorted) {
      const label = node.content ?? node.noteId ?? `(${node.type})`;
      lines.push(`- ${label}`);
    }
    lines.push("");
  }

  if (data.edges.length > 0) {
    lines.push("## Connections");
    lines.push("");
    for (const edge of data.edges) {
      const from = nodeMap.get(edge.from);
      const to   = nodeMap.get(edge.to);
      const fromLabel = from?.content ?? from?.id.slice(0, 8) ?? edge.from;
      const toLabel   = to?.content   ?? to?.id.slice(0, 8)   ?? edge.to;
      lines.push(`- **${fromLabel}** → ${toLabel}`);
    }
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  download(blob, safeFilename(data.title, "md"));
}

// ─── 4. SVG ───────────────────────────────────────────────────────────────────
//
// Self-contained SVG with inline styles. No external dependencies.
// Viewbox is set to the node bounding box for clean rendering at any size.

const SVG_FONT_SIZE   = 13;
const SVG_PADDING_H   = 10;
const SVG_PADDING_V   = 8;
const SVG_LINE_HEIGHT = SVG_FONT_SIZE * 1.55;

function svgEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgWrapText(text: string, maxChars = 26): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const words = raw.split(" ");
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = (current ? current + " " : "") + word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export function exportAsSvg(data: CanvasExportData): void {
  const bb      = getBoundingBox(data.nodes);
  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  const svgParts: string[] = [];

  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `  viewBox="${bb.minX} ${bb.minY} ${bb.width} ${bb.height}"`,
    `  width="${bb.width}" height="${bb.height}"`,
    `  style="background:${CANVAS_BG};font-family:ui-monospace,monospace">`,
  );

  // Background rect
  svgParts.push(
    `  <rect x="${bb.minX}" y="${bb.minY}" width="${bb.width}" height="${bb.height}" fill="${CANVAS_BG}"/>`,
  );

  // Edges
  for (const edge of data.edges) {
    const from = nodeMap.get(edge.from);
    const to   = nodeMap.get(edge.to);
    if (!from || !to) continue;

    const fx = from.x + from.width  / 2;
    const fy = from.y + from.height / 2;
    const tx = to.x   + to.width   / 2;
    const ty = to.y   + to.height  / 2;
    const cx = (fx + tx) / 2;
    const cy = (fy + ty) / 2 - Math.abs(tx - fx) * 0.2;

    svgParts.push(
      `  <path d="M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}"`,
      `    fill="none" stroke="${EDGE_COLOR}" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    );
  }

  // Arrow marker def (output once)
  svgParts.unshift(
    `  <defs>`,
    `    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">`,
    `      <path d="M0,0 L0,6 L8,3 z" fill="${EDGE_COLOR}"/>`,
    `    </marker>`,
    `  </defs>`,
  );

  // Nodes
  for (const node of data.nodes) {
    const textLines = node.content ? svgWrapText(node.content) : [];
    const nodeH     = Math.max(
      node.height,
      SVG_PADDING_V * 2 + SVG_FONT_SIZE + textLines.length * SVG_LINE_HEIGHT,
    );

    svgParts.push(
      `  <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${nodeH}"`,
      `    rx="${NODE_RADIUS}" ry="${NODE_RADIUS}"`,
      `    fill="${NODE_BG}" stroke="${NODE_BORDER}" stroke-width="1"/>`,
    );

    textLines.forEach((line, i) => {
      const ty = node.y + SVG_PADDING_V + SVG_FONT_SIZE + i * SVG_LINE_HEIGHT;
      svgParts.push(
        `  <text x="${node.x + SVG_PADDING_H}" y="${ty}"`,
        `    font-size="${SVG_FONT_SIZE}" fill="${NODE_TEXT}"`,
        `    dominant-baseline="auto">${svgEscape(line)}</text>`,
      );
    });
  }

  svgParts.push(`</svg>`);

  const blob = new Blob([svgParts.join("\n")], { type: "image/svg+xml" });
  download(blob, safeFilename(data.title, "svg"));
}