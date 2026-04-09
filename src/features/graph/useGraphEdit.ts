// src/features/graph/useGraphEdit.ts

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

export function useGraphEdit({
  simNodesRef,
  simEdgesRef,
  showToast,
}: UseGraphEditProps) {

  const storeDeleteNote = useNoteStore((s) => s.deleteNote);

  const createNodeAt = useCallback(async (
    x: number,
    y: number,
    onCreated: (node: GraphNode) => void
  ) => {
    try {
      const note = await dbCreateNote({ title: "Untitled" });

      const newNode: GraphNode = {
        id: note.id,
        title: note.title,
        tags: [],
        linkCount: 0,
        created_at: note.created_at,
        x, y, fx: x, fy: y,
      };

      // Update the simulation ref only — deliberately do NOT push into the
      // note store yet. Doing so would cause visibleNodes to recompute, which
      // triggers the useGraphSimulation effect to tear down and rebuild the
      // entire D3 graph, destroying the rename input before the user can type.
      // The store is updated in renameNode once the user commits a title.
      simNodesRef.current = [...simNodesRef.current, newNode];

      onCreated(newNode);
      showToast(`Created "${note.title}"`);
    } catch (err) {
      showToast("Failed to create note");
    }
  }, [simNodesRef, showToast]);

  const deleteNode = useCallback(async (
    nodeId: string,
    onDeleted: (nodeId: string) => void
  ) => {
    const node = simNodesRef.current.find(n => n.id === nodeId);
    try {
      simNodesRef.current = simNodesRef.current.filter(n => n.id !== nodeId);
      simEdgesRef.current = simEdgesRef.current.filter(e => {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        return s !== nodeId && t !== nodeId;
      });

      onDeleted(nodeId);
      await storeDeleteNote(nodeId);
      showToast(`"${node?.title}" moved to trash`);
    } catch (err) {
      showToast("Failed to delete note");
    }
  }, [simNodesRef, simEdgesRef, storeDeleteNote, showToast]);

  const renameNode = useCallback(async (
    nodeId: string,
    newTitle: string,
    onRenamed: (nodeId: string, title: string) => void
  ) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      simNodesRef.current = simNodesRef.current.map(n =>
        n.id === nodeId ? { ...n, title: trimmed } : n
      );
      onRenamed(nodeId, trimmed);
      await dbUpdateNote(nodeId, { title: trimmed });

      // Push into the note store here — after the user has committed a title
      // and the DB is updated. This is the correct moment for the sidebar to
      // reflect the new note. Doing it in createNodeAt instead would trigger
      // visibleNodes to recompute, causing the D3 effect to tear down and
      // rebuild the graph before the rename input ever appears.
      const updated = await getNoteById(nodeId);
      if (updated) {
        useNoteStore.setState((state) => {
          const exists = state.notes.some((n) => n.id === nodeId);
          return {
            notes: exists
              ? state.notes.map((n) => (n.id === nodeId ? updated : n))
              : [...state.notes, updated],
          };
        });
      }
    } catch (err) {
      showToast("Failed to rename note");
    }
  }, [simNodesRef, showToast]);

  const createLink = useCallback(async (
    sourceId: string,
    targetId: string,
    onLinked: (edge: GraphEdge) => void
  ) => {
    if (sourceId === targetId) return;

    try {
      const [sourceNote, targetNote] = await Promise.all([
        getNoteById(sourceId),
        getNoteById(targetId),
      ]);
      if (!sourceNote || !targetNote) return;

      const normalizedSource = typeof sourceId === "object"
        ? (sourceId as unknown as GraphNode).id
        : sourceId;
      const normalizedTarget = typeof targetId === "object"
        ? (targetId as unknown as GraphNode).id
        : targetId;

      const newEdge: GraphEdge = {
        source:   normalizedSource,
        target:   normalizedTarget,
        sourceId: normalizedSource,
        targetId: normalizedTarget,
        weight:   1,
      };

      simEdgesRef.current = [...simEdgesRef.current, newEdge];
      simNodesRef.current = simNodesRef.current.map(n => {
        if (n.id === normalizedSource || n.id === normalizedTarget) {
          return { ...n, linkCount: n.linkCount + 1 };
        }
        return n;
      });

      onLinked(newEdge);

      // Append a [[noteLink]] paragraph to the source note's TipTap document
      let doc: any;
      try { doc = JSON.parse(sourceNote.content ?? "{}"); } catch { doc = { content: [] }; }

      doc.content = [
        ...(doc.content ?? []),
        {
          type: "paragraph",
          content: [{ type: "noteLink", attrs: { id: targetId, label: targetNote.title } }],
        },
      ];

      await dbUpdateNote(sourceId, {
        content:   JSON.stringify(doc),
        plaintext: (sourceNote.plaintext ?? "") + `\n${targetNote.title}`,
      });

      const targets = simEdgesRef.current.flatMap(e => {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        if (s === sourceId) return [t];
        if (t === sourceId) return [s];
        return [];
      });
      await syncBacklinks(sourceId, [...new Set(targets)]);

      showToast(`Linked "${sourceNote.title}" → "${targetNote.title}"`);
    } catch (err) {
      showToast("Failed to create link");
    }
  }, [simEdgesRef, simNodesRef, showToast]);

  // ── Delete a link between two notes ──────────────────────────────────────
  //
  // Removes the [[noteLink]] node referencing targetId from the source note's
  // TipTap JSON content, re-syncs backlinks, patches simEdgesRef and
  // simNodesRef, then calls onDeleted so the D3 caller can rebind selections.
  const deleteLink = useCallback(async (
    sourceId: string,
    targetId: string,
    onDeleted: (sourceId: string, targetId: string) => void,
  ) => {
    try {
      const sourceNote = await getNoteById(sourceId);
      if (!sourceNote) return;

      // Walk the TipTap JSON and strip every noteLink pointing to targetId
      let doc: any;
      try { doc = JSON.parse(sourceNote.content ?? "{}"); } catch { doc = { content: [] }; }

      function stripNoteLinks(nodes: any[]): any[] {
        return nodes
          .filter((node) => {
            // Remove noteLink nodes that reference this target
            if (node.type === "noteLink" && node.attrs?.id === targetId) return false;
            return true;
          })
          .map((node) => {
            if (node.content && Array.isArray(node.content)) {
              return { ...node, content: stripNoteLinks(node.content) };
            }
            return node;
          });
      }

      doc.content = stripNoteLinks(doc.content ?? []);

      // Rebuild plaintext by walking the cleaned doc
      function extractText(nodes: any[]): string {
        return nodes.map((n) => {
          if (n.type === "text")     return n.text ?? "";
          if (n.type === "noteLink") return n.attrs?.label ?? "";
          if (n.content && Array.isArray(n.content)) return extractText(n.content);
          return "";
        }).join(" ");
      }
      const newPlaintext = extractText(doc.content ?? []);

      await dbUpdateNote(sourceId, {
        content:   JSON.stringify(doc),
        plaintext: newPlaintext,
      });

      // Patch sim state before calling onDeleted
      simEdgesRef.current = simEdgesRef.current.filter(e => {
        const s = e.sourceId ?? (typeof e.source === "object" ? (e.source as GraphNode).id : e.source);
        const t = e.targetId ?? (typeof e.target === "object" ? (e.target as GraphNode).id : e.target);
        // Remove in both directions — the graph is visually undirected
        return !((s === sourceId && t === targetId) || (s === targetId && t === sourceId));
      });

      simNodesRef.current = simNodesRef.current.map(n => {
        if (n.id === sourceId || n.id === targetId) {
          return { ...n, linkCount: Math.max(0, n.linkCount - 1) };
        }
        return n;
      });

      // Re-sync backlinks from the updated edges
      const remainingTargets = simEdgesRef.current.flatMap(e => {
        const s = e.sourceId ?? (typeof e.source === "object" ? (e.source as GraphNode).id : e.source);
        const t = e.targetId ?? (typeof e.target === "object" ? (e.target as GraphNode).id : e.target);
        if (s === sourceId) return [t];
        if (t === sourceId) return [s];
        return [];
      });
      await syncBacklinks(sourceId, [...new Set(remainingTargets)]);

      onDeleted(sourceId, targetId);

      const targetNote = await getNoteById(targetId);
      showToast(`Removed link → "${targetNote?.title ?? targetId}"`);
    } catch (err) {
      showToast("Failed to remove link");
    }
  }, [simEdgesRef, simNodesRef, showToast]);

  return { createNodeAt, deleteNode, renameNode, createLink, deleteLink };
}