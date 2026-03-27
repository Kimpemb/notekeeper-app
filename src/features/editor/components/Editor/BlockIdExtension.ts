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

        appendTransaction(_transactions, _oldState, newState) {
          const { doc, tr, schema } = newState;
          let modified = false;

          doc.descendants((node, pos) => {
            if (!TARGET_TYPES.has(node.type.name)) return;

            // Only assign if blockId is missing or empty
            if (node.attrs.blockId) return;

            // Check schema supports the attribute
            const nodeType = schema.nodes[node.type.name];
            if (!nodeType?.spec.attrs?.blockId) return;

            const id = crypto.randomUUID();
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: id });
            modified = true;
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});