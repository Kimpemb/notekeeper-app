// src/features/editor/components/Editor/BlockIdExtension.ts
//
// Assigns a stable UUID to every indexable block node via a `blockId` attribute.
//
// ── Why this is the hard part ─────────────────────────────────────────────────
// TipTap doesn't give you persistent node IDs out of the box. We need IDs that:
//   1. Survive saves and reloads (stored in the JSON).
//   2. Are unique when a block is pasted or duplicated (new UUID on copy).
//   3. Never drift — once assigned, the ID stays with that logical block forever.
//
// ── Approach ──────────────────────────────────────────────────────────────────
// We use a GlobalAttribute that adds `blockId` to every target node type.
// An appendTransaction plugin runs after every transaction and assigns a fresh
// UUID to any node of a target type that doesn't have one yet.
// On paste/duplicate, ProseMirror creates new nodes without attrs → the plugin
// assigns a new UUID, which is correct (it's a new block, not the original).
//
// ── Supported node types ──────────────────────────────────────────────────────
// paragraph, heading, bulletList, orderedList, listItem, taskItem,
// codeBlock, blockquote
// (matches INDEXABLE_BLOCK_TYPES in queries.ts)

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const BLOCK_ID_KEY = new PluginKey("blockId");

const TARGET_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskItem",
  "codeBlock",
  "blockquote",
  "table",
  "toggle",
]);

export const BlockIdExtension = Extension.create({
  name: "blockId",

  // ── 1. Declare the attribute on all target node types ────────────────────
  addGlobalAttributes() {
    return [
      {
        types: [...TARGET_TYPES],
        attributes: {
          blockId: {
            default: null,
            // Parse from stored HTML/JSON
            parseHTML: (element) => element.getAttribute("data-block-id") ?? null,
            renderHTML: (attributes) => {
              if (!attributes.blockId) return {};
              return { "data-block-id": attributes.blockId };
            },
          },
        },
      },
    ];
  },

  // ── 2. appendTransaction: assign IDs to any node missing one ────────────
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: BLOCK_ID_KEY,

        appendTransaction(transactions, _oldState, newState) {
  // Bail immediately if no transaction changed the document —
  // cursor moves, selections, and focus events all fire appendTransaction
  // but never add new nodes that need IDs.
  const docChanged = transactions.some((tr) => tr.docChanged);
  if (!docChanged) return null;

  const { doc, tr, schema } = newState;
  let modified = false;

  // Tracks blockIds already claimed during this walk. Needed because a
  // missing blockId isn't the only way a node can need a fresh one: stock
  // ProseMirror commands that clone a node (e.g. splitListItem on Enter
  // inside a non-empty list item) copy the original node's full attrs —
  // blockId included — into the new node. That new node arrives with a
  // blockId that's already correctly present, so the old "if (blockId)
  // return" guard let it straight through, silently duplicating an ID and
  // making the two nodes indistinguishable to anything keyed on blockId
  // (block_revision_snapshots, note_blocks, embeddings). Walking the doc
  // in order and reassigning every ID after the first claim fixes it
  // regardless of which command did the cloning.
  const seenBlockIds = new Set<string>();

  doc.descendants((node, pos) => {
    if (!TARGET_TYPES.has(node.type.name)) return;

    const nodeType = schema.nodes[node.type.name];
    if (!nodeType?.spec.attrs?.blockId) return;

    const existingId = node.attrs.blockId as string | null;
    const needsNewId = !existingId || seenBlockIds.has(existingId);

    if (needsNewId) {
      const id = crypto.randomUUID();
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id });
      seenBlockIds.add(id);
      modified = true;
    } else {
      seenBlockIds.add(existingId);
    }
  });

  if (!modified) return null;
  tr.setMeta("preventAutoSave", true);
  return tr;
},
      }),
    ];
  },
});