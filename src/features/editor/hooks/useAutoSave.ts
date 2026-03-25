// src/features/editor/hooks/useAutoSave.ts
//
// With key={noteId} on Editor, every note navigation unmounts and remounts
// the editor. The unmount flush (bottom of this file) is therefore the
// primary mechanism for saving content on navigation — the debounce timer
// may not have fired yet when the user switches notes quickly.
//
// isActiveTab is kept to prevent the display:none-hidden editor from
// scheduling saves while it's not visible, but it's a secondary concern.

import { useEffect, useRef, useCallback } from "react";
import { Editor } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import type { UpdateNoteInput } from "@/features/notes/db/queries";

const HARD_CAP_MS = 30_000;

interface UseAutoSaveOptions {
  editor: Editor | null;
  noteId: string | null;
  isActiveTab: boolean;
  onSaveComplete?: (content: string, noteId: string) => void;
}

export function useAutoSave({
  editor,
  noteId,
  isActiveTab,
  onSaveComplete,
}: UseAutoSaveOptions): void {
  const updateNote    = useNoteStore((s) => s.updateNote);
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);
  const autosaveDelay = useAppSettings((s) => s.settings.autosaveDelay);

  const debounceTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty         = useRef(false);
  const isActiveTabRef  = useRef(isActiveTab);
  const autosaveDelayRef = useRef(autosaveDelay);

  useEffect(() => { isActiveTabRef.current = isActiveTab; }, [isActiveTab]);
  useEffect(() => { autosaveDelayRef.current = autosaveDelay; }, [autosaveDelay]);

  const clearTimers = useCallback(() => {
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    if (hardCapTimer.current)  { clearTimeout(hardCapTimer.current);  hardCapTimer.current  = null; }
  }, []);

  const save = useCallback(async () => {
    if (!editor || !noteId || !isDirty.current) return;
    if (!isActiveTabRef.current) return;
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
    } catch (err) {
      console.error("[AutoSave] failed:", err);
      setSaveStatus("error");
    }
  }, [editor, noteId, updateNote, setSaveStatus, onSaveComplete, clearTimers]);

  const scheduleSave = useCallback(() => {
    isDirty.current = true;
    if (!isActiveTabRef.current) return;
    setSaveStatus("saving");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // Read the latest delay from the ref so changes take effect immediately
    // without needing to recreate this callback.
    debounceTimer.current = setTimeout(save, autosaveDelayRef.current);
    if (!hardCapTimer.current) hardCapTimer.current = setTimeout(save, HARD_CAP_MS);
  }, [save, setSaveStatus]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", scheduleSave);
    return () => { editor.off("update", scheduleSave); };
  }, [editor, scheduleSave]);

  // Flush on unmount — this is the critical path for navigation saves.
  // With key={noteId}, navigating away unmounts this editor immediately.
  // We must save synchronously-ish here or the content will be lost.
  // updateNote is fire-and-forget on unmount (can't await in cleanup).
  useEffect(() => {
    return () => {
      clearTimers();
      if (isDirty.current && editor && noteId && !editor.isDestroyed) {
        const content   = JSON.stringify(editor.getJSON());
        const plaintext = editor.getText();
        updateNote(noteId, { content, plaintext }).catch(console.error);
      }
    };
  }, [editor, noteId, updateNote, clearTimers]);
}