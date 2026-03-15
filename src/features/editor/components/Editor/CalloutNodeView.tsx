// src/features/editor/components/Editor/CalloutNodeView.tsx
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export type CalloutType = "info" | "warning" | "tip" | "danger";

export const CALLOUT_VARIANTS: {
  type: CalloutType;
  emoji: string;
  label: string;
}[] = [
  { type: "info",    emoji: "💡", label: "Info"    },
  { type: "warning", emoji: "⚠️", label: "Warning" },
  { type: "tip",     emoji: "✅", label: "Tip"     },
  { type: "danger",  emoji: "🚨", label: "Danger"  },
];

export function CalloutNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const type: CalloutType = (node.attrs.type as CalloutType) ?? "info";
  const current = CALLOUT_VARIANTS.find((v) => v.type === type) ?? CALLOUT_VARIANTS[0];

  const [open, setOpen]                   = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const btnRef      = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (
        !dropdownRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) setOpen(false);
    }
    function closeOnScroll() { setOpen(false); }
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  function openDropdown() {
    if (!btnRef.current) return;
    const rect       = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const shouldFlip = spaceBelow < 160 && rect.top > spaceBelow;
    setDropdownStyle({
      position: "fixed",
      left: rect.left,
      ...(shouldFlip
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      zIndex: 9999,
    });
    setOpen(true);
  }

  function select(t: CalloutType) {
    const { from, to } = editor.state.selection;
    updateAttributes({ type: t });
    setOpen(false);
    setTimeout(() => {
      editor.chain().focus().setTextSelection({ from, to }).run();
    }, 0);
  }

  return (
    <NodeViewWrapper className={`callout callout-${type}`}>
      <div className="callout-header" contentEditable={false}>
        {/* Emoji button — click to change variant */}
        <button
          ref={btnRef}
          className="callout-emoji-btn"
          onClick={() => (open ? setOpen(false) : openDropdown())}
          onMouseDown={(e) => e.preventDefault()}
          tabIndex={-1}
          title="Change callout type"
        >
          {current.emoji}
        </button>

        <span className="callout-label">{current.label}</span>
      </div>

      {/* Editable content area */}
      <NodeViewContent className="callout-content" />

      {/* Variant picker dropdown via portal */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="callout-dropdown"
          style={dropdownStyle}
          onMouseDown={(e) => e.preventDefault()}
        >
          {CALLOUT_VARIANTS.map((v) => (
            <button
              key={v.type}
              className={`callout-dropdown-option callout-dropdown-${v.type}${v.type === type ? " active" : ""}`}
              onClick={() => select(v.type)}
              onMouseDown={(e) => e.preventDefault()}
              tabIndex={-1}
            >
              <span className="callout-dropdown-emoji">{v.emoji}</span>
              <span>{v.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}