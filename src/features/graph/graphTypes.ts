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