// Canvas types - Idemora canvas system

export type CanvasId = string;
export type NodeId = string;
export type EdgeId = string;

export type CanvasNodeType = "note" | "text" | "group";

export type CanvasNode = {
  id: NodeId;
  type: CanvasNodeType;
  noteId?: string;      // Required if type === "note"
  content?: string;     // Required if type === "text"
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasEdge = {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
};

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type Canvas = {
  id: CanvasId;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  createdAt: string;
  updatedAt: string;
};

// For collaboration (future)
export type CanvasOperation = 
  | { type: "CREATE_NODE"; payload: CanvasNode }
  | { type: "UPDATE_NODE"; payload: { id: NodeId; updates: Partial<CanvasNode> } }
  | { type: "DELETE_NODE"; payload: { id: NodeId } }
  | { type: "CREATE_EDGE"; payload: CanvasEdge }
  | { type: "DELETE_EDGE"; payload: { id: EdgeId } }
  | { type: "UPDATE_VIEWPORT"; payload: Viewport }
  | { type: "SELECT_NODES"; payload: { nodeIds: NodeId[] } };