import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Mapping } from "@tiptap/pm/transform";
import { SubPageNodeView } from "./SubPageNodeView";
import { ALLOW_SUBPAGE_REMOVAL, SUBPAGE_BLOCK_TYPES } from "./subPageSync";

const isRefNode = (n: PMNode) => SUBPAGE_BLOCK_TYPES.has(n.type.name);

function collectRefIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((n) => {
    if (isRefNode(n) && n.attrs.noteId) ids.add(n.attrs.noteId as string);
  });
  return ids;
}

// Same scopes ListSelectAllExtension narrows Ctrl+A to.
const LIST_SCOPE_NODES = new Set(["listItem", "taskItem", "blockquote"]);

export interface SubPageNodeAttrs {
  noteId: string | null;
  title: string;
  mode: "editing" | "display";
}

export const SubPageNode = Node.create<object, {
  parentNoteId: string;
  paneId: 1 | 2;
  setCreating: (v: boolean) => void;
  /** True while the note is still a live child of this editor's note. Set by the Editor. */
  isLiveChild: (noteId: string) => boolean;
}>({
  name: "subPage",
  group: "block",
  atom: true,

  addStorage() {
    return {
      parentNoteId: "",
      paneId: 1 as 1 | 2,
      setCreating: (_v: boolean) => {},
      isLiveChild: (_id: string) => false,
    };
  },

  addAttributes() {
    return {
      noteId: { default: null },
      title:  { default: "Untitled" },
      mode:   { default: "editing" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sub-page"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "sub-page" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubPageNodeView);
  },

  addProseMirrorPlugins() {
    const storage = this.storage;

    return [
      // A sub-note leaves the editor only when its note is deleted (or moved away). Anything else
      // that would drop one (select-all + paste, cut, a stray range delete, a content reload that
      // lacks it) gets it put straight back, where it was or just after what replaced it.
      new Plugin({
        key: new PluginKey("subPageKeeper"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          if (transactions.some((t) => t.getMeta(ALLOW_SUBPAGE_REMOVAL))) return null;

          const keptIds = collectRefIds(newState.doc);
          const lost: { pos: number; node: PMNode }[] = [];
          oldState.doc.descendants((node, pos) => {
            if (!isRefNode(node)) return;
            const id = node.attrs.noteId as string | null;
            if (id && !keptIds.has(id) && storage.isLiveChild(id)) lost.push({ pos, node });
          });
          if (lost.length === 0) return null;

          const mapping = new Mapping();
          for (const t of transactions) mapping.appendMapping(t.mapping);

          const tr = newState.tr;
          for (const { pos, node } of lost) {
            // old position -> new document -> through the blocks already re-inserted below.
            // (assoc 1 keeps several restored blocks in their original order.)
            const inNew = Math.min(mapping.map(pos, 1), newState.doc.content.size);
            const here = Math.min(tr.mapping.map(inNew, 1), tr.doc.content.size);
            const $p = tr.doc.resolve(here);
            const at = $p.depth === 0 ? $p.pos : $p.after(1); // never inside a paragraph
            tr.insert(at, node);
          }
          return tr;
        },
        props: {
          // Pasted sub-note blocks are dropped unless they belong to this note and aren't
          // already shown: no foreign children from another note, no duplicates.
          transformPasted(slice, view) {
            const shown = collectRefIds(view.state.doc);
            const clean = (frag: Fragment): Fragment => {
              const out: PMNode[] = [];
              frag.forEach((node) => {
                if (isRefNode(node)) {
                  const id = node.attrs.noteId as string | null;
                  if (!id || shown.has(id) || !storage.isLiveChild(id)) return;
                  out.push(node);
                  return;
                }
                out.push(node.content.size > 0 ? node.copy(clean(node.content)) : node);
              });
              return Fragment.fromArray(out);
            };
            return new Slice(clean(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
      new Plugin({
        key: new PluginKey("subPageDeleteGuard"),
        props: {
          handleKeyDown(_view, event) {
            if (event.key !== "Backspace" && event.key !== "Delete") return false;
            const { selection } = _view.state;
            const selectedNode = (selection as { node?: { type: { name: string } } }).node;
            if (selectedNode?.type.name === "subPage") {
              // Swallow — subpages can only be deleted via the context menu
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

// Ctrl+A selects the text, not the sub-notes. Sub-notes are ordinary blocks to the selection, so
// leading/trailing ones are trimmed from the range; any left in the middle are protected by the
// keeper plugin above. Its own extension (not part of the node) so it can take a high priority
// without changing the schema's default block type.
export const SubPageSelectAllExtension = Extension.create({
  name: "subPageSelectAll",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      // Select-all covers the text, not the sub-notes. Sub-notes are ordinary blocks to the
      // selection, so we trim leading/trailing ones from the range; any left in the middle are
      // protected by the keeper below.
      "Mod-a": ({ editor }) => {
        const { state } = editor;
        const { doc, selection } = state;
        const { $from, from, to } = selection;

        for (let depth = $from.depth; depth > 0; depth--) {
          const name = $from.node(depth).type.name;
          if (name === "codeBlock") return false; // CodeBlockSelectAllExtension handles it
          if (LIST_SCOPE_NODES.has(name)) {
            const pos = $from.before(depth);
            const scopeFrom = Math.max(1, pos + 1);
            const scopeTo = Math.min(doc.content.size, pos + $from.node(depth).nodeSize - 1);
            // First press selects the list item/quote (ListSelectAllExtension); a second
            // press, with that scope already selected, widens to the whole note below.
            if (!(from === scopeFrom && to === scopeTo)) return false;
            break;
          }
        }

        let start = -1;
        let end = -1;
        doc.forEach((node, offset) => {
          if (isRefNode(node)) return;
          if (start < 0) start = offset;
          end = offset + node.nodeSize;
        });
        if (start < 0) return true; // nothing but sub-notes: nothing to select

        const sel = TextSelection.between(doc.resolve(start), doc.resolve(end));
        // No scrollIntoView: the selection's head is the end of the note, so it would jump to the bottom
        editor.view.dispatch(state.tr.setSelection(sel));
        return true;
      },
    };
  },
});
