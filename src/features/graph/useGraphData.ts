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
  suppressNextAutoRefresh: () => void;
}

export function useGraphData(): UseGraphDataResult {
  const [data, setData]               = useState<GraphData | null>(null);
  const [isLoading, setLoading]       = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tick, setTick]               = useState(0);

  // When set to true, the next notes-hash change is swallowed and this flag
  // resets. Used by createNodeAt so the store update from storeCreateNote
  // does not trigger a full simulation rebuild mid-animation.
  const suppressRef = useRef(false);

  const suppressNextAutoRefresh = useCallback(() => {
    suppressRef.current = true;
  }, []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // ── Auto-refresh when notes change in the store ───────────────────────────
  const notes       = useNoteStore((s) => s.notes);
  const prevHashRef = useRef<string>("");

  useEffect(() => {
    const hash = notes.map((n) => `${n.id}:${n.updated_at}`).join("|");
    if (hash === prevHashRef.current) return;

    const wasEmpty = prevHashRef.current === "";
    prevHashRef.current = hash;

    if (wasEmpty) return; // first load — let the tick=0 fetch handle it

    if (suppressRef.current) {
      // A creation animation is in flight — skip this rebuild entirely.
      // The graph will refresh naturally once the rename is committed
      // (which updates updated_at and triggers a normal hash change).
      suppressRef.current = false;
      return;
    }

    setTick((t) => t + 1);
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

  return { data, isLoading, error, refresh, lastUpdated, suppressNextAutoRefresh };
}