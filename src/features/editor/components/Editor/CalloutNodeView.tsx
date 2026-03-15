// src/features/editor/components/Editor/CalloutNodeView.tsx
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

export type CalloutType = "info" | "warning" | "tip" | "danger";

export const CALLOUT_VARIANTS: {
  type: CalloutType;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    type: "info",
    label: "Info",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="8" cy="5" r="0.75" fill="currentColor"/>
      </svg>
    ),
  },
  {
    type: "warning",
    label: "Warning",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2.5L14 13H2L8 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M8 7v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
      </svg>
    ),
  },
  {
    type: "tip",
    label: "Tip",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 2a4.5 4.5 0 0 1 2.5 8.2V11.5a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-1.3A4.5 4.5 0 0 1 8 2Z" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M6 13.5h4M7 15h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    type: "danger",
    label: "Danger",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export function CalloutNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const type: CalloutType = (node.attrs.type as CalloutType) ?? "info";
  const current = CALLOUT_VARIANTS.find((v) => v.type === type) ?? CALLOUT_VARIANTS[0];

  const [open, setOpen]                   = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const btnRef      = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    const shouldFlip = spaceBelow < 180 && rect.top > spaceBelow;
    setDropdownStyle({
      position: "fixed",
      left: rect.left,
      ...(shouldFlip
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
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
      {/* Icon — left column, click to change type */}
      <button
        ref={btnRef}
        className="callout-icon-btn"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onMouseDown={(e) => e.preventDefault()}
        tabIndex={-1}
        title="Change callout type"
        contentEditable={false}
      >
        {current.icon}
      </button>

      {/* Editable content */}
      <NodeViewContent className="callout-content" />

      {/* Variant picker */}
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
              <span className={`callout-dropdown-icon callout-dropdown-icon-${v.type}`}>
                {v.icon}
              </span>
              <span>{v.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}