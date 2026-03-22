// src/features/graph/GraphNotePreview.tsx
//
// Fixed top-left hover preview panel for the graph view.
// - Scrollable heading list, each heading navigates to that position in the note
// - Plaintext snippet fallback when note has no headings
// - Link count display
// - Staggered entrance animation on headings
// - H1 accent left-border differentiation
// - 300ms exit delay so panel fades gracefully on node click
// - onPanelMouseEnter/Leave props so D3 mouseleave is suppressed while
//   the cursor is over the panel itself

import { useEffect, useRef, useState } from "react";
import { getNoteById } from "@/features/notes/db/queries";
import type { GraphNode } from "./graphTypes";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Heading {
  level: number;
  text: string;
}

interface PreviewData {
  headings: Heading[];
  snippet: string;
  tags: string[];
  linkCount: number;
}

export interface GraphNotePreviewProps {
  node: GraphNode | null;
  tagColorMap: Map<string, string>;
  /** Called when user clicks title (no heading) or a heading row */
  onOpen: (nodeId: string, headingText?: string) => void;
  /** Cursor entered the panel — parent should suppress D3 mouseleave */
  onPanelMouseEnter: () => void;
  /** Cursor left the panel */
  onPanelMouseLeave: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHeadings(content: string | null): Heading[] {
  if (!content) return [];
  try {
    const doc = JSON.parse(content);
    const headings: Heading[] = [];
    function walk(nodes: any[]) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        if (node.type === "heading" && node.attrs?.level) {
          const text = (node.content ?? [])
            .filter((n: any) => n.type === "text")
            .map((n: any) => n.text ?? "")
            .join("").trim();
          if (text) headings.push({ level: node.attrs.level, text });
        }
        if (Array.isArray(node.content)) walk(node.content);
      }
    }
    walk(doc.content ?? []);
    return headings;
  } catch {
    return [];
  }
}

function extractSnippet(plaintext: string | null): string {
  if (!plaintext) return "";
  const lines = plaintext.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 3).join(" ").slice(0, 160);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL_COLOR  = "var(--color-text, #e2e2e2)";
const ACCENT_COLOR = "#6366f1";
const TAG_PALETTE  = [
  "#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6",
  "#ec4899","#14b8a6","#f97316","#8b5cf6","#84cc16",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphNotePreview({
  node,
  tagColorMap,
  onOpen,
  onPanelMouseEnter,
  onPanelMouseLeave,
}: GraphNotePreviewProps) {
  const [preview, setPreview]   = useState<PreviewData | null>(null);
  const [visible, setVisible]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [animated, setAnimated] = useState(false);

  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (debounceRef.current)  clearTimeout(debounceRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);

    if (!node) {
      // 300ms exit delay — lets the panel fade gracefully when a node is clicked
      exitTimerRef.current = setTimeout(() => {
        setVisible(false);
        setTimeout(() => { setPreview(null); setAnimated(false); }, 200);
      }, 300);
      return () => { if (exitTimerRef.current) clearTimeout(exitTimerRef.current); };
    }

    // 150ms debounce — ignore fast mouse-overs
    debounceRef.current = setTimeout(async () => {
      currentIdRef.current = node.id;
      setLoading(true);
      setAnimated(false);
      try {
        const fetched = await getNoteById(node.id);
        if (currentIdRef.current !== node.id) return; // stale, node changed
        const headings = extractHeadings(fetched?.content ?? null);
        const snippet  = extractSnippet(fetched?.plaintext ?? null);
        setPreview({ headings, snippet, tags: node.tags, linkCount: node.linkCount });
        setVisible(true);
        requestAnimationFrame(() => setAnimated(true)); // trigger stagger after paint
      } catch {
        if (currentIdRef.current === node.id) setPreview(null);
      } finally {
        if (currentIdRef.current === node.id) setLoading(false);
      }
    }, 150);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [node]);

  const show        = visible && node !== null;
  const hasHeadings = (preview?.headings.length ?? 0) > 0;
  const hasSnippet  = !!preview?.snippet;

  return (
    <>
      <div
        onMouseEnter={onPanelMouseEnter}
        onMouseLeave={onPanelMouseLeave}
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          width: 240,
          maxHeight: 300,
          zIndex: 20,
          pointerEvents: show ? "auto" : "none",
          opacity: show ? 1 : 0,
          transform: show ? "translateY(0) scale(1)" : "translateY(-6px) scale(0.97)",
          transition: "opacity 180ms ease, transform 180ms ease",
          display: "flex",
          flexDirection: "column",
          borderRadius: 10,
          overflow: "hidden",
          background: "rgba(18,18,18,0.97)",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
          backdropFilter: "blur(10px)",
        }}
      >
        {/* ── Title / header ──────────────────────────────────────────────── */}
        <button
          onClick={() => node && onOpen(node.id)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 12px 8px",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            cursor: "pointer",
            textAlign: "left",
            flexShrink: 0,
            transition: "background 120ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: LABEL_COLOR,
            lineHeight: 1.35,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}>
            {node?.title ?? ""}
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.35 }}>
            <path d="M2 5h6M5 2l3 3-3 3" stroke={LABEL_COLOR} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* ── Link count + tags ───────────────────────────────────────────── */}
        {preview && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            flexShrink: 0,
            flexWrap: "wrap",
          }}>
            <span style={{ fontSize: 11, color: LABEL_COLOR, opacity: 0.38, whiteSpace: "nowrap" }}>
              {preview.linkCount} {preview.linkCount === 1 ? "link" : "links"}
            </span>
            {preview.tags.map((tag) => {
              const color = tagColorMap.get(tag) ?? TAG_PALETTE[0];
              return (
                <span key={tag} style={{
                  background: `${color}22`,
                  border: `1px solid ${color}55`,
                  borderRadius: 3,
                  padding: "1px 6px",
                  fontSize: 10,
                  color,
                  lineHeight: 1.6,
                }}>
                  {tag}
                </span>
              );
            })}
          </div>
        )}

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>

          {/* Loading shimmer */}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px" }}>
              {[75, 55, 65].map((w, i) => (
                <div key={i} style={{
                  height: 10,
                  width: `${w}%`,
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 4,
                  animation: "gpShimmer 1.2s ease infinite",
                  animationDelay: `${i * 0.15}s`,
                }} />
              ))}
            </div>
          )}

          {/* Headings list — each row navigates to that heading */}
          {!loading && hasHeadings && (
            <ul style={{ listStyle: "none", margin: 0, padding: "5px 0" }}>
              {preview!.headings.map((h, i) => (
                <li key={i} style={{
                  opacity:   animated ? 1 : 0,
                  transform: animated ? "translateX(0)" : "translateX(-6px)",
                  transition: `opacity 180ms ease ${i * 28}ms, transform 180ms ease ${i * 28}ms`,
                }}>
                  <button
                    onClick={() => node && onOpen(node.id, h.text)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      paddingLeft: h.level === 1 ? 0 : 8 + (h.level - 1) * 10,
                      paddingRight: 12,
                      paddingTop: 5,
                      paddingBottom: 5,
                      background: "transparent",
                      border: "none",
                      // H1 gets an accent left border to differentiate from H2
                      borderLeft: h.level === 1
                        ? `2px solid ${ACCENT_COLOR}`
                        : "2px solid transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "background 80ms ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Level badge */}
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: h.level === 1 ? ACCENT_COLOR : LABEL_COLOR,
                      opacity: h.level === 1 ? 0.9 : 0.32,
                      textTransform: "uppercase",
                      flexShrink: 0,
                      letterSpacing: "0.04em",
                      paddingLeft: h.level === 1 ? 10 : 0,
                    }}>
                      H{h.level}
                    </span>
                    {/* Text */}
                    <span style={{
                      fontSize: h.level === 1 ? 12 : 11,
                      fontWeight: h.level === 1 ? 600 : h.level === 2 ? 500 : 400,
                      color: LABEL_COLOR,
                      opacity: h.level === 1 ? 0.88 : h.level === 2 ? 0.62 : 0.42,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}>
                      {h.text}
                    </span>
                    {/* Arrow */}
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, opacity: 0.22 }}>
                      <path d="M1 4h6M4 1.5l2.5 2.5L4 6.5" stroke={LABEL_COLOR} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Plaintext snippet fallback — when note has content but no headings */}
          {!loading && !hasHeadings && hasSnippet && (
            <p style={{
              margin: 0,
              padding: "10px 12px",
              fontSize: 11,
              color: LABEL_COLOR,
              opacity: 0.48,
              lineHeight: 1.65,
            }}>
              {preview!.snippet}
            </p>
          )}

          {/* Truly empty note */}
          {!loading && !hasHeadings && !hasSnippet && preview && (
            <p style={{
              margin: 0,
              padding: "10px 12px",
              fontSize: 11,
              color: LABEL_COLOR,
              opacity: 0.28,
              fontStyle: "italic",
            }}>
              No content yet.
            </p>
          )}
        </div>

        {/* ── Footer hint ─────────────────────────────────────────────────── */}
        {!loading && preview && (
          <div style={{
            padding: "5px 12px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 10, color: LABEL_COLOR, opacity: 0.26 }}>
              {hasHeadings ? "Click heading to jump there" : "Click title to open note"}
            </span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes gpShimmer {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.85; }
        }
      `}</style>
    </>
  );
}