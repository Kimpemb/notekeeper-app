// src/features/graph/useGraphSearch.ts
// Search highlight, auto-pan to first match, Enter key cycling.

import { useEffect, useRef, useState, RefObject } from "react";
import * as d3 from "d3";
import type { GraphNode } from "./graphTypes";

interface UseGraphSearchProps {
  searchQuery: string;
  focusNodeId: string | null;
  svgRef: RefObject<SVGSVGElement | null>;
  zoomRef: RefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  simNodesRef: RefObject<GraphNode[]>;
  simSettledRef: RefObject<boolean>;
}

interface UseGraphSearchResult {
  matchIndex: number;
  matchCount: number;
}

export function useGraphSearch({
  searchQuery,
  focusNodeId,
  svgRef,
  zoomRef,
  containerRef,
  simNodesRef,
  simSettledRef,
}: UseGraphSearchProps): UseGraphSearchResult {
  const [matchIndex, setMatchIndex] = useState(0);
  const matchIndexRef  = useRef(0);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Highlight + auto-pan to first match ────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const q   = searchQuery.trim().toLowerCase();

    // Reset index on every query change
    matchIndexRef.current = 0;
    setMatchIndex(0);

    svg.selectAll<SVGCircleElement, GraphNode>("circle")
      .attr("stroke", (d) => {
        if (focusNodeId === d.id) return "#fff";
        return q && d.title.toLowerCase().includes(q) ? "#fff" : "transparent";
      })
      .attr("fill-opacity", (d) => {
        if (!q) return focusNodeId === d.id ? 1 : 0.85;
        return d.title.toLowerCase().includes(q) ? 1 : 0.2;
      });
    svg.selectAll<SVGTextElement, GraphNode>("text")
      .attr("opacity", (d) => {
        if (focusNodeId === d.id) return 1;
        return q && d.title.toLowerCase().includes(q) ? 1 : 0;
      });

    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    if (!q) return;

    scrollTimerRef.current = setTimeout(() => {
      if (!svgRef.current || !zoomRef.current || !containerRef.current) return;
      if (!simSettledRef.current) return;

      const matches = simNodesRef.current.filter((n) => n.title.toLowerCase().includes(q));
      if (matches.length === 0) return;

      const target = matches[0];
      const nx = target.x ?? 0;
      const ny = target.y ?? 0;
      if (Math.abs(nx) < 1 && Math.abs(ny) < 1) return;

      const width  = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const k      = d3.zoomTransform(svgRef.current).k;

      d3.select(svgRef.current).transition().duration(500).call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(width / 2 - nx * k, height / 2 - ny * k).scale(k)
      );
    }, 400);

    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); };
  }, [searchQuery, focusNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enter key — cycle through matches ──────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (!searchQuery.trim()) return;
      if (!svgRef.current || !zoomRef.current || !containerRef.current) return;
      if (!simSettledRef.current) return;

      const q = searchQuery.trim().toLowerCase();
      const matches = simNodesRef.current.filter((n) => n.title.toLowerCase().includes(q));
      if (matches.length === 0) return;

      const nextIndex = (matchIndexRef.current + 1) % matches.length;
      matchIndexRef.current = nextIndex;
      setMatchIndex(nextIndex);

      const target = matches[nextIndex];
      const nx = target.x ?? 0;
      const ny = target.y ?? 0;

      const width  = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const k      = d3.zoomTransform(svgRef.current).k;

      d3.select(svgRef.current).transition().duration(400).call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(width / 2 - nx * k, height / 2 - ny * k).scale(k)
      );
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute current match count for the counter display
  const q          = searchQuery.trim().toLowerCase();
  const matchCount = q ? simNodesRef.current.filter((n) => n.title.toLowerCase().includes(q)).length : 0;

  return { matchIndex, matchCount };
}