// src/features/editor/components/Editor/CodeBlockNodeView.tsx
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { SUPPORTED_LANGUAGES } from "./constants";

export function CodeBlockNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const language    = node.attrs.language as string | null;
  const [open, setOpen]                   = useState(false);
  const [copied, setCopied]                = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const btnRef      = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const current = SUPPORTED_LANGUAGES.find((l) => l.value === (language ?? ""))
    ?? SUPPORTED_LANGUAGES[0];

  // Position the portal dropdown over the button and decide flip direction
  function openDropdown() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropHeight = 280;
    const shouldFlip = spaceBelow < dropHeight && spaceAbove > spaceBelow;

    setDropdownStyle({
      position: "fixed",
      left: rect.right - 144,
      ...(shouldFlip
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
      minWidth: 144,
      zIndex: 9999,
    });
    setOpen(true);
  }

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

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  function select(value: string) {
    const { from, to } = editor.state.selection;
    updateAttributes({ language: value || null });
    setOpen(false);
    setTimeout(() => {
      editor.chain().focus().setTextSelection({ from, to }).run();
    }, 0);
  }

  async function copyCode() {
    // Get the code content from the node
    const code = node.textContent;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  }

  return (
    <NodeViewWrapper
      className="code-block-wrap"
      onKeyDown={(e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "a") {
          e.preventDefault();
        }
      }}
    >
      <pre className="code-block-pre">
        {/* Language picker and copy button — top-right corner of the block */}
        <div
          className="code-block-lang-anchor"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-1">
            {/* Copy button */}
            <button
              className="code-block-copy-btn"
              onClick={copyCode}
              tabIndex={-1}
              title="Copy code"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M11.5 4L5.5 10L2.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="4.5" y="4.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M2.5 9.5V2.5H9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>

            {/* Language dropdown button */}
            <button
              ref={btnRef}
              className="code-block-lang-btn"
              onClick={() => (open ? setOpen(false) : openDropdown())}
              tabIndex={-1}
              title="Set language"
            >
              <span>{current.value ? current.label : "Plain"}</span>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                <path
                  d={open ? "M1.5 5L4 2.5L6.5 5" : "M1.5 3L4 5.5L6.5 3"}
                  stroke="currentColor" strokeWidth="1.3"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Code content */}
        <NodeViewContent className="code-block-content" />
      </pre>

      {/* Dropdown rendered in a portal so it escapes overflow:hidden on pre */}
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="code-block-lang-dropdown"
          style={dropdownStyle}
        >
          {SUPPORTED_LANGUAGES.map((l) => (
            <button
              key={l.value}
              className={`code-block-lang-option${l.value === (language ?? "") ? " active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(l.value)}
              tabIndex={-1}
            >
              {l.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}