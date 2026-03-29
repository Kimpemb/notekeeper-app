// src/features/graph/useGraphEdit.ts
//
// OWNERSHIP MODEL:
// The graph owns its world from the moment it opens. The store and DB are a
// background persistence layer — we write to them silently, they never talk
// back to the graph. This means:
//
//   • NO setStoreNotes calls during live graph editing (create / rename / link)
//   • DB writes happen after the graph has already updated its own refs
//   • deleteNode is the one exception — it calls storeDeleteNote because the
//     sidebar needs to reflect the deletion immediately, but the graph patches
//     its own D3 state independently via deleteNodeById in useGraphSimulation
//
// The three things kept in sync atomically on every mutation:
//   1. simNodesRef / simEdgesRef  (simulation data)
//   2. D3 DOM selections          (patched by the callback in useGraphSimulation)
//   3. DB                         (written silently, zero feedback loop)

import { useCallback } from "react";
import {
  createNote as dbCreateNote,
  getNoteById,
  syncBacklinks,
  updateNote as dbUpdateNote,
} from "@/features/notes/db/queries";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import type { GraphNode, GraphEdge } from "./graphTypes";

interface UseGraphEditProps {
  simNodesRef: React.MutableRefObject<GraphNode[]>;
  simEdgesRef: React.MutableRefObject<GraphEdge[]>;
  showToast: (msg: string) => void;
}

export interface UseGraphEditResult {
  createNodeAt: (x: number, y: number, onCreated: (node: GraphNode) => void) => Promise<void>;
  deleteNode:   (nodeId: string, onDeleted: (nodeId: string) => void) => Promise<void>;
  renameNode:   (nodeId: string, newTitle: string, onRenamed: (nodeId: string, title: string) => void) => Promise<void>;
  createLink:   (sourceId: string, targetId: string, onLinked: (edge: GraphEdge) => void) => Promise<void>;
  deleteLink:   (sourceId: string, targetId: string, onUnlinked: (sourceId: string, targetId: string) => void) => Promise<void>;
}

export function useGraphEdit({
  simNodesRef,
  simEdgesRef,
  showToast,
}: UseGraphEditProps): UseGraphEditResult {

  const storeDeleteNote = useNoteStore((s) => s.deleteNote);

  // ── Create ────────────────────────────────────────────────────────────────
  // Writes to DB only. The store is NOT touched — any store mutation would
  // cause visibleNodes to recompute, re-trigger useGraphSimulation's useEffect,
  // and tear down the entire simulation, losing the new node.
  // The store is reconciled when the user closes the graph (useGraphData.refresh).
  const createNodeAt = useCallback(async (
    x: number,
    y: number,
    onCreated: (node: GraphNode) => void,
  ): Promise<void> => {
    try {
      const note = await dbCreateNote({ title: "Untitled" });

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

      simNodesRef.current = [...simNodesRef.current, newNode];

      // onCreated patches D3 DOM selections in useGraphSimulation
      onCreated(newNode);
    } catch (err) {
      showToast("Failed to create note");
      console.error("[useGraphEdit] createNodeAt:", err);
    }
  }, [simNodesRef, showToast]);

  // ── Delete ────────────────────────────────────────────────────────────────
  // The one mutation that does go through the store, because the sidebar
  // must reflect deletions immediately. The graph patches its own D3 state
  // separately via deleteNodeById in useGraphSimulation (called from GraphView
  // inside the onDeleted callback), which runs against the already-updated refs.
  const deleteNode = useCallback(async (
    nodeId: string,
    onDeleted: (nodeId: string) => void,
  ): Promise<void> => {
    const node = simNodesRef.current.find((n) => n.id === nodeId);
    try {
      // Patch refs first — deleteNodeById in useGraphSimulation will read these
      simNodesRef.current = simNodesRef.current.filter((n) => n.id !== nodeId);
      simEdgesRef.current = simEdgesRef.current.filter((e) => {
        const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
        const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
        return sid !== nodeId && tid !== nodeId;
      });

      // Fire D3 patch callback before the async store write
      onDeleted(nodeId);

      // Store write is last — it will cause a store update, but by then the
      // graph has already removed the node from its own world
      await storeDeleteNote(nodeId);
      showToast(`"${node?.title ?? "Note"}" moved to trash`);
    } catch (err) {
      showToast("Failed to delete note");
      console.error("[useGraphEdit] deleteNode:", err);
    }
  }, [simNodesRef, simEdgesRef, storeDeleteNote, showToast]);

  // ── Rename ────────────────────────────────────────────────────────────────
  // DB-only write. Store is NOT touched for the same reason as createNodeAt.
  const renameNode = useCallback(async (
    nodeId: string,
    newTitle: string,
    onRenamed: (nodeId: string, title: string) => void,
  ): Promise<void> => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      // Patch live ref immediately
      simNodesRef.current = simNodesRef.current.map((n) =>
        n.id === nodeId ? { ...n, title: trimmed } : n,
      );

      // onRenamed patches the D3 label text in useGraphSimulation
      onRenamed(nodeId, trimmed);

      // Silent DB write — no store update, no feedback loop
      await dbUpdateNote(nodeId, { title: trimmed });
    } catch (err) {
      showToast("Failed to rename note");
      console.error("[useGraphEdit] renameNode:", err);
    }
  }, [simNodesRef, showToast]);

  // ── Create link ───────────────────────────────────────────────────────────
  // DB-only write. Appends a noteLink node to the source note's ProseMirror
  // doc, syncs backlinks, then patches simEdgesRef and fires onLinked so
  // useGraphSimulation can rebind the edge selection.
  const createLink = useCallback(async (
    sourceId: string,
    targetId: string,
    onLinked: (edge: GraphEdge) => void,
  ): Promise<void> => {
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
          content: [{ type: "noteLink", attrs: { id: targetId, label: targetNote.title } }],
        },
      ];

      const newContent   = JSON.stringify(doc);
      const newPlaintext = (sourceNote.plaintext ?? "").trimEnd() + `\n${targetNote.title}`;

      // Patch refs before onLinked so D3 reads correct data
      const newEdge: GraphEdge = { source: sourceId, target: targetId, weight: 1 };
      simEdgesRef.current = [...simEdgesRef.current, newEdge];
      simNodesRef.current = simNodesRef.current.map((n) => {
        if (n.id === sourceId || n.id === targetId) return { ...n, linkCount: n.linkCount + 1 };
        return n;
      });

      // onLinked patches D3 edge selection in useGraphSimulation
      onLinked(newEdge);

      // Silent DB writes — no store update, no feedback loop
      await dbUpdateNote(sourceId, { content: newContent, plaintext: newPlaintext });
      const existingTargets = simEdgesRef.current.flatMap((e) => {
        const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
        const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
        if (sid === sourceId) return [tid];
        if (tid === sourceId) return [sid];
        return [];
      });
      await syncBacklinks(sourceId, [...new Set(existingTargets)]);

      showToast(`Linked "${sourceNote.title}" → "${targetNote.title}"`);
    } catch (err) {
      showToast("Failed to create link");
      console.error("[useGraphEdit] createLink:", err);
    }
  }, [simEdgesRef, simNodesRef, showToast]);

  // ── Delete link ───────────────────────────────────────────────────────────
  const deleteLink = useCallback(async (
    sourceId: string,
    targetId: string,
    onUnlinked: (sourceId: string, targetId: string) => void,
  ): Promise<void> => {
    try {
      const sourceNote = await getNoteById(sourceId);
      if (!sourceNote) return;

      let doc: any;
      try { doc = JSON.parse(sourceNote.content ?? "{}"); } catch { return; }

      function removeLinks(nodes: any[]): any[] {
        return nodes.map((node) => {
          if (node.type === "noteLink" && node.attrs?.id === targetId) return null;
          if (Array.isArray(node.content)) {
            return { ...node, content: removeLinks(node.content).filter(Boolean) };
          }
          return node;
        }).filter(Boolean);
      }

      function extractText(nodes: any[]): string {
        return nodes.map((n) => {
          if (n.type === "text")     return n.text ?? "";
          if (n.type === "noteLink") return n.attrs?.label ?? "";
          if (Array.isArray(n.content)) return extractText(n.content);
          return "";
        }).join(" ").trim();
      }

      doc.content = removeLinks(doc.content ?? []);
      const newContent   = JSON.stringify(doc);
      const newPlaintext = extractText(doc.content ?? []);

      // Patch refs before onUnlinked
      simEdgesRef.current = simEdgesRef.current.filter((e) => {
        const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
        const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
        return !((sid === sourceId && tid === targetId) || (sid === targetId && tid === sourceId));
      });
      simNodesRef.current = simNodesRef.current.map((n) => {
        if (n.id === sourceId || n.id === targetId) {
          return { ...n, linkCount: Math.max(0, n.linkCount - 1) };
        }
        return n;
      });

      onUnlinked(sourceId, targetId);

      // Silent DB writes
      await dbUpdateNote(sourceId, { content: newContent, plaintext: newPlaintext });
      const remainingTargets = simEdgesRef.current.flatMap((e) => {
        const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
        const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
        if (sid === sourceId) return [tid];
        if (tid === sourceId) return [sid];
        return [];
      });
      await syncBacklinks(sourceId, [...new Set(remainingTargets)]);

      showToast("Link removed");
    } catch (err) {
      showToast("Failed to remove link");
      console.error("[useGraphEdit] deleteLink:", err);
    }
  }, [simEdgesRef, simNodesRef, showToast]);

  return { createNodeAt, deleteNode, renameNode, createLink, deleteLink };
}