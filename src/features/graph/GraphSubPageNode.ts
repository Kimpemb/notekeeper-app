// src/features/graph/GraphSubPageNode.ts
import { Node, mergeAttributes } from "@tiptap/core";

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!)
  );
}

/**
 * Drop-in replacement for SubPageNode inside the graph editor.
 * Uses the same schema (name, attrs) so existing note content is
 * parsed identically — only the nodeView is different.
 *
 * Registered via addNodeView() so it fires synchronously during
 * editor construction, before any content is parsed. No timing race.
 */
export function createGraphSubPageNode(
  onOpenInEditor:   (noteId: string) => void,
  onNavigateToNode: (noteId: string) => void,
) {
  return Node.create({
    name:  "subPage",   // must match exactly — same ProseMirror node type
    group: "block",
    atom:  true,

    addAttributes() {
      return {
        noteId: { default: null },
        title:  { default: "Untitled" },
        mode:   { default: "display" },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="sub-page"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": "sub-page" })];
    },

    // addNodeView() runs synchronously during `new Editor()` — guaranteed
    // first-paint correctness, no async gap, no fallback render.
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("div");
        dom.className = "graph-subpage-node";

        const noteId: string | null = node.attrs.noteId ?? null;
        const title: string         = node.attrs.title  ?? "Untitled";

        dom.innerHTML = `
          <div class="graph-subpage-inner" data-note-id="${noteId ?? ""}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;opacity:0.5">
              <path d="M4 2h6l3 3v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
                stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              <path d="M10 2v3h3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              <path d="M6 8h4M6 11h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
            <span>${escapeHtml(title)}</span>
          </div>
        `;

        if (noteId) {
          const handler = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) onNavigateToNode(noteId);
            else            onOpenInEditor(noteId);
          };
          dom.addEventListener("click", handler);

          return {
            dom,
            destroy() {
              dom.removeEventListener("click", handler);
            },
          };
        }

        return { dom };
      };
    },
  });
}