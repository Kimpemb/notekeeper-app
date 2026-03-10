// src/components/Editor/index.tsx
import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useNoteStore } from "@/store/useNoteStore";
import { useAutoSave } from "@/hooks/useAutoSave";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { VersionHistory } from "./VersionHistory";
import { useUIStore } from "@/store/useUIStore";

export function Editor() {
  const activeNote         = useNoteStore((s) => s.activeNote());
  const updateNote         = useNoteStore((s) => s.updateNote);
  const versionHistoryOpen = useUIStore((s) => s.versionHistoryOpen);
  const titleRef           = useRef<HTMLHeadingElement>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: activeNote?.content ? JSON.parse(activeNote.content) : "",
    editorProps: {
      attributes: {
        class: "tiptap h-full outline-none",
        "data-placeholder": "Start writing…",
      },
    },
  });

  // When active note changes, load its content into the editor
  useEffect(() => {
    if (!editor || !activeNote) return;
    const current = JSON.stringify(editor.getJSON());
    if (current !== activeNote.content) {
      editor.commands.setContent(
        activeNote.content ? JSON.parse(activeNote.content) : ""
      );
    }
    // Sync title element too
    if (titleRef.current) {
      titleRef.current.textContent =
        activeNote.title === "Untitled" ? "" : activeNote.title;
    }
  }, [activeNote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save
  useAutoSave({ editor: editor ?? null, noteId: activeNote?.id ?? null });

  if (!activeNote) return null;

  function handleTitleBlur() {
    if (!activeNote) return;
    const title = titleRef.current?.textContent?.trim() ?? "Untitled";
    if (title !== activeNote.title) {
      updateNote(activeNote.id, { title: title || "Untitled" });
    }
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
    // Enter moves focus to editor, never inserts a newline in the title
    if (e.key === "Enter") {
      e.preventDefault();
      editor?.commands.focus("start");
    }
    // Block paste from landing in title — redirect to editor instead
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      editor?.commands.focus("end");
      document.execCommand("paste");
    }
  }

  function handleTitlePaste(e: React.ClipboardEvent<HTMLHeadingElement>) {
    // Paste in title: take only the first line as plain text, strip the rest
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const firstLine = text.split(/\r?\n/)[0].trim().slice(0, 80);
    document.execCommand("insertText", false, firstLine);
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Toolbar */}
      <Toolbar editor={editor ?? null} />

      {/* Editor surface */}
      <div className="flex-1 overflow-y-auto">
        <div className="
          w-full mx-auto px-8 py-10 h-full
          max-w-2xl xl:max-w-3xl 2xl:max-w-4xl
        ">
          {/* Inline title — fully isolated from editor */}
          <h1
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            onPaste={handleTitlePaste}
            className="
              block w-full text-3xl font-bold mb-6 outline-none
              text-zinc-900 dark:text-zinc-100
              empty:before:content-[attr(data-placeholder)]
              empty:before:text-zinc-300 dark:empty:before:text-zinc-600
              empty:before:pointer-events-none
            "
            data-placeholder="Untitled"
          />

          <EditorContent
            editor={editor}
            className="text-zinc-800 dark:text-zinc-200 min-h-[60vh]"
          />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar editor={editor ?? null} />

      {/* Version history panel */}
      {versionHistoryOpen && <VersionHistory noteId={activeNote.id} />}
    </div>
  );
}