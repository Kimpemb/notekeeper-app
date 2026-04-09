// src/features/graph/GraphNodeEditor.tsx
//
// Thin wrapper around the main editor core for use inside the graph panel.
// Renders title + body content with full editing power (slash menu, block refs,
// sub-pages, all extensions) but omits all the chrome that doesn't make sense
// in the graph context: OutlinePanel, BacklinksPanel, SimilarNotesPanel,
// ChatPanel, VersionHistory, StatusBar, FindReplace, FrontmatterEditor,
// SubPagesSection, AIActionBar, TagBar, bubble menu, task list toolbar,
// and all pane-awareness / isActiveTab logic.
//
// Autosave is always active — no pane gating needed here.
// Title is editable via a contenteditable h1, same as the main editor.
// SlashMenu and BlockRefSuggest are portalled to document.body to escape
// the graph panel's overflow:hidden + backdropFilter.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAutoSave } from "@/features/editor/hooks/useAutoSave";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import { syncBacklinks } from "@/features/notes/db/queries";
import { NoteLink } from "@/features/editor/components/Editor/NoteLink";
import { SlashMenu } from "@/features/editor/components/Editor/SlashMenu";
import { BlockRefSuggest } from "@/features/editor/components/Editor/BlockRefSuggest";
import { SubPageNode } from "@/features/editor/components/Editor/SubPageNode";
import { extractNoteLinkIds } from "@/features/editor/components/Editor/editorUtils";
import {
  pickImageFile, readImageFile, saveImage,
  pickAttachmentFile, readImageFile as readFileBytes, saveAttachment,
} from "@/lib/tauri/fs";
import {
  CodeBlock, Callout, CheckList, CheckItem,
  Toggle, ToggleSummary, ToggleBody,
  EditorTable, TableRow, TableHeader, TableCell,
  TaskItemExitExtension, ToggleKeyboardExtension,
  EmptyLinePlaceholderExtension, SlashPlaceholderExtension,
  OrderedListBackspaceExtension, CodeBlockSelectAllExtension,
  ListSelectAllExtension, CodeBlockBackspaceExtension,
  BlockIdExtension, BlockRefNode, DataviewNode,
  TaskListSortExtension, ImageExtension, AttachmentExtension,
  createFindReplaceShortcutExtension,
} from "@/features/editor/components/Editor/extensions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphNodeEditorProps {
  noteId:           string;
  onClose:          () => void;
  onNavigateToNode: (nodeId: string) => void;
  onOpenInEditor:   (nodeId: string) => void;
  canGoBack?:       boolean;
  canGoForward?:    boolean;
  onGoBack?:        () => void;
  onGoForward?:     () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL = "var(--color-text, #e2e2e2)";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function uploadImageFromDisk(): Promise<{ path: string; name: string } | null> {
  const filePath = await pickImageFile();
  if (!filePath) return null;
  const bytes      = await readImageFile(filePath);
  const fileName   = filePath.split(/[\\/]/).pop() ?? "image.png";
  const ext        = fileName.split(".").pop()?.toLowerCase() ?? "png";
  const base       = fileName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  const uniqueName = `${base}_${Date.now()}.${ext}`;
  const savedPath  = await saveImage(uniqueName, bytes);
  return { path: savedPath, name: fileName };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphNodeEditor({
  noteId,
  onClose,
  onNavigateToNode,
  onOpenInEditor,
  canGoBack    = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
}: GraphNodeEditorProps) {
  const note       = useNoteStore(useCallback((s) => s.notes.find((n) => n.id === noteId) ?? null, [noteId]));
  const notes      = useNoteStore((s) => s.notes);
  const updateNote = useNoteStore((s) => s.updateNote);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);
  const spellCheck    = useAppSettings((s) => s.settings.spellCheck);

  // ── Title editing ─────────────────────────────────────────────────────────
  const titleRef        = useRef<HTMLHeadingElement>(null);
  const titleFocusedRef = useRef(false);

  // ── Slash menu ────────────────────────────────────────────────────────────
  const [slashOpen,  setSlashOpen]  = useState(false);
  const [slashPos,   setSlashPos]   = useState<{ top: number; left: number; caretTop: number }>({ top: 0, left: 0, caretTop: 0 });
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartPos = useRef<number | null>(null);

  // ── BlockRef suggest ──────────────────────────────────────────────────────
  const [blockRefOpen,  setBlockRefOpen]  = useState(false);
  const [blockRefPos,   setBlockRefPos]   = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [blockRefQuery, setBlockRefQuery] = useState("");
  const blockRefTriggerStart = useRef<number | null>(null);

  // ── Editor ────────────────────────────────────────────────────────────────
  const initialContent = note?.content ? JSON.parse(note.content) : "";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock, Callout, CheckList, CheckItem,
      EditorTable, TableRow, TableHeader, TableCell,
      ToggleSummary, ToggleBody, Toggle,
      ImageExtension, AttachmentExtension,
      TaskItemExitExtension, ToggleKeyboardExtension,
      CodeBlockSelectAllExtension, CodeBlockBackspaceExtension,
      ListSelectAllExtension, SlashPlaceholderExtension,
      EmptyLinePlaceholderExtension, OrderedListBackspaceExtension,
      TaskListSortExtension, SubPageNode,
      BlockIdExtension, BlockRefNode, DataviewNode,
      NoteLink.configure({ onNavigate: setActiveNote }),
      createFindReplaceShortcutExtension(() => {}),
      Extension.create({ name: "findReplacePlugin",     addProseMirrorPlugins() { return []; } }),
      Extension.create({ name: "searchHighlightPlugin", addProseMirrorPlugins() { return []; } }),
    ],
    content:   initialContent,
    autofocus: false,
    editorProps: {
      attributes: {
        class:      "tiptap outline-none",
        spellcheck: String(spellCheck),
      },
    },
    onUpdate: ({ editor: e }) => {
      const { state } = e;
      const { from }  = state.selection;

      // ── BlockRef "((" trigger ─────────────────────────────────────────────
      if (blockRefTriggerStart.current !== null) {
        const triggerStart = blockRefTriggerStart.current;
        if (from >= triggerStart + 2) {
          const textAfter = state.doc.textBetween(triggerStart + 2, from, "\n");
          if (!textAfter.includes(")") && !textAfter.includes("\n")) {
            setBlockRefQuery(textAfter);
            return;
          }
        }
        closeBlockRef();
      }
      const textBefore2 = from >= 2 ? state.doc.textBetween(from - 2, from, "\n") : "";
      if (textBefore2 === "((") {
        blockRefTriggerStart.current = from - 2;
        setBlockRefQuery("");
        const coords = e.view.coordsAtPos(from);
        setBlockRefPos({ top: coords.bottom, left: coords.left });
        setBlockRefOpen(true);
      }

      // ── Slash trigger ─────────────────────────────────────────────────────
      if (slashStartPos.current !== null) {
        const slashStart = slashStartPos.current;
        if (from >= slashStart) {
          const textAfterSlash = state.doc.textBetween(slashStart, from, "\n");
          if (textAfterSlash.startsWith("/")) {
            setSlashQuery(textAfterSlash.slice(1));
            if (textAfterSlash.includes(" ")) closeSlash();
            return;
          } else {
            closeSlash();
            return;
          }
        }
      }
      const textBefore1 = from >= 1 ? state.doc.textBetween(from - 1, from, "\n") : "";
      if (textBefore1 === "/") {
        slashStartPos.current = from - 1;
        setSlashQuery("");
        const coords = e.view.coordsAtPos(from);
        setSlashPos({ top: coords.bottom + 6, left: coords.left, caretTop: coords.top - 6 });
        setSlashOpen(true);
      }
    },
  });

  // ── Wire subPage storage ──────────────────────────────────────────────────
  // SubPageNode reads parentNoteId to create children under the right note.
  // onNavigate / onOpenInEditor hook into graph navigation on click.
  useEffect(() => {
    if (!editor) return;
    const s = editor.storage as unknown as Record<string, {
      parentNoteId:    string;
      paneId:          1 | 2;
      onNavigate?:     (id: string) => void;
      onOpenInEditor?: (id: string) => void;
    }>;
    if (s["subPage"]) {
      s["subPage"].parentNoteId   = noteId;
      s["subPage"].paneId         = 1;
      s["subPage"].onNavigate     = onNavigateToNode;
      s["subPage"].onOpenInEditor = onOpenInEditor;
    }
  }, [editor, noteId, onNavigateToNode, onOpenInEditor]);

  // ── Autosave ──────────────────────────────────────────────────────────────
  const onSaveComplete = useCallback((_content: string, savedNoteId: string) => {
    if (!editor) return;
    syncBacklinks(savedNoteId, extractNoteLinkIds(editor)).catch(console.error);
  }, [editor]);

  useAutoSave({ editor: editor ?? null, noteId, isActiveTab: true, onSaveComplete });

  // ── Escape closes slash menu ──────────────────────────────────────────────
  useEffect(() => {
    if (!slashOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); closeSlash(); }
    }
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [slashOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close helpers ─────────────────────────────────────────────────────────

  function closeSlash() {
    setSlashOpen(false);
    setSlashQuery("");
    slashStartPos.current = null;
  }

  function closeBlockRef() {
    setBlockRefOpen(false);
    setBlockRefQuery("");
    blockRefTriggerStart.current = null;
  }

  // ── Slash command handler ─────────────────────────────────────────────────

  function handleSlashCommand(action: () => void) {
    if (slashStartPos.current !== null && editor) {
      editor.chain().focus()
        .deleteRange({ from: slashStartPos.current, to: editor.state.selection.from })
        .run();
    }
    action();
    closeSlash();
  }

  function handleSubPageCreate() {
    if (!editor) return;
    const pattern = /^Untitled-(\d+)$/;
    const used    = new Set<number>();
    for (const n of notes) {
      const m = n.title.match(pattern);
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 1;
    while (used.has(n)) n++;

    const s = editor.storage as unknown as Record<string, { parentNoteId: string; paneId: 1 | 2 }>;
    if (s["subPage"]) {
      s["subPage"].parentNoteId = noteId;
      s["subPage"].paneId       = 1;
    }

    const chain = editor.chain().focus();
    if (slashStartPos.current !== null) {
      chain.deleteRange({ from: slashStartPos.current, to: editor.state.selection.from });
    }
    chain.insertContent([
      { type: "subPage", attrs: { noteId: null, title: `Untitled-${n}`, mode: "editing" } },
      { type: "paragraph" },
    ]).run();

    closeSlash();
  }

  // ── Upload handlers ───────────────────────────────────────────────────────

  async function handleImageUpload() {
    if (!editor) return;
    const result = await uploadImageFromDisk();
    if (!result) return;
    editor.chain().focus().insertContent({
      type: "image",
      attrs: { src: result.path, alt: result.name, width: null, align: "left" },
    }).run();
  }

  async function handleAttachmentUpload(kind: "pdf" | "audio") {
    if (!editor) return;
    const filePath = await pickAttachmentFile();
    if (!filePath) return;
    const bytes      = await readFileBytes(filePath);
    const fileName   = filePath.split(/[\\/]/).pop() ?? "file";
    const ext        = fileName.split(".").pop()?.toLowerCase() ?? "";
    const base       = fileName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
    const uniqueName = `${base}_${Date.now()}.${ext}`;
    const savedPath  = await saveAttachment(uniqueName, bytes);
    editor.chain().focus().insertContent({
      type: "attachment",
      attrs: { src: savedPath, filename: fileName, kind, size: bytes.length },
    }).run();
  }

  // ── Title handlers ────────────────────────────────────────────────────────

  function handleTitleFocus() { titleFocusedRef.current = true; }

  function handleTitleBlur() {
    titleFocusedRef.current = false;
    if (!note) return;
    const title = titleRef.current?.textContent?.trim() ?? "";
    if (!title || title === note.title) return;
    updateNote(note.id, { title });
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      editor?.commands.focus("start");
    }
  }

  function handleTitlePaste(e: React.ClipboardEvent<HTMLHeadingElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text.split(/\r?\n/)[0].trim().slice(0, 80));
  }

  // ── Click below content → append empty paragraph ─────────────────────────

  function handleEditorAreaClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!editor) return;
    const tiptapEl = e.currentTarget.querySelector(".tiptap");
    if (!tiptapEl) return;
    const lastChild = tiptapEl.lastElementChild;
    if (!lastChild) { editor.commands.focus("end"); return; }
    if (e.clientY > lastChild.getBoundingClientRect().bottom) {
      const lastNode = editor.state.doc.lastChild;
      const isEmpty  = lastNode?.isTextblock && lastNode.content.size === 0;
      if (!isEmpty) {
        editor.chain().focus("end")
          .insertContentAt(editor.state.doc.content.size, { type: "paragraph" })
          .focus("end").run();
      } else {
        editor.commands.focus("end");
      }
    }
  }

  if (!note) return null;

  const isUntitled = /^Untitled-\d+$/.test(note.title);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* ── Title bar ── */}
        <div style={{
          padding:      "10px 14px 8px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink:   0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            {canGoBack && (
              <button onClick={onGoBack} title="Go back" style={navBtnStyle}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 2L4 7l5 5" stroke={LABEL} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {canGoForward && (
              <button onClick={onGoForward} title="Go forward" style={navBtnStyle}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 2l5 5-5 5" stroke={LABEL} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}

            <h1
              ref={titleRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onFocus={handleTitleFocus}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              onPaste={handleTitlePaste}
              data-placeholder={isUntitled ? note.title : "Untitled"}
              style={{
                flex:         1,
                margin:       0,
                fontSize:     15,
                fontWeight:   700,
                lineHeight:   1.3,
                color:        LABEL,
                outline:      "none",
                whiteSpace:   "nowrap",
                overflow:     "hidden",
                textOverflow: "ellipsis",
                cursor:       "text",
                opacity:      0.9,
              }}
            >
              {isUntitled ? "" : note.title}
            </h1>
          </div>
          <span style={{ fontSize: 10, color: LABEL, opacity: 0.28 }}>
            Editing · changes save automatically
          </span>
        </div>

        {/* ── Scrollable body ── */}
        <div
          style={{ flex: 1, overflowY: "auto", padding: "12px 16px 32px", minHeight: 0 }}
          onClick={handleEditorAreaClick}
        >
          <style>{`
            .graph-editor-wrap .tiptap {
              font-size:   13px;
              line-height: 1.75;
              color:       ${LABEL};
              min-height:  120px;
              outline:     none;
            }
            .graph-editor-wrap .tiptap p         { margin: 0 0 4px; }
            .graph-editor-wrap .tiptap h1         { font-size: 18px; font-weight: 700; margin: 12px 0 4px; color: ${LABEL}; }
            .graph-editor-wrap .tiptap h2         { font-size: 15px; font-weight: 600; margin: 10px 0 3px; color: ${LABEL}; }
            .graph-editor-wrap .tiptap h3         { font-size: 13px; font-weight: 600; margin: 8px 0 3px;  color: ${LABEL}; }
            .graph-editor-wrap .tiptap ul,
            .graph-editor-wrap .tiptap ol         { padding-left: 18px; margin: 0 0 4px; }
            .graph-editor-wrap .tiptap li         { margin-bottom: 2px; }
            .graph-editor-wrap .tiptap code       { background: rgba(255,255,255,0.08); border-radius: 3px; padding: 1px 4px; font-size: 12px; font-family: monospace; }
            .graph-editor-wrap .tiptap blockquote { border-left: 2px solid rgba(255,255,255,0.15); margin: 4px 0; padding-left: 10px; opacity: 0.7; }
            .graph-editor-wrap .tiptap a          { color: #6366f1; text-decoration: underline; }
            .graph-editor-wrap .tiptap .note-link { color: #6366f1; text-decoration: none; cursor: pointer; }
            .graph-editor-wrap .tiptap .note-link:hover { text-decoration: underline; }
            .graph-editor-wrap .tiptap [data-placeholder]::before {
              content: attr(data-placeholder);
              color: rgba(255,255,255,0.2);
              pointer-events: none;
              position: absolute;
            }
          `}</style>
          <div className="graph-editor-wrap">
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding:    "6px 14px",
          borderTop:  "1px solid rgba(255,255,255,0.05)",
          flexShrink: 0,
          display:    "flex",
          alignItems: "center",
          gap:        8,
        }}>
          <button
            onClick={onClose}
            style={{
              background:   "transparent",
              border:       "1px solid rgba(255,255,255,0.1)",
              borderRadius: 5,
              padding:      "4px 10px",
              fontSize:     10,
              color:        LABEL,
              opacity:      0.45,
              cursor:       "pointer",
              transition:   "opacity 120ms",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0.45")}
          >
            ← Back to detail
          </button>
          <span style={{ fontSize: 10, color: LABEL, opacity: 0.2 }}>
            / for commands · (( to embed · click sub-page to open · Shift+click to graph
          </span>
        </div>
      </div>

      {/* Slash menu — portalled outside overflow:hidden panel */}
      {slashOpen && editor && createPortal(
        <SlashMenu
          position={slashPos}
          editor={editor}
          query={slashQuery}
          noteId={noteId}
          paneId={1}
          onCommand={handleSlashCommand}
          onClose={closeSlash}
          onImageUpload={handleImageUpload}
          onAttachmentUpload={handleAttachmentUpload}
          onSubPageCreate={handleSubPageCreate}
        />,
        document.body,
      )}

      {/* BlockRef suggest — portalled outside overflow:hidden panel */}
      {blockRefOpen && editor && blockRefTriggerStart.current !== null && createPortal(
        <BlockRefSuggest
          position={blockRefPos}
          editor={editor}
          query={blockRefQuery}
          triggerStart={blockRefTriggerStart.current}
          onClose={closeBlockRef}
        />,
        document.body,
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const navBtnStyle: React.CSSProperties = {
  background:   "transparent",
  border:       "none",
  cursor:       "pointer",
  padding:      4,
  borderRadius: 4,
  opacity:      0.5,
  transition:   "opacity 120ms",
  display:      "flex",
  alignItems:   "center",
  flexShrink:   0,
};