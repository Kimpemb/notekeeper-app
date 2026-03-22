// src/features/graph/useGraphData.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { getAllNotes, getAllBacklinks } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { GraphData, GraphNode, GraphEdge } from "./graphTypes";

interface UseGraphDataResult {
  data: GraphData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: number | null;
}

export function useGraphData(): UseGraphDataResult {
  const [data, setData]               = useState<GraphData | null>(null);
  const [isLoading, setLoading]       = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tick, setTick]               = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // ── Auto-refresh when notes change in the store ───────────────────────────
  const notes       = useNoteStore((s) => s.notes);
  const prevHashRef = useRef<string>("");

  useEffect(() => {
    const hash = notes.map((n) => `${n.id}:${n.updated_at}`).join("|");
    if (hash !== prevHashRef.current) {
      prevHashRef.current = hash;
      if (prevHashRef.current !== "") {
        setTick((t) => t + 1);
      }
    }
  }, [notes]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
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

        // ── Deduplicate edges by canonical pair, carry weight ─────────────
        // A→B and B→A are the same visual edge — merge them into one with
        // weight = total number of backlinks between the pair.
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

  return { data, isLoading, error, refresh, lastUpdated };
}