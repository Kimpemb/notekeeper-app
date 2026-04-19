import React, { useEffect, useRef, useState, useCallback } from "react";
import { CanvasEngine } from "../engine/engine";
import type { Viewport } from "@/types/canvas";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { worldFromJSON } from "../engine/world";

const FONT_SIZE = 14;
const PAD_H     = 10;
const PAD_V     = 8;
const LINE_H    = 1.55;

interface CanvasViewportProps {
  noteId:       string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const CanvasViewport: React.FC<CanvasViewportProps> = ({ noteId, containerRef: _containerRef }) => {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const engineRef    = useRef<CanvasEngine | null>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  // Only these two pieces of React state exist — everything else lives in engine
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [viewport,      setViewport]      = useState<Viewport>({ x: 0, y: 0, zoom: 0.6 });

  // Store hooks for content loading
  const loadNoteContent = useNoteStore((s) => s.loadNoteContent);
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));

  // ─── Load content if canvas_state is missing ─────────────────────────────────
 useEffect(() => {
  if (!note) return;
  const isEmpty = !note.canvas_state || (() => {
    try {
      const s = JSON.parse(note.canvas_state);
      return s.nodes?.length === 0 && s.edges?.length === 0;
    } catch { return true; }
  })();
  if (isEmpty) loadNoteContent(noteId);
}, [noteId, loadNoteContent, note]);

  // ─── Mount engine ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new CanvasEngine(noteId, {
      onNodeEditStart:  (id) => setEditingNodeId(id),
      onWorldChanged:   () => {},      // persistence handled inside engine
      onViewportChanged:(vp) => setViewport(vp),
    });

    engine.mount(canvas);
    engineRef.current = engine;

    return () => {
      engine.unmount();
      engineRef.current = null;
    };
  }, [noteId]);

  // ─── Reload engine when canvas_state arrives ────────────────────────────────
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const currentNote = useNoteStore.getState().notes.find((n) => n.id === noteId);
    if (currentNote?.canvas_state && currentNote.canvas_state !== "null") {
      try {
        const { world, viewport } = worldFromJSON(currentNote.canvas_state);
        engine.loadWorld(world, viewport);
      } catch (e) {
        console.error("Failed to load canvas world:", e);
      }
    }
  }, [noteId, note?.canvas_state]);

  // ─── Focus canvas when not editing ─────────────────────────────────────────
  useEffect(() => {
    if (!editingNodeId) {
      canvasRef.current?.focus();
    }
  }, [editingNodeId]);

  // ─── Focus textarea when editing starts ────────────────────────────────────
  useEffect(() => {
    if (editingNodeId && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editingNodeId]);

  // ─── Textarea handlers ──────────────────────────────────────────────────────
  const [draft, setDraft] = useState("");

  // Sync draft when editing node changes
  useEffect(() => {
    if (editingNodeId) {
      const node = engineRef.current?.getWorld().nodes.get(editingNodeId);
      setDraft(node?.content ?? "");
    }
  }, [editingNodeId]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !editingNodeId) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editingNodeId]);

  const commit = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !editingNodeId) return;
    const trimmed = draft.trim();
    if (trimmed) {
      // Measure natural height using a temporary off-screen element
      const measure       = document.createElement("div");
      measure.style.cssText = `
        position: absolute; visibility: hidden; top: 0; left: 0;
        width: ${180 - PAD_H * 2}px;
        font-size: ${FONT_SIZE}px;
        line-height: ${LINE_H};
        font-family: ui-sans-serif, system-ui, sans-serif;
        white-space: pre-wrap; word-break: break-word;
        box-sizing: border-box; padding: 0;
      `;
      measure.textContent = trimmed;
      document.body.appendChild(measure);
      const height = Math.max(44, measure.scrollHeight + PAD_V * 2);
      document.body.removeChild(measure);
      engine.commitNodeEdit(editingNodeId, trimmed, height);
    } else {
      engine.discardNodeEdit(editingNodeId);
    }
    setDraft("");
  }, [draft, editingNodeId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); commit(); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
  }, [commit]);

  // ─── Textarea position — sits over the canvas node ─────────────────────────
  const editingNode  = editingNodeId
    ? engineRef.current?.getWorld().nodes.get(editingNodeId)
    : null;

  const textareaStyle: React.CSSProperties | null = editingNode ? (() => {
    const { x: vx, y: vy, zoom } = viewport;
    const sx = editingNode.x * zoom + vx;
    const sy = editingNode.y * zoom + vy;
    const sw = editingNode.width  * zoom;
    const sh = editingNode.height * zoom;
    const borderW = 2;
return {
  position:   "absolute",
  left:       sx,
  top:        sy,
  width:      sw,
  minHeight:  sh,
  padding:    `${PAD_V * zoom}px ${PAD_H * zoom}px`,
  fontSize:   FONT_SIZE * zoom,
  lineHeight: LINE_H,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  color:      "rgba(226,232,240,0.88)",
  background: "#1a1b26",
  border:     `${borderW}px solid #7c3aed`,
  borderRadius: Math.max(5, 8 * zoom),
  boxShadow:  "0 0 0 3px rgba(124,58,237,0.15)",
  boxSizing:  "border-box" as const,
  resize:     "none" as const,
  outline:    "none",
  overflow:   "hidden",
  zIndex:     10,
  height:     "auto",
};
  })() : null;

  // ─── Handle pointerdown — detect connection handle clicks before engine ──────
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const handle = engine.getHandleAtScreen(sx, sy);
    if (handle) {
      e.stopPropagation();
      engine.startConnecting(handle.nodeId, sx, sy);
    }
    // Otherwise let the native event fall through to the engine's own listener
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
        onPointerDown={handleCanvasPointerDown}
      />

      {textareaStyle && (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder="Type something…"
          style={textareaStyle}
        />
      )}
    </div>
  );
};