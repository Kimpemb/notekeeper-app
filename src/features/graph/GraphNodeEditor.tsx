// src/features/graph/GraphNodeEditor.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAutoSave } from "@/features/editor/hooks/useAutoSave";
import { getNoteById } from "@/features/notes/db/queries";
import { NoteLink } from "@/features/editor/components/Editor/NoteLink";
import { syncBacklinks } from "@/features/notes/db/queries";
import { extractNoteLinkIds } from "@/features/editor/components/Editor/editorUtils";
import { createGraphSubPageNode } from "@/features/graph/GraphSubPageNode";
import { SlashMenu } from "@/features/editor/components/Editor/SlashMenu";
import { BlockRefSuggest } from "@/features/editor/components/Editor/BlockRefSuggest";
import {
  pickImageFile, readImageFile, saveImage,
  pickAttachmentFile, readImageFile as readFileBytes, saveAttachment,
} from "@/lib/tauri/fs";

import {
  CodeBlock, Callout, CheckList, CheckItem, Toggle, ToggleSummary, ToggleBody,
  EditorTable, TableRow, TableHeader, TableCell,
  TaskItemExitExtension, ToggleKeyboardExtension, EmptyLinePlaceholderExtension,
  SlashPlaceholderExtension, OrderedListBackspaceExtension, CodeBlockSelectAllExtension,
  ListSelectAllExtension, CodeBlockBackspaceExtension, BlockIdExtension, BlockRefNode,
  DataviewNode, TaskListSortExtension, ImageExtension, AttachmentExtension,
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

const LABEL            = "var(--color-text, #e2e2e2)";
const INIT_SUPPRESS_MS = 400;

// ─── Image / attachment upload helpers ────────────────────────────────────────

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

// ─── Inner editor ─────────────────────────────────────────────────────────────

interface EditorInnerProps {
  noteId:           string;
  initialContent:   any;
  incomingNoteId:   string;
  incomingContent:  any;
  onClose:          () => void;
  onNavigateToNode: (nodeId: string) => void;
  onOpenInEditor:   (nodeId: string) => void;
  // Slash menu — lifted to outer shell so the portal renders there
  onSlashOpenChange: (open: boolean, pos?: { top: number; left: number; caretTop: number }, query?: string) => void;
  onSlashQueryChange: (query: string) => void;
  onSlashClose: () => void;
  slashStartPosRef: React.MutableRefObject<number | null>;
  // BlockRef suggest — also lifted to outer shell for portal rendering
  onBlockRefOpenChange: (open: boolean, pos?: { top: number; left: number }, query?: string, triggerStart?: number) => void;
  onBlockRefClose: () => void;
  blockRefStartPosRef: React.MutableRefObject<number | null>;
  // Pass editor instance up to outer shell
  onEditorReady: (editor: any) => void;
}

function EditorInner({
  noteId: initialNoteId,
  initialContent,
  incomingNoteId,
  incomingContent,
  onClose,
  onNavigateToNode,
  onOpenInEditor,
  onSlashOpenChange,
  onSlashQueryChange,
  onSlashClose,
  slashStartPosRef,
  onBlockRefOpenChange,
  onBlockRefClose,
  blockRefStartPosRef,
  onEditorReady,
}: EditorInnerProps) {
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  const lastSavedContent = useRef<string | null>(null);
  const initDoneRef      = useRef(false);
  const currentNoteIdRef = useRef<string>(initialNoteId);
  const [liveNoteId, setLiveNoteId] = useState(initialNoteId);

  // ── Stable callback ref ───────────────────────────────────────────────────
  const callbacksRef = useRef({ onNavigateToNode, onOpenInEditor });
  useEffect(() => {
    callbacksRef.current = { onNavigateToNode, onOpenInEditor };
  });

  // ── GraphSubPageNode — created exactly once ───────────────────────────────
  const graphSubPageNode = useMemo(
    () =>
      createGraphSubPageNode(
        (id) => callbacksRef.current.onOpenInEditor(id),
        (id) => callbacksRef.current.onNavigateToNode(id),
      ),
    [],
  );

  // ── useEditor ─────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock, Callout, CheckList, CheckItem, EditorTable, TableRow, TableHeader, TableCell,
      ToggleSummary, ToggleBody, Toggle, ImageExtension, AttachmentExtension,
      TaskItemExitExtension, ToggleKeyboardExtension, CodeBlockSelectAllExtension,
      CodeBlockBackspaceExtension, ListSelectAllExtension, SlashPlaceholderExtension,
      EmptyLinePlaceholderExtension, OrderedListBackspaceExtension, TaskListSortExtension,
      BlockIdExtension, BlockRefNode, DataviewNode,
      graphSubPageNode,
      NoteLink.configure({ onNavigate: setActiveNote }),
      createFindReplaceShortcutExtension(() => {}),
      Extension.create({ name: "noopFindReplace", addProseMirrorPlugins() { return []; } }),
    ],
    content:   initialContent,
    autofocus: true,
    editorProps: {
      attributes: { class: "tiptap outline-none", spellcheck: "true" },
    },
    onUpdate: ({ editor: e }) => {
      const { state } = e;
      const { from }  = state.selection;

      // ── BlockRef trigger: detect "((" ─────────────────────────────────────
      // Check this BEFORE the slash logic so both can coexist cleanly.
      if (blockRefStartPosRef.current !== null) {
        const bStart = blockRefStartPosRef.current;
        if (from >= bStart) {
          const textSince = state.doc.textBetween(bStart, from, "\n");
          if (textSince.startsWith("((")) {
            // Still inside a block ref trigger — update query
            const q = textSince.slice(2); // everything after "(("
            if (!q.includes(" ") && !q.includes("\n")) {
              onBlockRefOpenChange(true, undefined, q, bStart);
              return;
            }
          }
          // Trigger string broken — close
          onBlockRefClose();
        }
      } else {
        // Check whether the last two characters just typed are "(("
        if (from >= 2) {
          const lastTwo = state.doc.textBetween(from - 2, from, "\n");
          if (lastTwo === "((") {
            blockRefStartPosRef.current = from - 2;
            const coords = e.view.coordsAtPos(from);
            onBlockRefOpenChange(
              true,
              { top: coords.bottom + 6, left: coords.left },
              "",
              from - 2,
            );
            return;
          }
        }
      }

      // ── Slash menu trigger & query tracking ───────────────────────────────
      if (slashStartPosRef.current !== null) {
        const slashStart = slashStartPosRef.current;
        if (from >= slashStart) {
          const textAfterSlash = state.doc.textBetween(slashStart, from, "\n");
          if (textAfterSlash.startsWith("/")) {
            const q = textAfterSlash.slice(1);
            // FIX: push the live query up to the outer shell every keystroke.
            // Previously slashQuery lived only in EditorInner local state and
            // the outer shell's slashQuery was set once on open and never updated,
            // so SlashMenu always received "" regardless of what was typed.
            onSlashQueryChange(q);
            if (textAfterSlash.includes(" ")) {
              onSlashClose();
            }
            return;
          } else {
            onSlashClose();
            return;
          }
        }
      }

      const textBefore1 = from >= 1 ? state.doc.textBetween(from - 1, from, "\n") : "";
      if (textBefore1 === "/") {
        slashStartPosRef.current = from - 1;
        const coords = e.view.coordsAtPos(from);
        // Open with empty query — query updates will arrive via onSlashQueryChange
        onSlashOpenChange(true, { top: coords.bottom + 6, left: coords.left, caretTop: coords.top - 6 }, "");
      }
    },
  });

  // Pass editor instance up to outer shell once ready
  useEffect(() => {
    if (editor) onEditorReady(editor);
  }, [editor, onEditorReady]);

  // Suppress autosave for the first INIT_SUPPRESS_MS after mount
  useEffect(() => {
    const id = setTimeout(() => { initDoneRef.current = true; }, INIT_SUPPRESS_MS);
    return () => clearTimeout(id);
  }, []);

  // ── Imperative content swap on navigation ─────────────────────────────────
  useEffect(() => {
    if (!editor) return;
    if (incomingNoteId === currentNoteIdRef.current) return;
    if (incomingContent === null) return;

    onSlashClose();
    onBlockRefClose();

    initDoneRef.current = false;
    editor.commands.setContent(incomingContent ?? "");
    currentNoteIdRef.current = incomingNoteId;
    setLiveNoteId(incomingNoteId);

    const id = setTimeout(() => { initDoneRef.current = true; }, INIT_SUPPRESS_MS);
    return () => clearTimeout(id);
  }, [editor, incomingNoteId, incomingContent, onSlashClose, onBlockRefClose]);

  // ── Guarded editor proxy (gates autosave during init) ─────────────────────
  const guardedEditorRef = useRef<typeof editor | null>(null);

  if (editor && !guardedEditorRef.current) {
    const wrappedHandlers = new Map<Function, Function>();
    guardedEditorRef.current = new Proxy(editor, {
      get(target, prop) {
        if (prop === "on") {
          return (event: string, handler: Function) => {
            if (event === "update") {
              const gated = (...args: any[]) => {
                if (initDoneRef.current) handler(...args);
              };
              wrappedHandlers.set(handler, gated);
              return (target as any).on(event, gated);
            }
            return (target as any).on(event, handler);
          };
        }
        if (prop === "off") {
          return (event: string, handler: Function) => {
            if (event === "update") {
              const gated = wrappedHandlers.get(handler);
              if (gated) {
                wrappedHandlers.delete(handler);
                return (target as any).off(event, gated);
              }
            }
            return (target as any).off(event, handler);
          };
        }
        const val = (target as any)[prop];
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
  }

  const onSaveComplete = useCallback((content: string, savedNoteId: string) => {
    lastSavedContent.current = content;
    if (!editor) return;
    syncBacklinks(savedNoteId, extractNoteLinkIds(editor)).catch(console.error);
  }, [editor]);

  useAutoSave({
    editor:      (guardedEditorRef.current ?? editor) as typeof editor,
    noteId:      liveNoteId,
    isActiveTab: true,
    onSaveComplete,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 24px", minHeight: 0 }}>
        <style>{`
          .graph-node-editor .tiptap {
            font-size:   13px;
            line-height: 1.7;
            color:       ${LABEL};
            min-height:  120px;
          }
          .graph-node-editor .tiptap p { margin: 0 0 6px; }
          .graph-node-editor .tiptap h1 { font-size: 16px; font-weight: 700; margin: 10px 0 4px; }
          .graph-node-editor .tiptap h2 { font-size: 14px; font-weight: 600; margin: 8px 0 3px; }
          .graph-node-editor .tiptap h3 { font-size: 13px; font-weight: 600; margin: 6px 0 3px; }
          .graph-node-editor .tiptap ul,
          .graph-node-editor .tiptap ol { padding-left: 18px; margin: 0 0 6px; }
          .graph-node-editor .tiptap li { margin-bottom: 2px; }
          .graph-node-editor .tiptap code {
            background: rgba(255,255,255,0.08);
            border-radius: 3px;
            padding: 1px 4px;
            font-size: 12px;
            font-family: monospace;
          }
          .graph-node-editor .tiptap blockquote {
            border-left: 2px solid rgba(255,255,255,0.15);
            margin: 4px 0;
            padding-left: 10px;
            opacity: 0.7;
          }
          .graph-node-editor .tiptap [data-placeholder]::before {
            content: attr(data-placeholder);
            color: rgba(255,255,255,0.2);
            pointer-events: none;
            position: absolute;
          }
          .graph-node-editor .tiptap a { color: #6366f1; text-decoration: underline; }
          .graph-node-editor .tiptap .note-link { color: #6366f1; text-decoration: none; cursor: pointer; }
          .graph-node-editor .tiptap .note-link:hover { text-decoration: underline; }
          .graph-node-editor .tiptap .graph-subpage-node { margin: 2px 0; }
          .graph-node-editor .tiptap .graph-subpage-inner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 6px;
            border-radius: 6px;
            cursor: pointer;
            color: ${LABEL};
            transition: background 120ms;
            font-size: 13px;
          }
          .graph-node-editor .tiptap .graph-subpage-inner:hover {
            background: rgba(99,102,241,0.15);
          }
        `}</style>
        <div className="graph-node-editor" style={{ position: "relative" }}>
          <EditorContent editor={editor} />
        </div>
      </div>

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
          Type / for commands · (( to embed block · Click sub-page to open · Shift+Click to focus in graph
        </span>
      </div>
    </div>
  );
}

// ─── Outer shell ──────────────────────────────────────────────────────────────

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
  const notes   = useNoteStore((s) => s.notes);
  const getNote = useCallback((id: string) => notes.find((n) => n.id === id) ?? null, [notes]);

  // ── Initial load ──────────────────────────────────────────────────────────
  const [initialNoteId,  setInitialNoteId]  = useState<string | null>(null);
  const [initialContent, setInitialContent] = useState<any>(null);
  const [initialReady,   setInitialReady]   = useState(false);

  // ── Incoming note (subsequent navigations) ────────────────────────────────
  const [incomingNoteId,  setIncomingNoteId]  = useState<string>(noteId);
  const [incomingContent, setIncomingContent] = useState<any>(null);

  // ── Title bar display ─────────────────────────────────────────────────────
  const [displayNoteId, setDisplayNoteId] = useState(noteId);

  // ── Editor instance (passed up from EditorInner) ──────────────────────────
  const [editor, setEditor] = useState<any>(null);

  // ── Slash menu state ──────────────────────────────────────────────────────
  const [slashOpen,  setSlashOpen]  = useState(false);
  const [slashPos,   setSlashPos]   = useState<{ top: number; left: number; caretTop: number }>({ top: 0, left: 0, caretTop: 0 });
  // FIX: slashQuery is the single source of truth. EditorInner calls
  // onSlashQueryChange on every keystroke; SlashMenu receives this live value.
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartPosRef = useRef<number | null>(null);

  // ── BlockRef suggest state ─────────────────────────────────────────────────
  const [blockRefOpen,  setBlockRefOpen]  = useState(false);
  const [blockRefPos,   setBlockRefPos]   = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [blockRefQuery, setBlockRefQuery] = useState("");
  const [blockRefTriggerStart, setBlockRefTriggerStart] = useState(0);
  const blockRefStartPosRef = useRef<number | null>(null);

  // ── Slash menu callbacks ───────────────────────────────────────────────────

  const handleSlashOpenChange = useCallback((
    open: boolean,
    pos?: { top: number; left: number; caretTop: number },
    query?: string,
  ) => {
    if (open && pos) {
      setSlashPos(pos);
      setSlashQuery(query ?? "");
      setSlashOpen(true);
    } else {
      setSlashOpen(false);
      setSlashQuery("");
    }
  }, []);

  // Called every keystroke while slash menu is open — keeps query in sync
  const handleSlashQueryChange = useCallback((query: string) => {
    setSlashQuery(query);
  }, []);

  const handleSlashClose = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    slashStartPosRef.current = null;
  }, []);

  const handleSlashCommand = useCallback((action: () => void) => {
    if (slashStartPosRef.current !== null && editor) {
      editor.chain().focus()
        .deleteRange({ from: slashStartPosRef.current, to: editor.state.selection.from })
        .run();
    }
    action();
    handleSlashClose();
  }, [editor, handleSlashClose]);

  // ── BlockRef callbacks ────────────────────────────────────────────────────

  const handleBlockRefOpenChange = useCallback((
    open: boolean,
    pos?: { top: number; left: number },
    query?: string,
    triggerStart?: number,
  ) => {
    if (open) {
      if (pos) setBlockRefPos(pos);
      setBlockRefQuery(query ?? "");
      if (triggerStart !== undefined) setBlockRefTriggerStart(triggerStart);
      setBlockRefOpen(true);
    } else {
      setBlockRefOpen(false);
      setBlockRefQuery("");
    }
  }, []);

  const handleBlockRefClose = useCallback(() => {
    setBlockRefOpen(false);
    setBlockRefQuery("");
    blockRefStartPosRef.current = null;
  }, []);

  // ── Upload / sub-page callbacks ───────────────────────────────────────────

  const handleImageUpload = useCallback(async () => {
    if (!editor) return;
    const result = await uploadImageFromDisk();
    if (!result) return;
    editor.chain().focus().insertContent({
      type: "image",
      attrs: { src: result.path, alt: result.name, width: null, align: "left" },
    }).run();
  }, [editor]);

  const handleAttachmentUpload = useCallback(async (kind: "pdf" | "audio") => {
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
  }, [editor]);

  const handleSubPageCreate = useCallback(() => {
    if (!editor) return;

    const pattern = /^Untitled-(\d+)$/;
    const used    = new Set<number>();
    for (const n of notes) {
      const m = n.title.match(pattern);
      if (m) used.add(parseInt(m[1], 10));
    }
    let n = 1;
    while (used.has(n)) n++;
    const defaultTitle = `Untitled-${n}`;

    // Write parentNoteId into storage so GraphSubPageNodeView can read it
    const s = editor.storage as unknown as Record<string, { parentNoteId: string; paneId: 1 | 2 }>;
    if (s["subPage"]) {
      s["subPage"].parentNoteId = displayNoteId;
      s["subPage"].paneId       = 1;
    }

    const insertChain = editor.chain().focus();
    if (slashStartPosRef.current !== null) {
      insertChain.deleteRange({ from: slashStartPosRef.current, to: editor.state.selection.from });
    }
    insertChain
      .insertContent([
        { type: "subPage", attrs: { noteId: null, title: defaultTitle, mode: "editing" } },
        { type: "paragraph" },
      ])
      .run();

    handleSlashClose();
  }, [editor, notes, displayNoteId, handleSlashClose]);

  // ── Content fetching ──────────────────────────────────────────────────────

  const fetchContent = useCallback(async (id: string): Promise<any> => {
    try {
      const fetched = await getNoteById(id);
      const raw = fetched?.content ?? getNote(id)?.content ?? null;
      return raw ? JSON.parse(raw) : null;
    } catch {
      const raw = getNote(id)?.content ?? null;
      return raw ? JSON.parse(raw) : null;
    }
  }, [getNote]);

  // Fetch first note on mount
  useEffect(() => {
    let cancelled = false;
    fetchContent(noteId).then((content) => {
      if (cancelled) return;
      setInitialNoteId(noteId);
      setInitialContent(content);
      setIncomingNoteId(noteId);
      setIncomingContent(content);
      setInitialReady(true);
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When noteId prop changes, fetch new content without remounting the editor
  const prevNoteIdRef = useRef(noteId);
  useEffect(() => {
    if (noteId === prevNoteIdRef.current) return;
    prevNoteIdRef.current = noteId;

    setDisplayNoteId(noteId);
    setIncomingContent(null);
    setIncomingNoteId(noteId);

    let cancelled = false;
    fetchContent(noteId).then((content) => {
      if (cancelled) return;
      setIncomingContent(content);
    });
    return () => { cancelled = true; };
  }, [noteId, fetchContent]);

  const displayNote = getNote(displayNoteId);
  const title       = displayNote?.title ?? "";

  const isLoading = !initialReady
    || (incomingContent === null && incomingNoteId !== initialNoteId);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Title bar */}
        <div style={{
          padding:      "10px 14px 6px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexShrink:   0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {canGoBack && (
              <button
                onClick={onGoBack}
                title="Go back"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: 4, borderRadius: 4, opacity: 0.5, transition: "opacity 120ms",
                  display: "flex", alignItems: "center",
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 2L4 7l5 5" stroke={LABEL} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            {canGoForward && (
              <button
                onClick={onGoForward}
                title="Go forward"
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: 4, borderRadius: 4, opacity: 0.5, transition: "opacity 120ms",
                  display: "flex", alignItems: "center",
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5 2l5 5-5 5" stroke={LABEL} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <span style={{
              fontSize:     15,
              fontWeight:   700,
              color:        LABEL,
              opacity:      0.9,
              lineHeight:   1.3,
              flex:         1,
              overflow:     "hidden",
              textOverflow: "ellipsis",
              whiteSpace:   "nowrap",
            }}>
              {title}
            </span>
          </div>
          <span style={{ fontSize: 10, color: LABEL, opacity: 0.28, display: "block" }}>
            {isLoading ? "Loading…" : "Editing · changes save automatically"}
          </span>
        </div>

        {!initialReady ? (
          <div style={{
            flex:           1,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            opacity:        0.25,
            fontSize:       12,
            color:          LABEL,
          }}>
            Loading content…
          </div>
        ) : (
          <EditorInner
            noteId={initialNoteId!}
            initialContent={initialContent}
            incomingNoteId={incomingNoteId}
            incomingContent={incomingContent}
            onClose={onClose}
            onNavigateToNode={onNavigateToNode}
            onOpenInEditor={onOpenInEditor}
            onSlashOpenChange={handleSlashOpenChange}
            onSlashQueryChange={handleSlashQueryChange}
            onSlashClose={handleSlashClose}
            slashStartPosRef={slashStartPosRef}
            onBlockRefOpenChange={handleBlockRefOpenChange}
            onBlockRefClose={handleBlockRefClose}
            blockRefStartPosRef={blockRefStartPosRef}
            onEditorReady={setEditor}
          />
        )}
      </div>

      {/* Slash menu — portal to document.body avoids overflow:hidden clipping */}
      {slashOpen && editor && createPortal(
        <SlashMenu
          position={slashPos}
          editor={editor}
          query={slashQuery}
          noteId={displayNoteId}
          paneId={1}
          onCommand={handleSlashCommand}
          onClose={handleSlashClose}
          onImageUpload={handleImageUpload}
          onAttachmentUpload={handleAttachmentUpload}
          onSubPageCreate={handleSubPageCreate}
        />,
        document.body,
      )}

      {/* BlockRef suggest — portal to document.body for same reason */}
      {blockRefOpen && editor && createPortal(
        <BlockRefSuggest
          position={blockRefPos}
          editor={editor}
          query={blockRefQuery}
          triggerStart={blockRefTriggerStart}
          onClose={handleBlockRefClose}
        />,
        document.body,
      )}
    </>
  );
}