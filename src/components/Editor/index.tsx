// src/components/Editor/index.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DecorationSet, Decoration } from "@tiptap/pm/view";
import { useNoteStore } from "@/store/useNoteStore";
import { useAutoSave } from "@/hooks/useAutoSave";
import { StatusBar } from "./StatusBar";
import { VersionHistory } from "./VersionHistory";
import { SlashMenu } from "./SlashMenu";
import { useUIStore } from "@/store/useUIStore";

interface BubblePos { top: number; left: number; }

// ─── Slash placeholder decoration extension ───────────────────────────────────
// Renders "Type to search" inline after the '/' character using a ProseMirror
// widget decoration — it appears in the same line as the slash, right after it.

const slashPlaceholderKey = new PluginKey<{ active: boolean }>("slashPlaceholder");

// Self-contained extension — detects '/' at start of block and shows ghost text.
// No external ref needed; reads doc state directly every transaction.
const SlashPlaceholderExtension = Extension.create({
  name: "slashPlaceholder",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: slashPlaceholderKey,
        props: {
          decorations(state) {
            const { doc, selection } = state;
            const { from, to } = selection;
            // Only show when cursor (no selection)
            if (from !== to) return DecorationSet.empty;
            // Check the single character immediately before the cursor is '/'
            // This works regardless of what else is on the line
            const charBefore = from > 0 ? doc.textBetween(from - 1, from, "\n") : "";
            if (charBefore !== "/") return DecorationSet.empty;
            const widget = Decoration.widget(from, () => {
              const span = document.createElement("span");
              span.textContent = "Type to search";
              span.style.color = "rgba(128,128,128,0.42)";
              span.style.pointerEvents = "none";
              span.style.userSelect = "none";
              span.setAttribute("data-slash-hint", "true");
              return span;
            }, { side: 1, key: "slash-hint" });
            return DecorationSet.create(doc, [widget]);
          },
        },
      }),
    ];
  },
});

// ─── Component ────────────────────────────────────────────────────────────────

export function Editor() {
  const activeNote         = useNoteStore((s) => s.activeNote());
  const updateNote         = useNoteStore((s) => s.updateNote);
  const versionHistoryOpen = useUIStore((s) => s.versionHistoryOpen);
  const titleRef           = useRef<HTMLHeadingElement>(null);
  const lastSavedContent   = useRef<string | null>(null);
  const editorWrapRef      = useRef<HTMLDivElement>(null);

  // Bubble menu
  const [bubblePos, setBubblePos]       = useState<BubblePos | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const bubblePosRef                    = useRef<BubblePos | null>(null);
  const slashFromBubble                 = useRef(false);

  // Slash menu
  const [slashOpen, setSlashOpen]   = useState(false);
  const [slashPos, setSlashPos]     = useState<{ top: number; left: number; caretTop: number }>({
    top: 0, left: 0, caretTop: 0,
  });
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartPos               = useRef<number | null>(null);
  // Ref for the decoration extension to read

  const editor = useEditor({
    extensions: [StarterKit, SlashPlaceholderExtension],
    content: activeNote?.content ? JSON.parse(activeNote.content) : "",
    editorProps: {
      attributes: {
        class: "tiptap h-full outline-none",
        "data-placeholder": "Start writing…",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
    },
    onSelectionUpdate: ({ editor: e }) => {
      if (slashFromBubble.current) return;
      const { from, to } = e.state.selection;
      if (from === to) {
        setHasSelection(false);
        setBubblePos(null);
        bubblePosRef.current = null;
        return;
      }
      const coords = e.view.coordsAtPos(from);
      const pos = { top: coords.top - 48, left: coords.left };
      setHasSelection(true);
      setBubblePos(pos);
      bubblePosRef.current = pos;
    },
    onUpdate: ({ editor: e }) => {
      const { state } = e;
      const { from } = state.selection;

      if (slashStartPos.current !== null && !slashFromBubble.current) {
        const slashStart = slashStartPos.current;
        if (from >= slashStart) {
          const textAfterSlash = state.doc.textBetween(slashStart, from, "\n");
          if (textAfterSlash.startsWith("/")) {
            const q = textAfterSlash.slice(1);
            setSlashQuery(q);
            if (textAfterSlash.includes(" ")) {
              closeSlashMenuInternal();
            }
            return;
          } else {
            closeSlashMenuInternal();
            return;
          }
        }
      }

      const textBefore = state.doc.textBetween(Math.max(0, from - 1), from, "\n");
      if (textBefore === "/") {
        slashStartPos.current = from - 1;
        setSlashQuery("");
        const coords = e.view.coordsAtPos(from);
        setSlashPos({
          top: coords.bottom + 6,        // used when opening downward
          left: coords.left,
          caretTop: coords.top - 6,      // used when opening upward (above the line)
        });
        setSlashOpen(true);
      }
    },
  });

  function closeSlashMenuInternal() {
    setSlashOpen(false);
    setSlashQuery("");
    slashStartPos.current = null;
    slashFromBubble.current = false;
  }

  useEffect(() => {
    if (!editor || !activeNote) return;
    const incoming = activeNote.content;
    lastSavedContent.current = incoming;
    editor.commands.setContent(incoming ? JSON.parse(incoming) : "");
    setBubblePos(null);
    setHasSelection(false);
    bubblePosRef.current = null;
    closeSlashMenuInternal();
    if (titleRef.current) {
      const isUntitled = /^Untitled-\d+$/.test(activeNote.title);
      titleRef.current.textContent = isUntitled ? "" : activeNote.title;
    }
  }, [activeNote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor || !activeNote) return;
    const incoming = activeNote.content;
    if (incoming === lastSavedContent.current) return;
    lastSavedContent.current = incoming;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(incoming ? JSON.parse(incoming) : "");
    try { editor.commands.setTextSelection({ from, to }); } catch { /**/ }
    if (titleRef.current) {
      const isUntitled = /^Untitled-\d+$/.test(activeNote.title);
      titleRef.current.textContent = isUntitled ? "" : activeNote.title;
    }
  }, [activeNote?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSaveComplete = useCallback((content: string) => {
    lastSavedContent.current = content;
  }, []);

  useAutoSave({ editor: editor ?? null, noteId: activeNote?.id ?? null, onSaveComplete });

  useEffect(() => {
    if (!slashOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); closeSlashMenu(); }
    }
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [slashOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeNote) return null;

  function closeSlashMenu() {
    closeSlashMenuInternal();
    editor?.commands.focus();
  }

  function handleTitleBlur() {
    if (!activeNote) return;
    const title = titleRef.current?.textContent?.trim() ?? "";
    if (!title) return;
    if (title !== activeNote.title) updateNote(activeNote.id, { title });
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
    if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); }
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      editor?.commands.focus("end");
      document.execCommand("paste");
    }
  }

  function handleTitlePaste(e: React.ClipboardEvent<HTMLHeadingElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const firstLine = text.split(/\r?\n/)[0].trim().slice(0, 80);
    document.execCommand("insertText", false, firstLine);
  }

  function handleEditorAreaClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editor) return;
    const tiptapEl = editorWrapRef.current?.querySelector(".tiptap");
    if (!tiptapEl) return;
    const lastChild = tiptapEl.lastElementChild;
    if (!lastChild) { editor.commands.focus("end"); return; }
    if (e.clientY > lastChild.getBoundingClientRect().bottom) {
      const lastNode = editor.state.doc.lastChild;
      const isEmpty = lastNode?.isTextblock && lastNode.content.size === 0;
      if (!isEmpty) {
        editor.chain().focus("end")
          .insertContentAt(editor.state.doc.content.size, { type: "paragraph" })
          .focus("end").run();
      } else {
        editor.commands.focus("end");
      }
    }
  }

  function handleSlashCommand(action: () => void) {
    if (!slashFromBubble.current && slashStartPos.current !== null && editor) {
      const from = slashStartPos.current;
      const to   = editor.state.selection.from;
      editor.chain().focus().deleteRange({ from, to }).run();
    }
    action();
    closeSlashMenuInternal();
  }

  function handleThreeDots() {
    const pos = bubblePosRef.current ?? bubblePos;
    if (!pos) return;
    slashFromBubble.current = true;
    slashStartPos.current = null;
    setSlashQuery("");
    setSlashPos({ top: pos.top + 52, left: pos.left, caretTop: pos.top });
    setTimeout(() => setSlashOpen(true), 0);
  }

  const isUntitled = /^Untitled-\d+$/.test(activeNote.title);

  return (
    <div className="flex flex-col h-full w-full">

      {/* ── Bubble menu ── */}
      {editor && hasSelection && bubblePos && (
        <div
          style={{ position: "fixed", top: bubblePos.top, left: bubblePos.left, zIndex: 40 }}
          className="
            flex items-center gap-0.5 px-1.5 py-1 rounded-lg
            bg-white dark:bg-zinc-800
            border border-zinc-200 dark:border-zinc-700
            shadow-xl
          "
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("button") === null) e.preventDefault();
          }}
        >
          <BubbleBtn onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")} title="Bold">
            <span className="font-bold text-sm">B</span>
          </BubbleBtn>
          <BubbleBtn onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")} title="Italic">
            <span className="italic text-sm">I</span>
          </BubbleBtn>
          <BubbleBtn onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")} title="Strikethrough">
            <span className="line-through text-sm">S</span>
          </BubbleBtn>
          <BubbleBtn onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")} title="Inline code">
            <span className="font-mono text-sm">{"<>"}</span>
          </BubbleBtn>
          <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-600 mx-0.5" />
          <button
            onClick={handleThreeDots}
            title="More commands"
            className="w-8 h-7 flex items-center justify-center rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors duration-75"
          >
            <span className="text-sm tracking-widest">···</span>
          </button>
        </div>
      )}

      {/* ── Editor surface ── */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="w-full mx-auto px-8 py-10 min-h-full max-w-2xl xl:max-w-3xl 2xl:max-w-4xl cursor-text"
          onClick={handleEditorAreaClick}
        >
          <h1
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            onPaste={handleTitlePaste}
            className="
              block w-full font-bold mb-8 outline-none
              text-zinc-900 dark:text-zinc-100
              empty:before:content-[attr(data-placeholder)]
              empty:before:text-zinc-300 dark:empty:before:text-zinc-600
              empty:before:pointer-events-none
            "
            style={{ fontSize: "3rem", lineHeight: 1.2 }}
            data-placeholder={isUntitled ? activeNote.title : "Untitled"}
          >
            {isUntitled ? "" : activeNote.title}
          </h1>

          <div ref={editorWrapRef}>
            <EditorContent
              editor={editor}
              className="text-zinc-800 dark:text-zinc-200 min-h-[60vh]"
            />
          </div>
        </div>
      </div>

      <StatusBar editor={editor ?? null} />
      {versionHistoryOpen && <VersionHistory noteId={activeNote.id} />}

      {slashOpen && editor && (
        <SlashMenu
          position={slashPos}
          editor={editor}
          query={slashQuery}
          onCommand={handleSlashCommand}
          onClose={closeSlashMenu}
        />
      )}
    </div>
  );
}

function BubbleBtn({ onClick, active, title, children }: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`
        w-8 h-7 flex items-center justify-center rounded-md
        transition-colors duration-75
        ${active
          ? "bg-zinc-200 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100"
          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
        }
      `}
    >
      {children}
    </button>
  );
}