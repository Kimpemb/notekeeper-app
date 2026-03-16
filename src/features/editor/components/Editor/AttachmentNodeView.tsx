// src/features/editor/components/Editor/AttachmentNodeView.tsx
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import type { AttachmentKind } from "./AttachmentExtension";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── PDF block ─────────────────────────────────────────────────────────────────

function PdfBlock({ src, filename, size, selected }: {
  src: string;
  filename: string;
  size: number | null;
  selected: boolean;
}) {
  async function handleOpen() {
    try {
      await invoke("open_in_browser", { path: src });
    } catch (err) {
      console.error("Failed to open PDF:", err);
    }
  }

  return (
    <div
      onClick={handleOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 14px",
        borderRadius: "8px",
        cursor: "pointer",
        outline: selected ? "2px solid #3b82f6" : "none",
        outlineOffset: "2px",
        userSelect: "none",
        maxWidth: "480px",
      }}
      className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-750 transition-colors duration-100"
      title="Click to open PDF"
    >
      {/* PDF icon */}
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        className="bg-red-100 dark:bg-red-950/50"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-red-500">
          <path d="M3 2h8l4 4v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          <path d="M11 2v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          <path d="M5 9.5h2.5a1 1 0 010 2H5V9.5z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9.5 9.5h1.5a1.5 1.5 0 010 3H9.5V9.5z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M13 9.5v3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      </div>

      {/* File info */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{ fontSize: "13px", fontWeight: 500, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          className="text-zinc-800 dark:text-zinc-200"
        >
          {filename || "Untitled.pdf"}
        </p>
        {size && (
          <p style={{ fontSize: "11px", margin: "2px 0 0" }} className="text-zinc-400 dark:text-zinc-500">
            {formatBytes(size)} · Click to open
          </p>
        )}
      </div>

      {/* Open arrow */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-zinc-400 shrink-0">
        <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ── Audio block ───────────────────────────────────────────────────────────────

function AudioBlock({ src, filename, size, selected }: {
  src: string;
  filename: string;
  size: number | null;
  selected: boolean;
}) {
  const url = src ? convertFileSrc(src) : "";

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "8px",
        outline: selected ? "2px solid #3b82f6" : "none",
        outlineOffset: "2px",
        maxWidth: "480px",
      }}
      className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          className="bg-violet-100 dark:bg-violet-950/50"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-violet-500">
            <path d="M6 2l8 2v8l-8-2V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="12" cy="10" r="2" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p
            style={{ fontSize: "13px", fontWeight: 500, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            className="text-zinc-800 dark:text-zinc-200"
          >
            {filename || "Audio file"}
          </p>
          {size && (
            <p style={{ fontSize: "11px", margin: "2px 0 0" }} className="text-zinc-400 dark:text-zinc-500">
              {formatBytes(size)}
            </p>
          )}
        </div>
      </div>

      {/* Native audio player */}
      <audio
        controls
        src={url}
        style={{ width: "100%", height: "32px", display: "block" }}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── NodeView ──────────────────────────────────────────────────────────────────

export function AttachmentNodeView({ node, selected }: NodeViewProps) {
  const { src, filename, kind, size } = node.attrs as {
    src: string;
    filename: string;
    kind: AttachmentKind;
    size: number | null;
  };

  return (
    <NodeViewWrapper>
      <div className="my-2">
        {kind === "audio" ? (
          <AudioBlock src={src} filename={filename} size={size} selected={selected} />
        ) : (
          <PdfBlock src={src} filename={filename} size={size} selected={selected} />
        )}
      </div>
    </NodeViewWrapper>
  );
}