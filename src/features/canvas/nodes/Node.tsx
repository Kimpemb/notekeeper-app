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
  onCommit:       (id: string, content: string) => void;
  onDiscard:      (id: string) => void;
  onEditStart:    (id: string) => void;
  onConnectStart: (id: string, e: React.PointerEvent) => void;
  onConnectEnd:   (id: string) => void;
}

const HANDLE_R = 5;

export const Node: React.FC<NodeProps> = ({
  node,
  viewport,
  isSelected,
  isEditing,
  isConnecting,
  onDragStart,
  onDrag,
  onDragEnd,
  onCommit,
  onDiscard,
  onEditStart,
  onConnectStart,
  onConnectEnd,
}) => {
  const nodeRef     = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft]     = useState(node.content ?? "");
  const [hovered, setHovered] = useState(false);
  const pointerMoved = useRef(false);

  const { x: vx, y: vy, zoom } = viewport;
  const screenX = node.x * zoom + vx;
  const screenY = node.y * zoom + vy;
  const screenW = node.width  * zoom;
  const screenH = node.height * zoom;

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) setDraft(node.content ?? "");
  }, [node.content, isEditing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) onCommit(node.id, trimmed);
    else         onDiscard(node.id);
  }, [draft, node.id, onCommit, onDiscard]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape")               { e.preventDefault(); commit(); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isEditing) return;
    e.stopPropagation();
    pointerMoved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onDragStart(node.id, e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isEditing) return;
    pointerMoved.current = true;
    onDrag(node.id, e);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isEditing) return;
    const wasDrag = pointerMoved.current;
    onDragEnd(node.id, e);
    pointerMoved.current = false;
    if (!wasDrag && isSelected) onEditStart(node.id);
  };

  const handlePointerEnter = () => {
    if (isConnecting) onConnectEnd(node.id);
  };

  const handles = [
    { id: "t", cx: screenW / 2, cy: 0           },
    { id: "r", cx: screenW,     cy: screenH / 2 },
    { id: "b", cx: screenW / 2, cy: screenH     },
    { id: "l", cx: 0,           cy: screenH / 2 },
  ];

  const showHandles = (hovered || isSelected) && !isEditing;

  const borderColor = isConnecting
    ? "#10b981"
    : isSelected
      ? "#7c3aed"
      : "rgba(255,255,255,0.22)";

  const borderWidth = isSelected || isConnecting ? 2 : 1;

  const boxShadow = isConnecting
    ? "0 0 0 3px rgba(16,185,129,0.2)"
    : isSelected
      ? "0 0 0 3px rgba(124,58,237,0.15), 0 4px 20px rgba(0,0,0,0.3)"
      : "0 2px 10px rgba(0,0,0,0.25)";

  const fontSize = Math.max(12, 14 * zoom);
  const paddingH = Math.max(8,  10 * zoom);
  const paddingV = Math.max(6,   8 * zoom);
  const radius   = Math.max(6,   8 * zoom);

  // The node container IS the editor — one surface, one border
  const containerStyle: React.CSSProperties = {
    position:        "absolute",
    left:            screenX,
    top:             screenY,
    width:           screenW,
    minHeight:       screenH,
    backgroundColor: "var(--color-idemora-bg-primary, #1a1b26)",
    border:          `${borderWidth}px solid ${borderColor}`,
    borderRadius:    radius,
    boxShadow,
    boxSizing:       "border-box",
    overflow:        "hidden",
    transition:      "border-color 0.12s, box-shadow 0.12s",
    pointerEvents:   "all",
    cursor:          isEditing ? "text" : "grab",
  };

  const sharedTextStyle: React.CSSProperties = {
    display:    "block",
    width:      "100%",
    minHeight:  screenH,
    padding:    `${paddingV}px ${paddingH}px`,
    fontSize,
    lineHeight: 1.55,
    fontFamily: "inherit",
    color:      "rgba(226,232,240,0.88)",
    boxSizing:  "border-box",
    whiteSpace: "pre-wrap",
    wordBreak:  "break-word",
  };

  return (
    <div
      ref={nodeRef}
      style={containerStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={handlePointerEnter}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Single content surface — no nested border, no nested bg */}
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder="Type something…"
          style={{
            ...sharedTextStyle,
            resize:     "none",
            border:     "none",
            outline:    "none",
            background: "transparent",
            overflowY:  "hidden",
          }}
        />
      ) : (
        <div style={{ ...sharedTextStyle, overflow: "hidden", userSelect: "none" }}>
          {node.type === "text" && (
            <span style={{ color: node.content ? "rgba(226,232,240,0.88)" : "rgba(148,163,184,0.35)" }}>
              {node.content || "Click to edit"}
            </span>
          )}
          {node.type === "note" && node.noteId && (
            <div>
              <strong style={{ fontSize: fontSize * 0.78, color: "rgba(148,163,184,0.5)", letterSpacing: "0.07em" }}>
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

      {/* Connection handles — SVG overflow:visible so dots sit outside border */}
      {showHandles && (
        <svg
          style={{
            position:      "absolute",
            inset:         0,
            width:         "100%",
            height:        "100%",
            overflow:      "visible",
            pointerEvents: "none",
          }}
        >
          {handles.map((h) => (
            <circle
              key={h.id}
              cx={h.cx}
              cy={h.cy}
              r={HANDLE_R}
              fill="rgba(255,255,255,0.88)"
              stroke="#7c3aed"
              strokeWidth={2}
              style={{ pointerEvents: "all", cursor: "crosshair" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onConnectStart(node.id, e);
              }}
            />
          ))}
        </svg>
      )}
    </div>
  );
};