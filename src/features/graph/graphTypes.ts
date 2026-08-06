// src/features/graph/graphTypes.ts

import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  tags: string[];
  linkCount: number;    // total connections — used to size the dot
  created_at: number;   // unix ms — used for timeline mode x-position
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  weight: number;       // number of backlinks between this pair — used for stroke scaling

  // Raw string IDs, always stable even after D3 mutates source/target into
  // object references. Used by edge click handlers and delete logic so they
  // never have to re-derive IDs from potentially-mutated D3 objects.
  sourceId: string;
  targetId: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Thought Graph (feature/thought-graph) — additive, GraphNode/GraphEdge/GraphData untouched ──

export type ThoughtNodeKind =
  | "claim" | "idea" | "question" | "counterargument"
  | "evidence" | "assumption" | "conclusion";

export type ThoughtNodeState = "open" | "resolved" | "parked";

export type ThoughtEdgeRelation =
  | "supports" | "challenges" | "answers"
  | "leads_to" | "depends_on" | "refines";

export interface ThoughtNode extends SimulationNodeDatum {
  id: string;
  graphId: string;
  type: ThoughtNodeKind;
  summary: string;
  body?: string | null;
  state: ThoughtNodeState;
  sourceRef: string | null;
  sourceKind: "conversation" | "note" | "external" | null;
  created_at: number;
}

export interface ThoughtEdge extends SimulationLinkDatum<ThoughtNode> {
  source: string | ThoughtNode;
  target: string | ThoughtNode;
  sourceId: string;
  targetId: string;
  relation: ThoughtEdgeRelation;
}

export interface ThoughtGraphData {
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
}

export const THOUGHT_TYPE_COLOR: Record<ThoughtNodeKind, string> = {
  claim:           "#6366f1",
  idea:            "#f59e0b",
  question:        "#3b82f6",
  counterargument: "#ef4444",
  evidence:        "#10b981",
  assumption:      "#84cc16",
  conclusion:      "#8b5cf6",
};

export const THOUGHT_STATE_OPACITY: Record<ThoughtNodeState, number> = {
  open:     1,
  resolved: 0.7,
  parked:   0.4,
};