// src/features/editor/components/Editor/ImageNodeView.tsx
import { useRef, useState, useCallback, useEffect } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { NodeViewErrorBoundary } from "./NodeViewErrorBoundary";

function safeConvertFileSrc(src: string): string {
  try {
    return src ? convertFileSrc(src) : "";
  } catch {
    return "";
  }
}

function ImageNodeViewInner({ node, selected, updateAttributes }: NodeViewProps) {
  const { src, alt, width, align } = node.attrs as {
    src: string;
    alt: string;
    width: number | null;
    align: "left" | "center" | "right";
  };

  const imgRef       = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart    = useRef<{ x: number; startWidth: number } | null>(null);
  const [resizing, setResizing]         = useState(false);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [imgError, setImgError]         = useState(false);
  const [visible, setVisible]           = useState(false); // controls fade-in

  const src_url = safeConvertFileSrc(src);

  // If no src at all, skip loading state entirely
  useEffect(() => {
    if (!src_url) {
      setImgError(true);
      setVisible(true);
    }
  }, [src_url]);

  function handleLoad() {
    if (imgRef.current) setNaturalWidth(imgRef.current.naturalWidth);
    setVisible(true);
  }

  function handleError() {
    setImgError(true);
    setVisible(true);
  }

  // ── Resize logic ───────────────────────────────────────────────────────────
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startWidth =
        imgRef.current?.getBoundingClientRect().width ??
        width ??
        naturalWidth ??
        400;
      dragStart.current = { x: e.clientX, startWidth };
      setResizing(true);
    },
    [width, naturalWidth]
  );

  useEffect(() => {
    if (!resizing) return;

    function onMouseMove(e: MouseEvent) {
      if (!dragStart.current) return;
      const delta    = e.clientX - dragStart.current.x;
      const newWidth = Math.max(80, Math.min(dragStart.current.startWidth + delta, 900));
      updateAttributes({ width: Math.round(newWidth) });
    }

    function onMouseUp() {
      dragStart.current = null;
      setResizing(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing, updateAttributes]);

  const justifyMap = { left: "flex-start", center: "center", right: "flex-end" } as const;
  const displayWidth = width ?? naturalWidth ?? undefined;

  return (
    <NodeViewWrapper>
      <div
        style={{ display: "flex", justifyContent: justifyMap[align] ?? "flex-start" }}
        className="my-2"
      >
        <div
          ref={containerRef}
          style={{
            position: "relative",
            display: "inline-block",
            width: displayWidth ? `${displayWidth}px` : undefined,
            maxWidth: "100%",
            userSelect: "none",
            opacity: visible ? 1 : 0,
            transition: "opacity 150ms ease",
          }}
          className={`image-node-container ${selected ? "image-node-selected" : ""}`}
        >
          {imgError ? (
            <div
              style={{
                width: displayWidth ? `${displayWidth}px` : "200px",
                height: "120px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                borderRadius: "6px",
              }}
              className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 text-xs"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                <path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Image not found</span>
            </div>
          ) : (
            <img
              ref={imgRef}
              src={src_url}
              alt={alt ?? ""}
              onLoad={handleLoad}
              onError={handleError}
              draggable={false}
              style={{
                display: "block",
                width: displayWidth ? `${displayWidth}px` : undefined,
                maxWidth: "100%",
                height: "auto",
                borderRadius: "6px",
                cursor: resizing ? "ew-resize" : "default",
                outline: selected ? "2px solid #3b82f6" : "none",
                outlineOffset: "2px",
              }}
            />
          )}

          {/* Resize handle */}
          {selected && !imgError && src_url && (
            <div
              onMouseDown={onResizeMouseDown}
              style={{
                position: "absolute",
                bottom: "-4px",
                right: "-4px",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                cursor: "se-resize",
                background: "#3b82f6",
                border: "2px solid white",
                zIndex: 10,
              }}
            />
          )}

          {/* Alignment toolbar */}
          {selected && !imgError && src_url && (
            <div
              style={{
                position: "absolute",
                top: "-34px",
                left: "0",
                display: "flex",
                alignItems: "center",
                gap: "2px",
                padding: "3px 6px",
                borderRadius: "6px",
                zIndex: 20,
              }}
              className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg"
              onMouseDown={(e) => e.preventDefault()}
            >
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => updateAttributes({ align: a })}
                  title={`Align ${a}`}
                  style={{
                    width: "24px",
                    height: "24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "4px",
                    border: "none",
                    cursor: "pointer",
                    background: align === a ? "#e4e4e7" : "transparent",
                  }}
                  className={align === a ? "dark:bg-zinc-600" : "hover:bg-zinc-100 dark:hover:bg-zinc-700"}
                >
                  <AlignIcon type={a} />
                </button>
              ))}

              <div style={{ width: "1px", height: "16px", margin: "0 2px" }} className="bg-zinc-200 dark:bg-zinc-600" />

              <button
                onClick={() => updateAttributes({ width: null })}
                title="Reset size"
                style={{
                  width: "24px",
                  height: "24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  background: "transparent",
                }}
                className="hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1h4v4M11 11H7V7M1 11l4-4M11 1L7 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export function ImageNodeView(props: NodeViewProps) {
  return (
    <NodeViewErrorBoundary label="image">
      <ImageNodeViewInner {...props} />
    </NodeViewErrorBoundary>
  );
}

function AlignIcon({ type }: { type: "left" | "center" | "right" }) {
  const lines = {
    left:   [8, 8, 10],
    center: [8, 6,  8],
    right:  [8, 4,  6],
  }[type];

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1 2h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d={`M1 5h${lines[0]}`} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d={`M${12 - lines[1]} 8h${lines[1]}`} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M1 11h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}