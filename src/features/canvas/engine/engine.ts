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
import { invalidateNodeLayout } from "./renderer";
import type { RenderState } from "./renderer";
import { InputHandler } from "./inputHandler";
import type { InputCallbacks } from "./inputHandler";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

export type EngineCallbacks = {
  onNodeEditStart:  (id: string | null) => void;
  onWorldChanged:   () => void;
  onViewportChanged:(vp: Viewport) => void;
};

const DEFAULT_VIEWPORT: Viewport  = { x: 0, y: 0, zoom: 0.6 };
const PERSIST_WORLD_MS            = 400;  // debounce for node/edge changes
const PERSIST_VIEWPORT_MS         = 1000; // debounce for viewport — much less urgent

export class CanvasEngine {
  private noteId:   string;
  private ctx:      CanvasRenderingContext2D | null = null;
  private rafId:    number | null = null;
  private observer: ResizeObserver | null = null;
  private paused:   boolean = false;

  private world:    World;
  private viewport: Viewport;

  private input:     InputHandler;
  private callbacks: EngineCallbacks;

  // Dirty flag — only draw when something changed
  private dirty: boolean = true;

  // Separate debounce timers for world vs viewport
  private worldPersistTimer:    ReturnType<typeof setTimeout> | null = null;
  private viewportPersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(noteId: string, callbacks: EngineCallbacks) {
    this.noteId    = noteId;
    this.callbacks = callbacks;

    const note = useNoteStore.getState().notes.find((n) => n.id === noteId);
    if (note?.canvas_state) {
      const { world, viewport } = worldFromJSON(note.canvas_state);
      this.world    = world;
      this.viewport = viewport;
    } else {
      this.world    = createWorld();
      this.viewport = { ...DEFAULT_VIEWPORT };
    }

    const inputCallbacks: InputCallbacks = {
      onViewportChange:   (vp) => this.applyViewport(vp),
      onSelectionChange:  (_ids) => { this.markDirty(); },
      onNodesMoved:       (_moves) => { this.markDirty(); this.scheduleWorldPersist(); },
      onNodeEditStart:    (id) => callbacks.onNodeEditStart(id || null),
      onNodeDelete:       (_ids) => { this.markDirty(); this.scheduleWorldPersist(); },
      onConnected:        (_f, _t) => { this.markDirty(); this.scheduleWorldPersist(); },
      onInputStateChange: (_s) => { this.markDirty(); },
      onHoverChange:      (_id) => { this.markDirty(); },
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
    this.ctx         = canvas.getContext("2d")!;
    canvas.tabIndex  = 0;
    this.paused      = false;
    this.dirty       = true;

    this.input.mount(canvas);
    this.setupResizeObserver(canvas);
    this.startLoop();
  }

  unmount(): void {
    this.stopLoop();
    this.observer?.disconnect();
    this.input.unmount();
    if (this.worldPersistTimer)    clearTimeout(this.worldPersistTimer);
    if (this.viewportPersistTimer) clearTimeout(this.viewportPersistTimer);
    this.ctx = null;
  }

  /** Pause rendering when the canvas tab is hidden. */
  pause(): void  { this.paused = true; }

  /** Resume rendering when the canvas tab becomes visible again. */
  resume(): void { this.paused = false; this.markDirty(); }

  // ─── Dirty flag ─────────────────────────────────────────────────────────────

  private markDirty(): void {
    this.dirty = true;
  }

  // ─── Engine API ──────────────────────────────────────────────────────────────

  addNode(node: CanvasNode): void {
    addNode(this.world, node);
    this.markDirty();
    this.scheduleWorldPersist();
  }

  removeNode(id: string): void {
    removeNode(this.world, id);
    invalidateNodeLayout(id);
    this.input.setSelectedIds(
      [...this.input.getSelectedIds()].filter((sid) => sid !== id),
    );
    this.markDirty();
    this.scheduleWorldPersist();
  }

  updateNode(id: string, updates: Partial<CanvasNode>): void {
    updateNode(this.world, id, updates);
    if (updates.content !== undefined) invalidateNodeLayout(id);
    this.markDirty();
    this.scheduleWorldPersist();
  }

  moveNode(id: string, x: number, y: number): void {
    moveNode(this.world, id, x, y);
    this.markDirty();
    this.scheduleWorldPersist();
  }

  connect(fromId: string, toId: string): void {
    connect(this.world, { id: crypto.randomUUID(), from: fromId, to: toId });
    this.markDirty();
    this.scheduleWorldPersist();
  }

  removeEdge(id: string): void {
    removeEdge(this.world, id);
    this.markDirty();
    this.scheduleWorldPersist();
  }

  commitNodeEdit(id: string, content: string, height: number): void {
    updateNode(this.world, id, { content, height });
    invalidateNodeLayout(id);
    this.input.setEditingId(null);
    this.callbacks.onNodeEditStart(null);
    this.markDirty();
    this.scheduleWorldPersist();
  }

  discardNodeEdit(id: string): void {
    const node = this.world.nodes.get(id);
    if (!node?.content?.trim()) {
      removeNode(this.world, id);
      invalidateNodeLayout(id);
      this.input.clearSelection();
    }
    this.input.setEditingId(null);
    this.callbacks.onNodeEditStart(null);
    this.markDirty();
    this.scheduleWorldPersist();
  }

  selectNodes(ids: string[]): void  { this.input.setSelectedIds(ids); this.markDirty(); }
  clearSelection(): void            { this.input.clearSelection();     this.markDirty(); }
  setViewport(vp: Viewport): void   { this.applyViewport(vp); }

  // ─── Read API ────────────────────────────────────────────────────────────────

  getWorld():       World            { return this.world; }
  getViewport():    Viewport         { return this.viewport; }
  getEditingId():   string | null    { return this.input.getEditingId(); }
  getSelectedIds(): Set<string>      { return this.input.getSelectedIds(); }

  getEditingNode(): CanvasNode | null {
    const id = this.input.getEditingId();
    return id ? (this.world.nodes.get(id) ?? null) : null;
  }

  // ─── rAF loop — only draws when dirty ────────────────────────────────────────

  private startLoop(): void {
    const loop = () => {
      if (!this.paused && this.dirty) {
        this.render();
        this.dirty = false;
      }
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
    this.markDirty();
    // Only notify React when editing (textarea needs repositioning)
    if (this.input.getEditingId()) {
      this.callbacks.onViewportChanged(vp);
    }
    this.scheduleViewportPersist();
  }

  // ─── Node creation ───────────────────────────────────────────────────────────

  private createNodeAtScreen(screenX: number, screenY: number): void {
    const world = screenToWorld(screenX, screenY, this.viewport);
    const id    = crypto.randomUUID();
    const node: CanvasNode = {
      id,
      type:    "text",
      content: "",
      x:       world.x - 90,
      y:       world.y - 22,
      width:   180,
      height:  44,
    };
    addNode(this.world, node);
    this.input.setSelectedIds([id]);
    this.input.setEditingId(id);
    this.callbacks.onNodeEditStart(id);
    this.markDirty();
    this.scheduleWorldPersist();
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
          this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        this.markDirty();
      }
    });
    this.observer.observe(canvas);
  }

  // ─── Persistence — world and viewport on separate timers ─────────────────────

  private scheduleWorldPersist(): void {
    if (this.worldPersistTimer) clearTimeout(this.worldPersistTimer);
    this.worldPersistTimer = setTimeout(() => this.flushWorld(), PERSIST_WORLD_MS);
  }

  private scheduleViewportPersist(): void {
    if (this.viewportPersistTimer) clearTimeout(this.viewportPersistTimer);
    this.viewportPersistTimer = setTimeout(() => this.flushViewport(), PERSIST_VIEWPORT_MS);
  }

  private flushWorld(): void {
    const json = worldToJSON(this.world, this.viewport);
    useNoteStore.getState().updateCanvasStateInMemory(this.noteId, json);
    useNoteStore.getState().updateCanvasState(this.noteId, json).catch(console.error);
    this.callbacks.onWorldChanged();
  }

  private flushViewport(): void {
    // Only persist viewport — no need to call onWorldChanged for a pan
    const json = worldToJSON(this.world, this.viewport);
    useNoteStore.getState().updateCanvasState(this.noteId, json).catch(console.error);
  }

  // ─── Handle detection ────────────────────────────────────────────────────────

  getHandleAtScreen(screenX: number, screenY: number): { nodeId: string; handleIndex: number } | null {
    const { zoom, x: vx, y: vy } = this.viewport;
    const HANDLE_R_HIT = 8;

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
        if (dx * dx + dy * dy <= HANDLE_R_HIT * HANDLE_R_HIT) {
          return { nodeId: node.id, handleIndex: i };
        }
      }
    }
    return null;
  }

  startConnecting(nodeId: string, screenX: number, screenY: number): void {
    this.input.startConnecting(nodeId, screenX, screenY);
    this.markDirty();
  }

  loadWorld(world: World, viewport: Viewport): void {
  this.world    = world;
  this.viewport = viewport;
  this.input.updateWorld(world);
  this.markDirty();
}
}