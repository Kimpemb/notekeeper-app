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

      // Push into the note store immediately so GraphNodeEditor (and the main
      // editor) can find the note by ID as soon as the user clicks to open it.
      // Previously this was deferred to renameNode to avoid triggering a D3
      // rebuild before the rename input appeared — that concern is now moot
      // because visibleNodes recomputation is gated on simNodesRef, not the
      // store, for the rename-input window.
      useNoteStore.setState((state) => ({
        notes: [...state.notes, note],
      }));

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
          content: [{ type: "noteLink", attrs: { id: normalizedTarget, label: targetNote.title } }],
        },
      ];

      const newContent = JSON.stringify(doc);

      await dbUpdateNote(sourceId, {
        content:   newContent,
        plaintext: (sourceNote.plaintext ?? "") + `\n${targetNote.title}`,
      });

      // Notify the main editor and GraphNodeEditor that this note's content
      // was written externally. Both listen for this event and reload their
      // TipTap in-memory state, preventing the autosave debounce from firing
      // with stale content and overwriting the injected noteLink.
      // The content is passed in the event detail to avoid a second DB fetch.
      window.dispatchEvent(new CustomEvent("idemora:content-updated", {
        detail: { noteId: sourceId, content: newContent },
      }));

      // Patch the note store so BacklinksPanel and other consumers see the
      // updated content immediately without waiting for a store poll.
      const refreshed = await getNoteById(sourceId);
      if (refreshed) {
        useNoteStore.setState((state) => ({
          notes: state.notes.map((n) => (n.id === sourceId ? refreshed : n)),
        }));
      }

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

  const deleteLink = useCallback(async (
    sourceId: string,
    targetId: string,
    onDeleted: (sourceId: string, targetId: string) => void,
  ) => {
    try {
      const sourceNote = await getNoteById(sourceId);
      if (!sourceNote) return;

      let doc: any;
      try { doc = JSON.parse(sourceNote.content ?? "{}"); } catch { doc = { content: [] }; }

      function stripNoteLinks(nodes: any[]): any[] {
        return nodes
          .filter((node) => {
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

      function extractText(nodes: any[]): string {
        return nodes.map((n) => {
          if (n.type === "text")     return n.text ?? "";
          if (n.type === "noteLink") return n.attrs?.label ?? "";
          if (n.content && Array.isArray(n.content)) return extractText(n.content);
          return "";
        }).join(" ");
      }
      const newPlaintext = extractText(doc.content ?? []);
      const newContent   = JSON.stringify(doc);

      await dbUpdateNote(sourceId, {
        content:   newContent,
        plaintext: newPlaintext,
      });

      // Same pattern as createLink — notify editors so they reload cleanly.
      window.dispatchEvent(new CustomEvent("idemora:content-updated", {
        detail: { noteId: sourceId, content: newContent },
      }));

      const refreshed = await getNoteById(sourceId);
      if (refreshed) {
        useNoteStore.setState((state) => ({
          notes: state.notes.map((n) => (n.id === sourceId ? refreshed : n)),
        }));
      }

      simEdgesRef.current = simEdgesRef.current.filter(e => {
        const s = e.sourceId ?? (typeof e.source === "object" ? (e.source as GraphNode).id : e.source);
        const t = e.targetId ?? (typeof e.target === "object" ? (e.target as GraphNode).id : e.target);
        return !((s === sourceId && t === targetId) || (s === targetId && t === sourceId));
      });

      simNodesRef.current = simNodesRef.current.map(n => {
        if (n.id === sourceId || n.id === targetId) {
          return { ...n, linkCount: Math.max(0, n.linkCount - 1) };
        }
        return n;
      });

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