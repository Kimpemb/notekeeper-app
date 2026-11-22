// Stripped-back editor for source_type 'notepad': paragraphs only, plain-text
// paste, no links/slash menu/suggestions. Local-only and hidden from the AI
// while rag_excluded = 1 (see aiHidden.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAutoSave } from "@/features/editor/hooks/useAutoSave";
import { BlockIdExtension } from "@/features/editor/components/Editor/extensions";
import { getNoteContent } from "@/features/notes/db/queries";

interface NotepadEditorProps {
  noteId:   string;
  paneId:   1 | 2;
  isActive: boolean;
}

export function NotepadEditor({ noteId, isActive }: NotepadEditorProps) {
  const note       = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNoteStore((s) => s.updateNote);
  const editorRef  = useRef<Editor | null>(null);
  const contentLoading = useRef(true);
  const [title, setTitle] = useState(note?.title ?? "");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, bulletList: false, orderedList: false, listItem: false,
        blockquote: false, codeBlock: false, horizontalRule: false,
        bold: false, italic: false, strike: false, code: false,
      }),
      BlockIdExtension,
    ],
    content: "",
    autofocus: false,
    editorProps: {
      attributes: {
        class: "tiptap h-full outline-none whitespace-pre-wrap",
        spellcheck: "false",
      },
      // Paste as literal text, one paragraph per line.
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text == null) return false;
        event.preventDefault();
        editorRef.current?.commands.insertContent(
          text.split(/\r?\n/).map((line) => ({
            type: "paragraph",
            content: line ? [{ type: "text", text: line }] : [],
          }))
        );
        return true;
      },
    },
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  // The store holds notes without content, so load it from the DB on open.
  // contentLoading blocks autosave until the load has finished, so a blank
  // editor can never overwrite stored text.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    contentLoading.current = true;
    getNoteContent(noteId).then(({ content }) => {
      if (cancelled || editor.isDestroyed) return;
      try {
        if (content && content !== "null" && content !== "{}") {
          editor.commands.setContent(JSON.parse(content));
        }
      } catch (err) {
        console.warn("[Notepad] could not parse saved content:", err);
      }
      editor.view.dispatch(editor.state.tr.setMeta("preventAutoSave", true));
      setTimeout(() => { contentLoading.current = false; }, 300);
    });
    return () => { cancelled = true; };
  }, [editor, noteId]);

  useAutoSave({ editor, noteId, isActiveTab: isActive, contentLoading });

  const commitTitle = useCallback(() => {
    const next = title.trim() || "Untitled";
    if (next !== note?.title) updateNote(noteId, { title: next });
  }, [title, note?.title, noteId, updateNote]);

  if (!note) return null;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="w-full mx-auto px-8 py-6 max-w-4xl cursor-text">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitTitle(); editor?.commands.focus("start"); }
          }}
          placeholder="Notepad"
          spellCheck={false}
          className="block w-full bg-transparent font-bold outline-none text-idemora-text-normal placeholder:text-idemora-text-faint"
          style={{ fontSize: "2rem", lineHeight: 1.2 }}
        />
        <p className="text-xs text-idemora-text-faint mt-1 mb-4">
          Notepad: stored on this device only, hidden from AI.
        </p>
        <div
          className="min-h-[60vh] cursor-text [&_.tiptap]:leading-[1.3]! [&_.tiptap_p]:m-0! [&_.tiptap_p]:leading-[1.3]!"
          onClick={(e) => {
            // Clicks on the text itself are handled by ProseMirror; only
            // the empty area around it needs help.
            if ((e.target as HTMLElement).closest(".tiptap") === null || e.target === e.currentTarget) {
              editor?.commands.focus("end");
            }
          }}
        >
          <EditorContent editor={editor} className="text-idemora-text-normal" />
        </div>
      </div>
    </div>
  );
}