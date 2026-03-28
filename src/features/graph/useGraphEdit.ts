// src/features/graph/useGraphEdit.ts

import { useCallback } from "react";
import { getNoteById, syncBacklinks, updateNote as dbUpdateNote } from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { GraphNode, GraphEdge } from "./graphTypes";

interface UseGraphEditProps {
  simNodesRef: React.MutableRefObject<GraphNode[]>;
  simEdgesRef: React.MutableRefObject<GraphEdge[]>;
  showToast: (msg: string) => void;
  suppressRefresh: () => void;  // call before storeCreateNote to block auto-rebuild
  onNodeCreated?: (node: GraphNode) => void;
}

export interface UseGraphEditResult {
  createNodeAt: (x: number, y: number) => Promise<GraphNode | null>;
  deleteNode: (nodeId: string) => Promise<void>;
  renameNode: (nodeId: string, newTitle: string) => Promise<void>;
  createLink: (sourceId: string, targetId: string) => Promise<void>;
  deleteLink: (sourceId: string, targetId: string) => Promise<void>;
}

export function useGraphEdit({
  simNodesRef,
  simEdgesRef,
  showToast,
  suppressRefresh,
  onNodeCreated,
}: UseGraphEditProps): UseGraphEditResult {

  const storeCreateNote = useNoteStore((s) => s.createNote);
  const storeDeleteNote = useNoteStore((s) => s.deleteNote);
  const storeUpdateNote = useNoteStore((s) => s.updateNote);

  // ── Create ────────────────────────────────────────────────────────────────
  const createNodeAt = useCallback(async (x: number, y: number): Promise<GraphNode | null> => {
    try {
      // Suppress the auto-refresh that storeCreateNote would trigger via the
      // notes-hash watcher in useGraphData. Without this, the store update
      // tears down the simulation mid-animation (mid-fly, mid-pulse, mid-rename).
      suppressRefresh();

      const note = await storeCreateNote({ title: "Untitled" });

      const newNode: GraphNode = {
        id:         note.id,
        title:      note.title,
        tags:       [],
        linkCount:  0,
        created_at: note.created_at,
        x,
        y,
        fx: x,
        fy: y,
      };

      onNodeCreated?.(newNode);
      return newNode;
    } catch (err) {
      showToast("Failed to create note");
      console.error("[useGraphEdit] createNodeAt:", err);
      return null;
    }
  }, [storeCreateNote, suppressRefresh, showToast, onNodeCreated]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteNode = useCallback(async (nodeId: string): Promise<void> => {
    const node = simNodesRef.current.find((n) => n.id === nodeId);
    try {
      await storeDeleteNote(nodeId);
      showToast(`"${node?.title ?? "Note"}" moved to trash`);
    } catch (err) {
      showToast("Failed to delete note");
      console.error("[useGraphEdit] deleteNode:", err);
    }
  }, [simNodesRef, storeDeleteNote, showToast]);

  // ── Rename ────────────────────────────────────────────────────────────────
  const renameNode = useCallback(async (nodeId: string, newTitle: string): Promise<void> => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      // This update WILL trigger a graph refresh (updated_at changes) — that's
      // intentional. By this point the fly+rename animation is complete.
      await storeUpdateNote(nodeId, { title: trimmed });
      showToast(`Renamed to "${trimmed}"`);
    } catch (err) {
      showToast("Failed to rename note");
      console.error("[useGraphEdit] renameNode:", err);
    }
  }, [storeUpdateNote, showToast]);

  // ── Create link ───────────────────────────────────────────────────────────
  const createLink = useCallback(async (sourceId: string, targetId: string): Promise<void> => {
    if (sourceId === targetId) return;

    const edgeExists = simEdgesRef.current.some((e) => {
      const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
      const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
      return (sid === sourceId && tid === targetId) || (sid === targetId && tid === sourceId);
    });
    if (edgeExists) { showToast("These notes are already linked"); return; }

    try {
      const [sourceNote, targetNote] = await Promise.all([
        getNoteById(sourceId),
        getNoteById(targetId),
      ]);
      if (!sourceNote || !targetNote) return;

      let doc: any;
      try { doc = JSON.parse(sourceNote.content ?? "{}"); } catch { return; }

      doc.content = [
        ...(doc.content ?? []),
        {
          type: "paragraph",
          content: [{
            type: "noteLink",
            attrs: { id: targetId, label: targetNote.title },
          }],
        },
      ];

      const newContent   = JSON.stringify(doc);
      const newPlaintext = (sourceNote.plaintext ?? "").trimEnd() + `\n${targetNote.title}`;

      await dbUpdateNote(sourceId, { content: newContent, plaintext: newPlaintext });

      const existingTargets = simEdgesRef.current
        .flatMap((e) => {
          const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
          const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
          if (sid === sourceId) return [tid];
          if (tid === sourceId) return [sid];
          return [];
        });

      await syncBacklinks(sourceId, [...new Set([...existingTargets, targetId])]);
      await storeUpdateNote(sourceId, { content: newContent, plaintext: newPlaintext });

      showToast(`Linked "${sourceNote.title}" → "${targetNote.title}"`);
    } catch (err) {
      showToast("Failed to create link");
      console.error("[useGraphEdit] createLink:", err);
    }
  }, [simEdgesRef, storeUpdateNote, showToast]);

  // ── Delete link ───────────────────────────────────────────────────────────
  const deleteLink = useCallback(async (sourceId: string, targetId: string): Promise<void> => {
    try {
      const sourceNote = await getNoteById(sourceId);
      if (!sourceNote) return;

      let doc: any;
      try { doc = JSON.parse(sourceNote.content ?? "{}"); } catch { return; }

      function removeLinks(nodes: any[]): any[] {
        return nodes
          .map((node) => {
            if (node.type === "noteLink" && node.attrs?.id === targetId) return null;
            if (Array.isArray(node.content)) {
              return { ...node, content: removeLinks(node.content).filter(Boolean) };
            }
            return node;
          })
          .filter(Boolean);
      }

      doc.content = removeLinks(doc.content ?? []);

      function extractText(nodes: any[]): string {
        return nodes.map((n) => {
          if (n.type === "text") return n.text ?? "";
          if (n.type === "noteLink") return n.attrs?.label ?? "";
          if (Array.isArray(n.content)) return extractText(n.content);
          return "";
        }).join(" ").trim();
      }

      const newContent   = JSON.stringify(doc);
      const newPlaintext = extractText(doc.content ?? []);

      await dbUpdateNote(sourceId, { content: newContent, plaintext: newPlaintext });

      const remainingTargets = simEdgesRef.current
        .flatMap((e) => {
          const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
          const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
          if (sid === sourceId) return [tid];
          if (tid === sourceId) return [sid];
          return [];
        })
        .filter((id) => id !== targetId);

      await syncBacklinks(sourceId, [...new Set(remainingTargets)]);
      await storeUpdateNote(sourceId, { content: newContent, plaintext: newPlaintext });

      showToast("Link removed");
    } catch (err) {
      showToast("Failed to remove link");
      console.error("[useGraphEdit] deleteLink:", err);
    }
  }, [simEdgesRef, storeUpdateNote, showToast]);

  return { createNodeAt, deleteNode, renameNode, createLink, deleteLink };
}