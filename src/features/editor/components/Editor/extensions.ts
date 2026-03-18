// src/features/editor/components/Editor/extensions.ts
import { Extension, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { CodeBlockNodeView } from "./CodeBlockNodeView";
import { CalloutNodeView } from "./CalloutNodeView";
import {
  ToggleNodeView,
  ToggleSummaryNodeView,
  ToggleBodyNodeView,
  toggleOpenState,
} from "./ToggleNodeView";

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

// ── Table ─────────────────────────────────────────────────────────────────────
export const EditorTable = Table.configure({
  resizable: true,
  HTMLAttributes: { class: "editor-table" },
});

export { TableRow, TableHeader, TableCell };

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

  parseHTML() { return [{ tag: "div[data-callout]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-callout": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },

  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { $from } = editor.state.selection;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "callout") {
            const pos = $from.before(depth);
            let from = pos + 2;
            let to   = pos + node.nodeSize - 2;
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
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "callout") {
            const calloutPos  = $from.before(depth);
            const calloutNode = $from.node(depth);
            const afterPos    = calloutPos + calloutNode.nodeSize;
            return editor
              .chain().focus()
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
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "callout") {
            if ($from.index(depth) === 0) {
              const pos = $from.before(depth);
              return editor
                .chain().focus()
                .command(({ tr, dispatch }) => {
                  if (dispatch) tr.delete(pos, pos + node.nodeSize);
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

// ── Toggle nodes ──────────────────────────────────────────────────────────────
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  isolating: false,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-open") === "true",
        renderHTML: (attrs) => ({ "data-open": attrs.open ? "true" : "false" }),
      },
    };
  },

  parseHTML() { return [{ tag: "div[data-toggle-summary]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-toggle-summary": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleSummaryNodeView);
  },
});

export const ToggleBody = Node.create({
  name: "toggleBody",
  content: "block+",
  defining: true,
  isolating: false,

  parseHTML() { return [{ tag: "div[data-toggle-body]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-toggle-body": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleBodyNodeView);
  },
});

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary toggleBody?",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-open") === "true",
        renderHTML: (attrs) => ({ "data-open": attrs.open ? "true" : "false" }),
      },
    };
  },

  parseHTML() { return [{ tag: "div[data-toggle]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-toggle": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView);
  },
});

// ── Toggle keyboard extension ─────────────────────────────────────────────────
export const ToggleKeyboardExtension = Extension.create({
  name: "toggleKeyboard",

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty) return false;

        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "toggleSummary") {
            const toggleNode = $from.node(depth - 1);
            if (!toggleNode || toggleNode.type.name !== "toggle") return false;

            const togglePos = $from.before(depth - 1);
            const isOpen    = toggleNode.attrs.open ?? false;

            if (isOpen) {
              const hasBody = toggleNode.childCount > 1;
              if (hasBody) {
                const summaryNode = toggleNode.child(0);
                const bodyPos     = togglePos + 1 + summaryNode.nodeSize;
                const cursorPos   = bodyPos + 2;
                return editor
                  .chain().focus()
                  .command(({ tr, state, dispatch }) => {
                    if (dispatch) {
                      const resolved = state.doc.resolve(Math.min(cursorPos, state.doc.content.size));
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      tr.setSelection((state.selection as any).constructor.near(resolved));
                    }
                    return true;
                  })
                  .run();
              } else {
                toggleOpenState(editor, togglePos);
                return true;
              }
            } else {
              const afterPos = togglePos + toggleNode.nodeSize;
              return editor
                .chain().focus()
                .command(({ tr, state, dispatch }) => {
                  if (dispatch) {
                    const newSummary = state.schema.nodes.toggleSummary.create({ open: false });
                    const newToggle  = state.schema.nodes.toggle.create({ open: false }, newSummary);
                    tr.insert(afterPos, newToggle);
                    const cursorPos = afterPos + 2;
                    const resolved  = tr.doc.resolve(Math.min(cursorPos, tr.doc.content.size));
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    tr.setSelection((state.selection as any).constructor.near(resolved));
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

      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;

        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "toggleSummary") {
            const summaryNode = $from.node(depth);
            if (summaryNode.content.size !== 0) return false;

            const toggleNode = $from.node(depth - 1);
            if (!toggleNode || toggleNode.type.name !== "toggle") return false;

            const togglePos = $from.before(depth - 1);

            return editor
              .chain().focus()
              .command(({ tr, state, dispatch }) => {
                if (dispatch) {
                  const paragraph = state.schema.nodes.paragraph.create();
                  tr.replaceWith(togglePos, togglePos + toggleNode.nodeSize, paragraph);
                  const resolved = tr.doc.resolve(togglePos + 1);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tr.setSelection((state.selection as any).constructor.near(resolved));
                }
                return true;
              })
              .run();
          }
          depth--;
        }

        depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "toggleBody") {
            if ($from.parent.type.name !== "paragraph") return false;
            if ($from.parent.content.size !== 0) return false;
            if ($from.index(depth) !== 0) return false;

            const toggleNode = $from.node(depth - 1);
            if (!toggleNode || toggleNode.type.name !== "toggle") return false;

            const togglePos     = $from.before(depth - 1);
            const summaryNode   = toggleNode.child(0);
            const summaryEndPos = togglePos + 1 + summaryNode.nodeSize - 1;

            return editor
              .chain().focus()
              .command(({ tr, state, dispatch }) => {
                if (dispatch) {
                  const resolved = state.doc.resolve(
                    Math.min(summaryEndPos, state.doc.content.size)
                  );
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tr.setSelection((state.selection as any).constructor.near(resolved));
                }
                return true;
              })
              .run();
          }
          depth--;
        }

        return false;
      },

      "Mod-Enter": ({ editor }) => {
        const { $from } = editor.state.selection;
        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "toggleSummary") {
            const toggleNode = $from.node(depth - 1);
            if (!toggleNode || toggleNode.type.name !== "toggle") return false;

            const togglePos  = $from.before(depth - 1);
            const isOpen     = toggleNode.attrs.open ?? false;
            const willOpen   = !isOpen;
            const hasBody    = toggleNode.childCount > 1;

            return editor
              .chain().focus()
              .command(({ tr, state: s }) => {
                if (willOpen && !hasBody) {
                  tr.setNodeMarkup(togglePos, undefined, { ...toggleNode.attrs, open: true });
                  const summaryNode   = toggleNode.child(0);
                  tr.setNodeMarkup(togglePos + 1, undefined, { ...summaryNode.attrs, open: true });
                  const paragraphNode = s.schema.nodes.paragraph.create();
                  const bodyNode      = s.schema.nodes.toggleBody.create({ open: true }, paragraphNode);
                  tr.insert(togglePos + toggleNode.nodeSize - 1, bodyNode);
                } else {
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
          depth--;
        }
        return false;
      },

      "Mod-a": ({ editor }) => {
        const { $from } = editor.state.selection;

        let depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "toggleSummary") {
            const pos  = $from.before(depth);
            const node = $from.node(depth);
            editor.commands.setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 });
            return true;
          }
          depth--;
        }

        depth = $from.depth;
        while (depth > 0) {
          if ($from.node(depth).type.name === "toggleBody") {
            const pos     = $from.before(depth);
            const node    = $from.node(depth);
            const docSize = editor.state.doc.content.size;
            const from    = Math.max(1, Math.min(pos + 2, docSize));
            const to      = Math.max(from, Math.min(pos + node.nodeSize - 2, docSize));
            editor.commands.setTextSelection({ from, to });
            return true;
          }
          depth--;
        }

        return false;
      },
    };
  },
});

// ── Toggle body empty hint ────────────────────────────────────────────────────
const toggleBodyPlaceholderKey = new PluginKey<DecorationSet>("toggleBodyPlaceholder");

export const ToggleBodyPlaceholderExtension = Extension.create({
  name: "toggleBodyPlaceholder",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: toggleBodyPlaceholderKey,
        props: {
          decorations(state) {
            const { doc } = state;
            const decorations: Decoration[] = [];
            doc.descendants((node, pos) => {
              if (node.type.name !== "toggleBody") return;
              if (node.childCount !== 1) return;
              const child = node.firstChild!;
              if (child.type.name !== "paragraph") return;
              if (child.content.size !== 0) return;
              decorations.push(
                Decoration.widget(
                  pos + 2,
                  () => {
                    const span = document.createElement("span");
                    span.textContent = "Write something, or press '/' for commands";
                    span.className = "toggle-body-hint";
                    return span;
                  },
                  { side: 1, key: `toggle-body-hint-${pos}` }
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

// ── Ctrl+A inside list items, task items, and blockquotes ────────────────────
// First press selects content of the innermost scoped container.
// Second press falls through (returns false) → browser/TipTap selects all.
const LIST_SCOPE_NODES = new Set([
  "listItem",
  "taskItem",
  "blockquote",
]);

export const ListSelectAllExtension = Extension.create({
  name: "listSelectAll",
  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => {
        const { $from, from, to } = editor.state.selection;
        const docSize = editor.state.doc.content.size;

        // Walk up from cursor looking for a scoped container.
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (LIST_SCOPE_NODES.has(node.type.name)) {
            const pos      = $from.before(depth);
            const scopeFrom = Math.max(1, pos + 1);
            const scopeTo   = Math.min(docSize, pos + node.nodeSize - 1);

            // If the selection already covers this scope exactly,
            // return false so the next Ctrl+A selects the whole doc.
            if (from === scopeFrom && to === scopeTo) return false;

            editor.commands.setTextSelection({ from: scopeFrom, to: scopeTo });
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

// ── Image ─────────────────────────────────────────────────────────────────────
export { ImageExtension } from "./ImageExtension";

// ── Attachment (PDF + Audio) ──────────────────────────────────────────────────
export { AttachmentExtension } from "./AttachmentExtension";