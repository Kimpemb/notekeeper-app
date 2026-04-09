// src/features/graph/GraphNodeEditor.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ─── Inner editor (never remounts — content is swapped imperatively) ──────────

interface EditorInnerProps {
  noteId:           string;
  initialContent:   any;
  // When incomingNoteId differs from the current note, EditorInner swaps
  // content imperatively. null incomingContent means the fetch is in flight.
  incomingNoteId:   string;
  incomingContent:  any;
  onClose:          () => void;
  onNavigateToNode: (nodeId: string) => void;
  onOpenInEditor:   (nodeId: string) => void;
}

function EditorInner({
  noteId: initialNoteId,
  initialContent,
  incomingNoteId,
  incomingContent,
  onClose,
  onNavigateToNode,
  onOpenInEditor,
}: EditorInnerProps) {
  const setActiveNote    = useNoteStore((s) => s.setActiveNote);
  const lastSavedContent = useRef<string | null>(null);
  const initDoneRef      = useRef(false);
  const currentNoteIdRef = useRef<string>(initialNoteId);
  const [liveNoteId, setLiveNoteId] = useState(initialNoteId);

  // ── Stable callback ref ───────────────────────────────────────────────────
  // Keeps onNavigateToNode / onOpenInEditor always current without forcing
  // the extension to be recreated on every render cycle.
  const callbacksRef = useRef({ onNavigateToNode, onOpenInEditor });
  useEffect(() => {
    callbacksRef.current = { onNavigateToNode, onOpenInEditor };
  });

  // ── GraphSubPageNode — created exactly once ───────────────────────────────
  // addNodeView() in an extension fires synchronously during `new Editor()`
  // construction, before any content is parsed. This guarantees sub-page
  // blocks are rendered correctly on the very first paint, with no async
  // gap and no fallback render from SubPageNodeView.
  //
  // Contrast with editorProps.nodeViews: that path is applied *after*
  // the editor and its initial content are already initialised, causing
  // the first-paint / double-click race condition this replaces.
  const graphSubPageNode = useMemo(
    () =>
      createGraphSubPageNode(
        (id) => callbacksRef.current.onOpenInEditor(id),
        (id) => callbacksRef.current.onNavigateToNode(id),
      ),
    [], // intentionally empty — callbacks accessed via ref, never stale
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock, Callout, CheckList, CheckItem, EditorTable, TableRow, TableHeader, TableCell,
      ToggleSummary, ToggleBody, Toggle, ImageExtension, AttachmentExtension,
      TaskItemExitExtension, ToggleKeyboardExtension, CodeBlockSelectAllExtension,
      CodeBlockBackspaceExtension, ListSelectAllExtension, SlashPlaceholderExtension,
      EmptyLinePlaceholderExtension, OrderedListBackspaceExtension, TaskListSortExtension,
      BlockIdExtension, BlockRefNode, DataviewNode,
      graphSubPageNode, // ← replaces SubPageNode; no editorProps.nodeViews needed
      NoteLink.configure({ onNavigate: setActiveNote }),
      createFindReplaceShortcutExtension(() => {}),
      Extension.create({ name: "noopFindReplace", addProseMirrorPlugins() { return []; } }),
    ],
    content:   initialContent,
    autofocus: true,
    editorProps: {
      attributes: { class: "tiptap outline-none", spellcheck: "true" },
    },
  });

  // Suppress autosave triggers for the first INIT_SUPPRESS_MS after mount
  useEffect(() => {
    const id = setTimeout(() => { initDoneRef.current = true; }, INIT_SUPPRESS_MS);
    return () => clearTimeout(id);
  }, []);

  // ── Imperative content swap when a new note is navigated to ──────────────
  useEffect(() => {
    if (!editor) return;
    if (incomingNoteId === currentNoteIdRef.current) return;
    if (incomingContent === null) return; // still loading — wait

    initDoneRef.current = false; // suppress autosave triggers during content swap
    editor.commands.setContent(incomingContent ?? "");
    currentNoteIdRef.current = incomingNoteId;
    setLiveNoteId(incomingNoteId);

    const id = setTimeout(() => { initDoneRef.current = true; }, INIT_SUPPRESS_MS);
    return () => clearTimeout(id);
  }, [editor, incomingNoteId, incomingContent]);

  // ── Guarded editor proxy ──────────────────────────────────────────────────
  // Gates autosave "update" events until initDoneRef is true, preventing
  // spurious saves during mount and imperative content swaps.
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
          Click to open in editor · Shift+Click to focus in graph
        </span>
      </div>
    </div>
  );
}

// ─── Outer shell ──────────────────────────────────────────────────────────────
// Fetches content and manages navigation state. EditorInner is never remounted
// — notes are switched by passing new incomingNoteId/incomingContent props and
// letting EditorInner swap content imperatively via editor.commands.setContent.

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

  // ── Initial load (first mount) ────────────────────────────────────────────
  const [initialNoteId,  setInitialNoteId]  = useState<string | null>(null);
  const [initialContent, setInitialContent] = useState<any>(null);
  const [initialReady,   setInitialReady]   = useState(false);

  // ── Incoming note (subsequent navigations) ────────────────────────────────
  // null incomingContent = fetch in flight; EditorInner waits for non-null
  const [incomingNoteId,  setIncomingNoteId]  = useState<string>(noteId);
  const [incomingContent, setIncomingContent] = useState<any>(null);

  // ── Title bar display ─────────────────────────────────────────────────────
  const [displayNoteId, setDisplayNoteId] = useState(noteId);

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

  // Fetch the first note on mount
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

  // When the noteId prop changes (back/forward navigation or sub-page click),
  // fetch the new content and pass it to EditorInner — do NOT remount.
  const prevNoteIdRef = useRef(noteId);
  useEffect(() => {
    if (noteId === prevNoteIdRef.current) return;
    prevNoteIdRef.current = noteId;

    setDisplayNoteId(noteId);
    setIncomingContent(null); // signal: loading
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
        // No key prop — EditorInner never remounts. Notes are swapped
        // imperatively via incomingNoteId / incomingContent props.
        <EditorInner
          noteId={initialNoteId!}
          initialContent={initialContent}
          incomingNoteId={incomingNoteId}
          incomingContent={incomingContent}
          onClose={onClose}
          onNavigateToNode={onNavigateToNode}
          onOpenInEditor={onOpenInEditor}
        />
      )}
    </div>
  );
}