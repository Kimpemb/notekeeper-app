// src/lib/exporters/markdown.ts

// ─── Types ────────────────────────────────────────────────────────────────────

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
}

interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ─── Inline marks ─────────────────────────────────────────────────────────────

function applyMarks(text: string, marks: PmMark[] = []): string {
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":      result = `**${result}**`; break;
      case "italic":    result = `_${result}_`;   break;
      case "strike":    result = `~~${result}~~`; break;
      case "code":      result = `\`${result}\``; break;
      case "link": {
        const href = mark.attrs?.href ?? "";
        result = `[${result}](${href})`;
        break;
      }
    }
  }
  return result;
}

// ─── Inline content ───────────────────────────────────────────────────────────

function inlineContent(nodes: PmNode[] = []): string {
  return nodes.map((node) => {
    if (node.type === "text") return applyMarks(node.text ?? "", node.marks);
    if (node.type === "hardBreak") return "  \n";
    if (node.type === "noteLink") return `[[${node.attrs?.label ?? node.attrs?.id ?? ""}]]`;
    if (node.type === "image") return `![${node.attrs?.alt ?? ""}](${node.attrs?.src ?? ""})`;
    return inlineContent(node.content);
  }).join("");
}

// ─── Block nodes ──────────────────────────────────────────────────────────────

function convertNode(node: PmNode, indent = 0, listIndex = 0): string {
  const pad = "  ".repeat(indent);

  switch (node.type) {

    case "paragraph": {
      const text = inlineContent(node.content);
      return text ? `${pad}${text}\n` : "\n";
    }

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const hashes = "#".repeat(level);
      return `${hashes} ${inlineContent(node.content)}\n`;
    }

    case "bulletList": {
      return (node.content ?? []).map((item) =>
        convertNode(item, indent, 0)
      ).join("");
    }

    case "orderedList": {
      return (node.content ?? []).map((item, i) =>
        convertNode(item, indent, i + 1)
      ).join("");
    }

    case "listItem": {
      const bullet = listIndex > 0 ? `${listIndex}.` : "-";
      const children = node.content ?? [];
      const lines: string[] = [];
      children.forEach((child, i) => {
        if (i === 0) {
          // First child inline with bullet
          const text = inlineContent(child.content);
          lines.push(`${pad}${bullet} ${text}`);
        } else {
          lines.push(convertNode(child, indent + 1));
        }
      });
      return lines.join("\n") + "\n";
    }

    case "taskList": {
      return (node.content ?? []).map((item) =>
        convertNode(item, indent)
      ).join("");
    }

    case "taskItem": {
      const checked = node.attrs?.checked ? "x" : " ";
      const children = node.content ?? [];
      const lines: string[] = [];
      children.forEach((child, i) => {
        if (i === 0) {
          const text = inlineContent(child.content);
          lines.push(`${pad}- [${checked}] ${text}`);
        } else {
          lines.push(convertNode(child, indent + 1));
        }
      });
      return lines.join("\n") + "\n";
    }

    case "blockquote": {
      const inner = convertNodes(node.content ?? []);
      return inner.split("\n").map((l) => l ? `> ${l}` : ">").join("\n") + "\n";
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const code = (node.content ?? []).map((n) => n.text ?? "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }

    case "horizontalRule": {
      return `---\n`;
    }

    case "image": {
      const src = (node.attrs?.src as string) ?? "";
      const alt = (node.attrs?.alt as string) ?? "";
      return `![${alt}](${src})\n`;
    }

    case "callout": {
      const type = (node.attrs?.type as string) ?? "info";
      const prefix = { info: "ℹ️", warning: "⚠️", tip: "💡", danger: "🚨" }[type] ?? "ℹ️";
      const inner = convertNodes(node.content ?? []);
      const lines = inner.trim().split("\n").map((l) => `> ${l}`).join("\n");
      return `> ${prefix}\n${lines}\n`;
    }

    case "toggle": {
      const summary = node.content?.find((n) => n.type === "toggleSummary");
      const body    = node.content?.find((n) => n.type === "toggleBody");
      const title   = inlineContent(summary?.content);
      const inner   = body ? convertNodes(body.content ?? []) : "";
      // Render as a details/summary block comment for portability
      const bodyLines = inner.trim().split("\n").map((l) => `  ${l}`).join("\n");
      return `<details>\n<summary>${title}</summary>\n\n${bodyLines}\n\n</details>\n`;
    }

    case "table": {
      return convertTable(node);
    }

    default:
      // Fallback — recurse into children
      return convertNodes(node.content ?? [], indent);
  }
}

function convertNodes(nodes: PmNode[], indent = 0): string {
  return nodes.map((n) => convertNode(n, indent)).join("");
}

// ─── Table ────────────────────────────────────────────────────────────────────

function convertTable(tableNode: PmNode): string {
  const rows = tableNode.content ?? [];
  const lines: string[] = [];

  rows.forEach((row, rowIndex) => {
    const cells = (row.content ?? []).map((cell) => {
      const text = inlineContent(
        (cell.content ?? []).flatMap((n) => n.content ?? [])
      );
      return text.replace(/\|/g, "\\|");
    });
    lines.push(`| ${cells.join(" | ")} |`);
    // Add separator after header row
    if (rowIndex === 0) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
  });

  return lines.join("\n") + "\n";
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function prosemirrorToMarkdown(title: string, contentJson: string): string {
  let doc: PmNode;
  try {
    doc = JSON.parse(contentJson);
  } catch {
    return `# ${title}\n`;
  }

  const body = convertNodes(doc.content ?? []);
  return `# ${title}\n\n${body}`.trimEnd() + "\n";
}