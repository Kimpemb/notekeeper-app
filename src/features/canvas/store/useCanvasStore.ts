import { create } from "zustand";
import type { CanvasNode, CanvasEdge, Viewport } from "@/types/canvas";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 0.6 };

interface CanvasUIState {
  selectedNodeIds: string[];
  viewport:        Viewport;
}

interface CanvasStore {
  uiState: Record<string, CanvasUIState>;
  dragCache: Record<string, { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: Viewport }>;

  // ─── Reads ──────────────────────────────────────────────────────────────────
  getNodes:           (noteId: string) => CanvasNode[];
  getEdges:           (noteId: string) => CanvasEdge[];
  getViewport:        (noteId: string) => Viewport;
  getSelectedNodeIds: (noteId: string) => string[];

  // ─── Node mutations ─────────────────────────────────────────────────────────
  addNode:    (noteId: string, node: CanvasNode) => void;
  updateNode: (noteId: string, id: string, updates: Partial<CanvasNode>) => void;
  deleteNode: (noteId: string, id: string) => void;
  /** Move a single node to an absolute (x, y) position. */
  moveNode:   (noteId: string, id: string, x: number, y: number) => void;
  /** Translate multiple nodes by a delta. Used for group drag. */
  moveNodes:  (noteId: string, ids: string[], dx: number, dy: number) => void;

  // ─── Edge mutations ──────────────────────────────────────────────────────────
  addEdge:    (noteId: string, edge: CanvasEdge) => void;
  deleteEdge: (noteId: string, id: string) => void;

  // ─── Selection ───────────────────────────────────────────────────────────────
  selectNodes:    (noteId: string, ids: string[]) => void;
  clearSelection: (noteId: string) => void;

  // ─── Viewport ────────────────────────────────────────────────────────────────
  setViewport: (noteId: string, viewport: Viewport) => void;
  pan:         (noteId: string, dx: number, dy: number) => void;
  zoom:        (noteId: string, delta: number, originX: number, originY: number) => void;

  // ─── Drag cache ─────────────────────────────────────────────────────────────
  flushDrag: (noteId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCanvasData(noteId: string): { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: Viewport } {
  const note = useNoteStore.getState().notes.find((n) => n.id === noteId);
  if (!note?.canvas_state) return { nodes: [], edges: [], viewport: DEFAULT_VIEWPORT };
  try {
    const parsed = JSON.parse(note.canvas_state);
    return {
      nodes:    parsed.nodes    ?? [],
      edges:    parsed.edges    ?? [],
      viewport: parsed.viewport ?? DEFAULT_VIEWPORT,
    };
  } catch {
    return { nodes: [], edges: [], viewport: DEFAULT_VIEWPORT };
  }
}

function persistToNote(noteId: string, nodes: CanvasNode[], edges: CanvasEdge[], viewport: Viewport) {
  useNoteStore.getState().updateCanvasState(
    noteId,
    JSON.stringify({ nodes, edges, viewport }),
  );
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  uiState: {},
  dragCache: {},

  // ─── Reads ──────────────────────────────────────────────────────────────────
  getNodes:    (noteId) => {
    const cached = get().dragCache[noteId];
    if (cached) return cached.nodes;
    return getCanvasData(noteId).nodes;
  },
  getEdges:    (noteId) => {
    const cached = get().dragCache[noteId];
    if (cached) return cached.edges;
    return getCanvasData(noteId).edges;
  },
  getViewport: (noteId) => get().uiState[noteId]?.viewport ?? getCanvasData(noteId).viewport,
  getSelectedNodeIds: (noteId) => get().uiState[noteId]?.selectedNodeIds ?? [],

  // ─── Node mutations ─────────────────────────────────────────────────────────
  addNode: (noteId, node) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(noteId, [...nodes, node], edges, viewport);
  },

  updateNode: (noteId, id, updates) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(
      noteId,
      nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
      edges,
      viewport,
    );
  },

  deleteNode: (noteId, id) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(
      noteId,
      nodes.filter((n) => n.id !== id),
      edges.filter((e) => e.from !== id && e.to !== id),
      viewport,
    );
  },

  moveNode: (noteId, id, x, y) => {
    const current = get().dragCache[noteId] ?? getCanvasData(noteId);
    const next = current.nodes.map((n) => (n.id === id ? { ...n, x, y } : n));
    const updated = { ...current, nodes: next };
    set((s) => ({ dragCache: { ...s.dragCache, [noteId]: updated } }));
    // Update note store in memory only (no DB write)
    useNoteStore.getState().updateCanvasStateInMemory(noteId, JSON.stringify(updated));
  },

  moveNodes: (noteId, ids, dx, dy) => {
    const current = get().dragCache[noteId] ?? getCanvasData(noteId);
    const idSet = new Set(ids);
    const next = current.nodes.map((n) => (idSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
    const updated = { ...current, nodes: next };
    set((s) => ({ dragCache: { ...s.dragCache, [noteId]: updated } }));
    // Update note store in memory only (no DB write)
    useNoteStore.getState().updateCanvasStateInMemory(noteId, JSON.stringify(updated));
  },

  // ─── Edge mutations ──────────────────────────────────────────────────────────
  addEdge: (noteId, edge) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(noteId, nodes, [...edges, edge], viewport);
  },

  deleteEdge: (noteId, id) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(noteId, nodes, edges.filter((e) => e.id !== id), viewport);
  },

  // ─── Selection ───────────────────────────────────────────────────────────────
  selectNodes: (noteId, ids) => {
    set((s) => ({
      uiState: {
        ...s.uiState,
        [noteId]: { ...s.uiState[noteId], selectedNodeIds: ids },
      },
    }));
  },

  clearSelection: (noteId) => {
    set((s) => ({
      uiState: {
        ...s.uiState,
        [noteId]: { ...s.uiState[noteId], selectedNodeIds: [] },
      },
    }));
  },

  // ─── Viewport ────────────────────────────────────────────────────────────────
  setViewport: (noteId, viewport) => {
    set((s) => ({
      uiState: {
        ...s.uiState,
        [noteId]: { ...s.uiState[noteId], viewport },
      },
    }));
  },

  pan: (noteId, dx, dy) => {
    const vp = get().getViewport(noteId);
    get().setViewport(noteId, { ...vp, x: vp.x + dx, y: vp.y + dy });
  },

  zoom: (noteId, delta, originX, originY) => {
    const { x, y, zoom } = get().getViewport(noteId);
    const factor = delta > 0 ? 1.01 : 0.99;
    const newZoom = Math.min(Math.max(zoom * factor, 0.25), 2.5);
    const zoomRatio = newZoom / zoom;
    get().setViewport(noteId, {
      x:    originX - (originX - x) * zoomRatio,
      y:    originY - (originY - y) * zoomRatio,
      zoom: newZoom,
    });
  },

  // ─── Drag cache ─────────────────────────────────────────────────────────────
  flushDrag: (noteId) => {
  const cached = get().dragCache[noteId];
  if (!cached) return;
  const json = JSON.stringify({ nodes: cached.nodes, edges: cached.edges, viewport: cached.viewport });
  // 1. Update noteStore in-memory synchronously
  useNoteStore.getState().updateCanvasStateInMemory(noteId, json);
  // 2. Clear dragCache — getNodes() now reads from noteStore which is correct
  set((s) => {
    const next = { ...s.dragCache };
    delete next[noteId];
    return { dragCache: next };
  });
  // 3. Persist to DB asynchronously
  useNoteStore.getState().updateCanvasState(noteId, json).catch(console.error);
},
}));