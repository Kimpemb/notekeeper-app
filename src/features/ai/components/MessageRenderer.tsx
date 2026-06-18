// src/features/ai/components/MessageRenderer.tsx
//
// Renders assistant message content with:
//   - Full markdown (react-markdown + remark-gfm)
//   - Math: inline $...$ and block $$...$$ (remark-math + rehype-katex)
//   - Syntax-highlighted code blocks (rehype-highlight + custom CodeBlock UI)
//   - Tables, blockquotes, task lists
//
// Math rendering is skipped during streaming to avoid re-running KaTeX on every
// token — pass isStreaming={true} while chunks are arriving, false when done.

import { useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import type { Components } from "react-markdown"
import type { PluggableList } from "unified"

// KaTeX CSS — import once here so ChatPanel doesn't need to know about it
import "katex/dist/katex.min.css"
// Syntax highlight theme — matches your existing github-dark-dimmed choice
import "highlight.js/styles/github-dark-dimmed.css"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  content:     string
  isStreaming?: boolean
}

// ─── CodeBlock ────────────────────────────────────────────────────────────────
// Reused by the `code` component override below. Handles both fenced blocks
// (has a language class) and inline code (no className).

function CodeBlock({
  inline,
  className,
  children,
}: {
  inline?:    boolean
  className?: string
  children?:  React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  // Inline code — simple styled span
  if (inline) {
    return (
      <code className="text-violet-400 bg-idemora-bg-secondary rounded px-1 py-0.5 text-xs font-mono">
        {children}
      </code>
    )
  }

  // Extract raw text from children for the copy button
  const codeText = extractText(children)

  // Language label from className like "language-typescript"
  const language = className?.replace(/^language-/, "") ?? "code"

  function handleCopy() {
    navigator.clipboard.writeText(codeText).catch(console.error)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-idemora-border/60">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-idemora-bg-secondary border-b border-idemora-border/40">
        <span className="text-[10px] font-medium text-idemora-text-muted uppercase tracking-wider">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-idemora-text-muted hover:text-idemora-text-normal transition-colors duration-100"
        >
          {copied ? (
            <>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                <path d="M2 7H1.5A.5.5 0 011 6.5v-5A.5.5 0 011.5 1h5a.5.5 0 01.5.5V2" stroke="currentColor" strokeWidth="1.1"/>
              </svg>
              Copy
            </>
          )}
        </button>
      </div>

      {/* rehype-highlight wraps the block in <pre><code className="language-*">
          We keep the pre/code structure but style it ourselves */}
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed bg-[#22272e] m-0">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

// Recursively extract plain text from React children (needed for copy button)
function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (node !== null && typeof node === "object" && "props" in node) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>
    return extractText(el.props.children)
  }
  return ""
}

// ─── Component map ────────────────────────────────────────────────────────────
// react-markdown calls these for each node type. Defined outside the component
// so they're stable references and don't cause unnecessary re-renders.

const components: Components = {
  // Code blocks and inline code both come through here
  // react-markdown passes `node`, `inline`, `className`, `children`
  code({ className, children, ...props }) {
    // react-markdown v9+ passes `node` — check if it's inside a <pre> to detect block vs inline
    const isInline = !className && !String(children ?? "").includes("\n")
    return (
      <CodeBlock inline={isInline} className={className} {...props}>
        {children}
      </CodeBlock>
    )
  },

  // Wrap pre so we don't double-wrap (react-markdown emits <pre><code>)
  // We handle the outer shell in CodeBlock above
  pre({ children }) {
    return <>{children}</>
  },

  // Tables — scrollable wrapper + your existing styles
  table({ children }) {
    return (
      <div className="overflow-x-auto my-2">
        <table className="w-full text-xs border-collapse border border-idemora-border/60">
          {children}
        </table>
      </div>
    )
  },
  th({ children }) {
    return (
      <th className="px-3 py-2.5 text-left font-semibold text-idemora-text-normal bg-idemora-bg-secondary border border-idemora-border/60">
        {children}
      </th>
    )
  },
  td({ children }) {
    return (
      <td className="px-3 py-2 text-idemora-text-muted border border-idemora-border/60">
        {children}
      </td>
    )
  },

  // Blockquote
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-violet-400/50 pl-3 pr-3 py-1.5 my-2 bg-idemora-bg-secondary rounded-r-md text-idemora-text-muted">
        {children}
      </blockquote>
    )
  },

  // Headings
  h1({ children }) {
    return <h1 className="text-lg font-bold mt-4 mb-1 text-idemora-text-normal leading-snug">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-base font-semibold mt-3 mb-0.5 text-idemora-text-normal border-b border-idemora-border/40 pb-0.5">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-sm font-semibold mt-2 mb-0.5 text-idemora-text-normal">{children}</h3>
  },

  // Paragraphs
  p({ children }) {
    return <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  },

  // Lists
  ul({ children }) {
    return <ul className="list-disc pl-4 ml-4 mt-1.5 mb-1.5 space-y-1">{children}</ul>
  },
  ol({ children }) {
    return <ol className="list-decimal pl-4 ml-4 mt-1.5 mb-1.5 space-y-1">{children}</ol>
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>
  },

  // Horizontal rule
  hr() {
    return <hr className="border-t border-idemora-border/40 my-3" />
  },

  // Strong / em
  strong({ children }) {
    return <strong className="font-semibold text-idemora-text-normal">{children}</strong>
  },
  em({ children }) {
    return <em className="italic">{children}</em>
  },

  // Links — open externally
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors duration-100"
      >
        {children}
      </a>
    )
  },
}

// Remark/rehype plugin arrays — typed as mutable so react-markdown accepts them
const remarkPlugins: PluggableList = [remarkGfm, remarkMath]
const rehypePluginsWithMath: PluggableList = [
  [rehypeKatex, { output: "html", throwOnError: false, strict: false }],
  rehypeHighlight,
]
const rehypePluginsNoMath: PluggableList = [rehypeHighlight]

// ─── MessageRenderer ──────────────────────────────────────────────────────────

export function MessageRenderer({ content, isStreaming = false }: Props) {
  // Normalise content:
  //   1. Strip RAG citation markers [web:...] and [1]
  //   2. Convert \(...\) → $...$ and \[...\] → $$...$$ so remark-math picks them up
  //      (LLMs typically emit LaTeX-style delimiters, not TeX dollar signs)
  const cleaned = useMemo(() => {
    return content
      .replace(/\[web:[^\]]+\]/g, "")
      .replace(/ \./g, ".")
      // Escape currency $ signs (digit or range immediately after $) before math parsing
      .replace(/\$(?=[\d])/g, "\\$")
      // Block math first (must come before inline to avoid partial matches)
      .replace(/\\\[([\s\S]*?)\\\]/g, (_: string, m: string) => `$$${m}$$`)
      // Inline math
      .replace(/\\\(([\s\S]*?)\\\)/g, (_: string, m: string) => `$${m}$`)
  }, [content])

  // During streaming: skip math rendering entirely (saves KaTeX parse cost on
  // every token) and use no-math rehype plugins. Math will render on next paint
  // after isStreaming flips to false.
  const rehypePlugins = isStreaming ? rehypePluginsNoMath : rehypePluginsWithMath

  return (
    <div className="text-sm text-idemora-text-normal wrap-break-word overflow-x-hidden">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  )
}