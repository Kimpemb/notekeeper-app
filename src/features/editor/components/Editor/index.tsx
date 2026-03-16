// src/features/editor/components/Editor/index.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAutoSave } from "@/features/editor/hooks/useAutoSave";
import { syncBacklinks } from "@/features/notes/db/queries";
import { NoteLink } from "./NoteLink";
import { NoteLinkSuggest } from "./NoteLinkSuggest";
import { BacklinksPanel } from "./BacklinksPanel";
import { OutlinePanel } from "./OutlinePanel";
import { StatusBar } from "./StatusBar";
import { VersionHistory } from "./VersionHistory";
import { SlashMenu } from "./SlashMenu";
import { FindReplace, buildFindReplacePlugin } from "./FindReplace";
import { TableToolbar } from "./TableToolbar";
import {
  CodeBlock,
  Callout,
  CheckList,
  CheckItem,
  Toggle,
  ToggleSummary,
  ToggleBody,
  EditorTable,
  TableRow,
  TableHeader,
  TableCell,
  TaskItemExitExtension,
  ToggleKeyboardExtension,
  EmptyLinePlaceholderExtension,
  SlashPlaceholderExtension,
  OrderedListBackspaceExtension,
  CodeBlockSelectAllExtension,
  createFindReplaceShortcutExtension,
  ImageExtension,
} from "./extensions";
import { extractNoteLinkIds, scrollToHeadingText } from "./editorUtils";
import { pickImageFile, readImageFile, saveImage } from "@/lib/tauri/fs";

interface BubblePos { top: number; left: number; }

// ── Upload helper (used by slash menu) ───────────────────────────────────────
async function uploadImageFromDisk(): Promise<{ path: string; name: string } | null> {
  const filePath = await pickImageFile();
  if (!filePath) return null;
  const bytes    = await readImageFile(filePath);
  const fileName = filePath.split(/[\\/]/).pop() ?? "image.png";
  const ext      = fileName.split(".").pop()?.toLowerCase() ?? "png";
  const base     = fileName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  const uniqueName = `${base}_${Date.now()}.${ext}`;
  const savedPath  = await saveImage(uniqueName, bytes);
  return { path: savedPath, name: fileName };
}

export function Editor() {
  const activeNote              = useNoteStore((s) => s.activeNote());
  const updateNote              = useNoteStore((s) => s.updateNote);
  const setActiveNote           = useNoteStore((s) => s.setActiveNote);
  const versionHistoryOpen      = useUIStore((s) => s.versionHistoryOpen);
  const backlinksOpen           = useUIStore((s) => s.backlinksOpen);
  const toggleBacklinks         = useUIStore((s) => s.toggleBacklinks);
  const outlineOpen             = useUIStore((s) => s.outlineOpen);
  const toggleOutline           = useUIStore((s) => s.toggleOutline);
  const pendingScrollHeading    = useUIStore((s) => s.pendingScrollHeading);
  const setPendingScrollHeading = useUIStore((s) => s.setPendingScrollHeading);

  const titleRef         = useRef<HTMLHeadingElement>(null);
  const lastSavedContent = useRef<string | null>(null);
  const editorWrapRef    = useRef<HTMLDivElement>(null);

  // ── Bubble menu ──────────────────────────────────────────────────────────
  const [bubblePos, setBubblePos]       = useState<BubblePos | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const bubblePosRef                    = useRef<BubblePos | null>(null);
  const slashFromBubble                 = useRef(false);

  // ── Slash menu ───────────────────────────────────────────────────────────
  const [slashOpen, setSlashOpen]   = useState(false);
  const [slashPos, setSlashPos]     = useState<{ top: number; left: number; caretTop: number }>({ top: 0, left: 0, caretTop: 0 });
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartPos               = useRef<number | null>(null);

  // ── Note link suggest ────────────────────────────────────────────────────
  const [linkOpen, setLinkOpen]   = useState(false);
  const [linkPos, setLinkPos]     = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [linkQuery, setLinkQuery] = useState("");
  const linkBracketStart          = useRef<number | null>(null);

  // ── Find & Replace ───────────────────────────────────────────────────────
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const openFindReplaceRef = useRef<() => void>(() => setFindReplaceOpen(true));
  openFindReplaceRef.current = () => setFindReplaceOpen(true);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock,
      Callout,
      CheckList,
      CheckItem,
      // Table — registered before toggle nodes to avoid any schema ordering issues
      EditorTable,
      TableRow,
      TableHeader,
      TableCell,
      // Toggle nodes — ToggleSummary and ToggleBody must be registered before Toggle
      ToggleSummary,
      ToggleBody,
      Toggle,
      // Keyboard handlers
      TaskItemExitExtension,
      ToggleKeyboardExtension,
      CodeBlockSelectAllExtension,
      SlashPlaceholderExtension,
      EmptyLinePlaceholderExtension,
      OrderedListBackspaceExtension,
      NoteLink.configure({ onNavigate: setActiveNote }),
      createFindReplaceShortcutExtension(() => openFindReplaceRef.current()),
      Extension.create({
        name: "findReplacePlugin",
        addProseMirrorPlugins() { return [buildFindReplacePlugin()]; },
      }),
      // Image — paste, drop, and NodeView all handled inside the extension
      ImageExtension,
    ],
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
      const { from, to, $from } = e.state.selection;
      if (from === to) {
        setHasSelection(false); setBubblePos(null); bubblePosRef.current = null; return;
      }
      // Suppress bubble menu for image node selections and table selections
      const selectedNodeType = $from.nodeAfter?.type.name ?? "";
      const insideTable = (() => { for (let d = $from.depth; d > 0; d--) { if ($from.node(d).type.name === "table") return true; } return false; })();
      if (selectedNodeType === "image" || insideTable) {
        setHasSelection(false); setBubblePos(null); bubblePosRef.current = null; return;
      }
      const coords = e.view.coordsAtPos(from);
      const pos = { top: coords.top - 48, left: coords.left };
      setHasSelection(true); setBubblePos(pos); bubblePosRef.current = pos;
    },
    onUpdate: ({ editor: e }) => {
      const { state } = e;
      const { from }  = state.selection;

      if (slashStartPos.current !== null && !slashFromBubble.current) {
        const slashStart = slashStartPos.current;
        if (from >= slashStart) {
          const textAfterSlash = state.doc.textBetween(slashStart, from, "\n");
          if (textAfterSlash.startsWith("/")) {
            setSlashQuery(textAfterSlash.slice(1));
            if (textAfterSlash.includes(" ")) closeSlashMenuInternal();
            return;
          } else { closeSlashMenuInternal(); return; }
        }
      }

      if (linkBracketStart.current !== null) {
        const bracketStart = linkBracketStart.current;
        if (from >= bracketStart + 2) {
          const textAfter = state.doc.textBetween(bracketStart + 2, from, "\n");
          if (!textAfter.includes("]") && !textAfter.includes("\n")) {
            setLinkQuery(textAfter); return;
          }
        }
        closeLinkSuggestInternal();
      }

      const textBefore2 = from >= 2 ? state.doc.textBetween(from - 2, from, "\n") : "";
      const textBefore1 = from >= 1 ? state.doc.textBetween(from - 1, from, "\n") : "";

      if (textBefore2 === "[[") {
        linkBracketStart.current = from - 2;
        setLinkQuery("");
        const coords = e.view.coordsAtPos(from);
        setLinkPos({ top: coords.bottom, left: coords.left });
        setLinkOpen(true);
        return;
      }

      if (textBefore1 === "/") {
        slashStartPos.current = from - 1;
        setSlashQuery("");
        const coords = e.view.coordsAtPos(from);
        setSlashPos({ top: coords.bottom + 6, left: coords.left, caretTop: coords.top - 6 });
        setSlashOpen(true);
      }
    },
  });

  function closeSlashMenuInternal() {
    setSlashOpen(false); setSlashQuery(""); slashStartPos.current = null; slashFromBubble.current = false;
  }
  function closeLinkSuggestInternal() {
    setLinkOpen(false); setLinkQuery(""); linkBracketStart.current = null;
  }

  // ── Note switch: load content ─────────────────────────────────────────────
  useEffect(() => {
    if (!editor || !activeNote) return;
    const incoming = activeNote.content;
    lastSavedContent.current = incoming;
    editor.commands.setContent(incoming ? JSON.parse(incoming) : "");
    setBubblePos(null); setHasSelection(false); bubblePosRef.current = null;
    closeSlashMenuInternal(); closeLinkSuggestInternal();
    if (titleRef.current) {
      const isUntitled = /^Untitled-\d+$/.test(activeNote.title);
      titleRef.current.textContent = isUntitled ? "" : activeNote.title;
    }
  }, [activeNote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pending scroll ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor || !activeNote || !pendingScrollHeading) return;
    const timer = setTimeout(() => {
      const success = scrollToHeadingText(editor, pendingScrollHeading);
      if (success) setPendingScrollHeading(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [activeNote?.id, pendingScrollHeading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── External content update (version restore) ────────────────────────────
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

  const onSaveComplete = useCallback((content: string, noteId: string) => {
    lastSavedContent.current = content;
    if (!editor) return;
    syncBacklinks(noteId, extractNoteLinkIds(editor)).catch(console.error);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  useAutoSave({ editor: editor ?? null, noteId: activeNote?.id ?? null, onSaveComplete });

  // ── Escape closes slash menu ──────────────────────────────────────────────
  useEffect(() => {
    if (!slashOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); closeSlashMenu(); }
    }
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [slashOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "b") {
        e.preventDefault(); toggleBacklinks();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "o") {
        e.preventDefault(); toggleOutline();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "h" && !e.shiftKey) {
        const inEditor = (e.target as HTMLElement).closest(".tiptap") !== null;
        if (!inEditor) { e.preventDefault(); setFindReplaceOpen(true); }
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [toggleBacklinks, toggleOutline]);

  if (!activeNote) return null;

  function closeSlashMenu() { closeSlashMenuInternal(); editor?.commands.focus(); }
  function closeLinkSuggest() { closeLinkSuggestInternal(); editor?.commands.focus(); }

  function handleTitleBlur() {
    if (!activeNote) return;
    const title = titleRef.current?.textContent?.trim() ?? "";
    if (!title || title === activeNote.title) return;
    updateNote(activeNote.id, { title });
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
    if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); }
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); editor?.commands.focus("end"); document.execCommand("paste");
    }
  }

  function handleTitlePaste(e: React.ClipboardEvent<HTMLHeadingElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text.split(/\r?\n/)[0].trim().slice(0, 80));
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
        editor.chain().focus("end").insertContentAt(editor.state.doc.content.size, { type: "paragraph" }).focus("end").run();
      } else {
        editor.commands.focus("end");
      }
    }
  }

  function handleSlashCommand(action: () => void) {
    if (!slashFromBubble.current && slashStartPos.current !== null && editor) {
      editor.chain().focus().deleteRange({ from: slashStartPos.current, to: editor.state.selection.from }).run();
    }
    action(); closeSlashMenuInternal();
  }

  // ── Image upload action (called from slash menu) ──────────────────────────
  async function handleImageUpload() {
    if (!editor) return;
    const result = await uploadImageFromDisk();
    if (!result) return;
    editor.chain().focus().insertContent({
      type: "image",
      attrs: { src: result.path, alt: result.name, width: null, align: "left" },
    }).run();
  }

  function handleThreeDots() {
    const pos = bubblePosRef.current ?? bubblePos;
    if (!pos) return;
    slashFromBubble.current = true; slashStartPos.current = null; setSlashQuery("");
    setSlashPos({ top: pos.top + 52, left: pos.left, caretTop: pos.top });
    setTimeout(() => setSlashOpen(true), 0);
  }

  const isUntitled = /^Untitled-\d+$/.test(activeNote.title);

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex flex-col flex-1 h-full overflow-hidden">

        {findReplaceOpen && editor && (
          <FindReplace
            editor={editor}
            onClose={() => { setFindReplaceOpen(false); editor.commands.focus(); }}
          />
        )}

        {/* Top-right panel toggles */}
        <div className="absolute top-15 right-3 z-30 flex items-center gap-1.5">
          <button
            onClick={toggleOutline}
            title="Toggle outline (Ctrl+Shift+O)"
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all duration-150 border ${
              outlineOpen
                ? "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 shadow-sm"
                : "bg-white dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 2.5h8M1.5 5h5.5M1.5 7.5h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Outline
          </button>
          <button
            onClick={toggleBacklinks}
            title="Toggle backlinks (Ctrl+Shift+B)"
            className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all duration-150 border ${
              backlinksOpen
                ? "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 shadow-sm"
                : "bg-white dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M8 3H4a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M6 1h4v4M10 1L6.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Backlinks
          </button>
        </div>

        {/* Bubble menu */}
        {editor && hasSelection && bubblePos && (
          <div
            style={{ position: "fixed", top: bubblePos.top, left: bubblePos.left, zIndex: 40 }}
            className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl"
            onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button") === null) e.preventDefault(); }}
          >
            <BubbleBtn onClick={() => editor.chain().focus().toggleBold().run()}   active={editor.isActive("bold")}   title="Bold"><span className="font-bold text-sm">B</span></BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><span className="italic text-sm">I</span></BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough"><span className="line-through text-sm">S</span></BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleCode().run()}   active={editor.isActive("code")}   title="Inline code"><span className="font-mono text-sm">{"<>"}</span></BubbleBtn>
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

        <div className="flex-1 overflow-y-auto">
          <div
            className="w-full mx-auto px-8 py-6 min-h-full max-w-2xl xl:max-w-3xl 2xl:max-w-4xl cursor-text"
            onClick={handleEditorAreaClick}
          >
            <h1
              ref={titleRef}
              contentEditable suppressContentEditableWarning spellCheck={false}
              autoCorrect="off" autoCapitalize="off"
              onBlur={handleTitleBlur} onKeyDown={handleTitleKeyDown} onPaste={handleTitlePaste}
              className="block w-full font-bold mb-6 outline-none text-zinc-900 dark:text-zinc-100 empty:before:content-[attr(data-placeholder)] empty:before:text-zinc-300 dark:empty:before:text-zinc-600 empty:before:pointer-events-none"
              style={{ fontSize: "3rem", lineHeight: 1.2 }}
              data-placeholder={isUntitled ? activeNote.title : "Untitled"}
            >
              {isUntitled ? "" : activeNote.title}
            </h1>
            <div key={activeNote.id} ref={editorWrapRef}>
              <EditorContent editor={editor} className="text-zinc-800 dark:text-zinc-200 min-h-[60vh]" />
            </div>
          </div>
        </div>

        <StatusBar editor={editor ?? null} />
        {versionHistoryOpen && <VersionHistory noteId={activeNote.id} />}
      </div>

      {outlineOpen   && editor && <OutlinePanel editor={editor} />}
      {backlinksOpen && <BacklinksPanel noteId={activeNote.id} />}

      {/* Table toolbar — floats above the active table */}
      {editor && <TableToolbar editor={editor} />}

      {slashOpen && editor && (
        <SlashMenu
          position={slashPos}
          editor={editor}
          query={slashQuery}
          onCommand={handleSlashCommand}
          onClose={closeSlashMenu}
          onImageUpload={handleImageUpload}
        />
      )}
      {linkOpen && editor && linkBracketStart.current !== null && (
        <NoteLinkSuggest position={linkPos} editor={editor} query={linkQuery} bracketStart={linkBracketStart.current} onClose={closeLinkSuggest} />
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
      className={`w-8 h-7 flex items-center justify-center rounded-md transition-colors duration-75 ${
        active
          ? "bg-zinc-200 dark:bg-zinc-600 text-zinc-900 dark:text-zinc-100"
          : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </button>
  );
}