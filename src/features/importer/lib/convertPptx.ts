// src/features/importer/lib/convertPptx.ts
import JSZip from "jszip"

export interface ConvertPptxResult {
  markdown:   string
  title:      string
  slideCount: number
}

function extractTextFromXml(xml: string): string {
  // Extract all <a:t> text nodes (DrawingML text runs)
  const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? []
  return matches
    .map((m) => m.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join(" ")
}

function extractNotesFromXml(xml: string): string {
  // Notes XML has same <a:t> structure
  return extractTextFromXml(xml)
}

export async function convertPptx(arrayBuffer: ArrayBuffer): Promise<ConvertPptxResult> {
  const zip = await JSZip.loadAsync(arrayBuffer)

  // Find all slide files in order
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)![0])
      const nb = parseInt(b.match(/\d+/)![0])
      return na - nb
    })

  const lines: string[] = []

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.files[slideFiles[i]].async("string")
    const slideText = extractTextFromXml(slideXml)
    if (!slideText.trim()) continue

    const slideLines = slideText.split(/\s{2,}/).map((l) => l.trim()).filter(Boolean)
    const slideTitle = slideLines[0] ?? `Slide ${i + 1}`
    const body = slideLines.slice(1)

    lines.push(`## Slide ${i + 1}: ${slideTitle}`)
    lines.push("")
    for (const line of body) {
      lines.push(line)
    }

    // Check for speaker notes
    const notesPath = `ppt/notesSlides/notesSlide${i + 1}.xml`
    if (zip.files[notesPath]) {
      const notesXml = await zip.files[notesPath].async("string")
      const notesText = extractNotesFromXml(notesXml)
      if (notesText.trim()) {
        lines.push("")
        lines.push(`> ${notesText.trim()}`)
      }
    }

    lines.push("")
  }

  const markdown = lines.join("\n").trim()
  const firstHeading = markdown.match(/^## Slide 1: (.+)$/m)
  const title = firstHeading ? firstHeading[1].trim() : "Untitled Presentation"

  return { markdown, title, slideCount: slideFiles.length }
}