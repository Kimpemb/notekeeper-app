// src/features/editor/components/Editor/subPageSync.ts
//
// Keeps a note's sub-note blocks (subPage / pdfLink) in step with its real children.
//
// Rules:
//  1. Every live child of the note is shown in the editor. A child with no block in the saved
//     content is appended at the bottom; a child that already has a block keeps its position.
//  2. Blocks are found at ANY depth (inside toggles, callouts, lists), not just the top level.
//  3. A block is removed only when its note is gone: trashed, moved to another parent, or (once
//     the store has settled) missing entirely. Never because the store was momentarily incomplete.

import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

export const SUBPAGE_BLOCK_TYPES = new Set(["subPage", "pdfLink"]);

/** Transaction meta that lets a transaction remove sub-note blocks (see SubPageNode's keeper). */
export const ALLOW_SUBPAGE_REMOVAL = "allowSubPageRemoval";

export interface NoteLike {
  id: string;
  title: string;
  parent_id: string | null;
  deleted_at: number | null;
  sort_order: number;
  source_type?: string;
}

function liveChildren(parentId: string, notes: NoteLike[]): NoteLike[] {
  return notes
    .filter((n) => n.parent_id === parentId && !n.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** True when the note behind a block should no longer appear under `parentId`. */
function isStale(
  noteId: string,
  parentId: string,
  byId: Map<string, NoteLike>,
  settled: boolean
): boolean {
  const n = byId.get(noteId);
  if (n) return n.parent_id !== parentId || !!n.deleted_at;
  // Unknown to the store: only trust that once loading has finished.
  return settled;
}

function blockJsonFor(c: NoteLike): JSONContent {
  return c.source_type === "pdf"
    ? { type: "pdfLink", attrs: { noteId: c.id, title: c.title } }
    : { type: "subPage", attrs: { noteId: c.id, title: c.title, mode: "display" } };
}

function refId(node: JSONContent): string | null {
  if (node.type && SUBPAGE_BLOCK_TYPES.has(node.type)) {
    const id = node.attrs?.noteId;
    return typeof id === "string" && id ? id : null;
  }
  return null;
}

function collectIds(nodes: JSONContent[] | undefined, out: Set<string>): void {
  for (const node of nodes ?? []) {
    const id = refId(node);
    if (id) out.add(id);
    if (Array.isArray(node.content)) collectIds(node.content, out);
  }
}

function stripStale(nodes: JSONContent[], isGone: (id: string) => boolean): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    const id = refId(node);
    if (id && isGone(id)) continue;
    if (Array.isArray(node.content) && node.content.length > 0) {
      const inner = stripStale(node.content, isGone);
      // A container emptied by the strip still needs one block child to stay valid.
      out.push({ ...node, content: inner.length > 0 ? inner : [{ type: "paragraph" }] });
    } else {
      out.push(node);
    }
  }
  return out;
}

function appendAtBottom(content: JSONContent[], blocks: JSONContent[]): JSONContent[] {
  if (blocks.length === 0) return content;
  const last = content[content.length - 1];
  const lastIsEmptyPara =
    last?.type === "paragraph" && (!last.content || last.content.length === 0);
  return lastIsEmptyPara
    ? [...content.slice(0, -1), ...blocks, last]
    : [...content, ...blocks];
}

/**
 * Content to open a note with: its saved content, plus a block for every live child that has none
 * (appended at the bottom), minus blocks whose note is gone. Saved positions are preserved.
 */
export function buildInitialContent(
  savedContent: string | null | undefined,
  noteId: string,
  notes: NoteLike[],
  settled: boolean
): JSONContent {
  let doc: JSONContent;
  try {
    doc = JSON.parse(
      !savedContent || savedContent === "null" ? '{"type":"doc","content":[]}' : savedContent
    );
  } catch {
    doc = { type: "doc", content: [] };
  }
  if (!doc || typeof doc !== "object") doc = { type: "doc", content: [] };
  const content = Array.isArray(doc.content) ? doc.content : [];

  const byId = new Map(notes.map((n) => [n.id, n]));
  const kept = stripStale(content, (id) => isStale(id, noteId, byId, settled));

  const present = new Set<string>();
  collectIds(kept, present);
  const missing = liveChildren(noteId, notes).filter((c) => !present.has(c.id));

  return {
    ...doc,
    type: "doc",
    content: appendAtBottom(kept, missing.map(blockJsonFor)),
  };
}

/**
 * Brings an already-mounted editor in line with the store using small transactions, so it works
 * while the user is typing (no setContent, caret and selection untouched).
 * Returns true when the document changed.
 */
export function syncSubPagesIntoEditor(
  editor: Editor,
  noteId: string,
  notes: NoteLike[],
  settled: boolean
): boolean {
  if (editor.isDestroyed) return false;

  const { state } = editor;
  const { schema } = state;
  const byId = new Map(notes.map((n) => [n.id, n]));

  const present = new Set<string>();
  const stale: { pos: number; size: number }[] = [];
  state.doc.descendants((node: PMNode, pos: number) => {
    if (!SUBPAGE_BLOCK_TYPES.has(node.type.name)) return;
    const id = node.attrs.noteId as string | null;
    if (!id) return; // placeholder still being named
    if (isStale(id, noteId, byId, settled)) stale.push({ pos, size: node.nodeSize });
    else present.add(id);
  });

  const missing = liveChildren(noteId, notes).filter((c) => !present.has(c.id));
  if (stale.length === 0 && missing.length === 0) return false;

  const tr = state.tr;
  for (const s of [...stale].sort((a, b) => b.pos - a.pos)) {
    tr.delete(s.pos, s.pos + s.size);
  }

  const toInsert: PMNode[] = [];
  for (const c of missing) {
    const typeName = c.source_type === "pdf" ? "pdfLink" : "subPage";
    const type = schema.nodes[typeName];
    if (!type) continue;
    toInsert.push(
      typeName === "pdfLink"
        ? type.create({ noteId: c.id, title: c.title })
        : type.create({ noteId: c.id, title: c.title, mode: "display" })
    );
  }
  if (toInsert.length > 0) {
    const d = tr.doc;
    const last = d.lastChild;
    const lastIsEmptyPara = last?.type.name === "paragraph" && last.content.size === 0;
    const at = lastIsEmptyPara ? d.content.size - last!.nodeSize : d.content.size;
    tr.insert(at, toInsert);
  }

  if (!tr.docChanged) return false;
  tr.setMeta("preventAutoSave", true); // derived from the store, not a user edit
  tr.setMeta("addToHistory", false);
  tr.setMeta(ALLOW_SUBPAGE_REMOVAL, true);
  editor.view.dispatch(tr);
  return true;
}
