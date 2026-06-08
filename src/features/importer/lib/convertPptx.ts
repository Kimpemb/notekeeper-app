// src/features/importer/lib/convertPptx.ts
import JSZip from "jszip"

export interface ConvertPptxResult {
  markdown:   string
  title:      string
  slideCount: number
}

// ── XML helpers ───────────────────────────────────────────────────────────────


function innerXml(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g")
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) results.push(m[1])
  return results
}

function stripTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, "")
}

// ── Paragraph-level extraction ────────────────────────────────────────────────
// Each <a:p> is one paragraph. We detect bullets and extract <a:t> runs.

function extractParagraphs(shapeXml: string): { text: string; isBullet: boolean }[] {
  const paragraphs = innerXml(shapeXml, "a:p")
  return paragraphs
    .map((p) => {
      // Detect bullet: <a:buChar> or <a:buAutoNum> present in <a:pPr>
      const hasBulletChar  = p.includes("<a:buChar")
      const hasBulletAuto  = p.includes("<a:buAutoNum")
      const hasNoBullet    = p.includes("<a:buNone")
      const isBullet = (hasBulletChar || hasBulletAuto) && !hasNoBullet

      // Extract all <a:t> text runs
      const runs = innerXml(p, "a:t").map(stripTags).join("")
      return { text: runs.trim(), isBullet }
    })
    .filter((p) => p.text.length > 0)
}

// ── Shape classification ──────────────────────────────────────────────────────

function isTitleShape(spXml: string): boolean {
  // <p:ph type="title"> or <p:ph type="ctrTitle">
  return (
    spXml.includes('type="title"') ||
    spXml.includes('type="ctrTitle"')
  )
}

function isBodyShape(spXml: string): boolean {
  // <p:ph type="body"> or <p:ph> with no type (default body)
  // Exclude title, subTitle handled separately
  if (isTitleShape(spXml)) return false
  return (
    spXml.includes('type="body"') ||
    spXml.includes('type="subTitle"') ||
    (spXml.includes("<p:ph") && !spXml.includes('type="'))  ||
    !spXml.includes("<p:ph")  // non-placeholder text boxes
  )
}

// ── Per-slide extraction ──────────────────────────────────────────────────────

interface SlideData {
  title:  string
  lines:  string[]
  notes:  string
}

function extractSlide(slideXml: string, notesXml: string | null): SlideData {
  // Get all <p:sp> shapes
  const shapes = innerXml(slideXml, "p:sp")

  let title = ""
  const bodyLines: string[] = []

  for (const sp of shapes) {
    const paragraphs = extractParagraphs(sp)
    if (paragraphs.length === 0) continue

    if (isTitleShape(sp)) {
      // Title shape — join all paragraphs as the title
      title = paragraphs.map((p) => p.text).join(" ").trim()
    } else if (isBodyShape(sp)) {
      for (const { text, isBullet } of paragraphs) {
        if (isBullet) {
          bodyLines.push(`- ${text}`)
        } else {
          bodyLines.push(text)
        }
      }
    }
  }

  // Speaker notes — same <a:t> extraction, but skip the default "Click to edit" placeholder
  let notes = ""
  if (notesXml) {
    const noteShapes = innerXml(notesXml, "p:sp")
    const noteTexts: string[] = []
    for (const sp of noteShapes) {
      // Skip the slide thumbnail placeholder (idx="0")
      if (sp.includes('idx="0"') && sp.includes('type="body"')) continue
      const paragraphs = extractParagraphs(sp)
      for (const { text } of paragraphs) {
        if (
          text &&
          text !== "Click to add notes" &&
          text !== "Click to edit Master title style"
        ) {
          noteTexts.push(text)
        }
      }
    }
    notes = noteTexts.join(" ").trim()
  }

  return { title, lines: bodyLines, notes }
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function convertPptx(arrayBuffer: ArrayBuffer): Promise<ConvertPptxResult> {
  const zip = await JSZip.loadAsync(arrayBuffer)

  // Find slides in order
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0])
      const nb = parseInt(b.match(/\d+/)![0])
      return na - nb
    })

  const output: string[] = []
  let presentationTitle = ""

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml  = await zip.files[slideFiles[i]].async("string")
    const notesPath = `ppt/notesSlides/notesSlide${i + 1}.xml`
    const notesXml  = zip.files[notesPath]
      ? await zip.files[notesPath].async("string")
      : null

    const { title, lines, notes } = extractSlide(slideXml, notesXml)

    const slideTitle = title || `Slide ${i + 1}`
    if (i === 0 && title) presentationTitle = title

    output.push(`## Slide ${i + 1}: ${slideTitle}`)
    output.push("")

    for (const line of lines) {
      output.push(line)
    }

    if (notes) {
      output.push("")
      output.push(`> ${notes}`)
    }

    output.push("")
  }

  const markdown = output.join("\n").trim()
  const title    = presentationTitle || "Untitled Presentation"

  return { markdown, title, slideCount: slideFiles.length }
}