// src/features/graph/useGraphData.ts
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
    removeEdge: (sourceId: string, targetId: string) => void;  // ← added
  };
}

export function useGraphData(): UseGraphDataResult {
  const [data, setData]               = useState<GraphData | null>(null);
  const [isLoading, setLoading]       = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tick, setTick]               = useState(0);

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

        // ← sourceId and targetId included so GraphEdge is fully satisfied
        const edges: GraphEdge[] = Array.from(edgeWeights.entries()).map(([key, weight]) => {
          const [source, target] = key.split("__");
          return { source, target, sourceId: source, targetId: target, weight };
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


  useEffect(() => {
  function onBacklinksUpdated() { refresh(); }
  window.addEventListener("idemora:backlinks-updated", onBacklinksUpdated);
  return () => window.removeEventListener("idemora:backlinks-updated", onBacklinksUpdated);
}, [refresh]);

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
        // ← sourceId and targetId included here too
        edges: [...prev.edges, {
          source:   sourceId,
          target:   targetId,
          sourceId: sourceId,
          targetId: targetId,
          weight:   edge.weight ?? 1,
        }],
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

  // ← moved inside the function body, now a proper useCallback
  const removeEdge = useCallback((sourceId: string, targetId: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        edges: prev.edges.filter((e) => {
          const sid = typeof e.source === "object"
            ? (e.source as GraphNode).id
            : e.source as string;
          const tid = typeof e.target === "object"
            ? (e.target as GraphNode).id
            : e.target as string;
          return !(
            (sid === sourceId && tid === targetId) ||
            (sid === targetId && tid === sourceId)
          );
        }),
        nodes: prev.nodes.map((n) => {
          if (n.id === sourceId || n.id === targetId) {
            return { ...n, linkCount: Math.max(0, n.linkCount - 1) };
          }
          return n;
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
    patchData: { addNode, addEdge, updateNodeTitle, removeNode, removeEdge },
  };
}