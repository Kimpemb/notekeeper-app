// src/features/graph/useGraphEdit.ts - BACK TO BASICS

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

      // Let D3 patch the DOM
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
          // If it already exists in the store (plain rename, not fresh
          // creation), update in place rather than duplicating.
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

      // FIX 2: Normalize source/target to plain string IDs before storing in
      // simEdgesRef. After forceLink runs D3 mutates edge source/target into
      // object references. The join key-function in the onLinked callback
      // reads those objects and produces keys like "abc|xyz" from .id — but
      // if we stored raw strings AND D3 hasn't resolved them yet the keys
      // won't match, the enter selection stays empty, and no line is drawn.
      // Storing the plain IDs upfront keeps the key function consistent
      // regardless of whether D3 has resolved the references yet.
      const normalizedSource = typeof sourceId === "object"
        ? (sourceId as unknown as GraphNode).id
        : sourceId;
      const normalizedTarget = typeof targetId === "object"
        ? (targetId as unknown as GraphNode).id
        : targetId;

      const newEdge: GraphEdge = {
        source: normalizedSource,
        target: normalizedTarget,
        weight: 1,
      };

      simEdgesRef.current = [...simEdgesRef.current, newEdge];
      simNodesRef.current = simNodesRef.current.map(n => {
        if (n.id === normalizedSource || n.id === normalizedTarget) {
          return { ...n, linkCount: n.linkCount + 1 };
        }
        return n;
      });

      onLinked(newEdge);

      // Update source note content
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
        content: JSON.stringify(doc),
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

  return { createNodeAt, deleteNode, renameNode, createLink };
}