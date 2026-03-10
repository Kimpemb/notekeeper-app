// src/hooks/useAutoSave.ts
import { useEffect, useRef, useCallback } from "react";
import { Editor } from "@tiptap/react";
import { useNoteStore } from "@/store/useNoteStore";
import { useUIStore } from "@/store/useUIStore";
import type { UpdateNoteInput } from "@/db/queries";

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 2_000;
const HARD_CAP_MS = 30_000;

interface UseAutoSaveOptions {
  editor: Editor | null;
  noteId: string | null;
}

export function useAutoSave({ editor, noteId }: UseAutoSaveOptions): void {
  const updateNote = useNoteStore(
    (s: { updateNote: (id: string, input: UpdateNoteInput) => Promise<void> }) =>
      s.updateNote
  );
  const setSaveStatus = useUIStore(
    (s: { setSaveStatus: (status: SaveStatus) => void }) => s.setSaveStatus
  );

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
    isDirty.current = false;

    setSaveStatus("saving");

    try {
      const json      = editor.getJSON();
      const content   = JSON.stringify(json);
      const plaintext = editor.getText();
      const title     = deriveTitleFromDoc(json);

      await updateNote(noteId, { title, content, plaintext });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2_000);
    } catch (err) {
      console.error("[AutoSave] failed:", err);
      setSaveStatus("error");
    }
  }, [editor, noteId, updateNote, setSaveStatus]);

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

interface TipTapTextNode { type: "text"; text?: string; }
interface TipTapBlockNode { type: string; content?: TipTapNode[]; }
type TipTapNode = TipTapTextNode | TipTapBlockNode;
interface TipTapDoc { content?: TipTapNode[]; }

function deriveTitleFromDoc(doc: TipTapDoc): string {
  if (!doc.content) return "Untitled";
  for (const node of doc.content) {
    const block = node as TipTapBlockNode;
    if (!block.content) continue;
    const text = block.content
      .filter((n): n is TipTapTextNode => n.type === "text")
      .map((n) => n.text ?? "")
      .join("")
      .trim();
    if (text.length > 0) return text.slice(0, 80);
  }
  return "Untitled";
}