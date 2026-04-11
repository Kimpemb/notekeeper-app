// src/features/graph/useGraphSearch.ts

import { useEffect, useRef, useState, RefObject } from "react";
import * as d3 from "d3";
import type { GraphNode } from "./graphTypes";
import { searchNotes } from "@/features/notes/db/queries";

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_COLOR = "#f97316"; // Jarvis orange

interface UseGraphSearchProps {
  searchQuery:   string;
  focusNodeId:   string | null;
  svgRef:        RefObject<SVGSVGElement | null>;
  zoomRef:       RefObject<d3.ZoomBehavior<SVGSVGElement, unknown> | null>;
  containerRef:  RefObject<HTMLDivElement | null>;
  simNodesRef:   RefObject<GraphNode[]>;
  simSettledRef: RefObject<boolean>;
}

interface UseGraphSearchResult {
  matchIndex:     number;
  matchCount:     number;
  matchedIds:     Set<string>;        // consumed by GraphView for visibleNodes filter
  matchSnippets:  Map<string, string>; // nodeId → FTS5 snippet for panel hover
  currentMatchId: string | null;      // the node currently centred by Enter cycling
}

// ─── Pulse animation — injected once into the SVG defs ───────────────────────

function ensurePulseAnimation(svg: SVGSVGElement) {
  if (svg.querySelector("#graphSearchPulse")) return;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <style id="graphSearchPulse">
      @keyframes searchPulse {
        0%, 100% { stroke-opacity: 0.5; stroke-width: 3; }
        50%       { stroke-opacity: 1;   stroke-width: 4; }
      }
      .search-current {
        animation: searchPulse 1.2s ease-in-out infinite;
      }
    </style>
  `;
  svg.insertBefore(defs, svg.firstChild);
}

// ─── Apply four-state visual system to D3 selections ─────────────────────────

function applySearchVisuals(
  svg:           d3.Selection<SVGSVGElement, unknown, null, undefined>,
  matchedIds:    Set<string>,
  neighbourIds:  Set<string>,
  currentMatchId: string | null,
) {
  svg.select(".nodes").selectAll<SVGCircleElement, GraphNode>("circle")
    .attr("stroke", (d) => {
      if (d.id === currentMatchId) return SEARCH_COLOR;
      if (matchedIds.has(d.id))    return SEARCH_COLOR;
      if (neighbourIds.has(d.id))  return "rgba(255,255,255,0.4)";
      return "transparent";
    })
    .attr("stroke-width", (d) => {
      if (d.id === currentMatchId) return 3;
      if (matchedIds.has(d.id))    return 1.5;
      if (neighbourIds.has(d.id))  return 0.5;
      return 0;
    })
    .attr("fill-opacity", (d) => {
      if (d.id === currentMatchId) return 1;
      if (matchedIds.has(d.id))    return 1;
      if (neighbourIds.has(d.id))  return 0.35;
      return 0.08;
    })
    .classed("search-current", (d) => d.id === currentMatchId);

  // Labels — only matched nodes show their label, at any zoom level
  svg.select(".labels").selectAll<SVGTextElement, GraphNode>("text")
    .attr("opacity", (d) => {
      if (d.id === currentMatchId) return 1;
      if (matchedIds.has(d.id))    return 1;
      return 0; // neighbours and non-matched: hidden regardless of zoom
    })
    .attr("font-weight", (d) => d.id === currentMatchId ? "700" : "400");
}

// ─── Reset visuals to pre-search state ───────────────────────────────────────

function resetVisuals(
  svg:         d3.Selection<SVGSVGElement, unknown, null, undefined>,
  focusNodeId: string | null,
) {
  svg.select(".nodes").selectAll<SVGCircleElement, GraphNode>("circle")
    .classed("search-current", false)
    .attr("stroke",       (d) => focusNodeId === d.id ? "#fff" : "transparent")
    .attr("stroke-width", (d) => focusNodeId === d.id ? 2 : 0)
    .attr("fill-opacity", (d) => focusNodeId === d.id ? 1 : 0.85);

  svg.select(".labels").selectAll<SVGTextElement, GraphNode>("text")
    .attr("opacity",      (d) => focusNodeId === d.id ? 1 : 0.7)
    .attr("font-weight",  "400");
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGraphSearch({
  searchQuery,
  focusNodeId,
  svgRef,
  zoomRef,
  containerRef,
  simNodesRef,
  simSettledRef,
}: UseGraphSearchProps): UseGraphSearchResult {

  const [matchIndex,     setMatchIndex]     = useState(0);
  const [matchedIds,     setMatchedIds]     = useState<Set<string>>(new Set());
const [matchSnippets,  setMatchSnippets]  = useState<Map<string, string>>(new Map());
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);

  const matchIndexRef    = useRef(0);
  const matchedIdsRef    = useRef<Set<string>>(new Set());
  const neighbourIdsRef  = useRef<Set<string>>(new Set());
  const currentMatchRef  = useRef<string | null>(null);
  const scrollTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── FTS5 query + initial D3 highlight ──────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current)  clearTimeout(debounceRef.current);
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);

    matchIndexRef.current = 0;
    setMatchIndex(0);
    setCurrentMatchId(null);
    currentMatchRef.current = null;

    const q = searchQuery.trim().toLowerCase();

    if (!q) {
      setMatchedIds(new Set());
      setMatchSnippets(new Map());
      matchedIdsRef.current   = new Set();
      neighbourIdsRef.current = new Set();
      if (svgRef.current) {
        resetVisuals(d3.select(svgRef.current), focusNodeId);
      }
      return;
    }

    debounceRef.current = setTimeout(async () => {
      // FTS5 — searches title + body content
      const rawResults = await searchNotes(q, 200);

      // Boost title matches to the top so exact/partial title hits rank before
      // body-only hits. Rank 0 = exact title, 1 = title contains, 2 = body only.
      const results = [...rawResults].sort((a, b) => {
        const aTitle = (a.title ?? "").toLowerCase();
        const bTitle = (b.title ?? "").toLowerCase();
        const aRank  = aTitle === q ? 0 : aTitle.includes(q) ? 1 : 2;
        const bRank  = bTitle === q ? 0 : bTitle.includes(q) ? 1 : 2;
        return aRank - bRank;
      });

      const ids      = new Set(results.map((r) => r.id));
      const snippets = new Map(results.map((r) => [r.id, r.snippet]));

      // Build 1-degree neighbour set from sim edges
      // We read edges directly from the SVG data binding
      const neighbours = new Set<string>();
      if (svgRef.current) {
        d3.select(svgRef.current)
          .select(".links")
          .selectAll<SVGLineElement, { source: GraphNode; target: GraphNode }>("line")
          .each((e) => {
            const sid = e.source?.id;
            const tid = e.target?.id;
            if (sid && tid) {
              if (ids.has(sid) && !ids.has(tid)) neighbours.add(tid);
              if (ids.has(tid) && !ids.has(sid)) neighbours.add(sid);
            }
          });
      }

      matchedIdsRef.current   = ids;
      neighbourIdsRef.current = neighbours;

      setMatchedIds(ids);
      setMatchSnippets(snippets);

      // Set initial currentMatchId to first sim match (respects ranked order)
      const firstMatch = results.find((r) => simNodesRef.current.some((n) => n.id === r.id));
      const firstSimNode = firstMatch
        ? simNodesRef.current.find((n) => n.id === firstMatch.id) ?? null
        : null;
      const firstId = firstSimNode?.id ?? null;
      setCurrentMatchId(firstId);
      currentMatchRef.current = firstId;

      if (!svgRef.current) return;
      const svg = d3.select(svgRef.current);
      ensurePulseAnimation(svgRef.current);
      applySearchVisuals(svg, ids, neighbours, firstId);

      // Pan to first match
      scrollTimerRef.current = setTimeout(() => {
        if (!svgRef.current || !zoomRef.current || !containerRef.current) return;
        if (!simSettledRef.current) return;
        if (!firstSimNode) return;

        const nx = firstSimNode.x ?? 0;
        const ny = firstSimNode.y ?? 0;
        if (Math.abs(nx) < 1 && Math.abs(ny) < 1) return;

        const width  = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        const k      = d3.zoomTransform(svgRef.current).k;

        d3.select(svgRef.current).transition().duration(500).call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(width / 2 - nx * k, height / 2 - ny * k).scale(k)
        );
      }, 200);
    }, 150);

    return () => {
      if (debounceRef.current)    clearTimeout(debounceRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [searchQuery, focusNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enter key — cycle through matches + update current highlight ───────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (!searchQuery.trim()) return;
      if (!svgRef.current || !zoomRef.current || !containerRef.current) return;
      if (!simSettledRef.current) return;

      const matches = simNodesRef.current.filter((n) => matchedIdsRef.current.has(n.id));
      if (matches.length === 0) return;

      const nextIndex = (matchIndexRef.current + 1) % matches.length;
      matchIndexRef.current = nextIndex;
      setMatchIndex(nextIndex);

      const target = matches[nextIndex];
      setCurrentMatchId(target.id);
      currentMatchRef.current = target.id;

      // Re-apply visuals with new current match
      applySearchVisuals(
        d3.select(svgRef.current),
        matchedIdsRef.current,
        neighbourIdsRef.current,
        target.id,
      );

      const nx     = target.x ?? 0;
      const ny     = target.y ?? 0;
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

  const matchCount = matchedIds.size > 0
    ? simNodesRef.current.filter((n) => matchedIds.has(n.id)).length
    : 0;

  return { matchIndex, matchCount, matchedIds, matchSnippets, currentMatchId };
}