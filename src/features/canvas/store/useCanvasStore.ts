// src/features/canvas/store/useCanvasStore.ts
import { create } from "zustand";
import type { CanvasNode, CanvasEdge, Viewport } from "@/types/canvas";
import { useNoteStore } from "@/features/notes/store/useNoteStore";

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

interface CanvasUIState {
  selectedNodeIds: string[];
  viewport: Viewport;
}

interface CanvasStore {
  uiState: Record<string, CanvasUIState>;

  getNodes:           (noteId: string) => CanvasNode[];
  getEdges:           (noteId: string) => CanvasEdge[];
  getViewport:        (noteId: string) => Viewport;
  getSelectedNodeIds: (noteId: string) => string[];

  addNode:    (noteId: string, node: CanvasNode) => void;
  updateNode: (noteId: string, id: string, updates: Partial<CanvasNode>) => void;
  deleteNode: (noteId: string, id: string) => void;
  moveNode:   (noteId: string, id: string, x: number, y: number) => void;

  addEdge:    (noteId: string, edge: CanvasEdge) => void;
  deleteEdge: (noteId: string, id: string) => void;

  selectNodes:    (noteId: string, ids: string[]) => void;
  clearSelection: (noteId: string) => void;

  setViewport: (noteId: string, viewport: Viewport) => void;
  pan:         (noteId: string, dx: number, dy: number) => void;
  zoom:        (noteId: string, delta: number, originX: number, originY: number) => void;
}

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
    JSON.stringify({ nodes, edges, viewport })
  );
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  uiState: {},

  getNodes:    (noteId) => getCanvasData(noteId).nodes,
  getEdges:    (noteId) => getCanvasData(noteId).edges,
  getViewport: (noteId) => get().uiState[noteId]?.viewport ?? getCanvasData(noteId).viewport,
  getSelectedNodeIds: (noteId) => get().uiState[noteId]?.selectedNodeIds ?? [],

  addNode: (noteId, node) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(noteId, [...nodes, node], edges, viewport);
  },

  updateNode: (noteId, id, updates) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(
      noteId,
      nodes.map((n) => n.id === id ? { ...n, ...updates } : n),
      edges,
      viewport
    );
  },

  deleteNode: (noteId, id) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(
      noteId,
      nodes.filter((n) => n.id !== id),
      edges.filter((e) => e.from !== id && e.to !== id),
      viewport
    );
  },

  moveNode: (noteId, id, x, y) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(
      noteId,
      nodes.map((n) => n.id === id ? { ...n, x, y } : n),
      edges,
      viewport
    );
  },

  addEdge: (noteId, edge) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(noteId, nodes, [...edges, edge], viewport);
  },

  deleteEdge: (noteId, id) => {
    const { nodes, edges, viewport } = getCanvasData(noteId);
    persistToNote(noteId, nodes, edges.filter((e) => e.id !== id), viewport);
  },

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
    const factor    = delta > 0 ? 1.1 : 0.9;
    const newZoom   = Math.min(Math.max(zoom * factor, 0.1), 5);
    const zoomRatio = newZoom / zoom;
    get().setViewport(noteId, {
      x: originX - (originX - x) * zoomRatio,
      y: originY - (originY - y) * zoomRatio,
      zoom: newZoom,
    });
  },
}));