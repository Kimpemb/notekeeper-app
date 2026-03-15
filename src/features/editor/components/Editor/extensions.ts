// src/features/editor/components/Editor/extensions.ts
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { common, createLowlight } from "lowlight";
import { CodeBlockNodeView } from "./CodeBlockNodeView";

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

// ── Backspace to lift list item out of ordered list ───────────────────────────
export const OrderedListBackspaceExtension = Extension.create({
  name: "orderedListBackspace",
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let depth = $from.depth;
        while (depth > 0) {
          const node = $from.node(depth);
          if (node.type.name === "listItem" && $from.node(depth - 1).type.name === "orderedList") {
            return editor.chain().focus().liftListItem("listItem").run();
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