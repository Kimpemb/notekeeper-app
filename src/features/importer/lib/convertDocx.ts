// src/features/importer/lib/convertDocx.ts
import mammoth from "mammoth/mammoth.browser"
import { generateJSON } from "@tiptap/core"
import { PARSE_EXTENSIONS } from "@/features/ai/lib/save/parseMarkdown"
import JSZip from "jszip"

export interface ConvertDocxResult {
  doc:       object
  markdown:  string
  title:     string
  pageCount: number
}

const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "p[style-name='Title']     => h1:fresh",
  "p[style-name='Subtitle']  => h2:fresh",
  "r[style-name='Strong']    => strong",
  "r[style-name='Emphasis']  => em",
].join("\n")

function cleanHtml(html: string): string {
  return html
    // Unwrap <li> that contains ONLY a nested list (no text before the list)
    .replace(/<li>(\s*<[ou]l>[\s\S]*?<\/[ou]l>\s*)<\/li>/g, "$1")
    // Remove completely empty <li></li>
    .replace(/<li>\s*<\/li>/g, "")
    // Unwrap nested <ul> that appears alone inside a <li> after text — move ol up
    .replace(/(<li>[^<]*(?:<(?!\/li)[^>]*>[^<]*)*)<ul>\s*(<ol>[\s\S]*?<\/ol>)\s*<\/ul>/g, "$1$2")
}

async function extractDocxTitle(arrayBuffer: ArrayBuffer): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer)
    if (!zip.files["docProps/core.xml"]) return null
    const xml = await zip.files["docProps/core.xml"].async("string")
    const match = xml.match(/<dc:title>(.*?)<\/dc:title>/i)
    const title = match?.[1]?.trim()
    return title || null
  } catch {
    return null
  }
}

function extractTitle(html: string, filenameFallback: string): string {
  // Try <h1> first
  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i)
  if (h1Match?.[1]) {
    const title = h1Match[1].replace(/<[^>]+>/g, "").trim()
    if (title) return title
  }

  // Try bold paragraphs as fallback
  const boldPMatch = html.match(/<p[^>]*><strong>(.*?)<\/strong><\/p>/i)
  if (boldPMatch?.[1]) {
    const title = boldPMatch[1].replace(/<[^>]+>/g, "").trim()
    if (title) return title
  }

  // Fallback to filename
  return filenameFallback
}

export async function convertDocx(
  arrayBuffer: ArrayBuffer,
  filenameFallback = "Untitled"
): Promise<ConvertDocxResult> {
  const metaTitle = await extractDocxTitle(arrayBuffer)

  // ── Convert to HTML (preserves bold, italic, tables, lists) ───────────────
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    { styleMap: STYLE_MAP }
  )

  // Clean the HTML to fix empty bullet issues
  const html = cleanHtml(result.value)

  // ── HTML → ProseMirror JSON directly ──────────────────────────────────────
  const doc = generateJSON(html, PARSE_EXTENSIONS)

  // ── Plaintext for RAG/search ───────────────────────────────────────────────
  const markdown = html
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, (_, t) => `# ${t}\n`)
    .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
    .replace(/<em>(.*?)<\/em>/gi, "_$1_")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, (_, t) => `- ${t}\n`)
    .replace(/<p[^>]*>(.*?)<\/p>/gi, (_, t) => `${t}\n`)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // ── Title extraction with proper fallback chain ───────────────────────────
  // Fallback chain: metadata title > filename > content (h1/bold paragraph)
  const title = metaTitle 
    ?? (filenameFallback !== "Untitled" ? filenameFallback : extractTitle(html, filenameFallback))

  const wordCount = markdown.split(/\s+/).filter(Boolean).length

  return { doc, markdown, title, pageCount: wordCount }
}