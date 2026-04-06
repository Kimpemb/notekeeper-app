// src/features/graph/useGraphData.ts
// Loads graph data once on mount. No auto-refresh — the graph manages
// its own state after initial load via simNodesRef / simEdgesRef.
//
// patchData exposes two imperative updaters that GraphView calls after a
// successful createNodeAt / createLink so that `data` (and therefore
// visibleNodes / visibleEdges) stays consistent with the live simulation
// state — without triggering a full DB reload or a D3 rebuild.

import { useState, useEffect, useCallback } from "react";
import { getAllNotes, getAllBacklinks } from "@/features/notes/db/queries";
import type { GraphData, GraphNode, GraphEdge } from "./graphTypes";

interface UseGraphDataResult {
  data: GraphData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: number | null;
  patchData: {
    addNode: (node: GraphNode) => void;
    addEdge: (edge: GraphEdge) => void;
    updateNodeTitle: (nodeId: string, title: string) => void;
    removeNode: (nodeId: string) => void;
  };
}

export function useGraphData(): UseGraphDataResult {
  const [data, setData]               = useState<GraphData | null>(null);
  const [isLoading, setLoading]       = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tick, setTick]               = useState(0);

  // Manual refresh only — no auto-refresh on store changes
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [fetchedNotes, backlinks] = await Promise.all([
          getAllNotes(),
          getAllBacklinks(),
        ]);

        if (cancelled) return;

        const linkCount = new Map<string, number>();
        for (const { source_id, target_id } of backlinks) {
          linkCount.set(source_id, (linkCount.get(source_id) ?? 0) + 1);
          linkCount.set(target_id, (linkCount.get(target_id) ?? 0) + 1);
        }

        const nodes: GraphNode[] = fetchedNotes.map((n) => ({
          id:         n.id,
          title:      n.title,
          tags:       n.tags
            ? (() => { try { return JSON.parse(n.tags!); } catch { return []; } })()
            : [],
          linkCount:  linkCount.get(n.id) ?? 0,
          created_at: n.created_at,
        }));

        const nodeIds = new Set(nodes.map((n) => n.id));

        const edgeWeights = new Map<string, number>();
        for (const b of backlinks) {
          if (!nodeIds.has(b.source_id) || !nodeIds.has(b.target_id)) continue;
          const key = b.source_id < b.target_id
            ? `${b.source_id}__${b.target_id}`
            : `${b.target_id}__${b.source_id}`;
          edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
        }

        const edges: GraphEdge[] = Array.from(edgeWeights.entries()).map(([key, weight]) => {
          const [source, target] = key.split("__");
          return { source, target, weight };
        });

        setData({ nodes, edges });
        setLastUpdated(Date.now());
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tick]);

  // ── Imperative patch helpers ─────────────────────────────────────────────
  //
  // These let GraphView push newly created nodes/edges into `data` immediately
  // after the graph edit hooks succeed — keeping the data layer in sync with
  // simNodesRef/simEdgesRef without a full DB reload.
  //
  // addNode: called after createNodeAt commits a title (renameNode), because
  //   that's the moment we know the final title and can safely add to data.
  //   Guarded so calling it twice for the same id (edge case) is a no-op.
  //
  // addEdge: called after createLink succeeds. Increments linkCount on both
  //   endpoint nodes so visibleNodes / neighbourhood calculations are correct.
  //
  // updateNodeTitle: called from renameNode for plain renames (not creations)
  //   so data.nodes stays in sync with what the sidebar and focused mode see.
  //
  // removeNode: called after deleteNode so focused-mode neighbourhood and
  //   full-graph data both drop the deleted node immediately.

  const addNode = useCallback((node: GraphNode) => {
    setData((prev) => {
      if (!prev) return prev;
      if (prev.nodes.some((n) => n.id === node.id)) return prev;
      return { ...prev, nodes: [...prev.nodes, node] };
    });
  }, []);

  const addEdge = useCallback((edge: GraphEdge) => {
    setData((prev) => {
      if (!prev) return prev;

      const sourceId = typeof edge.source === "object"
        ? (edge.source as GraphNode).id
        : edge.source as string;
      const targetId = typeof edge.target === "object"
        ? (edge.target as GraphNode).id
        : edge.target as string;

      // Deduplicate — if edge already in data (shouldn't be, but guard anyway)
      const edgeKey = (s: string, t: string) =>
        s < t ? `${s}|${t}` : `${t}|${s}`;
      const existingKeys = new Set(
        prev.edges.map((e) => {
          const s = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
          const t = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
          return edgeKey(s, t);
        }),
      );
      if (existingKeys.has(edgeKey(sourceId, targetId))) return prev;

      const updatedNodes = prev.nodes.map((n) => {
        if (n.id === sourceId || n.id === targetId) {
          return { ...n, linkCount: n.linkCount + 1 };
        }
        return n;
      });

      return {
        nodes: updatedNodes,
        edges: [...prev.edges, { source: sourceId, target: targetId, weight: edge.weight ?? 1 }],
      };
    });
  }, []);

  const updateNodeTitle = useCallback((nodeId: string, title: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => n.id === nodeId ? { ...n, title } : n),
      };
    });
  }, []);

  const removeNode = useCallback((nodeId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => {
          const s = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
          const t = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
          return s !== nodeId && t !== nodeId;
        }),
      };
    });
  }, []);

  return {
    data,
    isLoading,
    error,
    refresh,
    lastUpdated,
    patchData: { addNode, addEdge, updateNodeTitle, removeNode },
  };
}