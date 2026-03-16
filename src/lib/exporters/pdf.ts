// src/lib/exporters/pdf.ts

// ─── Inline marks ─────────────────────────────────────────────────────────────

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function applyMarks(text: string, marks: PmNode["marks"] = []): string {
  let result = escapeHtml(text);
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":      result = `<strong>${result}</strong>`; break;
      case "italic":    result = `<em>${result}</em>`;         break;
      case "strike":    result = `<s>${result}</s>`;           break;
      case "code":      result = `<code>${result}</code>`;     break;
      case "link": {
        const href = escapeHtml(String(mark.attrs?.href ?? ""));
        result = `<a href="${href}">${result}</a>`;
        break;
      }
    }
  }
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Inline content ───────────────────────────────────────────────────────────

function inlineContent(nodes: PmNode[] = []): string {
  return nodes.map((node) => {
    if (node.type === "text") return applyMarks(node.text ?? "", node.marks);
    if (node.type === "hardBreak") return "<br>";
    if (node.type === "noteLink") return `<span class="note-link">[[${escapeHtml(String(node.attrs?.label ?? node.attrs?.id ?? ""))}]]</span>`;
    if (node.type === "image") return `<img src="${escapeHtml(String(node.attrs?.src ?? ""))}" alt="${escapeHtml(String(node.attrs?.alt ?? ""))}">`;
    return inlineContent(node.content);
  }).join("");
}

// ─── Block nodes ──────────────────────────────────────────────────────────────

function nodeToHtml(node: PmNode): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${inlineContent(node.content) || "&nbsp;"}</p>`;

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      return `<h${level}>${inlineContent(node.content)}</h${level}>`;
    }

    case "bulletList":
      return `<ul>${(node.content ?? []).map((n) => nodeToHtml(n)).join("")}</ul>`;

    case "orderedList":
      return `<ol>${(node.content ?? []).map((n) => nodeToHtml(n)).join("")}</ol>`;

    case "listItem": {
      const children = node.content ?? [];
      const first = children[0] ? inlineContent(children[0].content) : "";
      const rest  = children.slice(1).map((n) => nodeToHtml(n)).join("");
      return `<li>${first}${rest}</li>`;
    }

    case "taskList":
      return `<ul class="task-list">${(node.content ?? []).map((n) => nodeToHtml(n)).join("")}</ul>`;

    case "taskItem": {
      const checked = node.attrs?.checked ? "checked" : "";
      const children = node.content ?? [];
      const first = children[0] ? inlineContent(children[0].content) : "";
      return `<li class="task-item"><input type="checkbox" ${checked} disabled> ${first}</li>`;
    }

    case "blockquote":
      return `<blockquote>${nodesToHtml(node.content ?? [])}</blockquote>`;

    case "codeBlock": {
      const lang = escapeHtml(String(node.attrs?.language ?? ""));
      const code = escapeHtml((node.content ?? []).map((n) => n.text ?? "").join(""));
      return `<pre><code class="language-${lang}">${code}</code></pre>`;
    }

    case "horizontalRule":
      return `<hr>`;

    case "image": {
      const src   = escapeHtml(String(node.attrs?.src ?? ""));
      const alt   = escapeHtml(String(node.attrs?.alt ?? ""));
      const width = node.attrs?.width ? ` style="width:${node.attrs.width}px;max-width:100%"` : ` style="max-width:100%"`;
      return `<figure><img src="${src}" alt="${alt}"${width}></figure>`;
    }

    case "callout": {
      const type  = String(node.attrs?.type ?? "info");
      const emoji = { info: "ℹ️", warning: "⚠️", tip: "💡", danger: "🚨" }[type] ?? "ℹ️";
      return `<div class="callout callout-${type}"><span class="callout-icon">${emoji}</span><div class="callout-body">${nodesToHtml(node.content ?? [])}</div></div>`;
    }

    case "toggle": {
      const summary = node.content?.find((n) => n.type === "toggleSummary");
      const body    = node.content?.find((n) => n.type === "toggleBody");
      const title   = inlineContent(summary?.content);
      const inner   = body ? nodesToHtml(body.content ?? []) : "";
      return `<details open><summary>${title}</summary>${inner}</details>`;
    }

    case "table":
      return tableToHtml(node);

    default:
      return nodesToHtml(node.content ?? []);
  }
}

function nodesToHtml(nodes: PmNode[]): string {
  return nodes.map((n) => nodeToHtml(n)).join("");
}

function tableToHtml(tableNode: PmNode): string {
  const rows = tableNode.content ?? [];
  const rowsHtml = rows.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? "th" : "td";
    const cells = (row.content ?? []).map((cell) => {
      const text = inlineContent((cell.content ?? []).flatMap((n) => n.content ?? []));
      return `<${tag}>${text}</${tag}>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<table>${rowsHtml}</table>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const PRINT_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13pt;
    line-height: 1.7;
    color: #1a1a1a;
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 32px;
  }
  h1 { font-size: 2em; font-weight: 700; margin: 0 0 0.5em; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.3em; }
  h2 { font-size: 1.4em; font-weight: 600; margin: 1.5em 0 0.5em; }
  h3 { font-size: 1.15em; font-weight: 600; margin: 1.2em 0 0.4em; }
  p  { margin: 0 0 0.8em; }
  ul, ol { margin: 0 0 0.8em; padding-left: 1.5em; }
  li { margin-bottom: 0.2em; }
  .task-list { list-style: none; padding-left: 0.5em; }
  .task-item input { margin-right: 0.4em; }
  blockquote { margin: 1em 0; padding: 0.5em 1em; border-left: 3px solid #d1d5db; color: #555; }
  pre { background: #f6f8fa; border-radius: 6px; padding: 1em; overflow-x: auto; font-size: 0.85em; margin: 0.8em 0; }
  code { background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.88em; font-family: "Fira Code", "Cascadia Code", monospace; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid #e5e5e5; margin: 1.5em 0; }
  img { max-width: 100%; border-radius: 4px; }
  figure { margin: 1em 0; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
  th, td { border: 1px solid #e2e8f0; padding: 0.5em 0.75em; text-align: left; }
  th { background: #f8fafc; font-weight: 600; }
  .callout { display: flex; gap: 0.75em; padding: 0.75em 1em; border-radius: 6px; margin: 1em 0; }
  .callout-info    { background: #eff6ff; border-left: 3px solid #3b82f6; }
  .callout-warning { background: #fffbeb; border-left: 3px solid #f59e0b; }
  .callout-tip     { background: #f0fdf4; border-left: 3px solid #22c55e; }
  .callout-danger  { background: #fef2f2; border-left: 3px solid #ef4444; }
  .callout-icon { font-size: 1em; line-height: 1.7; flex-shrink: 0; }
  .callout-body p:last-child { margin-bottom: 0; }
  details { margin: 0.8em 0; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.5em 1em; }
  summary { font-weight: 500; cursor: default; }
  .note-link { color: #3b82f6; }
  @media print {
    body { padding: 0; }
    @page { margin: 2cm; }
  }
`;

// ─── Public API ───────────────────────────────────────────────────────────────

export async function exportToPdf(title: string, contentJson: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");

  let doc: PmNode;
  try { doc = JSON.parse(contentJson); } catch { doc = { type: "doc", content: [] }; }

  const body = nodesToHtml(doc.content ?? []);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${body}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  <\/script>
</body>
</html>`;

  // Write to a temp file in app data dir, then open with system browser
  const appDataDir = await invoke<string>("get_app_data_dir");
  const sep        = appDataDir.includes("\\") ? "\\" : "/";
  const slug       = title.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
  const fullPath   = `${appDataDir}${sep}${slug}-${Date.now()}.html`;

  console.log("[export-pdf] appDataDir:", appDataDir);
  console.log("[export-pdf] fullPath:", fullPath);

  await invoke("write_file", { path: fullPath, contents: html });
  console.log("[export-pdf] file written");
  await invoke("open_in_browser", { path: fullPath });
  console.log("[export-pdf] openPath called");
}