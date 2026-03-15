// src/features/editor/components/Editor/ToggleNodeView.tsx
//
// Fixes applied:
//
// 1. LAYOUT — Arrow and summary title are on the same row.
//    The toggle-header is a flex row. The arrow sits on the left.
//    NodeViewContent (toggle-children) renders summary + body stacked
//    vertically to the right of the arrow, but the summary line itself
//    is just inline text so it appears on the same line as the arrow.
//
// 2. ARROW ROTATION — Driven by `.toggle-open .toggle-arrow-icon` on the
//    parent NodeViewWrapper, not a class on the summary child.
//
// 3. NO display:none ON BODY — display:none removes the node from ProseMirror's
//    view, causing content corruption. Instead the body is hidden via
//    height:0 + overflow:hidden + visibility:hidden, keeping the DOM node
//    present. The `.toggle-closed .toggle-body` rule in CSS handles this.

import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";

// ── Exported helper used by ToggleKeyboardExtension ──────────────────────────
export function toggleOpenState(editor: Editor, togglePos: number) {
  const { state } = editor;
  const toggleNode = state.doc.nodeAt(togglePos);
  if (!toggleNode || toggleNode.type.name !== "toggle") return;

  const currentOpen = toggleNode.attrs.open ?? false;
  const willOpen    = !currentOpen;
  const hasBody     = toggleNode.childCount > 1;

  editor
    .chain()
    .focus()
    .command(({ tr, state: s }) => {
      if (willOpen && !hasBody) {
        // Flip toggle open
        tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: true });

        // Mirror open=true onto summary (child 0, always at togglePos+1)
        const summaryNode = toggleNode.child(0);
        tr.setNodeMarkup(togglePos + 1, undefined, { ...summaryNode.attrs, open: true });

        // Insert toggleBody at end of toggle node
        const paragraphNode = s.schema.nodes.paragraph.create();
        const bodyNode      = s.schema.nodes.toggleBody.create({ open: true }, paragraphNode);
        const insertAt      = togglePos + toggleNode.nodeSize - 1;
        tr.insert(insertAt, bodyNode);

        // Move cursor into body's first paragraph
        // insertAt + 1 = body open token, insertAt + 2 = paragraph open token
        // insertAt + 3 = first content pos (but empty paragraph, so use +2 resolved)
        const cursorPos = insertAt + 2;
        const resolved  = tr.doc.resolve(Math.min(cursorPos, tr.doc.content.size));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tr.setSelection((s.selection as any).constructor.near(resolved));
      } else {
        // Flip all three nodes
        tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: willOpen });

        const summaryNode = toggleNode.child(0);
        tr.setNodeMarkup(togglePos + 1, undefined, { ...summaryNode.attrs, open: willOpen });

        if (hasBody) {
          const bodyPos  = togglePos + 1 + summaryNode.nodeSize;
          const bodyNode = toggleNode.child(1);
          tr.setNodeMarkup(bodyPos, undefined, { ...bodyNode.attrs, open: willOpen });
        }
      }
      return true;
    })
    .run();
}

// ── Parent toggle wrapper — owns open attr, renders arrow ────────────────────
export function ToggleNodeView({ node, getPos, editor }: NodeViewProps) {
  const open: boolean = node.attrs.open ?? false;

  function handleArrowClick() {
    if (!editor) return;
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos == null) return;
    toggleOpenState(editor, pos);
  }

  return (
    <NodeViewWrapper className={`toggle-block${open ? " toggle-open" : " toggle-closed"}`}>
      {/*
        Flex row: arrow on left, all content (summary title + body) on right.
        NodeViewContent renders the toggleSummary and toggleBody child nodes
        stacked vertically — summary on top (same visual line as arrow),
        body below (hidden via CSS when toggle-closed).
      */}
      <div className="toggle-header" contentEditable={false}>
        <button
          className="toggle-arrow-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleArrowClick}
          tabIndex={-1}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <svg
            className="toggle-arrow-icon"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {/*
        NodeViewContent must NOT be inside contentEditable={false}.
        It sits as a sibling to toggle-header, absolutely positioned
        to overlap the content area. See CSS for the layout trick.
      */}
      <NodeViewContent as="div" className="toggle-children" />
    </NodeViewWrapper>
  );
}

// ── Summary NodeView — just the inline title, no arrow ───────────────────────
export function ToggleSummaryNodeView(_props: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="toggle-summary-row">
      <NodeViewContent as="div" className="toggle-summary-content" />
    </NodeViewWrapper>
  );
}

// ── Body NodeView — always in DOM, hidden via CSS when closed ─────────────────
// NEVER use display:none — it removes the node from ProseMirror's view
// and causes content loss. Use CSS height/overflow/visibility instead,
// controlled by the parent's .toggle-closed class.
export function ToggleBodyNodeView(_props: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="toggle-body">
      <NodeViewContent as="div" className="toggle-body-content" />
    </NodeViewWrapper>
  );
}