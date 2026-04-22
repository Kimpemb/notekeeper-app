// src/features/editor/hooks/useAutoSave.ts
//
// CRITICAL: This hook ONLY triggers autosave on REAL user input.
// Programmatic setContent() calls are blocked via contentLoadingRef.
//
// The transaction event is used instead of update because it provides
// access to transaction metadata, allowing us to distinguish between
// user typing and programmatic changes.
//
// With key={noteId} on Editor, every note navigation unmounts and remounts
// the editor. The unmount flush (bottom of this file) is therefore the
// primary mechanism for saving content on navigation — the debounce timer
// may not have fired yet when the user switches notes quickly.
//
// isActiveTab is kept to prevent the display:none-hidden editor from
// scheduling saves while it's not visible, but it's a secondary concern.
//
// The embedding pipeline is fully decoupled from the save path via
// setTimeout(fn, 0) — content save completes and unblocks the editor
// before any indexing work begins.

import { useEffect, useRef, useCallback } from "react";
import { Editor } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import type { UpdateNoteInput } from "@/features/notes/db/queries";
import { syncNoteBlocks, enqueueEmbeddingJobs } from "@/features/notes/db/queries";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import { useAIStore } from "@/features/ai/store/useAIStore";

const HARD_CAP_MS = 30_000;

interface UseAutoSaveOptions {
  editor:          Editor | null;
  noteId:          string | null;
  isActiveTab:     boolean;
  onSaveComplete?: (content: string, noteId: string) => void;
  // When the graph writes content directly to the DB (link injection),
  // it dispatches idemora:content-updated and the editor reloads its
  // in-memory state. suppressSave is set to true for that reload window
  // so the debounce doesn't fire with stale content and overwrite the write.
  suppressSave?:   React.MutableRefObject<boolean>;
  // Blocks autosave while content is being programmatically loaded (brief setContent flash)
  contentLoading?: React.MutableRefObject<boolean>;
  // NEW: Blocks autosave until real content has been loaded at least once
  contentFullyLoaded?: React.MutableRefObject<boolean>;
}

export function useAutoSave({
  editor,
  noteId,
  isActiveTab,
  onSaveComplete,
  suppressSave,
  contentLoading,
  contentFullyLoaded,
}: UseAutoSaveOptions): void {
  const updateNote    = useNoteStore((s) => s.updateNote);
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);
  const autosaveDelay = useAppSettings((s) => s.settings.autosaveDelay);

  const debounceTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty          = useRef(false);
  const isActiveTabRef   = useRef(isActiveTab);
  const autosaveDelayRef = useRef(autosaveDelay);

  useEffect(() => { isActiveTabRef.current = isActiveTab; }, [isActiveTab]);
  useEffect(() => { autosaveDelayRef.current = autosaveDelay; }, [autosaveDelay]);

  const clearTimers = useCallback(() => {
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    if (hardCapTimer.current)  { clearTimeout(hardCapTimer.current);  hardCapTimer.current  = null; }
  }, []);

  // ── runEmbeddingPipeline ──────────────────────────────────────────────────
  // Fully detached from the save path. Called via setTimeout so it never
  // blocks the editor. Errors here must never surface to the user.

  const runEmbeddingPipeline = useCallback((savedNoteId: string, content: string) => {
    if (!useAIStore.getState().enabled) return;
    // Delay long enough that the editor has fully settled and re-painted
    // before any DB or network work begins. 2 s is imperceptible for indexing
    // but keeps the post-save frame completely clean.
    setTimeout(async () => {
      try {
        await syncNoteBlocks(savedNoteId, content);
        const { getDb } = await import("@/features/notes/db/client");
        const db        = await getDb();
        const blocks    = await db.select<{ block_id: string }[]>(
          `SELECT block_id FROM note_blocks WHERE note_id = $1`,
          [savedNoteId]
        );
        await enqueueEmbeddingJobs(
          blocks.map((b) => ({ blockId: b.block_id, noteId: savedNoteId }))
        );
        nudgeIndexer();
      } catch (err) {
        console.warn("[AutoSave] embedding enqueue failed:", err);
      }
    }, 2000);
  }, []);

  // ── runScheduledBackupIfDue (for "on_change" frequency) ───────────────────
  const runScheduledBackupIfDue = useCallback(async () => {
    try {
      const { runScheduledBackupIfDue: backupFn } = await import("@/features/backup/lib/scheduler");
      await backupFn();
    } catch (err) {
      // Silently fail — backup should never block the editor
      console.warn("[AutoSave] backup trigger failed:", err);
    }
  }, []);

  // ── save ──────────────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!editor || !noteId || !isDirty.current) return;
    if (!isActiveTabRef.current) return;
    // Skip if the editor is in the middle of reloading externally-written
    // content (e.g. graph link injection). The content is already correct in
    // the DB; saving now would be a no-op at best and a regression at worst.
    if (suppressSave?.current) return;
    // Skip if content is being programmatically loaded (brief setContent flash)
    if (contentLoading?.current) return;
    // NEW: Skip if real content hasn't been loaded yet
    if (contentFullyLoaded && !contentFullyLoaded.current) return;
    
    clearTimers();
    isDirty.current = false;
    setSaveStatus("saving");

    try {
      const content   = JSON.stringify(editor.getJSON());
      const plaintext = editor.getText();
      const update: UpdateNoteInput = { content, plaintext };

      await updateNote(noteId, update);
      onSaveComplete?.(content, noteId);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2_000);

      // Embedding is fire-and-forget — never awaited, never blocks the editor
      runEmbeddingPipeline(noteId, content);

      // Trigger scheduled backup check (for "on_change" frequency)
      runScheduledBackupIfDue();

    } catch (err) {
      console.error("[AutoSave] failed:", err);
      setSaveStatus("error");
    }
  }, [editor, noteId, updateNote, setSaveStatus, onSaveComplete, clearTimers, runEmbeddingPipeline, runScheduledBackupIfDue, suppressSave, contentLoading, contentFullyLoaded]);

  // ── scheduleSave ──────────────────────────────────────────────────────────

  const scheduleSave = useCallback(() => {
    // Skip saves during programmatic content loading (brief setContent flash)
    if (contentLoading?.current) return;
    // NEW: Skip saves until real content has been loaded at least once
    if (contentFullyLoaded && !contentFullyLoaded.current) return;
    
    isDirty.current = true;
    if (!isActiveTabRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(save, autosaveDelayRef.current);
    if (!hardCapTimer.current) hardCapTimer.current = setTimeout(save, HARD_CAP_MS);
  }, [save, contentLoading, contentFullyLoaded]);

  // ── Force-save listener ───────────────────────────────────────────────────
  // SubPageNodeView dispatches "idemora:force-save" after updateAttributes so
  // the new noteId/title attrs are flushed to DB before the graph editor
  // (a separate TipTap instance) can load the note and read stale attrs.

  useEffect(() => {
    function handleForceSave() {
      if (!editor || !noteId || editor.isDestroyed) return;
      if (!isActiveTabRef.current) return;
      if (contentLoading?.current) return;
      // NEW: Skip during content load
      if (contentFullyLoaded && !contentFullyLoaded.current) return;
      isDirty.current = true;
      save();
    }
    window.addEventListener("idemora:force-save", handleForceSave);
    return () => window.removeEventListener("idemora:force-save", handleForceSave);
  }, [editor, noteId, save, contentLoading, contentFullyLoaded]);

  // ── PATCH: Wire editor TRANSACTION event instead of UPDATE ────────────────
  // This is the critical fix: transaction gives us access to metadata,
  // allowing us to ignore programmatic setContent() calls.
  //
  // The handler checks:
  //   1. transaction.docChanged — ensures something actually changed
  //   2. !transaction.getMeta("preventAutoSave") — ignores programmatic updates
  
  useEffect(() => {
    if (!editor) return;
    
    const handler = ({ transaction }: { transaction: any }) => {
      // Only trigger on actual document changes
      if (!transaction.docChanged) return;
      // Skip if this transaction is marked to prevent autosave
      if (transaction.getMeta("preventAutoSave")) return;
      // Skip during programmatic content loading (brief setContent flash)
      if (contentLoading?.current) return;
      // NEW: Skip until real content has been loaded at least once
      if (contentFullyLoaded && !contentFullyLoaded.current) return;
      scheduleSave();
    };
    
    editor.on("transaction", handler);
    
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor, scheduleSave, contentLoading, contentFullyLoaded]);

  // ── Flush on unmount ──────────────────────────────────────────────────────
  // With key={noteId}, navigating away unmounts this editor immediately.
  // We must save synchronously-ish here or the content will be lost.
  // Embedding is intentionally skipped on unmount flush — the next mount
  // will pick up any un-indexed changes via the scheduled save.

  useEffect(() => {
    return () => {
      clearTimers();
      if (isDirty.current && editor && noteId && !editor.isDestroyed) {
        if (suppressSave?.current) return;
        if (contentLoading?.current) return;
        // NEW: Skip if real content hasn't been loaded yet
        if (contentFullyLoaded && !contentFullyLoaded.current) return;
        const content = JSON.stringify(editor.getJSON());
        // Never flush empty stub — content hasn't loaded yet
        if (content === '{"type":"doc","content":[]}') return;
        const plaintext = editor.getText();
        updateNote(noteId, { content, plaintext }).catch(console.error);
        runScheduledBackupIfDue();
      }
    };
  }, [editor, noteId, updateNote, clearTimers, suppressSave, contentLoading, contentFullyLoaded, runScheduledBackupIfDue]);
}