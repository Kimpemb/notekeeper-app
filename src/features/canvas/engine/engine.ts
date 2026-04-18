// src/features/canvas/engine/engine.ts

import type { Viewport, CanvasNode } from "@/types/canvas";
import {
  createWorld,
  worldToJSON,
  worldFromJSON,
  addNode,
  removeNode,
  updateNode,
  moveNode,
  connect,
  removeEdge,
  screenToWorld,
} from "./world";
import type { World } from "./world";
import { drawFrame } from "./renderer";
import type { RenderState } from "./renderer";
import { InputHandler } from "./inputHandler";
import type { InputCallbacks } from "./inputHandler";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EngineCallbacks = {
  /** React needs to mount a textarea for this node */
  onNodeEditStart: (id: string | null) => void;
  /** World changed — persist debounced */
  onWorldChanged: () => void;
  /** Viewport changed — React may need to rerender chrome */
  onViewportChanged: (vp: Viewport) => void;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 0.6 };
const PERSIST_DEBOUNCE_MS = 300;

// ─── CanvasEngine ─────────────────────────────────────────────────────────────

export class CanvasEngine {
  private noteId:   string;
  private ctx:      CanvasRenderingContext2D | null = null;
  private rafId:    number | null = null;
  private observer: ResizeObserver | null = null;

  // Core state — plain objects, never React state
  private world:    World;
  private viewport: Viewport;

  // Sub-systems
  private input:     InputHandler;
  private callbacks: EngineCallbacks;

  // Persistence
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(noteId: string, callbacks: EngineCallbacks) {
    this.noteId    = noteId;
    this.callbacks = callbacks;

    // Load initial state from noteStore
    const note = useNoteStore.getState().notes.find((n) => n.id === noteId);
    if (note?.canvas_state) {
      const { world, viewport } = worldFromJSON(note.canvas_state);
      this.world    = world;
      this.viewport = viewport;
    } else {
      this.world    = createWorld();
      this.viewport = { ...DEFAULT_VIEWPORT };
    }

    // Input handler — viewport getter always reads live
    const inputCallbacks: InputCallbacks = {
      onViewportChange:   (vp) => this.applyViewport(vp),
      onSelectionChange:  (_ids) => { /* inputHandler owns selectedIds */ },
      onNodesMoved:       (_moves) => this.schedulePersist(),
      onNodeEditStart:    (id) => callbacks.onNodeEditStart(id || null),
      onNodeDelete:       (_ids) => this.schedulePersist(),
      onConnected:        (_f, _t) => this.schedulePersist(),
      onInputStateChange: (_s) => { /* renderer reads inputHandler directly */ },
      onHoverChange:      (_id) => { /* renderer reads inputHandler directly */ },
      onCreateNode:       (sx, sy) => this.createNodeAtScreen(sx, sy),
    };

    this.input = new InputHandler(
      this.world,
      () => this.viewport,
      inputCallbacks,
    );
  }

  // ─── Mount / unmount ────────────────────────────────────────────────────────

  mount(canvas: HTMLCanvasElement): void {
    this.ctx    = canvas.getContext("2d")!;
    canvas.tabIndex = 0; // make focusable for keydown

    this.input.mount(canvas);
    this.setupResizeObserver(canvas);
    this.startLoop();
  }

  unmount(): void {
    this.stopLoop();
    this.observer?.disconnect();
    this.input.unmount();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.ctx    = null;
  }

  // ─── Engine API (use these — never mutate world directly from outside) ───────

  addNode(node: CanvasNode): void {
    addNode(this.world, node);
    this.schedulePersist();
  }

  removeNode(id: string): void {
    removeNode(this.world, id);
    this.input.setSelectedIds(
      [...this.input.getSelectedIds()].filter((sid) => sid !== id),
    );
    this.schedulePersist();
  }

  updateNode(id: string, updates: Partial<CanvasNode>): void {
    updateNode(this.world, id, updates);
    this.schedulePersist();
  }

  moveNode(id: string, x: number, y: number): void {
    moveNode(this.world, id, x, y);
    this.schedulePersist();
  }

  connect(fromId: string, toId: string): void {
    connect(this.world, { id: crypto.randomUUID(), from: fromId, to: toId });
    this.schedulePersist();
  }

  removeEdge(id: string): void {
    removeEdge(this.world, id);
    this.schedulePersist();
  }

  commitNodeEdit(id: string, content: string, height: number): void {
    updateNode(this.world, id, { content, height });
    this.input.setEditingId(null);
    this.callbacks.onNodeEditStart(null);
    this.schedulePersist();
  }

  discardNodeEdit(id: string): void {
    // If node has no content it was just created — remove it
    const node = this.world.nodes.get(id);
    if (!node?.content?.trim()) {
      removeNode(this.world, id);
      this.input.clearSelection();
    }
    this.input.setEditingId(null);
    this.callbacks.onNodeEditStart(null);
    this.schedulePersist();
  }

  selectNodes(ids: string[]): void {
    this.input.setSelectedIds(ids);
  }

  clearSelection(): void {
    this.input.clearSelection();
  }

  setViewport(vp: Viewport): void {
    this.applyViewport(vp);
  }

  // ─── Read API ────────────────────────────────────────────────────────────────

  getWorld():      World    { return this.world; }
  getViewport():   Viewport { return this.viewport; }
  getEditingId():  string | null { return this.input.getEditingId(); }
  getSelectedIds(): Set<string>  { return this.input.getSelectedIds(); }

  getEditingNode(): CanvasNode | null {
    const id = this.input.getEditingId();
    return id ? (this.world.nodes.get(id) ?? null) : null;
  }

  // ─── rAF loop ────────────────────────────────────────────────────────────────

  private startLoop(): void {
    const loop = () => {
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.ctx) return;
    const state: RenderState = {
      world:       this.world,
      viewport:    this.viewport,
      selectedIds: this.input.getSelectedIds(),
      editingId:   this.input.getEditingId(),
      hoveredId:   this.input.getHoveredId(),
      inputState:  this.input.getInputState(),
    };
    drawFrame(this.ctx, state);
  }

  // ─── Viewport ────────────────────────────────────────────────────────────────

  private applyViewport(vp: Viewport): void {
    this.viewport = vp;
    this.callbacks.onViewportChanged(vp);
    this.schedulePersist();
  }

  // ─── Node creation from double-click ─────────────────────────────────────────

  private createNodeAtScreen(screenX: number, screenY: number): void {
    const world = screenToWorld(screenX, screenY, this.viewport);
    const id    = crypto.randomUUID();
    const node: CanvasNode = {
      id,
      type:    "text",
      content: "",
      x:       world.x - 90,  // center the default 180px node
      y:       world.y - 22,  // center the default 44px node
      width:   180,
      height:  44,
    };
    addNode(this.world, node);
    this.input.setSelectedIds([id]);
    this.input.setEditingId(id);
    this.callbacks.onNodeEditStart(id);
    this.schedulePersist();
  }

  // ─── Resize observer ─────────────────────────────────────────────────────────

  private setupResizeObserver(canvas: HTMLCanvasElement): void {
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio ?? 1;
        canvas.width  = Math.floor(width  * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width  = `${width}px`;
        canvas.style.height = `${height}px`;
        if (this.ctx) {
          // Reset to identity first — never stack scale calls
          this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }
    });
    this.observer.observe(canvas);
  }

  // ─── Persistence ─────────────────────────────────────────────────────────────

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  private flush(): void {
    const json = worldToJSON(this.world, this.viewport);
    // In-memory sync
    useNoteStore.getState().updateCanvasStateInMemory(this.noteId, json);
    // Async DB write
    useNoteStore.getState().updateCanvasState(this.noteId, json).catch(console.error);
    this.callbacks.onWorldChanged();
  }

  // ─── Handle click detection (called from CanvasViewport for handle hits) ─────

  getHandleAtScreen(screenX: number, screenY: number): { nodeId: string; handleIndex: number } | null {
    const { zoom, x: vx, y: vy } = this.viewport;
    const HANDLE_R_HIT = 8; // slightly larger than drawn for easier clicking

    for (const node of this.world.nodes.values()) {
      const sx = node.x * zoom + vx;
      const sy = node.y * zoom + vy;
      const sw = node.width  * zoom;
      const sh = node.height * zoom;

      const handles: [number, number][] = [
        [sx + sw / 2, sy],
        [sx + sw,     sy + sh / 2],
        [sx + sw / 2, sy + sh],
        [sx,          sy + sh / 2],
      ];

      for (let i = 0; i < handles.length; i++) {
        const [hx, hy] = handles[i];
        const dx = screenX - hx;
        const dy = screenY - hy;
        if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_R_HIT) {
          return { nodeId: node.id, handleIndex: i };
        }
      }
    }
    return null;
  }

  startConnecting(nodeId: string, screenX: number, screenY: number): void {
    this.input.startConnecting(nodeId, screenX, screenY);
  }
}