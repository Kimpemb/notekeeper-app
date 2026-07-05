// src/features/ai/lib/save/parseMarkdown.ts
//
// Shared markdown → ProseMirror JSON pipeline.
// Used by SaveNoteDialog (chat save) and MarkdownPasteExtension (editor paste).
//
// Math support:
//   LLMs emit \(...\) and \[...\] delimiters. Before passing to generateJSON we
//   convert these to the HTML that @tiptap/extension-mathematics parseHTML expects:
//     \(...\)  →  <span data-type="inline-math" data-latex="..."></span>
//     \[...\]  →  <div  data-type="block-math"  data-latex="..."></div>
//   This lets saved/pasted math render correctly in the editor.

import { generateJSON }          from "@tiptap/core"
import { marked }                from "marked"
import StarterKit                from "@tiptap/starter-kit"
import CodeBlockLowlight         from "@tiptap/extension-code-block-lowlight"
import { common, createLowlight } from "lowlight"
import TaskList                  from "@tiptap/extension-task-list"
import TaskItem                  from "@tiptap/extension-task-item"
import { Table }                 from "@tiptap/extension-table"
import { TableRow }              from "@tiptap/extension-table-row"
import { TableHeader }           from "@tiptap/extension-table-header"
import { TableCell }             from "@tiptap/extension-table-cell"
import { Color }                 from "@tiptap/extension-color"
import { TextStyle }             from "@tiptap/extension-text-style"
import Highlight                 from "@tiptap/extension-highlight"
import { Mathematics }           from "@tiptap/extension-mathematics"
import { NoteLink }              from "@/features/editor/components/Editor/NoteLink"
import { ImageExtension }        from "@/features/editor/components/Editor/ImageExtension"

export const PARSE_EXTENSIONS = [
  StarterKit.configure({ codeBlock: false }),
  Color,
  TextStyle,
  Highlight.configure({ multicolor: true }),
  CodeBlockLowlight.configure({ lowlight: createLowlight(common) }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Mathematics.configure({ katexOptions: { throwOnError: false } }),
  NoteLink.configure({ onNavigate: () => {} }),
  ImageExtension,
]

// ─── Math delimiter normalisation ────────────────────────────────────────────
// Convert LLM-style LaTeX delimiters in raw markdown to the HTML nodes that
// @tiptap/extension-mathematics expects. Must run BEFORE marked.parse() since
// marked does not know about LaTeX and would mangle $ signs otherwise.
//
// Escaping note: data-latex values are HTML-attribute-escaped so that
// generateJSON's HTML parser reconstructs them correctly.

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function normaliseMathDelimiters(md: string): string {
  return (
    md
      // Block math first — must precede inline to avoid partial matches
      // \[...\]  →  <div data-type="block-math" data-latex="..."></div>
      .replace(/\\\[([^]*?)\\\]/g, (_: string, latex: string) =>
        `<div data-type="block-math" data-latex="${escapeAttr(latex.trim())}"></div>`,
      )
      // Inline math
      // \(...\)  →  <span data-type="inline-math" data-latex="..."></span>
      .replace(/\\\(([^]*?)\\\)/g, (_: string, latex: string) =>
        `<span data-type="inline-math" data-latex="${escapeAttr(latex.trim())}"></span>`,
      )
      // Also handle bare $...$ and $$...$$ (some LLMs use these)
      // Block $$...$$ first
      .replace(/\$\$([^$]+?)\$\$/g, (_: string, latex: string) =>
        `<div data-type="block-math" data-latex="${escapeAttr(latex.trim())}"></div>`,
      )
      // Inline $...$  — careful not to match $$ (already handled above)
      .replace(/(?<!\$)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, (_: string, latex: string) =>
        `<span data-type="inline-math" data-latex="${escapeAttr(latex.trim())}"></span>`,
      )
  )
}

export function markdownToDoc(md: string): object {
  // 1. Convert math delimiters → HTML math nodes
  const withMathAsHtml = normaliseMathDelimiters(md)
  // 2. Parse remaining markdown → HTML (marked leaves our <span>/<div> intact)
  const html = marked.parse(withMathAsHtml) as string
  // 3. generateJSON parses the combined HTML using Tiptap's schema
  return generateJSON(html, PARSE_EXTENSIONS)
}

export function markdownToContent(md: string): { content: string; plaintext: string } {
  try {
    const doc = markdownToDoc(md)
    return { content: JSON.stringify(doc), plaintext: md }
  } catch (err) {
    console.warn("[parseMarkdown] parse failed:", err)
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: md }] }],
    }
    return { content: JSON.stringify(doc), plaintext: md }
  }
}

export function looksLikeMarkdown(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return false
  }

  return /^#{1,6} /m.test(text)          // headings
    || /\*\*.+\*\*/m.test(text)           // bold (no dotall — must be same line)
    || /(?<!\*)\*(?!\*)[^\n*\/]+\*(?!\*)/m.test(text) // italic (same line, not ** or /*/)
    || /^- /m.test(text)                  // bullet list
    || /^\* /m.test(text)                 // bullet list (asterisk)
    || /^\d+\. /m.test(text)              // ordered list
    || /```/.test(text)                   // code fence
    || /^> /m.test(text)                  // blockquote
    || /^---$/m.test(text)                // horizontal rule
    || /\[.+\]\(.+\)/.test(text)          // link
    || /`[^`]+`/.test(text)               // inline code
    || /~~.+~~/m.test(text)               // strikethrough (no dotall)
    || /^\|.+\|/m.test(text)              // table
}