// src/features/editor/hooks/useReorderTransaction.ts
//
// Owns all ProseMirror transaction logic for block reordering.
//
// Three dispatch branches, in order of specificity:
//   1. List item escaped its parent list — wrap in original list type, move to top level
//   2. List item reorder within its list — replaceWith reordered children
//   3. Top-level block reorder          — replaceWith reordered top-level nodes
//
// Each branch:
//   - Builds a tr from current state
//   - Sets selection near the moved block
//   - Dispatches via view.dispatch(tr)
//   - Refocuses if cursor is still inside the editor
//
// Nothing in this file touches the DOM directly.

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DragSnapshot = {
  dragDom:        HTMLElement;
  nodePos:        number;
  isListItem:     boolean;
  listParentPos:  number;
  escapedList:    boolean;
  insertAfterPos: number | null;
};

interface UseReorderTransactionOptions {
  editorRef:     React.RefObject<Editor | null>;
  editorWrapRef: React.RefObject<HTMLDivElement | null>;
}

interface UseReorderTransactionResult {
  dispatchReorder: (ds: DragSnapshot, mouseX: number, mouseY: number) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useReorderTransaction({
  editorRef,
  editorWrapRef,
}: UseReorderTransactionOptions): UseReorderTransactionResult {

  const dispatchReorder = useCallback((
    ds:     DragSnapshot,
    mouseX: number,
    mouseY: number,
  ) => {
    const ed = editorRef.current;
    if (!ed) return;

    const { view }  = ed;
    const { state } = view;
    const { doc }   = state;

    // ── Refocus if cursor is still inside the editor ──────────────────────
    function refocusIfInEditor() {
      const editorEl = editorWrapRef.current;
      if (!editorEl) return;
      const rect = editorEl.getBoundingClientRect();
      if (
        mouseX >= rect.left && mouseX <= rect.right &&
        mouseY >= rect.top  && mouseY <= rect.bottom
      ) view.focus();
    }

    // ── Branch 1: list item escaped — move to top level ───────────────────
    if (ds.isListItem && ds.escapedList) {
      const listNode = doc.nodeAt(ds.listParentPos);
      if (!listNode) return;

      let draggedItem: PmNode | null = null;
      listNode.forEach((child: PmNode, childOffset: number) => {
        if (ds.listParentPos + 1 + childOffset === ds.nodePos) draggedItem = child;
      });
      if (!draggedItem) return;

      const itemNode        = draggedItem as PmNode;
      const { schema }      = state;
      const listTypeName    = listNode.type.name;
      const itemTypeName    = itemNode.type.name;

      const newItem     = schema.nodes[itemTypeName].create(itemNode.attrs, itemNode.content);
      const wrappedList = schema.nodes[listTypeName].create(null, newItem);

      const siblings: PmNode[] = [];
      listNode.forEach((child: PmNode, childOffset: number) => {
        if (ds.listParentPos + 1 + childOffset !== ds.nodePos) siblings.push(child);
      });

      const topLevelNodes: { pos: number; node: PmNode }[] = [];
      doc.forEach((node: PmNode, pos: number) => topLevelNodes.push({ pos, node }));

      let insertAt: number;
      if (ds.insertAfterPos === null) {
        insertAt = 0;
      } else {
        const ref = topLevelNodes.find((n) => n.pos === ds.insertAfterPos);
        insertAt  = ref ? ref.pos + ref.node.nodeSize : doc.content.size;
      }

      const tr = state.tr;

      if (siblings.length === 0) {
        tr.replaceWith(ds.listParentPos, ds.listParentPos + listNode.nodeSize, wrappedList);

        if (insertAt > ds.listParentPos) {
          const shift = listNode.nodeSize - wrappedList.nodeSize;
          insertAt   -= shift;
        }

        const currentPos = ds.listParentPos;
        if (insertAt !== currentPos) {
          tr.delete(currentPos, currentPos + wrappedList.nodeSize);
          const finalPos = insertAt > currentPos
            ? insertAt - wrappedList.nodeSize
            : insertAt;
          tr.insert(Math.max(0, finalPos), wrappedList);
        }
      } else {
        const listContentStart = ds.listParentPos + 1;
        const listContentEnd   = ds.listParentPos + listNode.nodeSize - 1;
        tr.replaceWith(listContentStart, listContentEnd, siblings);

        if (insertAt > ds.nodePos) insertAt -= itemNode.nodeSize;

        tr.insert(Math.max(0, insertAt), wrappedList);
      }

      try {
        const resolvedInsert = siblings.length === 0
          ? Math.min(ds.listParentPos + 1, tr.doc.content.size - 1)
          : Math.min(insertAt + 1, tr.doc.content.size - 1);
        const $pos = tr.doc.resolve(Math.max(0, resolvedInsert));
        tr.setSelection(Selection.near($pos));
      } catch { /**/ }

      tr.setMeta("reorderBlock", true);
      view.dispatch(tr);
      refocusIfInEditor();
      return;
    }

    // ── Branch 2: list item reorder within its list ───────────────────────
    if (ds.isListItem && !ds.escapedList) {
      const listNode = doc.nodeAt(ds.listParentPos);
      if (!listNode) return;

      const items: { pos: number; node: PmNode }[] = [];
      listNode.forEach((child: PmNode, childOffset: number) => {
        items.push({ pos: ds.listParentPos + 1 + childOffset, node: child });
      });
      if (items.length < 2) return;

      const dragIndex = items.findIndex((item) => item.pos === ds.nodePos);
      if (dragIndex === -1) return;

      const reordered = [...items];
      const [dragged] = reordered.splice(dragIndex, 1);

      if (ds.insertAfterPos === null) {
        reordered.splice(0, 0, dragged);
      } else {
        const refIdx = reordered.findIndex((n) => n.pos === ds.insertAfterPos);
        if (refIdx === -1) reordered.push(dragged);
        else reordered.splice(refIdx + 1, 0, dragged);
      }

      const unchanged     = reordered.every((n, i) => n.pos === items[i].pos);
      if (unchanged) return;

      const originalSize  = items.reduce((acc, n) => acc + n.node.nodeSize, 0);
      const reorderedSize = reordered.reduce((acc, n) => acc + n.node.nodeSize, 0);
      if (originalSize !== reorderedSize) return;

      const listStart = ds.listParentPos + 1;
      const listEnd   = ds.listParentPos + listNode.nodeSize - 1;
      const tr        = state.tr;
      tr.replaceWith(listStart, listEnd, reordered.map((n) => n.node));

      try {
        const finalIdx = reordered.findIndex((n) => n.node === dragged.node);
        const newPos   = ds.listParentPos + 1 +
          reordered.slice(0, finalIdx).reduce((acc, n) => acc + n.node.nodeSize, 0);
        const $pos = tr.doc.resolve(Math.min(newPos + 1, tr.doc.content.size - 1));
        tr.setSelection(Selection.near($pos));
      } catch { /**/ }

      tr.setMeta("reorderBlock", true);
      view.dispatch(tr);
      refocusIfInEditor();
      return;
    }

    // ── Branch 3: top-level block reorder ────────────────────────────────
    const topLevelNodes: { pos: number; node: PmNode }[] = [];
    doc.forEach((node: PmNode, pos: number) => topLevelNodes.push({ pos, node }));
    if (topLevelNodes.length < 2) return;

    const dragIndex = topLevelNodes.findIndex((n) => n.pos === ds.nodePos);
    if (dragIndex === -1) return;

    const reordered = [...topLevelNodes];
    const [dragged] = reordered.splice(dragIndex, 1);

    if (ds.insertAfterPos === null) {
      reordered.splice(0, 0, dragged);
    } else {
      const refIdx = reordered.findIndex((n) => n.pos === ds.insertAfterPos);
      if (refIdx === -1) reordered.push(dragged);
      else reordered.splice(refIdx + 1, 0, dragged);
    }

    const unchanged     = reordered.every((n, i) => n.pos === topLevelNodes[i].pos);
    if (unchanged) return;

    const originalSize  = topLevelNodes.reduce((acc, n) => acc + n.node.nodeSize, 0);
    const reorderedSize = reordered.reduce((acc, n) => acc + n.node.nodeSize, 0);
    if (originalSize !== reorderedSize) return;

    const finalInsertAt = reordered.findIndex((n) => n.node === dragged.node);
    const tr            = state.tr;
    tr.replaceWith(0, doc.content.size, reordered.map((n) => n.node));

    try {
      const newPos = reordered
        .slice(0, finalInsertAt)
        .reduce((acc, n) => acc + n.node.nodeSize, 0);
      const $pos = tr.doc.resolve(Math.min(newPos + 1, tr.doc.content.size - 1));
      tr.setSelection(Selection.near($pos));
    } catch { /**/ }

    tr.setMeta("reorderBlock", true);
    view.dispatch(tr);
    refocusIfInEditor();
  }, [editorRef, editorWrapRef]);

  return { dispatchReorder };
}