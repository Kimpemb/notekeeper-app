// src/lib/exporters/docx.ts
//
// Docx export — TipTap JSON -> .docx (Uint8Array), via the `docx` npm package.
// Mirrors pdf.ts's node-walking approach but is ASYNC (image embedding requires
// reading real bytes off disk via the existing read_file_bytes Tauri command)
// and builds `docx` library primitives instead of an HTML string.
//
// Node-type handling — see docx-export-design-spec.md section 2 for full rationale:
//   Standard nodes             -> direct docx equivalents
//   toggle, dateChip           -> Category 1: fully flattened inline, no marker
//   subPage, pdfLink, blockRef -> Category 2: labeled reference, never recursed (cycle-safe)
//   dataview                   -> Category 3: placeholder showing the raw query string
//
// ── ASSUMPTIONS RESOLVED (confirmed against real extension source) ────────────
// - blockRef: uses attrs.snapshot (plaintext), not attrs.label as originally
//   guessed. See the blockRef case below.
// - dateChip: uses attrs.displayDate (human-readable, e.g. "15 Jun 2026"),
//   falling back to attrs.isoDate. Neither "date" nor "label" exist on this
//   node — both were incorrect initial guesses. See textRunsFromInline below.
//
// ── ONE-WAY EXPORT, BY DESIGN (not a round-trip format) ────────────────────────
// toggle, callout, dataview, subPage, pdfLink, and blockRef are all flattened
// to plain paragraphs/formatting with no marker distinguishing them from
// ordinary text (see Category 1/2/3 handling below). This is deliberate: docx
// is a portability target for sharing notes outside the app, not a save
// format. Re-importing an exported .docx will NOT reconstruct these node
// types — Word has no concept of them, and mammoth (the import-side HTML
// converter) has no way to tell a flattened toggle from a heading someone
// typed by hand. If lossless round-tripping is ever needed, use the app's own
// JSON export/import instead. Do not "fix" reimport of these node types
// without first revisiting this decision.
//
// ── KNOWN SIMPLIFICATIONS (v1, deliberate) ─────────────────────────────────────
// - Ordered lists use a manual "N. " text prefix rather than native Word
//   numbering (avoids registering a numbering config on the Document, which is
//   the more failure-prone path for a first version). Numbers restart per list,
//   not per nested level — acceptable for v1, revisit if nested ordered lists
//   need proper indentation-aware numbering.
// - Image aspect ratio is assumed 4:3 from the stored width attr, since reading
//   true image dimensions isn't wired up yet. Images will look correct in width
//   but may appear stretched/squashed vertically. Flagged in the design spec's
//   open questions as a Milestone 2 follow-up, not blocking for v1.
// - Callout/blockquote styling (shading, indent) is applied per-paragraph rather
//   than as a true bordered/boxed container, since docx's box-drawing primitives
//   are more limited than HTML's. Visually simpler than the PDF export's callout
//   boxes, but readable and correctly labeled.

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  Packer,
  BorderStyle,
  WidthType,
  ExternalHyperlink,
  ShadingType,
} from "docx";
import { invoke } from "@tauri-apps/api/core";

// ─── Shared node shape (mirrors pdf.ts's PmNode) ──────────────────────────────

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

type DocxBlock = Paragraph | Table;

// ─── Inline marks -> TextRun ───────────────────────────────────────────────────

function textRunsFromInline(nodes: PmNode[] = [], forceItalic = false): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      const marks = node.marks ?? [];
      const bold = marks.some((m) => m.type === "bold");
      const italics = forceItalic || marks.some((m) => m.type === "italic");
      const strike = marks.some((m) => m.type === "strike");
      const isCode = marks.some((m) => m.type === "code");
      const linkMark = marks.find((m) => m.type === "link");

      const run = new TextRun({
        text: node.text ?? "",
        bold,
        italics,
        strike,
        font: isCode ? "Consolas" : undefined,
        shading: isCode ? { type: ShadingType.CLEAR, fill: "F1F5F9" } : undefined,
      });

      if (linkMark) {
        runs.push(
          new ExternalHyperlink({
            link: String(linkMark.attrs?.href ?? ""),
            children: [run],
          })
        );
      } else {
        runs.push(run);
      }
      continue;
    }

    if (node.type === "hardBreak") {
      runs.push(new TextRun({ text: "", break: 1 }));
      continue;
    }

    if (node.type === "noteLink") {
      runs.push(new TextRun({
        text: `[[${String(node.attrs?.label ?? node.attrs?.id ?? "")}]]`,
        italics: true,
      }));
      continue;
    }

    if (node.type === "dateChip") {
      // Category 1 — flatten inline, no marker. Confirmed against
      // DateChipExtension.ts: displayDate is the human-readable chip text
      // (e.g. "15 Jun 2026"), isoDate is the fallback if displayDate is
      // somehow empty. Neither "date" nor "label" attrs exist on this node.
      const text = String(node.attrs?.displayDate || node.attrs?.isoDate || "");
      runs.push(new TextRun({ text, italics: forceItalic }));
      continue;
    }

    // Unknown inline node — recurse into its content if any
    if (node.content) runs.push(...textRunsFromInline(node.content, forceItalic));
  }

  return runs;
}

function plainTextFromInline(nodes: PmNode[] = []): string {
  return nodes.map((n) => {
    if (n.type === "text") return n.text ?? "";
    if (n.content) return plainTextFromInline(n.content);
    return "";
  }).join("");
}

// ─── Image byte loading ────────────────────────────────────────────────────────

async function loadImageBytes(path: string): Promise<Uint8Array | null> {
  try {
    const data = await invoke<number[]>("read_file_bytes", { path });
    return new Uint8Array(data);
  } catch (err) {
    console.warn("[docx-export] failed to read image bytes:", path, err);
    return null;
  }
}

function isParagraph(el: DocxBlock): el is Paragraph {
  return el instanceof Paragraph;
}

// ─── List handling ──────────────────────────────────────────────────────────
// See "Known simplifications" at top of file — ordered lists use a manual
// "N. " text prefix rather than native Word numbering.

async function listToParagraphs(
  listNode: PmNode,
  ordered: boolean,
  depth: number
): Promise<Paragraph[]> {
  const out: Paragraph[] = [];
  let counter = 1;

  for (const item of listNode.content ?? []) {
    const children = item.content ?? [];
    const first = children[0];
    const runs = first ? textRunsFromInline(first.content) : [];
    const prefix = ordered ? `${counter}. ` : "•  ";
    counter++;

    out.push(new Paragraph({
      children: [new TextRun({ text: prefix }), ...runs],
      indent: { left: 360 * (depth + 1) },
    }));

    // Nested content under a list item (sub-lists, extra paragraphs)
    for (const child of children.slice(1)) {
      const nested = await nodeToDocxElements(child, depth + 1);
      out.push(...nested.filter(isParagraph));
    }
  }

  return out;
}

// ─── Block-level node -> docx element(s) ──────────────────────────────────────
// Async because image embedding needs to read real file bytes off disk.

async function nodeToDocxElements(node: PmNode, depth = 0): Promise<DocxBlock[]> {
  switch (node.type) {

    case "paragraph":
      return [new Paragraph({ children: textRunsFromInline(node.content) })];

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      };
      return [new Paragraph({
        heading: headingMap[level] ?? HeadingLevel.HEADING_1,
        children: textRunsFromInline(node.content),
      })];
    }

    case "bulletList":
      return listToParagraphs(node, false, depth);

    case "orderedList":
      return listToParagraphs(node, true, depth);

    case "taskList": {
      const items: Paragraph[] = [];
      for (const item of node.content ?? []) {
        const checked = item.attrs?.checked ? "☑  " : "☐  ";
        const first = item.content?.[0];
        const runs = first ? textRunsFromInline(first.content) : [];
        items.push(new Paragraph({
          children: [new TextRun({ text: checked }), ...runs],
          indent: { left: 360 * (depth + 1) },
        }));
        for (const child of (item.content ?? []).slice(1)) {
          const nested = await nodeToDocxElements(child, depth + 1);
          items.push(...nested.filter(isParagraph));
        }
      }
      return items;
    }

    case "blockquote": {
      // docx has no direct equivalent of a left-border blockquote box without
      // more setup than is worth it for v1: indent + italic, applied at
      // construction time via forceItalic on textRunsFromInline. Paragraph
      // children get the styled treatment directly; non-paragraph children
      // (nested lists, tables, etc.) are recursed into as-is, unstyled — a
      // built Paragraph's children can't be read back out to re-style after
      // the fact, so we never try to.
      const out: DocxBlock[] = [];
      for (const child of node.content ?? []) {
        if (child.type === "paragraph") {
          out.push(new Paragraph({
            children: textRunsFromInline(child.content, true),
            indent: { left: 480 },
          }));
        } else {
          out.push(...(await nodeToDocxElements(child, depth)));
        }
      }
      return out;
    }

    case "codeBlock": {
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      const lines = code.split("\n");
      return lines.map((line) => new Paragraph({
        children: [new TextRun({ text: line.length > 0 ? line : " ", font: "Consolas", size: 20 })],
        shading: { type: ShadingType.CLEAR, fill: "F6F8FA" },
      }));
    }

    case "horizontalRule":
      return [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
        children: [],
      })];

    case "image": {
      const src = String(node.attrs?.src ?? "");
      if (!src) return [];
      const bytes = await loadImageBytes(src);
      if (!bytes) {
        return [new Paragraph({
          children: [new TextRun({ text: `[Image not found: ${node.attrs?.alt ?? src}]`, italics: true })],
        })];
      }
      const width = (node.attrs?.width as number) ?? 400;
      // Assumed 4:3 aspect — see "Known simplifications" at top of file.
      const height = Math.round(width * 0.75);
      return [new Paragraph({
        children: [new ImageRun({ data: bytes, transformation: { width, height }, type: "png" })],
      })];
    }

    case "callout": {
      const calloutType = String(node.attrs?.type ?? "info");
      const emoji = { info: "ℹ️", warning: "⚠️", tip: "💡", danger: "🚨" }[calloutType] ?? "ℹ️";
      const shadeColor = { info: "EFF6FF", warning: "FFFBEB", tip: "F0FDF4", danger: "FEF2F2" }[calloutType] ?? "EFF6FF";

      const children = node.content ?? [];
      const out: DocxBlock[] = [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === "paragraph") {
          out.push(new Paragraph({
            children: i === 0
              ? [new TextRun({ text: `${emoji}  ` }), ...textRunsFromInline(child.content)]
              : textRunsFromInline(child.content),
            shading: { type: ShadingType.CLEAR, fill: shadeColor },
          }));
        } else {
          out.push(...(await nodeToDocxElements(child, depth)));
        }
      }
      return out;
    }

    // ── Category 1 — inline, user-authored content, fully flattened ─────────

    case "toggle": {
      const summary = node.content?.find((n) => n.type === "toggleSummary");
      const body = node.content?.find((n) => n.type === "toggleBody");
      const out: DocxBlock[] = [
        new Paragraph({
          children: [new TextRun({ text: plainTextFromInline(summary?.content) || "(untitled toggle)", bold: true })],
        }),
      ];
      for (const child of body?.content ?? []) {
        out.push(...(await nodeToDocxElements(child, depth + 1)));
      }
      return out;
    }

    // ── Category 2 — references, never recursed (cycle-safe) ────────────────

    case "subPage": {
      const title = String(node.attrs?.title ?? "Untitled");
      return [new Paragraph({
        children: [new TextRun({ text: `→ Subpage: ${title}`, italics: true, color: "3B82F6" })],
      })];
    }

    case "pdfLink": {
      const title = String(node.attrs?.title ?? "PDF");
      return [new Paragraph({
        children: [new TextRun({ text: `→ PDF: ${title}`, italics: true, color: "3B82F6" })],
      })];
    }

    case "blockRef": {
      // Confirmed against BlockRefNode.ts — the node stores a plaintext
      // `snapshot` attr (used as its own offline/loading fallback), which is
      // exactly the static text export needs. No live DB lookup required.
      const snapshot = node.attrs?.snapshot as string | undefined;
      const excerpt = snapshot ? snapshot.slice(0, 60) : null;
      const truncated = snapshot && snapshot.length > 60 ? "…" : "";
      return [new Paragraph({
        children: [new TextRun({
          text: excerpt ? `→ Reference: "${excerpt}${truncated}"` : "[Reference]",
          italics: true,
          color: "6B7280",
        })],
      })];
    }

    // ── Category 3 — live computed content, no static equivalent ────────────

    case "dataview": {
      const query = String(node.attrs?.query ?? "");
      return [new Paragraph({
        children: [new TextRun({
          text: `[Dynamic view: ${query || "(empty query)"} — not available in exported document]`,
          italics: true,
          color: "9CA3AF",
        })],
      })];
    }

    case "table":
      return [await tableToDocx(node)];

    default: {
      // Unknown container — recurse into content if present
      const out: DocxBlock[] = [];
      for (const child of node.content ?? []) {
        out.push(...(await nodeToDocxElements(child, depth)));
      }
      return out;
    }
  }
}

// ─── Table ──────────────────────────────────────────────────────────────────

async function tableToDocx(tableNode: PmNode): Promise<Table> {
  const rows = tableNode.content ?? [];
  // Explicit column widths in DXA (twentieths of a point) — percentage-only
  // width is unreliable across renderers (mobile viewers, some preview tools
  // default near-zero per column without an explicit DXA width to fall back on).
  const columnCount = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
  const totalWidthDxa = 9000; // ~6.25in usable width at standard 1in margins
  const colWidthDxa = Math.floor(totalWidthDxa / columnCount);

  const tableRows: TableRow[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const cells: TableCell[] = [];
    for (const cell of row.content ?? []) {
      const cellParagraphs: Paragraph[] = [];
      for (const cellChild of cell.content ?? []) {
        const elements = await nodeToDocxElements(cellChild);
        cellParagraphs.push(...elements.filter(isParagraph));
      }
      cells.push(new TableCell({
        children: cellParagraphs.length > 0 ? cellParagraphs : [new Paragraph({ children: [] })],
        width: { size: colWidthDxa, type: WidthType.DXA },
        shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: "F8FAFC" } : undefined,
      }));
    }
    tableRows.push(new TableRow({ children: cells }));
  }

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array(columnCount).fill(colWidthDxa),
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function exportToDocx(title: string, contentJson: string): Promise<Uint8Array> {
  let doc: PmNode;
  try {
    doc = JSON.parse(contentJson);
  } catch {
    doc = { type: "doc", content: [] };
  }

  const bodyElements: DocxBlock[] = [];
  for (const node of doc.content ?? []) {
    bodyElements.push(...(await nodeToDocxElements(node)));
  }

  const docxDoc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: title, bold: true })],
          }),
          ...bodyElements,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(docxDoc);
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}