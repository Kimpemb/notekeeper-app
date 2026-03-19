// src/features/graph/useGraphData.ts

import { useState, useEffect } from "react";
import { getAllNotes, getAllBacklinks } from "@/features/notes/db/queries";
import type { GraphData, GraphNode, GraphEdge } from "./graphTypes";

interface UseGraphDataResult {
  data: GraphData | null;
  isLoading: boolean;
  error: string | null;
}

export function useGraphData(): UseGraphDataResult {
  const [data, setData]       = useState<GraphData | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [notes, backlinks] = await Promise.all([
          getAllNotes(),
          getAllBacklinks(),
        ]);

        if (cancelled) return;

        // Count connections per note so we can size nodes
        const linkCount = new Map<string, number>();
        for (const { source_id, target_id } of backlinks) {
          linkCount.set(source_id, (linkCount.get(source_id) ?? 0) + 1);
          linkCount.set(target_id, (linkCount.get(target_id) ?? 0) + 1);
        }

        const nodes: GraphNode[] = notes.map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags ? (() => { try { return JSON.parse(n.tags!); } catch { return []; } })() : [],
          linkCount: linkCount.get(n.id) ?? 0,
        }));

        // Only include edges where both ends exist in the note set
        const nodeIds = new Set(nodes.map((n) => n.id));
        const edges: GraphEdge[] = backlinks
          .filter((b) => nodeIds.has(b.source_id) && nodeIds.has(b.target_id))
          .map((b) => ({ source: b.source_id, target: b.target_id }));

        setData({ nodes, edges });
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { data, isLoading, error };
}