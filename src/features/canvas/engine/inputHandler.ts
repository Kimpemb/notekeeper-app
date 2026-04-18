// src/features/canvas/engine/inputHandler.ts

import type { Viewport, NodeId } from "@/types/canvas";
import type { World } from "./world";
import {
  hitTest,
  hitTestRect,
  screenToWorld,
  panViewport,
  zoomViewport,
  connect,
  removeNode,
} from "./world";

// ─── InputState ───────────────────────────────────────────────────────────────

export type InputState =
  | { type: "idle" }
  | {
      type:     "dragging";
      nodeIds:  string[];
      originX:  number; // world-space origin at drag start
      originY:  number;
      snapshot: Map<string, { x: number; y: number }>; // world positions at drag start
    }
  | {
      type:   "panning";
      startX: number; // screen-space
      startY: number;
    }
  | {
      type:     "selecting";
      startX:   number; // screen-space
      startY:   number;
      currentX: number;
      currentY: number;
    }
  | {
      type:        "connecting";
      fromId:      string;
      fromScreenX: number;
      fromScreenY: number;
      currentX:    number;
      currentY:    number;
    };

// ─── Callbacks out to the engine / React boundary ────────────────────────────

export type InputCallbacks = {
  onViewportChange:  (viewport: Viewport) => void;
  onSelectionChange: (ids: string[]) => void;
  onNodesMoved:      (moves: { id: string; x: number; y: number }[]) => void;
  onNodeEditStart:   (id: string) => void;
  onNodeDelete:      (ids: string[]) => void;
  onConnected:       (fromId: string, toId: string) => void;
  onInputStateChange:(state: InputState) => void;
  onHoverChange:     (id: string | null) => void;
  onCreateNode:      (screenX: number, screenY: number) => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAG_THRESHOLD = 4; // px screen-space before drag is recognised

// ─── InputHandler ─────────────────────────────────────────────────────────────

export class InputHandler {
  private world:        World;
  private viewport:     () => Viewport; // live getter — never stale
  private callbacks:    InputCallbacks;
  private canvas:       HTMLCanvasElement | null = null;

  // Internal mutable state — never React state
  private inputState:   InputState = { type: "idle" };
  private selectedIds:  Set<string> = new Set();
  private hoveredId:    string | null = null;
  private editingId:    string | null = null;

  // Pointer tracking
  private activePointerId: number | null = null;
  private pointerDownPos:  { x: number; y: number } = { x: 0, y: 0 };
  private pointerDownTarget: NodeId | null = null;
  private didCrossThreshold: boolean = false;

  // Bound listeners (stored so we can remove them)
  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: (e: PointerEvent) => void;
  private _onPointerUp:   (e: PointerEvent) => void;
  private _onDblClick:    (e: MouseEvent)   => void;
  private _onKeyDown:     (e: KeyboardEvent) => void;
  private _onWheel:       (e: WheelEvent)   => void;
  private _onTouchStart:  (e: TouchEvent)   => void;
  private _onTouchMove:   (e: TouchEvent)   => void;

  // Touch pinch state
  private lastPinchDist: number = 0;

  constructor(
    world: World,
    viewport: () => Viewport,
    callbacks: InputCallbacks,
  ) {
    this.world     = world;
    this.viewport  = viewport;
    this.callbacks = callbacks;

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp   = this.onPointerUp.bind(this);
    this._onDblClick    = this.onDblClick.bind(this);
    this._onKeyDown     = this.onKeyDown.bind(this);
    this._onWheel       = this.onWheel.bind(this);
    this._onTouchStart  = this.onTouchStart.bind(this);
    this._onTouchMove   = this.onTouchMove.bind(this);
  }

  // ─── Mount / unmount ────────────────────────────────────────────────────────

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("pointermove", this._onPointerMove);
    canvas.addEventListener("pointerup",   this._onPointerUp);
    canvas.addEventListener("dblclick",    this._onDblClick);
    canvas.addEventListener("keydown",     this._onKeyDown);
    canvas.addEventListener("wheel",       this._onWheel,      { passive: false });
    canvas.addEventListener("touchstart",  this._onTouchStart, { passive: false });
    canvas.addEventListener("touchmove",   this._onTouchMove,  { passive: false });
  }

  unmount(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.removeEventListener("pointerdown", this._onPointerDown);
    canvas.removeEventListener("pointermove", this._onPointerMove);
    canvas.removeEventListener("pointerup",   this._onPointerUp);
    canvas.removeEventListener("dblclick",    this._onDblClick);
    canvas.removeEventListener("keydown",     this._onKeyDown);
    canvas.removeEventListener("wheel",       this._onWheel);
    canvas.removeEventListener("touchstart",  this._onTouchStart);
    canvas.removeEventListener("touchmove",   this._onTouchMove);
    this.canvas = null;
  }

  // ─── Public state readers (for renderer) ────────────────────────────────────

  getInputState():  InputState    { return this.inputState; }
  getSelectedIds(): Set<string>   { return this.selectedIds; }
  getHoveredId():   string | null { return this.hoveredId; }
  getEditingId():   string | null { return this.editingId; }

  // ─── Public setters (called by engine API / React boundary) ─────────────────

  setEditingId(id: string | null): void {
    this.editingId = id;
  }

  setSelectedIds(ids: string[]): void {
    this.selectedIds = new Set(ids);
    this.callbacks.onSelectionChange(ids);
  }

  clearSelection(): void {
    this.selectedIds = new Set();
    this.callbacks.onSelectionChange([]);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private setState(state: InputState): void {
    this.inputState = state;
    this.callbacks.onInputStateChange(state);
  }

  private rect(): DOMRect | null {
    return this.canvas?.getBoundingClientRect() ?? null;
  }

  private screenPos(e: PointerEvent | MouseEvent): { x: number; y: number } | null {
    const r = this.rect();
    if (!r) return null;
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ─── Pointer down ────────────────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;

    const pos = this.screenPos(e);
    if (!pos) return;

    // Middle mouse — pan
    if (e.button === 1) {
      e.preventDefault();
      this.canvas?.setPointerCapture(e.pointerId);
      this.activePointerId = e.pointerId;
      this.setState({ type: "panning", startX: e.clientX, startY: e.clientY });
      return;
    }

    this.activePointerId   = e.pointerId;
    this.pointerDownPos    = { x: e.clientX, y: e.clientY };
    this.didCrossThreshold = false;

    const vp  = this.viewport();
    const hit = hitTest(this.world, pos.x, pos.y, vp);
    this.pointerDownTarget = hit;

    this.canvas?.setPointerCapture(e.pointerId);

    if (!hit) {
      // Click on empty canvas — start potential selection rect
      this.setState({
        type: "selecting",
        startX: pos.x, startY: pos.y,
        currentX: pos.x, currentY: pos.y,
      });
    }
    // If hit a node — wait for threshold before starting drag
  }

  // ─── Pointer move ────────────────────────────────────────────────────────────

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.activePointerId && this.inputState.type !== "idle") return;

    const pos = this.screenPos(e);
    if (!pos) return;
    const vp = this.viewport();

    // Update hover
    const hit = hitTest(this.world, pos.x, pos.y, vp);
    if (hit !== this.hoveredId) {
      this.hoveredId = hit;
      this.callbacks.onHoverChange(hit);
    }

    // Connecting — update draft endpoint + hover target
    if (this.inputState.type === "connecting") {
      this.setState({ ...this.inputState, currentX: pos.x, currentY: pos.y });
      return;
    }

    // Panning
    if (this.inputState.type === "panning") {
      const dx = e.clientX - this.inputState.startX;
      const dy = e.clientY - this.inputState.startY;
      this.callbacks.onViewportChange(panViewport(vp, dx, dy));
      this.setState({ type: "panning", startX: e.clientX, startY: e.clientY });
      return;
    }

    // Selection rect
    if (this.inputState.type === "selecting") {
      this.setState({ ...this.inputState, currentX: pos.x, currentY: pos.y });
      return;
    }

    // Node drag — check threshold first
    if (this.pointerDownTarget && this.inputState.type === "idle") {
      const dx = e.clientX - this.pointerDownPos.x;
      const dy = e.clientY - this.pointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

      // Threshold crossed — start drag
      this.didCrossThreshold = true;
      const id = this.pointerDownTarget;

      // If dragging a non-selected node, select it alone
      if (!this.selectedIds.has(id)) {
        this.selectedIds = new Set([id]);
        this.callbacks.onSelectionChange([id]);
      }

      const idsToMove = [...this.selectedIds];
      const snapshot  = new Map<string, { x: number; y: number }>();
      for (const nid of idsToMove) {
        const n = this.world.nodes.get(nid);
        if (n) snapshot.set(nid, { x: n.x, y: n.y });
      }

      // Seed origin from live viewport at this exact moment
      const origin = screenToWorld(pos.x, pos.y, vp);

      this.setState({
        type: "dragging",
        nodeIds: idsToMove,
        originX: origin.x,
        originY: origin.y,
        snapshot,
      });
      return;
    }

    // Dragging — move nodes directly in world
    if (this.inputState.type === "dragging") {
      const origin = screenToWorld(pos.x, pos.y, vp);
      const ddx = origin.x - this.inputState.originX;
      const ddy = origin.y - this.inputState.originY;

      for (const [nid, start] of this.inputState.snapshot) {
        const node = this.world.nodes.get(nid);
        if (!node) continue;
        this.world.nodes.set(nid, { ...node, x: start.x + ddx, y: start.y + ddy });
      }
    }
  }

  // ─── Pointer up ──────────────────────────────────────────────────────────────

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.activePointerId) return;
    this.activePointerId = null;

    const pos = this.screenPos(e);
    const vp  = this.viewport();

    // Finish panning
    if (this.inputState.type === "panning") {
      this.setState({ type: "idle" });
      return;
    }

    // Finish connecting
    if (this.inputState.type === "connecting") {
      if (pos) {
        const toId = hitTest(this.world, pos.x, pos.y, vp);
        if (toId && toId !== this.inputState.fromId) {
          connect(this.world, {
            id:   crypto.randomUUID(),
            from: this.inputState.fromId,
            to:   toId,
          });
          this.callbacks.onConnected(this.inputState.fromId, toId);
        }
      }
      this.setState({ type: "idle" });
      return;
    }

    // Finish selection rect
    if (this.inputState.type === "selecting") {
      const { startX, startY, currentX, currentY } = this.inputState;
      const moved = Math.abs(currentX - startX) > 2 || Math.abs(currentY - startY) > 2;

      if (moved) {
        const minX = Math.min(startX, currentX);
        const maxX = Math.max(startX, currentX);
        const minY = Math.min(startY, currentY);
        const maxY = Math.max(startY, currentY);
        const hits = hitTestRect(this.world, minX, minY, maxX, maxY, vp);
        if (hits.length > 0) {
          this.selectedIds = new Set(hits);
          this.callbacks.onSelectionChange(hits);
        } else {
          this.clearSelection();
        }
      } else {
        // Pure click on empty canvas — clear selection + exit editing
        this.clearSelection();
        if (this.editingId) {
          this.editingId = null;
          this.callbacks.onNodeEditStart(""); // signal React to close textarea
        }
      }
      this.setState({ type: "idle" });
      return;
    }

    // Finish drag
    if (this.inputState.type === "dragging") {
      const moves: { id: string; x: number; y: number }[] = [];
      for (const nid of this.inputState.nodeIds) {
        const n = this.world.nodes.get(nid);
        if (n) moves.push({ id: nid, x: n.x, y: n.y });
      }
      this.callbacks.onNodesMoved(moves);
      this.setState({ type: "idle" });
      return;
    }

    // Pure click on a node (threshold never crossed)
    if (this.pointerDownTarget && !this.didCrossThreshold) {
      const id = this.pointerDownTarget;
      if (this.selectedIds.has(id) && this.selectedIds.size === 1) {
        // Second click on already-selected node → edit
        this.editingId = id;
        this.callbacks.onNodeEditStart(id);
      } else {
        // First click — select it, replacing current selection
        this.selectedIds = new Set([id]);
        this.callbacks.onSelectionChange([id]);
      }
      this.setState({ type: "idle" });
      return;
    }

    this.setState({ type: "idle" });
  }

  // ─── Double click ────────────────────────────────────────────────────────────

  private onDblClick(e: MouseEvent): void {
    const pos = this.screenPos(e);
    if (!pos) return;
    const vp  = this.viewport();
    const hit = hitTest(this.world, pos.x, pos.y, vp);
    if (!hit) {
      // Double click on empty canvas — create node
      this.callbacks.onCreateNode(pos.x, pos.y);
    }
  }

  // ─── Keyboard ────────────────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (this.editingId) return; // React textarea handles keys when editing

    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.selectedIds.size === 0) return;
      e.preventDefault();
      const ids = [...this.selectedIds];
      for (const id of ids) removeNode(this.world, id);
      this.clearSelection();
      this.callbacks.onNodeDelete(ids);
    }
  }

  // ─── Wheel (scroll to pan, ctrl+wheel to zoom) ───────────────────────────────

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const vp = this.viewport();
    if (e.ctrlKey) {
      const r = this.rect();
      if (!r) return;
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      this.callbacks.onViewportChange(zoomViewport(vp, -e.deltaY, ox, oy));
    } else {
      this.callbacks.onViewportChange(panViewport(vp, -e.deltaX, -e.deltaY));
    }
  }

  // ─── Touch pinch to zoom ─────────────────────────────────────────────────────

  private onTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2) {
      e.preventDefault();
      this.lastPinchDist = this.pinchDist(e.touches);
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const r = this.rect();
    if (!r) return;
    const dist  = this.pinchDist(e.touches);
    const delta = (dist - this.lastPinchDist) * 0.5;
    const mid   = {
      x: ((e.touches[0].clientX + e.touches[1].clientX) / 2) - r.left,
      y: ((e.touches[0].clientY + e.touches[1].clientY) / 2) - r.top,
    };
    this.callbacks.onViewportChange(zoomViewport(this.viewport(), delta, mid.x, mid.y));
    this.lastPinchDist = dist;
  }

  private pinchDist(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ─── Connection start (called by engine when handle is clicked) ──────────────

  startConnecting(fromId: string, fromScreenX: number, fromScreenY: number): void {
    this.setState({
      type: "connecting",
      fromId,
      fromScreenX,
      fromScreenY,
      currentX: fromScreenX,
      currentY: fromScreenY,
    });
  }
}