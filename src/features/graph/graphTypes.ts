// src/features/graph/graphTypes.ts

import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  tags: string[];
  linkCount: number;   // total connections — used to size the dot
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}