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
      className="code-block-wrap group relative my-3"
      onKeyDown={(e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "a") e.preventDefault();
      }}
    >
      <pre className="code-block-pre relative rounded-lg overflow-hidden bg-idemora-bg-secondary border border-idemora-border">
        {/* Sticky toolbar */}
        <div
          className="code-block-lang-anchor sticky top-0 z-10 flex justify-end pointer-events-none"
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Unified pill */}
          <div ref={pillRef} className="code-block-pill pointer-events-auto flex items-center gap-1 m-2 rounded-md bg-idemora-bg-primary/90 backdrop-blur-sm border border-idemora-border shadow-sm">

            {/* Language segment */}
            <button
              ref={langBtnRef}
              className="code-block-pill-lang flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors duration-100 text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
              onClick={() => (open ? setOpen(false) : openDropdown())}
              tabIndex={-1}
              title="Set language"
            >
              <span className="code-block-pill-lang-inner flex items-center gap-1">
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
            <span className="code-block-pill-divider w-px h-4 bg-idemora-border" aria-hidden />

            {/* Copy segment */}
            <button
              className="code-block-pill-icon flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-100 text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
              onClick={copyCode}
              tabIndex={-1}
              title={copied ? "Copied!" : "Copy code"}
            >
              <span className="code-block-pill-icon-inner flex items-center justify-center">
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

        <NodeViewContent className="code-block-content p-3 font-mono text-sm leading-relaxed text-idemora-text-normal overflow-x-auto" />
      </pre>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="code-block-lang-dropdown rounded-lg border border-idemora-border bg-idemora-bg-primary shadow-xl overflow-hidden"
          style={dropdownStyle}
        >
          {/* Search */}
          <div className="code-block-lang-search-wrap p-2 border-b border-idemora-border">
            <input
              ref={searchRef}
              className="code-block-lang-search w-full px-3 py-1.5 text-sm rounded-md border border-idemora-border bg-idemora-bg-primary text-idemora-text-normal placeholder-idemora-text-faint focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors duration-150"
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
          <div className="code-block-lang-list max-h-[280px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="code-block-lang-empty px-3 py-4 text-sm text-idemora-text-muted text-center">
                No results
              </p>
            ) : (
              filtered.map((l) => {
                const isActive = l.value === (language ?? "");
                return (
                  <button
                    key={l.value}
                    className={`code-block-lang-option w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors duration-75 text-left ${
                      isActive
                        ? "bg-blue-500/10 text-blue-500"
                        : "text-idemora-text-muted hover:bg-idemora-bg-secondary hover:text-idemora-text-normal"
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(l.value)}
                    tabIndex={-1}
                  >
                    <span>{l.label}</span>
                    {isActive && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="code-block-lang-check shrink-0">
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