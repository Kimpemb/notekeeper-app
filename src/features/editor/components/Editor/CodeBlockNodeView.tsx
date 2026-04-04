// src/features/editor/components/Editor/CodeBlockNodeView.tsx
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { SUPPORTED_LANGUAGES } from "./constants";

const DROPDOWN_WIDTH = 240;

export function CodeBlockNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const language = node.attrs.language as string | null;
  const [open, setOpen]                   = useState(false);
  const [copied, setCopied]               = useState(false);
  const [search, setSearch]               = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  // Ref on the whole pill — used for dropdown positioning & outside-click detection
  const pillRef     = useRef<HTMLDivElement>(null);
  const langBtnRef  = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef   = useRef<HTMLInputElement>(null);

  const current = SUPPORTED_LANGUAGES.find((l) => l.value === (language ?? ""))
    ?? SUPPORTED_LANGUAGES[0];

  const filtered = SUPPORTED_LANGUAGES.filter((l) =>
    l.label.toLowerCase().includes(search.toLowerCase())
  );

  function openDropdown() {
    if (!pillRef.current) return;
    const rect = pillRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropHeight = 340;
    const shouldFlip = spaceBelow < dropHeight && spaceAbove > spaceBelow;

    // Clamp left so dropdown never bleeds off the right edge
    const rawLeft = rect.left;
    const maxLeft = window.innerWidth - DROPDOWN_WIDTH - 12;
    const left = Math.min(rawLeft, maxLeft);

    setDropdownStyle({
      position: "fixed",
      left,
      ...(shouldFlip
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 6 }),
      width: DROPDOWN_WIDTH,
      zIndex: 9999,
    });
    setSearch("");
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 30);
  }

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (
        !dropdownRef.current?.contains(e.target as Node) &&
        !pillRef.current?.contains(e.target as Node)
      ) setOpen(false);
    }
    function closeOnScroll(e: Event) {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
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
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  }

  return (
    <NodeViewWrapper
      className="code-block-wrap"
      onKeyDown={(e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "a") e.preventDefault();
      }}
    >
      <pre className="code-block-pre">
        {/* Sticky toolbar */}
        <div
          className="code-block-lang-anchor"
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Unified pill */}
          <div ref={pillRef} className="code-block-pill">

            {/* Language segment */}
            <button
              ref={langBtnRef}
              className="code-block-pill-lang"
              onClick={() => (open ? setOpen(false) : openDropdown())}
              tabIndex={-1}
              title="Set language"
            >
              <span className="code-block-pill-lang-inner">
                <span>{current.value ? current.label : "Plain"}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d={open ? "M2 6.5L5 3.5L8 6.5" : "M2 3.5L5 6.5L8 3.5"}
                    stroke="currentColor" strokeWidth="1.4"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>

            {/* Divider */}
            <span className="code-block-pill-divider" aria-hidden />

            {/* Copy segment */}
            <button
              className="code-block-pill-icon"
              onClick={copyCode}
              tabIndex={-1}
              title={copied ? "Copied!" : "Copy code"}
            >
              <span className="code-block-pill-icon-inner">
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M11.5 4L5.5 10L2.5 7" stroke="currentColor" strokeWidth="1.6"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                    <path d="M2.5 9.5V2.5H9.5" stroke="currentColor" strokeWidth="1.2"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
            </button>

          </div>
        </div>

        <NodeViewContent className="code-block-content" />
      </pre>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="code-block-lang-dropdown"
          style={dropdownStyle}
        >
          {/* Search */}
          <div className="code-block-lang-search-wrap">
            <input
              ref={searchRef}
              className="code-block-lang-search"
              placeholder="Search for a language..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered.length > 0) select(filtered[0].value);
              }}
            />
          </div>

          {/* Language list */}
          <div className="code-block-lang-list">
            {filtered.length === 0 ? (
              <p className="code-block-lang-empty">No results</p>
            ) : (
              filtered.map((l) => {
                const isActive = l.value === (language ?? "");
                return (
                  <button
                    key={l.value}
                    className={`code-block-lang-option${isActive ? " active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(l.value)}
                    tabIndex={-1}
                  >
                    <span>{l.label}</span>
                    {isActive && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="code-block-lang-check">
                        <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="1.6"
                          strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}