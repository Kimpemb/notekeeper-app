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
// SlashMenu, BlockRefSuggest, and NoteLinkSuggest are portalled to document.body
// to escape the graph panel's overflow:hidden + backdropFilter.

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
import { NoteLinkSuggest } from "@/features/editor/components/Editor/NoteLinkSuggest";
import { createGraphSubPageNode } from "./GraphSubPageNode";
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
  const loadNoteContent = useNoteStore((s) => s.loadNoteContent);
  const isStaleContent  = useNoteStore((s) => s.staleContentIds.has(noteId));
  const spellCheck    = useAppSettings((s) => s.settings.spellCheck);

  // Fire loadNoteContent during render — before useEditor mounts — same
  // pattern as the main editor (Fix 4 from perf session). note.content at
  // this point is the meta-only placeholder so we must fetch it on demand.
  // This one-shot-at-mount check also catches the case where the note is
  // ALREADY marked stale at the moment this component mounts.
  const contentLoadFired = useRef(false);
  if (!contentLoadFired.current) {
    contentLoadFired.current = true;
    const raw = note?.content;
    const isEmpty = !raw || raw === "null" || raw === "" ||
                    raw === '{"type":"doc","content":[]}';
    if (isEmpty || isStaleContent) loadNoteContent(noteId);
  }

  // Separate from the mount-time check above: catches staleness that
  // happens WHILE this instance stays mounted (e.g. the main Editor tab
  // for the same note autosaves in the background). Uses its own
  // in-flight guard so it can fire again on a later staleness episode,
  // unlike the permanent one-shot above.
  const staleLoadInFlight = useRef(false);
  useEffect(() => {
    if (!isStaleContent) return;
    if (staleLoadInFlight.current) return;
    staleLoadInFlight.current = true;
    loadNoteContent(noteId).finally(() => {
      staleLoadInFlight.current = false;
    });
  }, [isStaleContent, noteId, loadNoteContent]);

  // ── Title editing ─────────────────────────────────────────────────────────
  const titleRef        = useRef<HTMLHeadingElement>(null);
  const titleFocusedRef = useRef(false);
  // Local title state — synced from store on mount/noteId change only.
  // Never updated from store while the user is actively typing.
  const [localTitle, setLocalTitle] = useState(note?.title ?? "");
  const lastNoteIdRef = useRef(noteId);

  // suppressSave starts true — flipped to false only after real content
  // has arrived and been synced into the editor. Prevents autosave from
  // writing the empty placeholder back to the DB.
  const suppressSave = useRef(true);

  // Sync local title when navigating to a different note
  useEffect(() => {
    if (lastNoteIdRef.current !== noteId) {
      lastNoteIdRef.current = noteId;
      setLocalTitle(note?.title ?? "");
      if (titleRef.current) {
        titleRef.current.textContent = note?.title ?? "";
      }
    }
  }, [noteId, note?.title]);

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

  // ── NoteLink suggest ([[ trigger) ─────────────────────────────────────────
  const [noteLinkOpen,  setNoteLinkOpen]  = useState(false);
  const [noteLinkPos,   setNoteLinkPos]   = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [noteLinkQuery, setNoteLinkQuery] = useState("");
  const noteLinkTriggerStart = useRef<number | null>(null);

  // ── Editor ────────────────────────────────────────────────────────────────
  const rawContent    = note?.content;
  const isContentEmpty = !rawContent || rawContent === "null" || rawContent === "" ||
                         rawContent === '{"type":"doc","content":[]}';
  const initialContent = !isContentEmpty ? JSON.parse(rawContent!) : "";

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
      TaskListSortExtension, createGraphSubPageNode(onOpenInEditor, onNavigateToNode),
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

      // ── NoteLink "[[ trigger ─────────────────────────────────────────────
      if (noteLinkTriggerStart.current !== null) {
        const triggerStart = noteLinkTriggerStart.current;
        if (from >= triggerStart + 2) {
          const textAfter = state.doc.textBetween(triggerStart + 2, from, "\n");
          if (!textAfter.includes("]") && !textAfter.includes("\n")) {
            setNoteLinkQuery(textAfter);
            return;
          }
        }
        closeNoteLink();
      }
      const textBefore2NL = from >= 2 ? state.doc.textBetween(from - 2, from, "\n") : "";
      if (textBefore2NL === "[[") {
        noteLinkTriggerStart.current = from - 2;
        setNoteLinkQuery("");
        const coords = e.view.coordsAtPos(from);
        setNoteLinkPos({ top: coords.bottom, left: coords.left });
        setNoteLinkOpen(true);
      }

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

  // ── idemora:content-updated ───────────────────────────────────────────────
  // Fired by useGraphEdit after writing a noteLink directly to the DB.
  // Reloads TipTap in-memory state so subsequent autosaves include the
  // injected link. suppressSave is set for the reload window.
  useEffect(() => {
    function handleContentUpdated(e: Event) {
      const { noteId: updatedId, content: freshContent } =
        (e as CustomEvent<{ noteId: string; content: string }>).detail;

      if (updatedId !== noteId || !editor) return;

      let parsed: unknown;
      try { parsed = JSON.parse(freshContent); } catch { return; }

      suppressSave.current = true;

      // emitUpdate: false prevents onUpdate from firing and re-triggering
      // the slash menu / link suggest logic from the injected noteLink node.
      editor.commands.setContent(parsed as import("@tiptap/core").Content, { emitUpdate: false });

      requestAnimationFrame(() => {
        suppressSave.current = false;
      });
    }

    window.addEventListener("idemora:content-updated", handleContentUpdated);
    return () => window.removeEventListener("idemora:content-updated", handleContentUpdated);
  }, [noteId, editor]);

  // Sync editor when loadNoteContent resolves — handles the case where
  // useEditor mounted with empty initialContent before the fetch returned.
 
useEffect(() => {
  if (!editor) return;
  const raw = note?.content;
  const isEmpty = !raw || raw === "null" || raw === "" ||
                  raw === '{"type":"doc","content":[]}';
  if (isEmpty) return;

  const doc = editor.getJSON();
  const isEditorEmpty =
    !doc.content ||
    doc.content.length === 0 ||
    (doc.content.length === 1 &&
     doc.content[0].type === "paragraph" &&
     (!doc.content[0].content || doc.content[0].content.length === 0));

  if (isEditorEmpty) {
    suppressSave.current = true;
    editor.commands.setContent(JSON.parse(raw), { emitUpdate: true });
    requestAnimationFrame(() => {
      suppressSave.current = false;
    });
  } else {
    suppressSave.current = false;
  }
}, [note?.content, editor]);

  // ── Autosave ──────────────────────────────────────────────────────────────
  const onSaveComplete = useCallback((_content: string, savedNoteId: string) => {
    if (!editor) return;
    syncBacklinks(savedNoteId, extractNoteLinkIds(editor), "graph-editor").catch(console.error);
  }, [editor]);

  useAutoSave({ editor: editor ?? null, noteId, isActiveTab: true, onSaveComplete, suppressSave });

  // ── Escape closes slash menu ──────────────────────────────────────────────
  useEffect(() => {
    if (!slashOpen) return;
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); closeSlash(); }
    }
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [slashOpen]);

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

  function closeNoteLink() {
    setNoteLinkOpen(false);
    setNoteLinkQuery("");
    noteLinkTriggerStart.current = null;
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
    setLocalTitle(title);
    updateNote(note.id, { title });
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      editor?.commands.focus("start");
    }
  }

  function handleTitleInput() {
    // Track local changes without touching the store — prevents re-render
    // from resetting the contenteditable while the user is mid-type.
    setLocalTitle(titleRef.current?.textContent ?? "");
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

  const isUntitled = /^Untitled-\d+$/.test(localTitle || note.title);

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
              onInput={handleTitleInput}
              onPaste={handleTitlePaste}
              data-placeholder={isUntitled ? (note.title || "Untitled") : "Untitled"}
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
              {isUntitled ? "" : localTitle || note.title}
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
            / for commands · (( to embed · [[ to link · click sub-page to open · Shift+click to graph
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

      {/* NoteLink suggest — portalled outside overflow:hidden panel */}
      {noteLinkOpen && editor && noteLinkTriggerStart.current !== null && createPortal(
        <NoteLinkSuggest
          position={noteLinkPos}
          editor={editor}
          query={noteLinkQuery}
          bracketStart={noteLinkTriggerStart.current}
          onClose={closeNoteLink}
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