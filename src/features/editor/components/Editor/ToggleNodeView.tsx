// src/features/editor/components/Editor/ToggleNodeView.tsx
//
// Schema:
//   toggle (open attr)
//     └─ toggleSummary  (no open attr — visibility driven by parent CSS class)
//     └─ toggleBody?    (no open attr — same)
//
// Why `open` lives only on the toggle parent:
//   Previously all three nodes (toggle, toggleSummary, toggleBody) carried
//   an `open` attribute that had to be kept in sync via three setNodeMarkup
//   calls per toggle operation. If any call failed or a transaction was
//   partially applied, the nodes could drift out of sync.
//
//   Now `open` is the single source of truth on the toggle parent only.
//   The CSS class `.toggle-open` / `.toggle-closed` on the NodeViewWrapper
//   drives arrow rotation and body visibility. toggleSummary and toggleBody
//   have no attributes at all — they are structurally inert.
//
// Why NOT display:none for the body:
//   display:none removes the element from the layout tree. ProseMirror's
//   ReactNodeViewRenderer mounts React sub-trees into real DOM nodes — if
//   those nodes vanish from layout, React loses its fiber references and the
//   NodeViews go stale (clicks stop working, content can corrupt on re-focus).
//   The toggle body stays mounted at all times; CSS hides it via
//   height:0 + overflow:hidden + visibility:hidden.
//
//   App.tsx uses the same principle for inactive tabs: visibility:hidden
//   instead of display:none keeps all editors fully mounted.

import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";

// ── Exported helper — called by ToggleKeyboardExtension ──────────────────────
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
        // Opening for the first time: create body and move cursor into it.
        // Single setNodeMarkup — only the toggle parent changes.
        tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: true });

        const paragraph = s.schema.nodes.paragraph.create();
        const bodyNode  = s.schema.nodes.toggleBody.create({}, paragraph);
        const insertAt  = togglePos + toggleNode.nodeSize - 1;
        tr.insert(insertAt, bodyNode);

        // Place cursor at first content position inside the new body paragraph
        const cursorPos = insertAt + 2;
        const resolved  = tr.doc.resolve(Math.min(cursorPos, tr.doc.content.size));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tr.setSelection((s.selection as any).constructor.near(resolved));
      } else {
        // Simple flip — one setNodeMarkup on the toggle parent only.
        tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: willOpen });
      }
      return true;
    })
    .run();
}

// ── Parent toggle wrapper ─────────────────────────────────────────────────────
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
        Arrow button: lives in a non-editable overlay at top-left.
        Kept outside NodeViewContent so clicks don't become cursor movements.
        onMouseDown preventDefault stops the editor losing focus on click.
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

      {/* Content column: toggleSummary and toggleBody stacked vertically */}
      <NodeViewContent as="div" className="toggle-children" />
    </NodeViewWrapper>
  );
}

// ── Summary NodeView ──────────────────────────────────────────────────────────
// Renders the inline title. No attributes, no open/closed logic here.
export function ToggleSummaryNodeView(_props: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="toggle-summary-row">
      <NodeViewContent as="div" className="toggle-summary-content" />
    </NodeViewWrapper>
  );
}

// ── Body NodeView ─────────────────────────────────────────────────────────────
// Always in the DOM. Visibility controlled entirely by CSS on the parent:
//   .toggle-closed .toggle-body { height:0; overflow:hidden; visibility:hidden }
//   .toggle-open   .toggle-body { height:auto; visibility:visible }
export function ToggleBodyNodeView(_props: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="toggle-body">
      <NodeViewContent as="div" className="toggle-body-content" />
    </NodeViewWrapper>
  );
}