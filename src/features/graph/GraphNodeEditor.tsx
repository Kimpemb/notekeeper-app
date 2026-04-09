// src/features/graph/GraphNodeEditor.tsx
//
// A stripped-down TipTap editor for use inside GraphNotePanel's edit mode.
// Intentionally minimal — no status bar, no slash menu, no outline, no AI bar,
// no subpages. Just the editor surface + autosave.
//
// Uses the same extensions as the main editor so content is always compatible.
// Saves via useAutoSave on the same debounce path — no bespoke save logic.
//
// Content is fetched directly from IndexedDB (getNoteById) rather than from
// the note store. The store's `notes` array does not guarantee that every
// note's `content` field is hydrated — only recently-opened notes are fully
// populated. Fetching from DB ensures the editor always gets real content.
//
// CRITICAL — initialisation guard:
// TipTap extensions (BlockIdExtension in particular) fire onUpdate during
// their onCreate setup phase to assign block IDs to every node. This flips
// isDirty in useAutoSave before the user has touched anything. If the panel
// is closed before the debounce fires, the unmount flush saves a partially-
// initialised document, wiping real content and inserting stray nodes.
//
// Fix: we proxy editor.on("update", ...) so that any handler registered
// during the INIT_SUPPRESS_MS window is wrapped to no-op until the window
// closes. This means useAutoSave never sees init-phase mutations as dirty.

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useAutoSave } from "@/features/editor/hooks/useAutoSave";
import { getNoteById } from "@/features/notes/db/queries";
import { NoteLink } from "@/features/editor/components/Editor/NoteLink";
import { syncBacklinks } from "@/features/notes/db/queries";
import { extractNoteLinkIds } from "@/features/editor/components/Editor/editorUtils";
import { SubPageNode } from "@/features/editor/components/Editor/SubPageNode";

import {
  CodeBlock, Callout, CheckList, CheckItem, Toggle, ToggleSummary, ToggleBody,
  EditorTable, TableRow, TableHeader, TableCell,
  TaskItemExitExtension, ToggleKeyboardExtension, EmptyLinePlaceholderExtension,
  SlashPlaceholderExtension, OrderedListBackspaceExtension, CodeBlockSelectAllExtension,
  ListSelectAllExtension, CodeBlockBackspaceExtension, BlockIdExtension, BlockRefNode,
  DataviewNode, TaskListSortExtension, ImageExtension, AttachmentExtension,
  createFindReplaceShortcutExtension,
  // SubPageNode is NOT exported from extensions — remove it from here
} from "@/features/editor/components/Editor/extensions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphNodeEditorProps {
  noteId:  string;
  onClose: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL = "var(--color-text, #e2e2e2)";

// Suppress onUpdate events for this long after mount.
// BlockIdExtension and similar init-phase mutations all fire within the first
// frame; 400ms is generous but still imperceptible to a user starting to type.
const INIT_SUPPRESS_MS = 400;

// ─── Inner editor ─────────────────────────────────────────────────────────────
// Separated so it only mounts after content is ready — TipTap's `content` prop
// is consumed once at mount and ignored on subsequent renders. Mounting before
// we have real content would give useAutoSave an empty document to flush on
// unmount.

interface EditorInnerProps {
  noteId:          string;
  initialContent:  any;
  onClose:         () => void;
}

function EditorInner({ noteId, initialContent, onClose }: EditorInnerProps) {
  const setActiveNote    = useNoteStore((s) => s.setActiveNote);
  const lastSavedContent = useRef<string | null>(null);

  // True once INIT_SUPPRESS_MS has elapsed after mount.
  const initDoneRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlock, Callout, CheckList, CheckItem, EditorTable, TableRow, TableHeader, TableCell,
      ToggleSummary, ToggleBody, Toggle, ImageExtension, AttachmentExtension,
      TaskItemExitExtension, ToggleKeyboardExtension, CodeBlockSelectAllExtension,
      CodeBlockBackspaceExtension, ListSelectAllExtension, SlashPlaceholderExtension,
      EmptyLinePlaceholderExtension, OrderedListBackspaceExtension, TaskListSortExtension,
      BlockIdExtension, BlockRefNode, DataviewNode,
      SubPageNode,  // ← ADDED: so subPage nodes are not stripped
      NoteLink.configure({ onNavigate: setActiveNote }),
      createFindReplaceShortcutExtension(() => {}),
      Extension.create({ name: "noopFindReplace", addProseMirrorPlugins() { return []; } }),
    ],
    content:   initialContent,
    autofocus: true,
    editorProps: {
      attributes: {
        class:      "tiptap outline-none",
        spellcheck: "true",
      },
    },
  });

  // Lift the suppression flag after the init window
  useEffect(() => {
    const id = setTimeout(() => { initDoneRef.current = true; }, INIT_SUPPRESS_MS);
    return () => clearTimeout(id);
  }, []);

  // Build a proxied editor whose "update" event is gated by initDoneRef.
  // We build this once (via useRef) so useAutoSave always receives the same
  // object reference — recreating the proxy on every render would cause
  // useAutoSave to re-subscribe on every render.
  const guardedEditorRef = useRef<typeof editor | null>(null);

  if (editor && !guardedEditorRef.current) {
    const wrappedHandlers = new Map<Function, Function>();

    guardedEditorRef.current = new Proxy(editor, {
      get(target, prop) {
        // Intercept `.on` so any "update" handler is wrapped with the gate
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
        // Intercept `.off` so the gated wrapper is unsubscribed correctly
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
    noteId,
    isActiveTab: true,
    onSaveComplete,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Editor surface */}
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
        `}</style>
        <div className="graph-node-editor" style={{ position: "relative" }}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: "6px 14px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <button
          onClick={onClose}
          style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 5, padding: "4px 10px", fontSize: 10,
            color: LABEL, opacity: 0.45, cursor: "pointer", transition: "opacity 120ms",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.45")}
        >
          ← Back to detail
        </button>
        <span style={{ fontSize: 10, color: LABEL, opacity: 0.2 }}>
          Triple-click node to open full editor
        </span>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphNodeEditor({ noteId, onClose }: GraphNodeEditorProps) {
  const note = useNoteStore(
    useCallback((s) => s.notes.find((n) => n.id === noteId) ?? null, [noteId])
  );

  const [initialContent, setInitialContent] = useState<any>(null);
  const [contentReady,   setContentReady]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNoteById(noteId)
      .then((fetched) => {
        if (cancelled) return;
        // Prefer DB over store — store may have a stale/null content field
        const raw = fetched?.content ?? note?.content ?? null;
        setInitialContent(raw ? JSON.parse(raw) : null);
        setContentReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        const raw = note?.content ?? null;
        setInitialContent(raw ? JSON.parse(raw) : null);
        setContentReady(true);
      });
    return () => { cancelled = true; };
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = note?.title ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Title row */}
      <div style={{
        padding: "10px 14px 6px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 15, fontWeight: 700, color: LABEL, opacity: 0.9,
          lineHeight: 1.3, display: "block",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: LABEL, opacity: 0.28, marginTop: 2, display: "block" }}>
          {contentReady ? "Editing · changes save automatically" : "Loading…"}
        </span>
      </div>

      {/* Gate: don't mount TipTap until we have real content from the DB */}
      {!contentReady ? (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          opacity: 0.25, fontSize: 12, color: LABEL,
        }}>
          Loading content…
        </div>
      ) : (
        // key={noteId} guarantees a fresh editor instance per note
        <EditorInner
          key={noteId}
          noteId={noteId}
          initialContent={initialContent}
          onClose={onClose}
        />
      )}
    </div>
  );
}