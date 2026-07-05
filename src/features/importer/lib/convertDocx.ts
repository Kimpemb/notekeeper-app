// src/features/importer/lib/convertDocx.ts
import mammoth from "mammoth/mammoth.browser"
import { generateJSON } from "@tiptap/core"
import { PARSE_EXTENSIONS } from "@/features/ai/lib/save/parseMarkdown"
import JSZip from "jszip"
import { saveImage } from "@/lib/tauri/fs"

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

// ── Persist mammoth's inline base64 images to disk ─────────────────────────
// mammoth.convertToHtml() embeds images as data: URIs directly in the HTML.
// generateJSON will happily parse those into image nodes with a base64 `src`,
// but every other image in the app stores a real filesystem path (written by
// ImageExtension.ts's persistImage/saveImage on paste/drop), which is also
// what docx.ts's export-side loadImageBytes() expects to read back later.
// Decode + save each embedded image here so imported notes match that shape.
async function persistEmbeddedImages(node: any): Promise<void> {
  if (!node || typeof node !== "object") return

  if (node.type === "image" && typeof node.attrs?.src === "string" && node.attrs.src.startsWith("data:")) {
    const match = node.attrs.src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/)
    if (match) {
      const [, mime, base64] = match
      const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png"
      try {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const fileName = `docx_image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        node.attrs.src = await saveImage(fileName, bytes)
      } catch (err) {
        console.warn("[convertDocx] failed to persist embedded image:", err)
      }
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) await persistEmbeddedImages(child)
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

  // Decode mammoth's inline base64 images and persist them to disk, rewriting
  // each image node's src to the real path (matches how normal image
  // paste/drop stores images — see ImageExtension.ts).
  await persistEmbeddedImages(doc)

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