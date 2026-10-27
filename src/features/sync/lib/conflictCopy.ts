// src/features/sync/lib/conflictCopy.ts
//
// Stage 4d.3, whole_keep_both — PURE helpers for the "conflict copy" note.
// No DB, no network, no store, no supabaseClient import (node-testable).
//
// Why block ids are remapped: note_blocks has PRIMARY KEY (block_id) alone and
// syncNoteBlocks upserts ON CONFLICT(block_id) without touching note_id. A copy
// that kept theirs' block ids would never get its own index rows (they would
// stay owned by the original note), so search and RAG would skip the copy.
//
// Only the types in BlockIdExtension's TARGET_TYPES are remapped. Other nodes
// (for example a blockRef) may carry an attrs.blockId that POINTS at another
// block; those references must stay untouched.

export const BLOCK_ID_TARGET_TYPES: ReadonlySet<string> = new Set([
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

export const CONFLICT_COPY_SUFFIX = " (conflict copy)";

export function conflictCopyTitle(title: string): string {
  const base = title.trim() === "" ? "Untitled" : title;
  return base + CONFLICT_COPY_SUFFIX;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface RemapResult {
  /** The content JSON string with fresh block ids. */
  content: string;
  /** old id -> new id, for every block that was remapped. */
  mapping: Map<string, string>;
}

/**
 * Returns a copy of `contentJson` in which every blockId-bearing node of a
 * target type has a fresh id. Throws on invalid JSON (the caller treats that as
 * a failed plan and writes nothing). The same old id seen twice maps to the
 * same new id, so a document that already repeated an id stays internally
 * consistent.
 */
export function remapBlockIds(contentJson: string, newId: () => string): RemapResult {
  const root = JSON.parse(contentJson) as Json;
  const mapping = new Map<string, string>();

  const walk = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;

    const out: { [k: string]: Json } = { ...node };

    const type = typeof out.type === "string" ? out.type : "";
    const attrs = out.attrs;
    if (
      BLOCK_ID_TARGET_TYPES.has(type) &&
      attrs !== null &&
      typeof attrs === "object" &&
      !Array.isArray(attrs) &&
      typeof attrs.blockId === "string" &&
      attrs.blockId !== ""
    ) {
      const old = attrs.blockId;
      let fresh = mapping.get(old);
      if (fresh === undefined) {
        fresh = newId();
        mapping.set(old, fresh);
      }
      out.attrs = { ...attrs, blockId: fresh };
    }
    if (out.content !== undefined) out.content = walk(out.content);
    return out;
  };

  return { content: JSON.stringify(walk(root)), mapping };
}
