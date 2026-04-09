// src/features/graph/GraphNotePanel.tsx
//
// Unified right-side panel for the graph view. Replaces both GraphNotePreview
// and GraphNodeDetailPanel. Three modes:
//
//   preview  — hover populates it, shows headings/snippet/tags/links
//   detail   — single click locks it open, adds word count + backlinks list
//   edge     — single click on an edge, shows backlink context + delete action
//
// Transitions between modes are animated. Panel slides in from the right.
// Close button or Escape returns to idle (hidden).

import { useEffect, useRef, useState } from "react";
import { getNoteById, getBacklinksForNote } from "@/features/notes/db/queries";
import type { GraphNode } from "./graphTypes";
import type { Note } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Heading {
  level: number;
  text:  string;
}

interface PreviewData {
  headings:  Heading[];
  snippet:   string;
  tags:      string[];
  linkCount: number;
  wordCount: number;
  createdAt: number;
}

export type PanelMode = "idle" | "preview" | "detail" | "edge";

export interface EdgeContext {
  sourceId:    string;
  targetId:    string;
  sourceTitle: string;
  targetTitle: string;
  snippet:     string;
}

export interface GraphNotePanelProps {
  // Node being hovered (preview mode trigger)
  hoveredNode:   GraphNode | null;
  // Node that was clicked (detail mode trigger) — null to close detail
  detailNode:    GraphNode | null;
  // Edge that was clicked (edge mode trigger) — null to close edge
  edgeContext:   EdgeContext | null;
  tagColorMap:   Map<string, string>;
  notes:         Note[];
  /** Heading navigation — opens note in editor at that heading */
  onOpen:        (nodeId: string, headingText?: string) => void;
  /** Called when panel requests closing detail/edge mode */
  onCloseDetail: () => void;
  onCloseEdge:   () => void;
  /** Delete edge — called after confirmation */
  onDeleteEdge:  (sourceId: string, targetId: string) => void;
  /** Focus node in graph */
  onFocusNode:   (nodeId: string) => void;
  /** Open a backlink note */
  onOpenBacklink:(noteId: string) => void;
  /** Suppress D3 mouseleave while cursor is over panel */
  onPanelMouseEnter: () => void;
  onPanelMouseLeave: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL  = "var(--color-text, #e2e2e2)";
const ACCENT = "#6366f1";
const DANGER = "#ef4444";
const TAG_PALETTE = [
  "#6366f1","#f59e0b","#10b981","#ef4444","#3b82f6",
  "#ec4899","#14b8a6","#f97316","#8b5cf6","#84cc16",
];
const PANEL_WIDTH = 256;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHeadings(content: string | null | undefined): Heading[] {
  if (!content) return [];
  try {
    const doc = JSON.parse(content);
    const out: Heading[] = [];
    function walk(nodes: any[]) {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        if (n.type === "heading" && n.attrs?.level) {
          const text = (n.content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text ?? "")
            .join("").trim();
          if (text) out.push({ level: n.attrs.level, text });
        }
        if (Array.isArray(n.content)) walk(n.content);
      }
    }
    walk(doc.content ?? []);
    return out;
  } catch { return []; }
}

function extractSnippet(plaintext: string | null | undefined): string {
  if (!plaintext) return "";
  return plaintext.split("\n").map(l => l.trim()).filter(Boolean)
    .slice(0, 3).join(" ").slice(0, 160);
}

function countWords(plaintext: string | null | undefined): number {
  if (!plaintext) return 0;
  return plaintext.trim().split(/\s+/).filter(Boolean).length;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background:   `${color}22`,
      border:       `1px solid ${color}55`,
      borderRadius: 3,
      padding:      "1px 6px",
      fontSize:     10,
      color,
      lineHeight:   1.6,
      whiteSpace:   "nowrap",
    }}>
      {label}
    </span>
  );
}

function Shimmer() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 14px" }}>
      {[75, 55, 65].map((w, i) => (
        <div key={i} style={{
          height: 10, width: `${w}%`,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 4,
          animation: `gnpShimmer 1.2s ease infinite`,
          animationDelay: `${i * 0.15}s`,
        }} />
      ))}
    </div>
  );
}

function CloseBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Close"
      style={{
        background: "transparent", border: "none",
        cursor: "pointer", padding: 4, borderRadius: 4,
        color: LABEL, opacity: 0.4, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "opacity 120ms",
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
      onMouseLeave={e => (e.currentTarget.style.opacity = "0.4")}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 2l8 8M10 2l-8 8" stroke={LABEL} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphNotePanel({
  hoveredNode,
  detailNode,
  edgeContext,
  tagColorMap,
  onOpen,
  onCloseDetail,
  onCloseEdge,
  onDeleteEdge,
  onFocusNode,
  onOpenBacklink,
  onPanelMouseEnter,
  onPanelMouseLeave,
}: GraphNotePanelProps) {

  // ── Mode resolution ────────────────────────────────────────────────────────
  // Priority: edge > detail > preview > idle
  const mode: PanelMode =
    edgeContext  ? "edge"    :
    detailNode   ? "detail"  :
    hoveredNode  ? "preview" : "idle";

  const activeNodeId =
    mode === "detail"  ? detailNode?.id  :
    mode === "preview" ? hoveredNode?.id : null;

  // ── Preview data fetch ─────────────────────────────────────────────────────
  const [preview,  setPreview]  = useState<PreviewData | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [animated, setAnimated] = useState(false);

  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIdRef = useRef<string | null>(null);

  // ── Backlinks for detail mode ──────────────────────────────────────────────
  const [backlinks,        setBacklinks]        = useState<Note[]>([]);
  const [backlinksLoading, setBacklinksLoading] = useState(false);

  // ── Edge delete confirmation ───────────────────────────────────────────────
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // ── Visibility (for CSS transition) ───────────────────────────────────────
  const [visible, setVisible] = useState(false);

  // Reset delete confirm when edge context changes
  useEffect(() => { setConfirmingDelete(false); }, [edgeContext]);

  // ── Fetch note data when active node changes ───────────────────────────────
  useEffect(() => {
    if (debounceRef.current)  clearTimeout(debounceRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);

    if (!activeNodeId) {
      if (mode === "idle") {
        // Small exit delay so the panel fades gracefully
        exitTimerRef.current = setTimeout(() => {
          setVisible(false);
          setTimeout(() => { setPreview(null); setAnimated(false); }, 200);
        }, 300);
      }
      return () => { if (exitTimerRef.current) clearTimeout(exitTimerRef.current); };
    }

    setVisible(true);

    // 150ms debounce — skip fast mouse-overs
    debounceRef.current = setTimeout(async () => {
      currentIdRef.current = activeNodeId;
      setLoading(true);
      setAnimated(false);

      try {
        const fetched = await getNoteById(activeNodeId);
        if (currentIdRef.current !== activeNodeId) return;

        const node = detailNode ?? hoveredNode!;
        const headings  = extractHeadings(fetched?.content);
        const snippet   = extractSnippet(fetched?.plaintext);
        const wordCount = countWords(fetched?.plaintext);

        setPreview({
          headings,
          snippet,
          tags:      node.tags,
          linkCount: node.linkCount,
          wordCount,
          createdAt: node.created_at,
        });
        requestAnimationFrame(() => setAnimated(true));
      } catch {
        if (currentIdRef.current === activeNodeId) setPreview(null);
      } finally {
        if (currentIdRef.current === activeNodeId) setLoading(false);
      }
    }, 150);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [activeNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch backlinks when entering detail mode ──────────────────────────────
  useEffect(() => {
    if (mode !== "detail" || !detailNode) { setBacklinks([]); return; }
    setBacklinksLoading(true);
    getBacklinksForNote(detailNode.id)
      .then(bls => { setBacklinks(bls); setBacklinksLoading(false); })
      .catch(() => setBacklinksLoading(false));
  }, [detailNode?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show panel when edge context arrives
  useEffect(() => {
    if (edgeContext) setVisible(true);
  }, [edgeContext]);

  const show = visible && mode !== "idle";

  const activeNode = detailNode ?? hoveredNode;
  const hasHeadings = (preview?.headings.length ?? 0) > 0;
  const hasSnippet  = !!preview?.snippet;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div
        onMouseEnter={onPanelMouseEnter}
        onMouseLeave={onPanelMouseLeave}
        style={{
          position:   "absolute",
          top:        16,
          right:      16,
          width:      PANEL_WIDTH,
          maxHeight:  "calc(100% - 32px)",
          zIndex:     20,
          pointerEvents: show ? "auto" : "none",
          opacity:    show ? 1 : 0,
          transform:  show
            ? "translateX(0) scale(1)"
            : "translateX(12px) scale(0.97)",
          transition: "opacity 200ms ease, transform 200ms ease",
          display:    "flex",
          flexDirection: "column",
          borderRadius:  10,
          overflow:   "hidden",
          background: "rgba(16,16,16,0.97)",
          border:     "1px solid rgba(255,255,255,0.09)",
          boxShadow:  "0 8px 32px rgba(0,0,0,0.6)",
          backdropFilter: "blur(12px)",
        }}
      >

        {/* ══════════════════════════════════════════════════════════════════
            EDGE MODE
        ══════════════════════════════════════════════════════════════════ */}
        {mode === "edge" && edgeContext && (
          <>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center",
              padding: "10px 12px 8px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              gap: 8, flexShrink: 0,
            }}>
              {/* Edge icon */}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                <circle cx="2.5" cy="7" r="2" stroke={LABEL} strokeWidth="1.2"/>
                <circle cx="11.5" cy="7" r="2" stroke={LABEL} strokeWidth="1.2"/>
                <line x1="4.5" y1="7" x2="9.5" y2="7" stroke={LABEL} strokeWidth="1.2"/>
              </svg>
              <span style={{ fontSize: 11, fontWeight: 600, color: LABEL, opacity: 0.5, flex: 1, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Link
              </span>
              <CloseBtn onClick={onCloseEdge} />
            </div>

            {/* Note titles */}
            <div style={{ padding: "10px 14px 0", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <button
                  onClick={() => onOpen(edgeContext.sourceId)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: LABEL, opacity: 0.9 }}>
                    {edgeContext.sourceTitle}
                  </span>
                </button>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.35 }}>
                  <path d="M2 5h6M5 2l3 3-3 3" stroke={LABEL} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <button
                  onClick={() => onOpen(edgeContext.targetId)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: LABEL, opacity: 0.9 }}>
                    {edgeContext.targetTitle}
                  </span>
                </button>
              </div>

              {/* Snippet */}
              {edgeContext.snippet ? (
                <div style={{
                  background:   "rgba(255,255,255,0.04)",
                  border:       "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 6,
                  padding:      "8px 10px",
                  marginBottom: 10,
                }}>
                  <p style={{
                    margin: 0, fontSize: 11, color: LABEL,
                    opacity: 0.6, lineHeight: 1.65,
                    fontStyle: "italic",
                  }}>
                    "{edgeContext.snippet}"
                  </p>
                </div>
              ) : (
                <p style={{ margin: "0 0 10px", fontSize: 11, color: LABEL, opacity: 0.3, fontStyle: "italic" }}>
                  No context available.
                </p>
              )}
            </div>

            {/* Delete area */}
            <div style={{ padding: "0 14px 12px", flexShrink: 0 }}>
              {!confirmingDelete ? (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  style={{
                    width: "100%", padding: "7px 0",
                    background: `${DANGER}18`,
                    border: `1px solid ${DANGER}44`,
                    borderRadius: 6, cursor: "pointer",
                    fontSize: 11, fontWeight: 600,
                    color: DANGER, letterSpacing: "0.02em",
                    transition: "background 120ms",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${DANGER}28`)}
                  onMouseLeave={e => (e.currentTarget.style.background = `${DANGER}18`)}
                >
                  Remove link
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, color: LABEL, opacity: 0.55, textAlign: "center" }}>
                    Remove this link?
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setConfirmingDelete(false)}
                      style={{
                        flex: 1, padding: "6px 0",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 6, cursor: "pointer",
                        fontSize: 11, color: LABEL, opacity: 0.7,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setConfirmingDelete(false);
                        onDeleteEdge(edgeContext.sourceId, edgeContext.targetId);
                      }}
                      style={{
                        flex: 1, padding: "6px 0",
                        background: DANGER,
                        border: "none",
                        borderRadius: 6, cursor: "pointer",
                        fontSize: 11, fontWeight: 700,
                        color: "#fff",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            PREVIEW + DETAIL MODE (shared node content)
        ══════════════════════════════════════════════════════════════════ */}
        {(mode === "preview" || mode === "detail") && (
          <>
            {/* Title header */}
            <div style={{
              display: "flex", alignItems: "center",
              padding: "10px 10px 8px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              gap: 6, flexShrink: 0,
            }}>
              <button
                onClick={() => activeNode && onOpen(activeNode.id)}
                style={{
                  background: "transparent", border: "none",
                  cursor: "pointer", padding: 0, textAlign: "left", flex: 1,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <span style={{
                  fontSize: 13, fontWeight: 600, color: LABEL,
                  lineHeight: 1.35, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {activeNode?.title ?? ""}
                </span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.3 }}>
                  <path d="M2 5h6M5 2l3 3-3 3" stroke={LABEL} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Focus button — only in detail mode */}
              {mode === "detail" && activeNode && (
                <button
                  onClick={() => onFocusNode(activeNode.id)}
                  title="Focus in graph"
                  style={{
                    background: "transparent", border: "none",
                    cursor: "pointer", padding: 4, borderRadius: 4,
                    opacity: 0.4, flexShrink: 0,
                    display: "flex", alignItems: "center",
                    transition: "opacity 120ms",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0.4")}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="2" stroke={LABEL} strokeWidth="1.3"/>
                    <path d="M6 1v2M6 9v2M1 6h2M9 6h2" stroke={LABEL} strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              )}

              {mode === "detail" && <CloseBtn onClick={onCloseDetail} />}
            </div>

            {/* Meta row — link count + tags */}
            {preview && (
              <div style={{
                display: "flex", alignItems: "center",
                gap: 6, padding: "5px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                flexShrink: 0, flexWrap: "wrap",
              }}>
                <span style={{ fontSize: 11, color: LABEL, opacity: 0.38, whiteSpace: "nowrap" }}>
                  {preview.linkCount} {preview.linkCount === 1 ? "link" : "links"}
                </span>
                {preview.tags.map(tag => {
                  const color = tagColorMap.get(tag) ?? TAG_PALETTE[0];
                  return <Tag key={tag} label={tag} color={color} />;
                })}
              </div>
            )}

            {/* Detail stats row — word count + date */}
            {mode === "detail" && preview && (
              <div style={{
                display: "flex", alignItems: "center",
                gap: 12, padding: "5px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 11, color: LABEL, opacity: 0.35 }}>
                  {preview.wordCount} {preview.wordCount === 1 ? "word" : "words"}
                </span>
                {preview.createdAt > 0 && (
                  <span style={{ fontSize: 11, color: LABEL, opacity: 0.35 }}>
                    {formatDate(preview.createdAt)}
                  </span>
                )}
              </div>
            )}

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>

              {loading && <Shimmer />}

              {/* Headings list */}
              {!loading && hasHeadings && (
                <ul style={{ listStyle: "none", margin: 0, padding: "5px 0" }}>
                  {preview!.headings.map((h, i) => (
                    <li key={i} style={{
                      opacity:   animated ? 1 : 0,
                      transform: animated ? "translateX(0)" : "translateX(-6px)",
                      transition: `opacity 180ms ease ${i * 28}ms, transform 180ms ease ${i * 28}ms`,
                    }}>
                      <button
                        onClick={() => activeNode && onOpen(activeNode.id, h.text)}
                        style={{
                          width: "100%", display: "flex", alignItems: "center",
                          gap: 6,
                          paddingLeft:  h.level === 1 ? 0 : 8 + (h.level - 1) * 10,
                          paddingRight: 12, paddingTop: 5, paddingBottom: 5,
                          background: "transparent", border: "none",
                          borderLeft: h.level === 1
                            ? `2px solid ${ACCENT}`
                            : "2px solid transparent",
                          cursor: "pointer", textAlign: "left",
                          transition: "background 80ms ease",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <span style={{
                          fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                          color:   h.level === 1 ? ACCENT : LABEL,
                          opacity: h.level === 1 ? 0.9 : 0.32,
                          flexShrink: 0, letterSpacing: "0.04em",
                          paddingLeft: h.level === 1 ? 10 : 0,
                        }}>
                          H{h.level}
                        </span>
                        <span style={{
                          fontSize:   h.level === 1 ? 12 : 11,
                          fontWeight: h.level === 1 ? 600 : h.level === 2 ? 500 : 400,
                          color:   LABEL,
                          opacity: h.level === 1 ? 0.88 : h.level === 2 ? 0.62 : 0.42,
                          overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", flex: 1,
                        }}>
                          {h.text}
                        </span>
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, opacity: 0.22 }}>
                          <path d="M1 4h6M4 1.5l2.5 2.5L4 6.5" stroke={LABEL} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Snippet fallback */}
              {!loading && !hasHeadings && hasSnippet && (
                <p style={{ margin: 0, padding: "10px 12px", fontSize: 11, color: LABEL, opacity: 0.48, lineHeight: 1.65 }}>
                  {preview!.snippet}
                </p>
              )}

              {/* Empty */}
              {!loading && !hasHeadings && !hasSnippet && preview && (
                <p style={{ margin: 0, padding: "10px 12px", fontSize: 11, color: LABEL, opacity: 0.28, fontStyle: "italic" }}>
                  No content yet.
                </p>
              )}

              {/* Backlinks — detail mode only */}
              {mode === "detail" && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: 4 }}>
                  <div style={{ padding: "7px 12px 4px", fontSize: 10, fontWeight: 600, color: LABEL, opacity: 0.3, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Backlinks
                  </div>
                  {backlinksLoading && <Shimmer />}
                  {!backlinksLoading && backlinks.length === 0 && (
                    <p style={{ margin: 0, padding: "4px 12px 10px", fontSize: 11, color: LABEL, opacity: 0.28, fontStyle: "italic" }}>
                      No backlinks.
                    </p>
                  )}
                  {!backlinksLoading && backlinks.map(bl => (
                    <button
                      key={bl.id}
                      onClick={() => onOpenBacklink(bl.id)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center",
                        gap: 6, padding: "5px 12px",
                        background: "transparent", border: "none",
                        cursor: "pointer", textAlign: "left",
                        transition: "background 80ms",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, opacity: 0.3 }}>
                        <path d="M1 4h6M4 1.5l2.5 2.5L4 6.5" stroke={LABEL} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontSize: 11, color: LABEL, opacity: 0.65, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {bl.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer hint */}
            {!loading && preview && (
              <div style={{ padding: "5px 12px", borderTop: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: LABEL, opacity: 0.26 }}>
                  {mode === "detail"
                    ? "Double-click node to edit · Triple-click to open"
                    : hasHeadings ? "Click heading to jump · Click node for detail" : "Click node for detail"}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes gnpShimmer {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.85; }
        }
      `}</style>
    </>
  );
}