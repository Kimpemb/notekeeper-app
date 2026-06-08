// src/features/importer/lib/convertDocx.ts

// mammoth ships a browser build that works in Tauri's webview — no Node APIs needed.
// We import it via the browser entry point to avoid Node-only dependencies.
import mammoth from "mammoth/mammoth.browser";

export interface ConvertDocxResult {
  markdown:  string
  title:     string
  pageCount: number   // word count approximation — actual pages unknowable without layout engine
}

const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Title']     => h1:fresh",
  "p[style-name='Subtitle']  => h2:fresh",
].join("\n")

export async function convertDocx(arrayBuffer: ArrayBuffer): Promise<ConvertDocxResult> {
  const result = await mammoth.convertToMarkdown(
    { arrayBuffer },
    { styleMap: STYLE_MAP }
  )

  const raw = result.value

  // ── Post-processing ────────────────────────────────────────────────────────
  const lines = raw.split("\n")
  const processed: string[] = []
  let blankRun = 0

  for (const line of lines) {
    const trimmed = line.trimEnd()
    if (trimmed === "") {
      blankRun++
      // Collapse more than 1 consecutive blank line into 1
      if (blankRun <= 1) processed.push("")
    } else {
      blankRun = 0
      processed.push(trimmed)
    }
  }

  const markdown = processed.join("\n").trim()

  // ── Title extraction ───────────────────────────────────────────────────────
  // First # heading, fallback to first non-empty line, fallback to "Untitled"
  const h1Match = markdown.match(/^#\s+(.+)$/m)
  const firstLine = markdown.split("\n").find((l) => l.trim().length > 0) ?? ""
  const title = h1Match
    ? h1Match[1].trim()
    : firstLine.replace(/^#+\s*/, "").trim() || "Untitled"

  // ── Word count as proxy for "size" ────────────────────────────────────────
  const wordCount = markdown.split(/\s+/).filter(Boolean).length

  return { markdown, title, pageCount: wordCount }
}