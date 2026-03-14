// src/features/editor/hooks/useAutoSave.ts
import { useEffect, useRef, useCallback } from "react";
import { Editor } from "@tiptap/react";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import type { UpdateNoteInput } from "@/features/notes/db/queries";

const DEBOUNCE_MS = 2_000;
const HARD_CAP_MS = 30_000;

interface UseAutoSaveOptions {
  editor: Editor | null;
  noteId: string | null;
  onSaveComplete?: (content: string, noteId: string) => void;
}

export function useAutoSave({ editor, noteId, onSaveComplete }: UseAutoSaveOptions): void {
  const updateNote    = useNoteStore((s) => s.updateNote);
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty       = useRef(false);
  const lastNoteId    = useRef<string | null>(null);

  const save = useCallback(async () => {
    if (!editor || !noteId || !isDirty.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (hardCapTimer.current)  clearTimeout(hardCapTimer.current);
    debounceTimer.current = null;
    hardCapTimer.current  = null;
    isDirty.current       = false;
    setSaveStatus("saving");
    try {
      const content   = JSON.stringify(editor.getJSON());
      const plaintext = editor.getText();
      const update: UpdateNoteInput = { content, plaintext };
      // Title is NEVER derived from content — only updated explicitly via the title field
      await updateNote(noteId, update);
      onSaveComplete?.(content, noteId);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2_000);
    } catch (err) {
      console.error("[AutoSave] failed:", err);
      setSaveStatus("error");
    }
  }, [editor, noteId, updateNote, setSaveStatus, onSaveComplete]);

  const scheduleSave = useCallback(() => {
    isDirty.current = true;
    setSaveStatus("saving");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(save, DEBOUNCE_MS);
    if (!hardCapTimer.current) hardCapTimer.current = setTimeout(save, HARD_CAP_MS);
  }, [save, setSaveStatus]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", scheduleSave);
    return () => { editor.off("update", scheduleSave); };
  }, [editor, scheduleSave]);

  // Flush pending save when switching notes
  useEffect(() => {
    if (lastNoteId.current && lastNoteId.current !== noteId && isDirty.current) save();
    lastNoteId.current = noteId;
  }, [noteId, save]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (isDirty.current) save();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (hardCapTimer.current)  clearTimeout(hardCapTimer.current);
    };
  }, [save]);
}