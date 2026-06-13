// src/features/editor/components/Editor/index.tsx
//
// ARCHITECTURE NOTE — why no setContent:
// TipTap 3 calls flushSync() during NodeView mount inside a React passive effect.
// React 18 forbids this. Fix: key the editor on noteId so each navigation remounts
// a fresh instance with content passed at construction time — setContent is never
// called after mount.
//
// EXCEPTION — idemora:content-updated:
// When the graph writes a noteLink directly to the DB (drag-to-link), it dispatches
// this event with the new content. The editor must reload its TipTap state so that
// subsequent autosaves include the injected link rather than overwriting it with
// stale in-memory content. suppressSave is set for the reload window so the
// debounce doesn't fire during the transition.

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { useNoteStore } from "@/features/notes/store/useNoteStore";
import { useUIStore } from "@/features/ui/store/useUIStore";
import { useAutoSave } from "@/features/editor/hooks/useAutoSave";
import { useAppSettings } from "@/features/ui/store/useAppSettings";
import { syncBacklinks } from "@/features/notes/db/queries";
import { NoteLink } from "./NoteLink";
import { NoteLinkSuggest } from "./NoteLinkSuggest";
import { OutlinePanel } from "./OutlinePanel";
import { SimilarNotesPanel } from "./SimilarNotesPanel";
import { StatusBar } from "./StatusBar";
import { VersionHistory } from "./VersionHistory";
import { SlashMenu } from "./SlashMenu";
import { FindReplace, buildFindReplacePlugin } from "./FindReplace";
import { TableToolbar } from "./TableToolbar";
import { TagBar } from "./TagBar";
import { SubPagesSection } from "./SubPagesSection";
import { SubPageNode } from "./SubPageNode";
import { PDFLinkNode } from "./PDFLinkNode";
import { FrontmatterEditor } from "./FrontmatterEditor";
import { BlockRefSuggest } from "./BlockRefSuggest";
import { useDragReorder } from "@/features/editor/hooks/useDragReorder";
import { Breadcrumb } from "./Breadcrumb";
import { enqueueNoteForIndexing } from "@/features/ai/lib/indexer"


import {
  CodeBlock, Callout, CheckList, CheckItem, Toggle, ToggleSummary, ToggleBody,
  EditorTable, TableRow, TableHeader, TableCell,
  TaskItemExitExtension, ToggleKeyboardExtension, EmptyLinePlaceholderExtension,
  SlashPlaceholderExtension, OrderedListBackspaceExtension, CodeBlockSelectAllExtension,
  ListSelectAllExtension, createFindReplaceShortcutExtension, ImageExtension, AttachmentExtension,
  TaskListSortExtension,
  CodeBlockBackspaceExtension,
  BlockIdExtension,
  BlockRefNode,
  DataviewNode, Color, TextStyle, MultiHighlight,
  MarkdownPasteExtension,
} from "./extensions";

import {
  extractNoteLinkIds, scrollToHeadingText, scrollToQuery,
  buildSearchHighlightPlugin, getScrollContainer, clearSearchHighlight,
} from "./editorUtils";
import {
  pickImageFile, readImageFile, saveImage,
  pickAttachmentFile, readImageFile as readFileBytes, saveAttachment,
} from "@/lib/tauri/fs";

interface BubblePos { top: number; left: number; }

function LastEdited({ timestamp }: { timestamp: number }) {
  const [formatted, setFormatted] = useState<string>("");

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const diff = now - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) setFormatted("Edited just now");
      else if (minutes < 60) setFormatted(`Edited ${minutes} minute${minutes === 1 ? "" : "s"} ago`);
      else if (hours < 24) setFormatted(`Edited ${hours} hour${hours === 1 ? "" : "s"} ago`);
      else if (days < 7) setFormatted(`Edited ${days} day${days === 1 ? "" : "s"} ago`);
      else setFormatted(new Date(timestamp).toLocaleDateString());
    };

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return (
    <div className="flex items-center gap-1.5 text-xs text-idemora-text-muted mb-4">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-60">
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
        <polyline points="6 3 6 6 8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span>{formatted}</span>
    </div>
  );
}

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

interface EditorProps {
  noteId: string;
  paneId: 1 | 2;
  initialScrollTop?: number;
  onScrollChange?: (scrollTop: number) => void;
}

 
function reconcileSubPageBlocks(
  contentJson: string,
  children: { id: string; title: string; source_type?: string }[]
): string | null {
  let doc: { type: string; content: unknown[] };
  try { doc = JSON.parse(contentJson); } catch { return null; }

  const existingIds = new Set<string>();
  for (const node of doc.content ?? []) {
    const n = node as { type: string; attrs?: { noteId?: string | null } };
    if ((n.type === "subPage" || n.type === "pdfLink") && n.attrs?.noteId) {
      existingIds.add(n.attrs.noteId);
    }
  }

  // Remove blocks for notes no longer children
  const validIds = new Set(children.map((c) => c.id));
  const filtered = doc.content.filter((node) => {
    const n = node as { type: string; attrs?: { noteId?: string | null } };
    if ((n.type === "subPage" || n.type === "pdfLink") && n.attrs?.noteId) {
      return validIds.has(n.attrs.noteId);
    }
    return true;
  });

  // Add missing blocks
  const missing = children.filter((c) => !existingIds.has(c.id));
  const newBlocks = missing.map((c) =>
    c.source_type === "pdf"
      ? { type: "pdfLink", attrs: { noteId: c.id, title: c.title } }
      : { type: "subPage", attrs: { noteId: c.id, title: c.title, mode: "display" } }
  );

  if (filtered.length === doc.content.length && newBlocks.length === 0) return null;

  const finalContent = [...filtered];
  if (newBlocks.length > 0) {
    const last = finalContent[finalContent.length - 1] as { type: string; content?: unknown[] } | undefined;
    const lastIsEmptyPara = last?.type === "paragraph" && (!last.content || last.content.length === 0);
    if (lastIsEmptyPara) {
      finalContent.splice(finalContent.length - 1, 0, ...newBlocks);
    } else {
      finalContent.push(...newBlocks);
    }
  }

  return JSON.stringify({ ...doc, content: finalContent });
}
 

export function Editor({ noteId, paneId, initialScrollTop = 0, onScrollChange }: EditorProps) {
  const note = useNoteStore(useCallback((s) =>
    s.notes.find((n) => n.id === noteId) ?? s.trashedNotes.find((n) => n.id === noteId) ?? null
  , [noteId]));
  const notes         = useNoteStore((s) => s.notes);
  const updateNote    = useNoteStore((s) => s.updateNote);
  const setActiveNote = useNoteStore((s) => s.setActiveNote);

  // Nav — pane 1
  const goBack            = useNoteStore((s) => s.goBack);
  const goForward         = useNoteStore((s) => s.goForward);
  const pane1CanGoBack    = useNoteStore((s) => s.canGoBack());
  const pane1CanGoForward = useNoteStore((s) => s.canGoForward());

  // Nav — pane 2
  const pane2CanGoBack    = useUIStore((s) => s.pane2CanGoBack());
  const pane2CanGoForward = useUIStore((s) => s.pane2CanGoForward());
  const pane2GoBack       = useUIStore((s) => s.pane2GoBack);
  const pane2GoForward    = useUIStore((s) => s.pane2GoForward);

  const canGoBack    = paneId === 2 ? pane2CanGoBack    : pane1CanGoBack;
  const canGoForward = paneId === 2 ? pane2CanGoForward : pane1CanGoForward;

  const pane1ActiveNoteId = useUIStore((s) => s.activeTabNoteId());
  const pane2ActiveNoteId = useUIStore((s) => s.paneActiveNoteId(2));
  const activePaneId      = useUIStore((s) => s.activePaneId);

  const isActiveTab = paneId === 1
    ? pane1ActiveNoteId === noteId
    : pane2ActiveNoteId === noteId;

  const showEditorButtons = isActiveTab && activePaneId === paneId;

  const myOutlineOpen        = useUIStore((s) => paneId === 1 ? s.pane1OutlineOpen        : s.pane2OutlineOpen);
  const mySimilarOpen        = useUIStore((s) => paneId === 1 ? s.pane1SimilarOpen        : s.pane2SimilarOpen);
  const myVersionHistoryOpen = useUIStore((s) => paneId === 1 ? s.pane1VersionHistoryOpen : s.pane2VersionHistoryOpen);

  const openGraphForNote  = useUIStore((s) => s.openGraphForNote);
  const chatOpen1         = useUIStore((s) => s.chatOpen1);
  const chatOpen2         = useUIStore((s) => s.chatOpen2);
  const rightPanelOpen    = useUIStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const chatActive        = paneId === 1 ? chatOpen1 : chatOpen2;

  const pendingScrollHeading    = useUIStore((s) => s.pendingScrollHeading);
  const setPendingScrollHeading = useUIStore((s) => s.setPendingScrollHeading);
  const pendingScrollQuery      = useUIStore((s) => s.pendingScrollQuery);
  const setPendingScrollQuery   = useUIStore((s) => s.setPendingScrollQuery);
  const pendingScrollIndex      = useUIStore((s) => s.pendingScrollIndex);
  const setPendingScrollIndex   = useUIStore((s) => s.setPendingScrollIndex);

  const spellCheck = useAppSettings((s) => s.settings.spellCheck);

  const titleRef            = useRef<HTMLHeadingElement>(null);
  const editorWrapRef       = useRef<HTMLDivElement>(null);
  const editorTextColumnRef = useRef<HTMLDivElement>(null);
  const scrollRef           = useRef<HTMLDivElement>(null);
  const lastSavedContent    = useRef<string | null>(note?.content ?? null);
  const titleFocusedRef     = useRef(false);
  const subPageCreatingRef  = useRef(false);
  const suppressSave        = useRef(false);
const contentLoadingRef   = useRef(false);

const isEmptyContent = !note?.content ||
  note.content === "null" ||
  note.content === "" ||
  note.content === '{"type":"doc","content":[]}';

const [contentReady, setContentReady] = useState(!isEmptyContent);
  const [bubblePos, setBubblePos]       = useState<BubblePos | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const bubblePosRef                    = useRef<BubblePos | null>(null);
  const slashFromBubble                 = useRef(false);

  const [slashOpen, setSlashOpen]   = useState(false);
  const [slashPos, setSlashPos]     = useState<{ top: number; left: number; caretTop: number }>({ top: 0, left: 0, caretTop: 0 });
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartPos               = useRef<number | null>(null);

  const [linkOpen, setLinkOpen]   = useState(false);
  const [linkPos, setLinkPos]     = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [linkQuery, setLinkQuery] = useState("");
  const linkBracketStart          = useRef<number | null>(null);

  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const openFindReplaceRef = useRef<() => void>(() => setFindReplaceOpen(true));
  openFindReplaceRef.current = () => setFindReplaceOpen(true);

  const [blockRefOpen,  setBlockRefOpen]  = useState(false);
  const [blockRefPos,   setBlockRefPos]   = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [blockRefQuery, setBlockRefQuery] = useState("");
  const blockRefTriggerStart              = useRef<number | null>(null);

  const [taskListToolbarPos, setTaskListToolbarPos] = useState<{ top: number; left: number } | null>(null);

  const loadNoteContent = useNoteStore((s) => s.loadNoteContent);

  // Load content if empty/stub — only fires once per mount
  const _contentLoadFired = useRef(false);


useEffect(() => {
  if (!isEmptyContent) {
    setContentReady(true);
    return;
  }
  if (_contentLoadFired.current) return;
  _contentLoadFired.current = true;
  loadNoteContent(noteId).then(() => setContentReady(true));
}, [noteId, isEmptyContent]);

// preserve positions; only append genuinely missing children
const initialContent = (() => {
  let doc: { type: string; content: unknown[] };
  try {
    doc = JSON.parse(
      !note?.content || note.content === "null" || note.content === ""
        ? '{"type":"doc","content":[]}'
        : note.content
    );
  } catch {
    doc = { type: "doc", content: [] };
  }

  // Guard against malformed/legacy content where `content` is missing
  // or not an array (e.g. `{"type":"doc"}` with no content key)
  if (!Array.isArray(doc.content)) {
    doc.content = [];
  }

  const children = notes
    .filter((n) => n.parent_id === noteId && !n.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order);

  // Find which children are already represented in the saved content
  const existingIds = new Set<string>();
  for (const node of doc.content) {
    const n = node as { type: string; attrs?: { noteId?: string | null } };
    if ((n.type === "subPage" || n.type === "pdfLink") && n.attrs?.noteId) {
      existingIds.add(n.attrs.noteId);
    }
  }

  // Remove stale blocks (child was deleted/re-parented)
  const validIds = new Set(children.map((c) => c.id));
  doc.content = doc.content.filter((node) => {
    const n = node as { type: string; attrs?: { noteId?: string | null } };
    if ((n.type === "subPage" || n.type === "pdfLink") && n.attrs?.noteId) {
      return validIds.has(n.attrs.noteId);
    }
    return true;
  });

  // Append only the children not yet in the doc (newly created subpages)
  const missing = children.filter((c) => !existingIds.has(c.id));
  if (missing.length > 0) {
    const newBlocks = missing.map((c) =>
      c.source_type === "pdf"
        ? { type: "pdfLink", attrs: { noteId: c.id, title: c.title } }
        : { type: "subPage", attrs: { noteId: c.id, title: c.title, mode: "display" } }
    );
    const last = doc.content[doc.content.length - 1] as
      { type: string; content?: unknown[] } | undefined;
    const lastIsEmptyPara =
      last?.type === "paragraph" && (!last.content || last.content.length === 0);
    if (lastIsEmptyPara) {
      doc.content.splice(doc.content.length - 1, 0, ...newBlocks);
    } else {
      doc.content.push(...newBlocks);
    }
  }

  return doc as import("@tiptap/core").JSONContent;
})();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Color,
      TextStyle,
      MultiHighlight,
      CodeBlock, Callout, CheckList, CheckItem, EditorTable, TableRow, TableHeader, TableCell,
      ToggleSummary, ToggleBody, Toggle, ImageExtension, AttachmentExtension,
      TaskItemExitExtension, ToggleKeyboardExtension, CodeBlockSelectAllExtension,
      CodeBlockBackspaceExtension, ListSelectAllExtension, SlashPlaceholderExtension, EmptyLinePlaceholderExtension,
      OrderedListBackspaceExtension, TaskListSortExtension, SubPageNode, PDFLinkNode, BlockIdExtension, BlockRefNode, DataviewNode,
      NoteLink.configure({ onNavigate: setActiveNote }),
      MarkdownPasteExtension,
      createFindReplaceShortcutExtension(() => openFindReplaceRef.current()),
      Extension.create({ name: "findReplacePlugin",     addProseMirrorPlugins() { return [buildFindReplacePlugin()]; } }),
      Extension.create({ name: "searchHighlightPlugin", addProseMirrorPlugins() { return [buildSearchHighlightPlugin()]; } }),
    ],
    content: initialContent,
    autofocus: false,
    editorProps: {
      attributes: {
        class: "tiptap h-full outline-none",
        "data-placeholder": "Start writing…",
        spellcheck: String(spellCheck),
      },
    },
    onSelectionUpdate: ({ editor: e }) => {
      if (isDraggingRef.current) return;
      if (slashFromBubble.current) return;
      const { from, to, $from } = e.state.selection;

      let foundTaskList = false;
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === "taskList") {
          foundTaskList = true;
          const taskListPos = $from.before(depth);
          try {
            const domNode = e.view.nodeDOM(taskListPos) as HTMLElement | null;
            if (domNode) {
              const rect = domNode.getBoundingClientRect();
              setTaskListToolbarPos({ top: rect.top - 32, left: rect.left });
            }
          } catch { /**/ }
          break;
        }
      }
      if (!foundTaskList) setTaskListToolbarPos(null);

      if (from === to) { setHasSelection(false); setBubblePos(null); bubblePosRef.current = null; return; }
      const selectedNodeType = $from.nodeAfter?.type.name ?? "";
      const insideTable = (() => { for (let d = $from.depth; d > 0; d--) { if ($from.node(d).type.name === "table") return true; } return false; })();
      if (selectedNodeType === "image" || selectedNodeType === "attachment" || insideTable) {
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
          if (!textAfter.includes("]") && !textAfter.includes("\n")) { setLinkQuery(textAfter); return; }
        }
        closeLinkSuggestInternal();
      }

      const textBefore2ForBlock = from >= 2 ? state.doc.textBetween(from - 2, from, "\n") : "";
      if (blockRefTriggerStart.current !== null) {
        const triggerStart = blockRefTriggerStart.current;
        if (from >= triggerStart + 2) {
          const textAfterTrigger = state.doc.textBetween(triggerStart + 2, from, "\n");
          if (!textAfterTrigger.includes(")") && !textAfterTrigger.includes("\n")) {
            setBlockRefQuery(textAfterTrigger);
            return;
          }
        }
        closeBlockRefSuggestInternal();
      }
      if (textBefore2ForBlock === "((") {
        blockRefTriggerStart.current = from - 2;
        setBlockRefQuery("");
        const coords = e.view.coordsAtPos(from);
        setBlockRefPos({ top: coords.bottom, left: coords.left });
        setBlockRefOpen(true);
      }

      const textBefore2 = from >= 2 ? state.doc.textBetween(from - 2, from, "\n") : "";
      const textBefore1 = from >= 1 ? state.doc.textBetween(from - 1, from, "\n") : "";
      if (textBefore2 === "[[") {
        linkBracketStart.current = from - 2; setLinkQuery("");
        const coords = e.view.coordsAtPos(from);
        setLinkPos({ top: coords.bottom, left: coords.left }); setLinkOpen(true); return;
      }
      if (textBefore1 === "/") {
        slashStartPos.current = from - 1; setSlashQuery("");
        const coords = e.view.coordsAtPos(from);
        setSlashPos({ top: coords.bottom + 6, left: coords.left, caretTop: coords.top - 6 }); setSlashOpen(true);
      }
    },
  });

  function closeSlashMenuInternal() { setSlashOpen(false); setSlashQuery(""); slashStartPos.current = null; slashFromBubble.current = false; }
  function closeLinkSuggestInternal() { setLinkOpen(false); setLinkQuery(""); linkBracketStart.current = null; }
  function closeBlockRefSuggestInternal() { setBlockRefOpen(false); setBlockRefQuery(""); blockRefTriggerStart.current = null; }
  function closeSlashMenu() { closeSlashMenuInternal(); editor?.commands.focus(); }
  function closeLinkSuggest() { closeLinkSuggestInternal(); editor?.commands.focus(); }
  function closeBlockRefSuggest() { closeBlockRefSuggestInternal(); editor?.commands.focus(); }

  useEffect(() => {
    if (!editor || !note?.content) return;
    syncBacklinks(noteId, extractNoteLinkIds(editor)).catch(console.error);
  }, [noteId]);

  useEffect(() => {
  enqueueNoteForIndexing(noteId).catch(console.warn)
}, [noteId])

const setActiveEditor = useUIStore((s) => s.setActiveEditor)

useEffect(() => {
  if (!editor) return
  setActiveEditor(editor)
  return () => setActiveEditor(null)
}, [editor])

useEffect(() => {
  if (!editor) return;
  const dom = editor.view.dom as HTMLElement;
  function handleEditorClick() {
    clearSearchHighlight(editor!);
  }
  dom.addEventListener("mousedown", handleEditorClick);
  return () => dom.removeEventListener("mousedown", handleEditorClick);
}, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          class: "tiptap h-full outline-none",
          "data-placeholder": "Start writing…",
          spellcheck: String(spellCheck),
        },
      },
    });
    const el = editor.view.dom as HTMLElement;
    el.setAttribute("spellcheck", String(spellCheck));
  }, [editor, spellCheck]);

  useEffect(() => {
    if (!scrollRef.current || initialScrollTop === 0) return;
    scrollRef.current.scrollTop = initialScrollTop;
  }, []);

  useEffect(() => {
    if (!titleRef.current) return;
    const isUntitledNote = /^Untitled-\d+$/.test(note?.title ?? "");
    if (isUntitledNote) {
      const t = setTimeout(() => {
        titleRef.current?.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        if (titleRef.current && sel) {
          range.selectNodeContents(titleRef.current);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 50);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onScrollChange) return;
    function handleScroll() { onScrollChange!(el!.scrollTop); }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [onScrollChange]);

  // Reload editor content when the store updates it (e.g. after loadNoteContent resolves)
  useEffect(() => {
    if (!editor || !note) return;
    const incoming = note.content ?? null;
    if (incoming === lastSavedContent.current) return;

    // Don't clobber user edits if editor is focused and already has real content
    if (editor.isFocused) {
      const current = JSON.stringify(editor.getJSON());
      const isEmpty = current === '{"type":"doc","content":[{"type":"paragraph"}]}'
        || current === '{"type":"doc","content":[]}';
      if (!isEmpty) {
        lastSavedContent.current = incoming;
        return;
      }
    }

    try {
      const incomingNorm = JSON.stringify(JSON.parse(incoming ?? "null"));
      const savedNorm    = JSON.stringify(JSON.parse(lastSavedContent.current ?? "null"));
      if (incomingNorm === savedNorm) {
        lastSavedContent.current = incoming;
        return;
      }
    } catch { /* malformed JSON — fall through */ }

    lastSavedContent.current = incoming;
    const timer = setTimeout(() => {
      if (editor.isDestroyed) return;
      // Re-check focus — don't overwrite if user started typing
      if (editor.isFocused) {
        const current = JSON.stringify(editor.getJSON());
        const isEmpty = current === '{"type":"doc","content":[{"type":"paragraph"}]}'
          || current === '{"type":"doc","content":[]}';
        if (!isEmpty) return;
      }

      const { from, to } = editor.state.selection;

      contentLoadingRef.current = true;
      editor.commands.setContent(incoming ? JSON.parse(incoming) : "");
      editor.view.dispatch(editor.state.tr.setMeta("preventAutoSave", true));
      setTimeout(() => { contentLoadingRef.current = false; }, 300);

      try {
        const $from = editor.state.doc.resolve(Math.min(from, editor.state.doc.content.size));
        if ($from.parent.isTextblock) {
          editor.commands.setTextSelection({ from, to });
        }
      } catch { /**/ }

      if (titleRef.current && !titleFocusedRef.current) {
        const isUntitled = /^Untitled-\d+$/.test(note.title);
        titleRef.current.textContent = isUntitled ? "" : note.title;
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [note?.content]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!note?.deleted_at);
  }, [editor, note?.deleted_at]);

  useEffect(() => {
    function handleContentUpdated(e: Event) {
      const { noteId: updatedId, content: freshContent } =
        (e as CustomEvent<{ noteId: string; content: string }>).detail;

      if (updatedId !== noteId || !editor) return;

      let parsed: unknown;
      try { parsed = JSON.parse(freshContent); } catch { return; }

      suppressSave.current = true;
      lastSavedContent.current = freshContent;
      editor.commands.setContent(parsed as import("@tiptap/core").Content, { emitUpdate: false });

      requestAnimationFrame(() => { suppressSave.current = false; });
    }

    window.addEventListener("idemora:content-updated", handleContentUpdated);
    return () => window.removeEventListener("idemora:content-updated", handleContentUpdated);
  }, [noteId, editor]);

  useEffect(() => {
    if (!editor || !note) return;
    if (!contentReady) return;
    if (subPageCreatingRef.current) return;

    const children = notes
      .filter((n) => n.parent_id === noteId && !n.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order);

    const apply = () => {
      if (editor.isDestroyed || editor.isFocused) return;
      if (subPageCreatingRef.current) return;

      const liveContent = JSON.stringify(editor.getJSON());
      const newContent = reconcileSubPageBlocks(liveContent, children);
      if (!newContent) return;

      contentLoadingRef.current = true;
      editor.commands.setContent(JSON.parse(newContent));
      editor.view.dispatch(editor.state.tr.setMeta("preventAutoSave", true));
      setTimeout(() => { contentLoadingRef.current = false; }, 300);
    };

    const t = setTimeout(apply, 80);
    return () => clearTimeout(t);
  }, [noteId, notes]);

 

 

  useEffect(() => {
    if (!editor || !note || !pendingScrollHeading || !isActiveTab) return;
    const timer = setTimeout(() => {
      const success = scrollToHeadingText(editor, pendingScrollHeading);
      if (success) setPendingScrollHeading(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [noteId, pendingScrollHeading, isActiveTab]);

  useEffect(() => {
    if (!editor || !note || !pendingScrollQuery || !isActiveTab) return;
    const timer = setTimeout(() => {
      const container = getScrollContainer(editor);
      scrollToQuery(editor, pendingScrollQuery, container, pendingScrollIndex);
      setTimeout(() => {
        if (!editor.isDestroyed) {
          scrollToQuery(editor, pendingScrollQuery, container, pendingScrollIndex);
          setPendingScrollQuery(null);
        }
      }, 400);
    }, 50);
    return () => clearTimeout(timer);
  }, [noteId, pendingScrollQuery, pendingScrollIndex, isActiveTab]);

  useEffect(() => {
    if (!editor || !isActiveTab) return;
    function handleInsertLink(e: Event) {
      const { noteId: linkedId, noteTitle } = (e as CustomEvent<{ noteId: string; noteTitle: string }>).detail;
      if (!editor) return;

      const { doc } = editor.state;
      const firstNode = doc.firstChild;

      const isLinksLine =
        firstNode?.type.name === "paragraph" &&
        firstNode.content.size > 0 &&
        (() => {
          let allLinks = true;
          firstNode.forEach((child) => {
            if (child.type.name !== "noteLink" && child.text?.trim() !== "") {
              allLinks = false;
            }
          });
          return allLinks;
        })();

      if (isLinksLine) {
        const insertPos = firstNode!.nodeSize - 1;
        editor!.chain().focus()
          .insertContentAt(insertPos, [
            { type: "text", text: " " },
            { type: "noteLink", attrs: { id: linkedId, label: noteTitle } },
          ])
          .run();
      } else {
        editor!.chain().focus()
          .insertContentAt(0, [{
            type: "paragraph",
            content: [{ type: "noteLink", attrs: { id: linkedId, label: noteTitle } }],
          }])
          .run();
      }
    }
    window.addEventListener("idemora:insert-link", handleInsertLink);
    return () => window.removeEventListener("idemora:insert-link", handleInsertLink);
  }, [editor, isActiveTab]);

  useEffect(() => {
    if (!editor || !isActiveTab) return;
    function handleInsertSubPage(e: Event) {
      const { noteId: subNoteId } = (e as CustomEvent<{ noteId: string }>).detail;
      if (!editor) return;
      const note = useNoteStore.getState().notes.find((n) => n.id === subNoteId);
      editor.chain().focus("end").insertContent([
        { type: "subPage", attrs: { noteId: subNoteId, title: note?.title ?? "Untitled", mode: "display" } },
        { type: "paragraph" },
      ]).run();
    }
    window.addEventListener("idemora:insert-subpage", handleInsertSubPage);
    return () => window.removeEventListener("idemora:insert-subpage", handleInsertSubPage);
  }, [editor, isActiveTab]);

  const onSaveComplete = useCallback((content: string, savedNoteId: string) => {
    lastSavedContent.current = content;
    if (!editor) return;
    syncBacklinks(savedNoteId, extractNoteLinkIds(editor)).catch(console.error);
  }, [editor]);

  useAutoSave({
    editor,
    noteId,
    isActiveTab,
    onSaveComplete,
    suppressSave,
    contentLoading: contentLoadingRef,
  });

  useEffect(() => {
    if (!slashOpen) return;
    function handle(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); closeSlashMenu(); } }
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, [slashOpen]);

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (!isActiveTab) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "h" && !e.shiftKey) {
        const inEditor = (e.target as HTMLElement).closest(".tiptap") !== null;
        if (!inEditor) { e.preventDefault(); setFindReplaceOpen(true); }
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [isActiveTab]);

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (!isActiveTab || activePaneId !== paneId) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (e.key === "g" && !e.shiftKey) {
        e.preventDefault();
        openGraphForNote(noteId);
        return;
      }
      if (e.key === "U" && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("idemora:ai-action", { detail: { action: "summarize" } }));
        return;
      }
      if (e.key === "E" && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("idemora:ai-action", { detail: { action: "explain" } }));
        return;
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [isActiveTab, activePaneId, paneId, noteId, openGraphForNote]);

  useEffect(() => {
    function handle() {
      if (isActiveTab && activePaneId === paneId) openGraphForNote(noteId);
    }
    window.addEventListener("idemora:open-local-graph", handle);
    return () => window.removeEventListener("idemora:open-local-graph", handle);
  }, [isActiveTab, activePaneId, paneId, noteId, openGraphForNote]);

  useEffect(() => {
    if (!editor) return;
    const s = editor.storage as unknown as Record<string, {
      parentNoteId: string;
      paneId: 1 | 2;
      setCreating: (v: boolean) => void;
    }>;
    if (s["subPage"]) {
      s["subPage"].paneId       = paneId;
      s["subPage"].parentNoteId = noteId;
      s["subPage"].setCreating  = (v) => { subPageCreatingRef.current = v; };
    }
  }, [editor, paneId, noteId]);

  useEffect(() => {
    function handleOpenChat(e: Event) {
      const { paneId: targetPane } = (e as CustomEvent).detail;
      if (targetPane === paneId) useUIStore.getState().openChat(paneId);
    }
    window.addEventListener("idemora:open-chat", handleOpenChat);
    return () => window.removeEventListener("idemora:open-chat", handleOpenChat);
  }, [paneId]);

  const getEditorLeft = useCallback(() => {
    if (!editorTextColumnRef.current) return 0;
    return editorTextColumnRef.current.getBoundingClientRect().left + 64;
  }, []);

  const { isDraggingRef } = useDragReorder({
    editor: editor ?? null,
    scrollRef,
    editorWrapRef,
    editorTextColumnRef,
    getEditorLeft,
  });

  // ── Early return — all hooks must be above this line ─────────────────────
if (!note) return null;
if (!contentReady) return null;

  const isUntitled = /^Untitled-\d+$/.test(note.title);

  function handleTitleFocus() { titleFocusedRef.current = true; }
  function handleTitleBlur() {
    titleFocusedRef.current = false;
    if (!note || note.deleted_at) return;
    const title = titleRef.current?.textContent?.trim() ?? "";
    if (!title || title === note.title) return;
    updateNote(note.id, { title });
  }
  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
    if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); }
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
      const isEmpty  = lastNode?.isTextblock && lastNode.content.size === 0;
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

  function handleSubPageCreate() {
    if (!editor) return;

    const pattern = /^Untitled-(\d+)$/;
    const used    = new Set<number>();
    for (const n of notes) { const m = n.title.match(pattern); if (m) used.add(parseInt(m[1], 10)); }
    let n = 1;
    while (used.has(n)) n++;
    const defaultTitle = `Untitled-${n}`;

    const subPageExt = editor.extensionManager.extensions.find((e) => e.name === "subPage");
    if (subPageExt) {
      const s = editor.storage as unknown as Record<string, { parentNoteId: string; paneId: 1 | 2 }>;
      s["subPage"].parentNoteId = noteId;
      s["subPage"].paneId = paneId;
    }

    const insertChain = editor.chain().focus();
    if (slashStartPos.current !== null) {
      insertChain.deleteRange({ from: slashStartPos.current, to: editor.state.selection.from });
    }
    insertChain
      .insertContent([
        { type: "subPage", attrs: { noteId: null, title: defaultTitle, mode: "editing" } },
        { type: "paragraph" },
      ])
      .run();

    closeSlashMenuInternal();
  }

  async function handleImageUpload() {
    if (!editor) return;
    const result = await uploadImageFromDisk();
    if (!result) return;
    editor.chain().focus().insertContent({ type: "image", attrs: { src: result.path, alt: result.name, width: null, align: "left" } }).run();
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
    editor.chain().focus().insertContent({ type: "attachment", attrs: { src: savedPath, filename: fileName, kind, size: bytes.length } }).run();
  }

  function handleThreeDots() {
    const pos = bubblePosRef.current ?? bubblePos;
    if (!pos) return;
    slashFromBubble.current = true; slashStartPos.current = null; setSlashQuery("");
    setSlashPos({ top: pos.top + 52, left: pos.left, caretTop: pos.top });
    setTimeout(() => setSlashOpen(true), 0);
  }

  function convertToToggle() {
    if (!editor) return;
    const { state } = editor;
    const { $from, $to } = state.selection;

    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name === "toggle") {
        const togglePos = $from.before(d);
        const textContent = node.textContent;
        editor.chain().focus().command(({ tr, state: s }) => {
          const paragraph = s.schema.nodes.paragraph.create(
            {},
            textContent ? s.schema.text(textContent) : undefined
          );
          tr.replaceWith(togglePos, togglePos + node.nodeSize, paragraph);
          return true;
        }).run();
        return;
      }
    }

    const blocks: { pos: number; node: import("@tiptap/pm/model").Node }[] = [];
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (parent?.type.name === "doc" && node.isBlock) {
        blocks.push({ pos, node });
        return false;
      }
    });

    if (blocks.length === 0) return;

    editor.chain().focus().command(({ tr, state: s }) => {
      for (let i = blocks.length - 1; i >= 0; i--) {
        const { pos, node } = blocks[i];
        const textContent = node.textContent;
        const inlineContent = textContent ? [s.schema.text(textContent)] : [];
        const summary = s.schema.nodes.toggleSummary.create({}, inlineContent);
        const para    = s.schema.nodes.paragraph.create();
        const body    = s.schema.nodes.toggleBody.create({}, para);
        const toggle  = s.schema.nodes.toggle.create({ open: false }, [summary, body]);
        tr.replaceWith(pos, pos + node.nodeSize, toggle);
      }
      return true;
    }).run();
  }

  function convertToTodo() {
    if (!editor) return;
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "taskItem") {
        editor.chain().focus().liftListItem("taskItem").run();
        return;
      }
    }
    editor.chain().focus().toggleTaskList().run();
  }

  function handleSortTaskList() {
    if (!editor) return;
    editor.chain().focus().sortTaskList().run();
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex flex-col flex-1 h-full overflow-hidden">

        {/* ── Editor nav bar ── */}
        <div className="flex items-center justify-between gap-2 px-3 h-9 shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => paneId === 2 ? pane2GoBack() : goBack()}
              disabled={!canGoBack}
              title="Go back (Ctrl+[)"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
            >
              <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
                <path d="M9 7H3M3 7l3.5-3.5M3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button
              onClick={() => paneId === 2 ? pane2GoForward() : goForward()}
              disabled={!canGoForward}
              title="Go forward (Ctrl+])"
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-25 disabled:cursor-not-allowed text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
            >
              <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
                <path d="M5 7h6M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <Breadcrumb noteId={noteId} paneId={paneId} />
          </div>

          {showEditorButtons && (
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className={`flex items-center gap-1.5 transition-all duration-200 ease-in-out overflow-hidden ${
                  rightPanelOpen ? "w-auto opacity-100" : "w-0 opacity-0"
                }`}
              >
                <button
                  onClick={() => {
                    const { openChat, closeChat } = useUIStore.getState();
                    if (chatActive) {
                      closeChat(paneId);
                      setRightPanelOpen(false);
                    } else {
                      openChat(paneId);
                      setRightPanelOpen(true);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all duration-150 border ${
                    chatActive
                      ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                      : "bg-idemora-bg-primary text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary border-idemora-border"
                  }`}
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 2.5h9a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 011 10V4a1.5 1.5 0 011.5-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                    <path d="M3.5 5h7M3.5 7h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                  </svg>
                  AI Chat
                </button>
              </div>
              <button
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-xs font-medium transition-all duration-150 border bg-idemora-bg-primary text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary border-idemora-border"
              >
                <svg
                  width="9" height="9" viewBox="0 0 9 9" fill="none"
                  className={`transition-transform duration-200 ${rightPanelOpen ? "" : "rotate-180"}`}
                >
                  <path d="M3 2l3 2.5L3 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => openGraphForNote(noteId)}
                className="flex items-center gap-1.5 px-2.5 h-7 rounded-full text-xs font-medium transition-all duration-150 bg-idemora-bg-primary text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary border border-idemora-border"
              >
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
                  <circle cx="2.5" cy="4" r="1.5" fill="currentColor"/>
                  <circle cx="11.5" cy="4" r="1.5" fill="currentColor"/>
                  <circle cx="2.5" cy="10" r="1.5" fill="currentColor"/>
                  <circle cx="11.5" cy="10" r="1.5" fill="currentColor"/>
                  <path d="M7 7L2.5 4M7 7l4.5-3M7 7l-4.5 3M7 7l4.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                </svg>
                Local Graph
              </button>
            </div>
          )}
        </div>

        {findReplaceOpen && editor && (
          <FindReplace editor={editor} onClose={() => { setFindReplaceOpen(false); editor.commands.focus(); }} />
        )}

        {editor && taskListToolbarPos && isActiveTab && (
          <div
            style={{ position: "fixed", top: taskListToolbarPos.top, left: taskListToolbarPos.left, zIndex: 40 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              onClick={handleSortTaskList}
              title="Sort: unchecked first, checked last"
              className="flex items-center gap-1.5 px-2.5 h-6 rounded-full text-xs font-medium transition-all duration-150 border bg-idemora-bg-primary text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary border-idemora-border shadow-sm"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M1.5 3h5M1.5 5.5h3.5M1.5 8h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M8.5 2v7M8.5 9l-1.5-1.5M8.5 9l1.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Sort
            </button>
          </div>
        )}

        {editor && hasSelection && bubblePos && (
          <div
            style={{ position: "fixed", top: bubblePos.top, left: bubblePos.left, zIndex: 40 }}
            className="flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-idemora-bg-primary border border-idemora-border shadow-xl"
            onMouseDown={(e) => { if ((e.target as HTMLElement).closest("button") === null) e.preventDefault(); }}
          >
            <BubbleBtn onClick={() => editor.chain().focus().toggleBold().run()}   active={editor.isActive("bold")}   title="Bold"><span className="font-bold text-sm">B</span></BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><span className="italic text-sm">I</span></BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough"><span className="line-through text-sm">S</span></BubbleBtn>
            <BubbleBtn onClick={() => editor.chain().focus().toggleCode().run()}   active={editor.isActive("code")}   title="Inline code"><span className="font-mono text-sm">{"<>"}</span></BubbleBtn>
            <div className="w-px h-4 bg-idemora-border mx-0.5" />
            <BubbleBtn onClick={convertToToggle} active={editor.isActive("toggle")} title="Convert to toggle">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M3 4l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M8 9.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </BubbleBtn>
            <BubbleBtn onClick={convertToTodo} active={editor.isActive("taskItem")} title="Convert to to-do">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="1.5" y="1.5" width="10" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M3.5 6.5l2 2 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </BubbleBtn>
            <div className="w-px h-4 bg-idemora-border mx-0.5" />
            <button onClick={handleThreeDots} title="More commands" className="w-8 h-7 flex items-center justify-center rounded-md text-idemora-text-normal hover:text-idemora-text-muted hover:bg-idemora-bg-secondary transition-colors duration-75">
              <span className="text-sm tracking-widest">···</span>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          <div ref={editorTextColumnRef} className="w-full mx-auto pl-16 pr-8 py-6 min-h-full max-w-4xl xl:max-w-240 2xl:max-w-5xl cursor-text" onClick={handleEditorAreaClick}>
            <FrontmatterEditor
              frontmatter={note.frontmatter ?? null}
              onChange={(frontmatter) => updateNote(note.id, { frontmatter })}
            />
            <h1
              ref={titleRef}
              contentEditable suppressContentEditableWarning spellCheck={false}
              autoCorrect="off" autoCapitalize="off"
              onFocus={handleTitleFocus} onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown} onPaste={handleTitlePaste}
              className="block w-full font-bold outline-none text-idemora-text-normal empty:before:content-[attr(data-placeholder)] empty:before:text-idemora-text-faint empty:before:pointer-events-none"
              style={{ fontSize: "3rem", lineHeight: 1.2 }}
              data-placeholder={isUntitled ? note.title : "Untitled"}
            >
              {isUntitled ? "" : note.title}
            </h1>

            <LastEdited timestamp={note.updated_at} />

            <TagBar noteId={note.id} tags={note.tags} />
            <div key={note.id} ref={editorWrapRef}>
              <EditorContent editor={editor} className="text-idemora-text-normal min-h-[60vh]" />
              <div className="h-[25vh]" />
            </div>
          </div>
          <SubPagesSection noteId={note.id} paneId={paneId} editor={editor ?? null} />
        </div>

        <StatusBar editor={editor ?? null} paneId={paneId} />
        {myVersionHistoryOpen && isActiveTab && <VersionHistory noteId={note.id} paneId={paneId} />}
      </div>

      {myOutlineOpen && editor && isActiveTab && <OutlinePanel editor={editor} paneId={paneId} />}
      {mySimilarOpen && isActiveTab && <SimilarNotesPanel noteId={note.id} paneId={paneId} />}
      {editor && <TableToolbar editor={editor} />}

      {slashOpen && editor && (
        <SlashMenu
          position={slashPos}
          editor={editor}
          query={slashQuery}
          noteId={noteId}
          paneId={paneId}
          onCommand={handleSlashCommand}
          onClose={closeSlashMenu}
          onImageUpload={handleImageUpload}
          onAttachmentUpload={handleAttachmentUpload}
          onSubPageCreate={handleSubPageCreate}
        />
      )}
      {linkOpen && editor && linkBracketStart.current !== null && (
        <NoteLinkSuggest position={linkPos} editor={editor} query={linkQuery} bracketStart={linkBracketStart.current} onClose={closeLinkSuggest} />
      )}
      {blockRefOpen && editor && blockRefTriggerStart.current !== null && (
        <BlockRefSuggest
          position={blockRefPos}
          editor={editor}
          query={blockRefQuery}
          triggerStart={blockRefTriggerStart.current}
          onClose={closeBlockRefSuggest}
        />
      )}
    </div>
  );
}

function BubbleBtn({ onClick, active, title, children }: {
  onClick: () => void; active: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`w-8 h-7 flex items-center justify-center rounded-md transition-colors duration-75 ${
        active ? "bg-idemora-bg-secondary text-idemora-text-normal" : "text-idemora-text-muted hover:text-idemora-text-normal hover:bg-idemora-bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}