import React, { useRef, useEffect, useState, useCallback } from "react";
import type { CanvasNode as CanvasNodeType, Viewport } from "../../../types/canvas";

interface NodeProps {
  node:         CanvasNodeType;
  viewport:     Viewport;
  isSelected:   boolean;
  isEditing:    boolean;
  isConnecting: boolean;
  onDragStart:    (id: string, e: React.PointerEvent) => void;
  onDrag:         (id: string, e: React.PointerEvent) => void;
  onDragEnd:      (id: string, e: React.PointerEvent) => void;
  onCommit:       (id: string, content: string, height: number) => void;
  onDiscard:      (id: string) => void;
  onEditStart:    (id: string) => void;
  onResize:       (id: string, height: number) => void;
  onConnectStart: (id: string, e: React.PointerEvent) => void;
  onConnectEnd:   (id: string) => void;
  registerRef?:   (id: string, el: HTMLDivElement | null) => void;
}

const HANDLE_R  = 5;
const FONT_SIZE = 14;
const PAD_H     = 10;
const PAD_V     = 8;
const LINE_H    = 1.55;
const DRAG_THRESHOLD = 4;

export const Node: React.FC<NodeProps> = ({
  node, viewport, isSelected, isEditing, isConnecting,
  onDragStart, onDrag, onDragEnd,
  onCommit, onDiscard, onEditStart,
  onConnectStart, onConnectEnd, registerRef,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measureRef  = useRef<HTMLDivElement>(null);
  const [draft,   setDraft]   = useState(node.content ?? "");
  const [hovered, setHovered] = useState(false);
  const pointerMoved   = useRef(false);
  const pointerDownPos = useRef({ x: 0, y: 0 });
  const isDragging     = useRef(false);

  const { x: vx, y: vy, zoom } = viewport;

  const screenX = node.x * zoom + vx;
  const screenY = node.y * zoom + vy;
  const screenW = node.width  * zoom;
  const screenH = node.height * zoom;
  const radius  = Math.max(5, 8 * zoom);

  // ─── Register ref with parent ────────────────────────────────────────────────
  const nodeContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (registerRef) registerRef(node.id, el);
  }, [node.id, registerRef]);

  // ─── Focus on edit ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  // ─── Sync draft when not editing ───────────────────────────────────────────
  useEffect(() => {
    if (!isEditing) setDraft(node.content ?? "");
  }, [node.content, isEditing]);

  // ─── Auto-grow textarea while typing ───────────────────────────────────────
  useEffect(() => {
    if (!isEditing || !textareaRef.current) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, isEditing]);

  // ─── Measure natural text height for shrink-to-fit on commit ───────────────
  const measureHeight = useCallback((content: string): number => {
    const el = measureRef.current;
    if (!el) return node.height;
    el.textContent = content || " ";
    return Math.max(44, el.scrollHeight + PAD_V * 2);
  }, [node.height]);

  // ─── Commit / discard ──────────────────────────────────────────────────────
  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) {
      const newHeight = measureHeight(trimmed);
      onCommit(node.id, trimmed, newHeight);
    } else {
      onDiscard(node.id);
    }
  }, [draft, node.id, onCommit, onDiscard, measureHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); commit(); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
  };

  // ─── Pointer / drag ────────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isEditing) return;
    e.stopPropagation();
    pointerMoved.current   = false;
    isDragging.current     = false;
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // onDragStart deferred until threshold crossed
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isEditing) return;
    const dx = e.clientX - pointerDownPos.current.x;
    const dy = e.clientY - pointerDownPos.current.y;
    if (!isDragging.current) {
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      isDragging.current   = true;
      pointerMoved.current = true;
      onDragStart(node.id, e); // origin seeded here with live pointer position
    }
    onDrag(node.id, e);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isEditing) return;
    const wasDrag      = isDragging.current;
    isDragging.current = false;
    pointerMoved.current = false;
    if (wasDrag) {
      onDragEnd(node.id, e);
    } else if (isSelected) {
      onEditStart(node.id);
    }
  };

  const handlePointerEnter = () => {
    if (isConnecting) onConnectEnd(node.id);
  };

  // ─── Connection handles ────────────────────────────────────────────────────
  const handles = [
    { id: "t", cx: screenW / 2, cy: 0           },
    { id: "r", cx: screenW,     cy: screenH / 2 },
    { id: "b", cx: screenW / 2, cy: screenH     },
    { id: "l", cx: 0,           cy: screenH / 2 },
  ];

  const showHandles = (hovered || isSelected) && !isEditing;

  // ─── Visual state ──────────────────────────────────────────────────────────
  const borderColor = isConnecting ? "#10b981" : isSelected ? "#7c3aed" : "rgba(255,255,255,0.22)";
  const borderWidth = isSelected || isConnecting ? 2 : 1;
  const boxShadow   = isConnecting
    ? "0 0 0 3px rgba(16,185,129,0.2)"
    : isSelected
      ? "0 0 0 3px rgba(124,58,237,0.15), 0 4px 20px rgba(0,0,0,0.3)"
      : "0 2px 10px rgba(0,0,0,0.25)";

  const containerStyle: React.CSSProperties = {
    position:        "absolute",
    left:            0,
    top:             0,
    transform:       `translate(${screenX}px, ${screenY}px)`,
    width:           screenW,
    height:          screenH,
    backgroundColor: "var(--color-idemora-bg-primary, #1a1b26)",
    border:          `${borderWidth}px solid ${borderColor}`,
    borderRadius:    radius,
    boxShadow,
    boxSizing:       "border-box",
    overflow:        "hidden",
    transition:      "border-color 0.12s, box-shadow 0.12s",
    pointerEvents:   "all",
    cursor:          isEditing ? "text" : hovered ? "grab" : "default",
  };

  const innerStyle: React.CSSProperties = {
    width:           node.width,
    height:          node.height,
    padding:         `${PAD_V}px ${PAD_H}px`,
    fontSize:        FONT_SIZE,
    lineHeight:      LINE_H,
    fontFamily:      "inherit",
    color:           "rgba(226,232,240,0.88)",
    boxSizing:       "border-box",
    whiteSpace:      "pre-wrap",
    wordBreak:       "break-word",
    overflow:        "hidden",
    transform:       `scale(${zoom})`,
    transformOrigin: "top left",
  };

  const textareaStyle: React.CSSProperties = {
    ...innerStyle,
    height:     "auto",
    minHeight:  node.height,
    display:    "block",
    resize:     "none",
    border:     "none",
    outline:    "none",
    background: "transparent",
    overflow:   "hidden",
  };

  return (
    <div
      ref={nodeContainerRef}
      style={containerStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={handlePointerEnter}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Invisible measure div — in layout but hidden so scrollHeight is accurate */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position:      "absolute",
          visibility:    "hidden",
          top:           0,
          left:          0,
          width:         node.width - PAD_H * 2,
          fontSize:      FONT_SIZE,
          lineHeight:    LINE_H,
          fontFamily:    "inherit",
          whiteSpace:    "pre-wrap",
          wordBreak:     "break-word",
          boxSizing:     "border-box",
          pointerEvents: "none",
        }}
      />

      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder="Type something…"
          style={textareaStyle}
        />
      ) : (
        <div style={{ ...innerStyle, userSelect: "none" }}>
          {node.type === "text" && (
            <span style={{ color: node.content ? "rgba(226,232,240,0.88)" : "rgba(148,163,184,0.35)" }}>
              {node.content || "Double-click to edit"}
            </span>
          )}
          {node.type === "note" && node.noteId && (
            <div>
              <strong style={{ fontSize: FONT_SIZE * 0.78, color: "rgba(148,163,184,0.5)", letterSpacing: "0.07em" }}>
                NOTE
              </strong>
              <p style={{ marginTop: 4, color: "rgba(226,232,240,0.88)" }}>
                {node.noteId.slice(0, 8)}…
              </p>
            </div>
          )}
          {node.type === "group" && (
            <div style={{ opacity: 0.25, textAlign: "center" }}>Group</div>
          )}
        </div>
      )}

      {showHandles && (
        <svg
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            overflow: "visible", pointerEvents: "none",
          }}
        >
          {handles.map((h) => (
            <circle
              key={h.id}
              cx={h.cx} cy={h.cy} r={HANDLE_R}
              fill="rgba(255,255,255,0.88)"
              stroke="#7c3aed" strokeWidth={2}
              style={{ pointerEvents: "all", cursor: "crosshair" }}
              onPointerDown={(e) => { e.stopPropagation(); onConnectStart(node.id, e); }}
            />
          ))}
        </svg>
      )}
    </div>
  );
};