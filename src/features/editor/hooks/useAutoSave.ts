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
import { syncNoteBlocks } from "@/features/notes/db/queries";
import { nudgeIndexer } from "@/features/ai/lib/indexer";
import { useAIStore } from "@/features/ai/store/useAIStore";


const HARD_CAP_MS = 30_000;

interface UseAutoSaveOptions {
  editor:          Editor | null;
  noteId:          string | null;
  isActiveTab:     boolean;
  onSaveComplete?: (content: string, noteId: string) => void;
  suppressSave?:   React.MutableRefObject<boolean>;
  contentLoading?: React.MutableRefObject<boolean>;
}

export function useAutoSave({
  editor,
  noteId,
  isActiveTab,
  onSaveComplete,
  suppressSave,
  contentLoading,
}: UseAutoSaveOptions): void {
const updateNote    = useNoteStore((s) => s.updateNote);
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);
  const autosaveDelay = useAppSettings((s) => s.settings.autosaveDelay);
  const dbSettled     = useNoteStore((s) => s.dbSettled);

  const debounceTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty          = useRef(false);
  const isActiveTabRef   = useRef(isActiveTab);
  const autosaveDelayRef = useRef(autosaveDelay);
  const dbSettledRef     = useRef(dbSettled);

  useEffect(() => { isActiveTabRef.current = isActiveTab; }, [isActiveTab]);
  useEffect(() => { autosaveDelayRef.current = autosaveDelay; }, [autosaveDelay]);
  useEffect(() => { dbSettledRef.current = dbSettled; }, [dbSettled]);

  const clearTimers = useCallback(() => {
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    if (hardCapTimer.current)  { clearTimeout(hardCapTimer.current);  hardCapTimer.current  = null; }
  }, []);

  // ── runScheduledBackupIfDue ───────────────────────────────────────────────

  const runScheduledBackupIfDue = useCallback(async () => {
    try {
      const { runScheduledBackupIfDue: backupFn } = await import("@/features/backup/lib/scheduler");
      await backupFn();
    } catch (err) {
      console.warn("[AutoSave] backup trigger failed:", err);
    }
  }, []);

  // ── runEmbeddingPipeline ──────────────────────────────────────────────────
  // syncNoteBlocks handles chunking, hash-based skip, and job enqueueing
  // internally. Only changed blocks produce embedding jobs.

  const runEmbeddingPipeline = useCallback((savedNoteId: string, content: string) => {
    if (!useAIStore.getState().enabled) return;
    setTimeout(async () => {
      try {
        await syncNoteBlocks(savedNoteId, content);
        nudgeIndexer();
      } catch (err) {
        console.warn("[AutoSave] embedding enqueue failed:", err);
      }
    }, 2000);
  }, []);

  // ── save ──────────────────────────────────────────────────────────────────

const save = useCallback(async () => {
    if (!editor || !noteId || !isDirty.current) return;
    if (!isActiveTabRef.current) return;
    if (suppressSave?.current) return;
    if (contentLoading?.current) return;
    if (!dbSettledRef.current) return;

    clearTimers();
    isDirty.current = false;
    setSaveStatus("saving");

    try {
      const content   = JSON.stringify(editor.getJSON());
      const plaintext = editor.getText();
      const update: UpdateNoteInput = { content, plaintext };

      onSaveComplete?.(content, noteId);
await updateNote(noteId, update);
setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2_000);

      runEmbeddingPipeline(noteId, content);
      runScheduledBackupIfDue();

    } catch (err) {
      console.error("[AutoSave] failed:", err);
      setSaveStatus("error");
    }
  }, [editor, noteId, updateNote, setSaveStatus, onSaveComplete, clearTimers, runEmbeddingPipeline, runScheduledBackupIfDue, suppressSave, contentLoading]);

  // ── scheduleSave ──────────────────────────────────────────────────────────

  const scheduleSave = useCallback(() => {
    if (contentLoading?.current) return;
    isDirty.current = true;
    if (!isActiveTabRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(save, autosaveDelayRef.current);
    if (!hardCapTimer.current) hardCapTimer.current = setTimeout(save, HARD_CAP_MS);
  }, [save, contentLoading]);

  // ── Ctrl/Cmd+S ────────────────────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "s") return;
      if (!isActiveTabRef.current) return;
      e.preventDefault();
      if (!editor || !noteId || editor.isDestroyed) return;
      if (suppressSave?.current) return;
      if (contentLoading?.current) return;
      isDirty.current = true;
      save();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save, editor, noteId, suppressSave, contentLoading]);

  // ── Force-save listener ───────────────────────────────────────────────────

  useEffect(() => {
    function handleForceSave() {
      if (!editor || !noteId || editor.isDestroyed) return;
      if (!isActiveTabRef.current) return;
      if (contentLoading?.current) return;
      isDirty.current = true;
      save();
    }
    window.addEventListener("idemora:force-save", handleForceSave);
    return () => window.removeEventListener("idemora:force-save", handleForceSave);
  }, [editor, noteId, save, contentLoading]);

  // ── Transaction handler ───────────────────────────────────────────────────

  useEffect(() => {
    if (!editor) return;

   const handler = ({ transaction }: { transaction: any }) => {
  if (!transaction.docChanged) return;
  if (transaction.getMeta("preventAutoSave")) return;
const metaKeys = Object.keys(transaction.meta ?? {});
if (metaKeys.length === 1 && metaKeys[0] === "preventUpdate") return;
   
  if (contentLoading?.current) {
    setTimeout(() => {
      if (!contentLoading?.current) scheduleSave();
    }, 50);
    return;
  }
  scheduleSave();
};

    editor.on("transaction", handler);
    return () => { editor.off("transaction", handler); };
  }, [editor, scheduleSave, contentLoading]);

  // ── Flush on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearTimers();
      if (isDirty.current && editor && noteId && !editor.isDestroyed) {
        if (suppressSave?.current) return;
        if (contentLoading?.current) return;
        const content = JSON.stringify(editor.getJSON());
        // Never flush empty stub
        if (content === '{"type":"doc","content":[]}') return;
        const plaintext = editor.getText();
        updateNote(noteId, { content, plaintext }).catch(console.error);
        runScheduledBackupIfDue();
      }
    };
  }, [editor, noteId, updateNote, clearTimers, suppressSave, contentLoading, runScheduledBackupIfDue]);
}