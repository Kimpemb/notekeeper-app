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
  // We watch the notes array length + a hash of updated_at values so we catch
  // edits, additions, and deletions without re-fetching on unrelated store changes.
  const notes         = useNoteStore((s) => s.notes);
  const prevHashRef   = useRef<string>("");

  useEffect(() => {
    const hash = notes.map((n) => `${n.id}:${n.updated_at}`).join("|");
    if (hash !== prevHashRef.current) {
      prevHashRef.current = hash;
      // Skip the very first run — initial load handles that via tick=0
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
          id: n.id,
          title: n.title,
          tags: n.tags
            ? (() => { try { return JSON.parse(n.tags!); } catch { return []; } })()
            : [],
          linkCount: linkCount.get(n.id) ?? 0,
        }));

        const nodeIds = new Set(nodes.map((n) => n.id));
        const edges: GraphEdge[] = backlinks
          .filter((b) => nodeIds.has(b.source_id) && nodeIds.has(b.target_id))
          .map((b) => ({ source: b.source_id, target: b.target_id }));

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