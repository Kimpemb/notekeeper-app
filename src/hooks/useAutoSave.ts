// src/hooks/useAutoSave.ts
import { useEffect, useRef, useCallback } from "react";
import { Editor } from "@tiptap/react";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import type { UpdateNoteInput } from "@/db/queries";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 2_000;
const HARD_CAP_MS = 30_000;
const UNTITLED_PATTERN = /^Untitled-\d+$/;

// Characters that should never be promoted to a note title.
// A lone '/' means the user is mid-command; other symbols are similarly useless.
const INVALID_TITLE_PATTERN = /^[/\\|#*`~\-_=<>]+$/;

interface UseAutoSaveOptions {
  editor: Editor | null;
  noteId: string | null;
  onSaveComplete?: (content: string) => void;
}

export function useAutoSave({ editor, noteId, onSaveComplete }: UseAutoSaveOptions): void {
  const notes         = useNoteStore((s) => s.notes);
  const updateNote    = useNoteStore((s) => s.updateNote);
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardCapTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty       = useRef(false);
  const lastNoteId    = useRef<string | null>(null);
  const notesRef      = useRef(notes);

  useEffect(() => { notesRef.current = notes; }, [notes]);

  const save = useCallback(async () => {
    if (!editor || !noteId || !isDirty.current) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (hardCapTimer.current)  clearTimeout(hardCapTimer.current);
    debounceTimer.current = null;
    hardCapTimer.current  = null;
    isDirty.current = false;

    setSaveStatus("saving");

    try {
      const json      = editor.getJSON();
      const content   = JSON.stringify(json);
      const plaintext = editor.getText();

      // Notify editor BEFORE the store update so lastSavedContent is set
      // before the useEffect watching activeNote?.content can fire
      onSaveComplete?.(content);

      const currentNote = notesRef.current.find((n) => n.id === noteId);
      const isUntitled  = !currentNote || UNTITLED_PATTERN.test(currentNote.title);

      const update: UpdateNoteInput = { content, plaintext };

      if (isUntitled) {
        const derived = deriveTitleFromDoc(json);
        // Only promote to title if it's a real, non-symbol string
        if (derived && !INVALID_TITLE_PATTERN.test(derived)) {
          update.title = derived;
        }
        // Otherwise leave the title as Untitled-X — don't set update.title at all
      }

      await updateNote(noteId, update);
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
    if (!hardCapTimer.current) {
      hardCapTimer.current = setTimeout(save, HARD_CAP_MS);
    }
  }, [save, setSaveStatus]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", scheduleSave);
    return () => { editor.off("update", scheduleSave); };
  }, [editor, scheduleSave]);

  useEffect(() => {
    if (lastNoteId.current && lastNoteId.current !== noteId && isDirty.current) {
      save();
    }
    lastNoteId.current = noteId;
  }, [noteId, save]);

  useEffect(() => {
    return () => {
      if (isDirty.current) save();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (hardCapTimer.current)  clearTimeout(hardCapTimer.current);
    };
  }, [save]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TipTapTextNode  { type: "text"; text?: string; }
interface TipTapBlockNode { type: string; content?: TipTapNode[]; }
type TipTapNode = TipTapTextNode | TipTapBlockNode;
interface TipTapDoc { content?: TipTapNode[]; }

function deriveTitleFromDoc(doc: TipTapDoc): string {
  if (!doc.content) return "";
  for (const node of doc.content) {
    const block = node as TipTapBlockNode;
    if (!block.content) continue;
    const text = block.content
      .filter((n): n is TipTapTextNode => n.type === "text")
      .map((n) => n.text ?? "")
      .join("").trim();
    if (text.length > 0) return text.slice(0, 80);
  }
  return "";
}