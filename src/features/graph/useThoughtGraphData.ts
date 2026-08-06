// src/features/graph/useThoughtGraphData.ts
import { useState, useEffect, useCallback } from "react";
import {
  getThoughtGraphsForNote,
  getThoughtNodesForGraphs,
  getThoughtEdgesForGraphs,
} from "@/features/graph/db/thoughtGraphQueries";
import { getOpenEpisode } from "@/features/notes/db/queries";
import type { ThoughtGraphData, ThoughtNode, ThoughtEdge } from "./graphTypes";

interface UseThoughtGraphDataResult {
  data:          ThoughtGraphData | null;
  isLoading:     boolean;
  error:         string | null;
  refresh:       () => void;
  activeGraphId: string | null;   // the currently-open episode's graph, for "active" styling
}

export function useThoughtGraphData(noteId: string | null): UseThoughtGraphDataResult {
  const [data, setData]                   = useState<ThoughtGraphData | null>(null);
  const [isLoading, setLoading]           = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const [tick, setTick]                   = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!noteId) { setData(null); setLoading(false); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const graphs = await getThoughtGraphsForNote(noteId!);
        if (cancelled) return;

        if (graphs.length === 0) {
          setData({ nodes: [], edges: [] });
          setActiveGraphId(null);
          return;
        }

        const graphIds = graphs.map((g) => g.id);
        const [nodeRows, edgeRows, openEpisode] = await Promise.all([
          getThoughtNodesForGraphs(graphIds),
          getThoughtEdgesForGraphs(graphIds),
          getOpenEpisode(noteId!),
        ]);
        if (cancelled) return;

        const activeGraph = openEpisode
          ? graphs.find((g) => g.source_id === openEpisode.id)
          : undefined;
        setActiveGraphId(activeGraph?.id ?? null);

        const nodes: ThoughtNode[] = nodeRows.map((r) => ({
          id:         r.id,
          graphId:    r.graph_id,
          type:       r.type,
          summary:    r.summary,
          body:       r.body,
          state:      r.state,
          sourceRef:  r.source_ref,
          sourceKind: r.source_kind,
          created_at: r.created_at,
        }));

        const edges: ThoughtEdge[] = edgeRows.map((r) => ({
          source:   r.from_id,
          target:   r.to_id,
          sourceId: r.from_id,
          targetId: r.to_id,
          relation: r.relation,
        }));

        setData({ nodes, edges });
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [noteId, tick]);

  useEffect(() => {
    function onUpdate() { refresh(); }
    window.addEventListener("idemora:thought-graph-updated", onUpdate);
    return () => window.removeEventListener("idemora:thought-graph-updated", onUpdate);
  }, [refresh]);

  return { data, isLoading, error, refresh, activeGraphId };
}