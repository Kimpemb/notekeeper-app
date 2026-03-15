// src/features/editor/components/Editor/extensions.ts
import { Extension, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { CodeBlockNodeView } from "./CodeBlockNodeView";
import { CalloutNodeView } from "./CalloutNodeView";

// ── Lowlight instance ─────────────────────────────────────────────────────────
export const lowlight = createLowlight(common);

// ── Syntax-highlighted code block with React NodeView ────────────────────────
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
}).configure({
  lowlight,
  defaultLanguage: "plaintext",
  HTMLAttributes: { class: "hljs" },
});

// ── Task list (checklist / to-do) ─────────────────────────────────────────────
export const CheckList = TaskList.configure({
  HTMLAttributes: { class: "task-list" },
});

export const CheckItem = TaskItem.configure({
  nested: true,
  HTMLAttributes: { class: "task-item" },
});

// ── Exit task list on Enter (empty item) or Backspace (start of item) ─────────
export const TaskItemExitExtension = Extension.create({
  name: "taskItemExit",
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "taskItem") {
            return editor.chain().focus().liftListItem("taskItem").run();
          }
          depth--;
        }
        return false;
      },
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "taskItem") {
            return editor.chain().focus().liftListItem("taskItem").run();
          }
          depth--;
        }
        return false;
      },
    };
  },
});

// ── Callout block (info / warning / tip / danger) ─────────────────────────────
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-type") ?? "info",
        renderHTML: (attrs) => ({ "data-type": attrs.type }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-callout": "", ...HTMLAttributes }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },

  addKeyboardShortcuts() {
    return {
      // Ctrl+A inside callout — select only text content, not the node structure
      "Mod-a": ({ editor }) => {
        const { $from } = editor.state.selection;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "callout") {
            const pos = $from.before(depth);
            // Find the first and last text positions inside the callout
            // by walking into the first and last block children
            let from = pos + 2; // pos+1 = callout open, pos+2 = first child open
            let to   = pos + node.nodeSize - 2; // skip callout close and last child close
            // Clamp to actual content boundaries
            const docSize = editor.state.doc.content.size;
            from = Math.max(1, Math.min(from, docSize));
            to   = Math.max(from, Math.min(to, docSize));
            editor.commands.setTextSelection({ from, to });
            return true;
          }
          depth--;
        }
        return false;
      },
      // Enter on empty callout paragraph → exit below as paragraph
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "callout") {
            // Insert a paragraph after the callout node
            const calloutPos  = $from.before(depth);
            const calloutNode = $from.node(depth);
            const afterPos    = calloutPos + calloutNode.nodeSize;
            return editor
              .chain()
              .focus()
              .command(({ tr, dispatch }) => {
                if (dispatch) {
                  const paragraph = editor.schema.nodes.paragraph.create();
                  tr.insert(afterPos, paragraph);
                  tr.setSelection(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (editor.state.selection as any).constructor.near(tr.doc.resolve(afterPos + 1))
                  );
                }
                return true;
              })
              .run();
          }
          depth--;
        }
        return false;
      },
      // Backspace at start of empty callout → remove the whole block
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "callout") {
            // Only delete if it's the only/first paragraph in the callout
            if ($from.index(depth) === 0) {
              const pos = $from.before(depth);
              return editor
                .chain()
                .focus()
                .command(({ tr, dispatch }) => {
                  if (dispatch) {
                    tr.delete(pos, pos + node.nodeSize);
                  }
                  return true;
                })
                .run();
            }
          }
          depth--;
        }
        return false;
      },
    };
  },
});

// ── Empty-line "Press '/' for commands" hint ──────────────────────────────────
const emptyLinePlaceholderKey = new PluginKey<DecorationSet>("emptyLinePlaceholder");

export const EmptyLinePlaceholderExtension = Extension.create({
  name: "emptyLinePlaceholder",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: emptyLinePlaceholderKey,
        props: {
          decorations(state) {
            const { doc, selection } = state;
            const decorations: Decoration[] = [];
            doc.descendants((node, pos) => {
              if (node.type.name !== "paragraph") return;
              if (node.content.size !== 0) return;
              const nodeEnd = pos + node.nodeSize;
              const cursorInNode = selection.from >= pos && selection.from <= nodeEnd;
              if (!cursorInNode) return;
              decorations.push(
                Decoration.widget(
                  pos + 1,
                  () => {
                    const span = document.createElement("span");
                    span.textContent = "Press '/' for commands";
                    span.className = "empty-line-hint";
                    return span;
                  },
                  { side: 1, key: `empty-hint-${pos}` }
                )
              );
            });
            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});

// ── Slash placeholder "Type to search" hint after "/" ─────────────────────────
const slashPlaceholderKey = new PluginKey<{ active: boolean }>("slashPlaceholder");

export const SlashPlaceholderExtension = Extension.create({
  name: "slashPlaceholder",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: slashPlaceholderKey,
        props: {
          decorations(state) {
            const { doc, selection } = state;
            const { from, to } = selection;
            if (from !== to) return DecorationSet.empty;
            const charBefore = from > 0 ? doc.textBetween(from - 1, from, "\n") : "";
            if (charBefore !== "/") return DecorationSet.empty;
            return DecorationSet.create(doc, [
              Decoration.widget(
                from,
                () => {
                  const span = document.createElement("span");
                  span.textContent = "Type to search";
                  span.style.color = "rgba(128,128,128,0.42)";
                  span.style.pointerEvents = "none";
                  span.style.userSelect = "none";
                  span.setAttribute("data-slash-hint", "true");
                  return span;
                },
                { side: 1, key: "slash-hint" }
              ),
            ]);
          },
        },
      }),
    ];
  },
});

// ── Exit ordered and bullet lists on Enter (empty item) or Backspace ─────────
export const OrderedListBackspaceExtension = Extension.create({
  name: "orderedListBackspace",
  addKeyboardShortcuts() {
    return {
      // Enter on empty list item → lift out to paragraph
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "listItem") {
            const parent = $from.node(depth - 1);
            if (parent.type.name === "orderedList" || parent.type.name === "bulletList") {
              return editor.chain().focus().liftListItem("listItem").run();
            }
          }
          depth--;
        }
        return false;
      },
      // Backspace at start of empty list item → lift out to paragraph
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "listItem") {
            const parent = $from.node(depth - 1);
            if (parent.type.name === "orderedList" || parent.type.name === "bulletList") {
              return editor.chain().focus().liftListItem("listItem").run();
            }
          }
          depth--;
        }
        return false;
      },
    };
  },
});

// ── Ctrl+A inside code block selects only that block's content ────────────────
export const CodeBlockSelectAllExtension = Extension.create({
  name: "codeBlockSelectAll",
  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { $from } = editor.state.selection;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "codeBlock") {
            const pos = $from.before(depth);
            editor.commands.setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 });
            return true;
          }
          depth--;
        }
        return false;
      },
    };
  },
});

// ── Find & Replace keyboard shortcut (Mod+H) ─────────────────────────────────
export function createFindReplaceShortcutExtension(onOpen: () => void) {
  return Extension.create({
    name: "findReplaceShortcut",
    addKeyboardShortcuts() {
      return {
        "Mod-h": () => { onOpen(); return true; },
      };
    },
  });
}