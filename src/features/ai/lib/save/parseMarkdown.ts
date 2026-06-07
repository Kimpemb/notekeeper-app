// src/features/ai/lib/save/parseMarkdown.ts
//
// Shared markdown → ProseMirror JSON pipeline.
// Used by SaveNoteDialog (chat save) and MarkdownPasteExtension (editor paste).

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
import { NoteLink }              from "@/features/editor/components/Editor/NoteLink"

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
  NoteLink.configure({ onNavigate: () => {} }),
]

export function markdownToDoc(md: string): object {
  const html = marked.parse(md) as string
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
  return /^#{1,6} /m.test(text)          // headings
    || /\*\*.+\*\*/s.test(text)           // bold
    || /\*.+\*/s.test(text)               // italic
    || /^- /m.test(text)                  // bullet list
    || /^\* /m.test(text)                 // bullet list (asterisk)
    || /^\d+\. /m.test(text)              // ordered list
    || /```/.test(text)                   // code fence
    || /^> /m.test(text)                  // blockquote
    || /^---$/m.test(text)                // horizontal rule
    || /\[.+\]\(.+\)/.test(text)          // link
    || /`[^`]+`/.test(text)               // inline code
    || /~~.+~~/.test(text)                // strikethrough
    || /^\|.+\|/m.test(text)              // table
}