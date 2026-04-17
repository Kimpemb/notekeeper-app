import { create } from "zustand";
import type { Canvas, CanvasNode, CanvasEdge, Viewport } from "@/types/canvas";
import {
  createCanvasInDb,
  getCanvas,
  saveCanvas,
  saveCanvasName,
} from "@/features/canvas/db/canvasQueries";

function makeId(): string {
  return crypto.randomUUID();
}

interface CanvasData {
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  selectedNodeIds: string[];
  loading: boolean;
}

interface CanvasStore {
  canvases: Record<string, CanvasData>;
  activeCanvasId: string | null;

  loadCanvas: (id: string) => Promise<void>;
  createCanvas: (name: string) => Promise<Canvas>;
  updateCanvasName: (id: string, name: string) => Promise<void>;
  
  addNode:    (canvasId: string, node: CanvasNode) => void;
  updateNode: (canvasId: string, id: string, updates: Partial<CanvasNode>) => void;
  deleteNode: (canvasId: string, id: string) => void;
  moveNode:   (canvasId: string, id: string, x: number, y: number) => void;

  addEdge:    (canvasId: string, edge: CanvasEdge) => void;
  deleteEdge: (canvasId: string, id: string) => void;

  selectNodes:    (canvasId: string, ids: string[]) => void;
  clearSelection: (canvasId: string) => void;

  setViewport: (canvasId: string, viewport: Viewport) => void;
  pan:         (canvasId: string, dx: number, dy: number) => void;
  zoom:        (canvasId: string, delta: number, originX: number, originY: number) => void;

  persist: (canvasId: string) => Promise<void>;
  setActiveCanvas: (id: string | null) => void;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  canvases: {},
  activeCanvasId: null,

  setActiveCanvas: (id) => set({ activeCanvasId: id }),

  loadCanvas: async (id) => {
    if (get().canvases[id]) return;
    
    set((s) => ({ 
      canvases: { ...s.canvases, [id]: { ...s.canvases[id], loading: true } }
    }));
    
    const row = await getCanvas(id);
    if (!row) { 
      set((s) => ({ 
        canvases: { ...s.canvases, [id]: { name: "", nodes: [], edges: [], viewport: DEFAULT_VIEWPORT, selectedNodeIds: [], loading: false } }
      }));
      return; 
    }
    
    const data = JSON.parse(row.data);
    set((s) => ({
      activeCanvasId: id,
      canvases: {
        ...s.canvases,
        [id]: {
          name: row.name,
          nodes: data.nodes ?? [],
          edges: data.edges ?? [],
          viewport: data.viewport ?? DEFAULT_VIEWPORT,
          selectedNodeIds: [],
          loading: false,
        }
      }
    }));
  },

  createCanvas: async (name) => {
    const id = makeId();
    await createCanvasInDb(id, name);
    return { id, name, nodes: [], edges: [], viewport: DEFAULT_VIEWPORT, createdAt: String(Date.now()), updatedAt: String(Date.now()) };
  },

  updateCanvasName: async (id, name) => {
    await saveCanvasName(id, name);
    set((s) => ({
      canvases: {
        ...s.canvases,
        [id]: { ...s.canvases[id], name }
      }
    }));
  },

  addNode: (canvasId, node) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: { ...s.canvases[canvasId], nodes: [...s.canvases[canvasId].nodes, node] }
      }
    }));
    get().persist(canvasId);
  },

  updateNode: (canvasId, id, updates) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: {
          ...s.canvases[canvasId],
          nodes: s.canvases[canvasId].nodes.map((n) => n.id === id ? { ...n, ...updates } : n)
        }
      }
    }));
    get().persist(canvasId);
  },

  deleteNode: (canvasId, id) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: {
          ...s.canvases[canvasId],
          nodes: s.canvases[canvasId].nodes.filter((n) => n.id !== id),
          edges: s.canvases[canvasId].edges.filter((e) => e.from !== id && e.to !== id)
        }
      }
    }));
    get().persist(canvasId);
  },

  moveNode: (canvasId, id, x, y) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: {
          ...s.canvases[canvasId],
          nodes: s.canvases[canvasId].nodes.map((n) => n.id === id ? { ...n, x, y } : n)
        }
      }
    }));
  },

  addEdge: (canvasId, edge) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: { ...s.canvases[canvasId], edges: [...s.canvases[canvasId].edges, edge] }
      }
    }));
    get().persist(canvasId);
  },

  deleteEdge: (canvasId, id) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: {
          ...s.canvases[canvasId],
          edges: s.canvases[canvasId].edges.filter((e) => e.id !== id)
        }
      }
    }));
    get().persist(canvasId);
  },

  selectNodes: (canvasId, ids) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: { ...s.canvases[canvasId], selectedNodeIds: ids }
      }
    }));
  },

  clearSelection: (canvasId) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: { ...s.canvases[canvasId], selectedNodeIds: [] }
      }
    }));
  },

  setViewport: (canvasId, viewport) => {
    set((s) => ({
      canvases: {
        ...s.canvases,
        [canvasId]: { ...s.canvases[canvasId], viewport }
      }
    }));
  },

  pan: (canvasId, dx, dy) => {
    set((s) => {
      const vp = s.canvases[canvasId]?.viewport || DEFAULT_VIEWPORT;
      return {
        canvases: {
          ...s.canvases,
          [canvasId]: {
            ...s.canvases[canvasId],
            viewport: { ...vp, x: vp.x + dx, y: vp.y + dy }
          }
        }
      };
    });
  },

  zoom: (canvasId, delta, originX, originY) => {
    set((s) => {
      const { x, y, zoom } = s.canvases[canvasId]?.viewport || DEFAULT_VIEWPORT;
      const factor = delta > 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(zoom * factor, 0.1), 5);
      const zoomRatio = newZoom / zoom;
      return {
        canvases: {
          ...s.canvases,
          [canvasId]: {
            ...s.canvases[canvasId],
            viewport: {
              x: originX - (originX - x) * zoomRatio,
              y: originY - (originY - y) * zoomRatio,
              zoom: newZoom,
            }
          }
        }
      };
    });
  },

  persist: async (canvasId) => {
    const canvas = get().canvases[canvasId];
    if (!canvas) return;
    await saveCanvas(canvasId, { nodes: canvas.nodes, edges: canvas.edges, viewport: canvas.viewport });
  },
}));