// src/features/ai/components/ChatPanel.tsx
//
// RAG v3 — Milestone 8 + Phase 3 (M14 scope, save flow)

import { useEffect, useRef, useState, useCallback, useMemo, type ReactElement } from "react";
import { subscribeToIndexerStatus } from "@/features/ai/lib/indexer";
import { onRecovery } from "@/features/ai/lib/client";
import {
  streamChatWithNotes,
  streamChatWithTools,
  classifyActionIntent,
  runPipeline,
  runThoughtExtractionPass,
  type PipelineResult,
  type ChatMessage,
  type RelatedNote,
  type Tier1ResultCard,
} from "@/features/ai/lib/chat";
import type { ProviderMessage } from "@/features/ai/lib/client";
 
import { BatchConfirmationModal, BatchSummaryChip } from "@/features/ai/components/BatchConfirmationModal";
import {
  useConfirmationGate,
  type PendingWrite,
} from "@/features/ai/lib/tools/confirmationGate";

// ─── Batch grouping helper ─────────────────────────────────────────────────────
// Groups pending writes by batchId (all writes proposed in the same model
// turn). `?? pw.id` is a defensive fallback for any pending write that
// somehow lacks a batchId, so it still renders standalone rather than
// crashing the group-by.

function groupPendingWritesByBatch(writes: PendingWrite[]): PendingWrite[][] {
  const groups = new Map<string, PendingWrite[]>();
  for (const pw of writes) {
    const key = pw.batchId ?? pw.id;
    const arr = groups.get(key) ?? [];
    arr.push(pw);
    groups.set(key, arr);
  }
  return [...groups.values()];
}

import { clearAIHistory, clearConversationSummary, getAllDescendants, appendAIHistory } from "@/features/notes/db/queries";
import { useNoteStore }        from "@/features/notes/store/useNoteStore";
import { useUIStore }          from "@/features/ui/store/useUIStore";
import { useAIStore }          from "@/features/ai/store/useAIStore";
import { isAIReady }           from "@/features/ai/lib/client";
import type { AICallError }    from "@/features/ai/lib/client";
import { QuickSwitch }         from "@/features/ai/components/QuickSwitch";
import { SaveNoteDialog }      from "@/features/ai/components/SaveNoteDialog";
import { useChatSessionStore, emptySession } from "@/features/ai/store/useChatSessionStore"
import type { PersistedMeta } from "@/features/ai/store/useChatSessionStore"
import type { ExcludedTitleMatch } from "@/features/ai/lib/search/hybrid"
import { useAppSettings } from "@/features/ui/store/useAppSettings"
import { MessageRenderer } from "@/features/ai/components/MessageRenderer"
import {
  WEB_SEARCH_PROVIDERS,
  getWebSearchProvider,
  type WebSearchResult,
} from "@/features/ai/lib/search/webSearchProvider"
import { detectIntent } from "@/features/ai/lib/search/intentDetection"
import { onExplicitClear } from "@/features/ai/lib/memory/episodeManager"
import { looksLikeCodeBlob, wrapAsCodeFence } from "@/lib/looksLikeCode"

// Queries containing pasted/quoted content (captions, lists, long blocks of text)
// can't be reliably compressed into one search phrase — cutting them down
// (by position, by colon, by word count) either drops the substantive content
// or keeps only generic instruction text, producing junk search results either
// way. Rather than guess, treat these as "not auto-searchable": skip auto-fire
// and let the user manually search with their own chosen phrasing instead.
function isAutoSearchable(raw: string): boolean {
  const trimmed = raw.trim()
  if (trimmed.includes('"') || trimmed.includes("\n")) return false
  const words = trimmed.split(/\s+/).filter(Boolean)
  return words.length <= 20
}

// Detects the model narrating a write as done ("I've created...", "Done!")
// in its own text. Used ONLY as a secondary check when we already know no
// write was registered at the gate for this message — kept narrow (first-
// person action claims) to avoid flagging unrelated uses of these words,
// e.g. "this note was created in 2024".
// KNOWN LIMITATION: checked once per whole turn, not per tool-loop iteration —
// if one real write happens early in a turn and a later iteration falsely
// claims a second action with no tool call, this will not catch it.
function containsUnverifiedWriteClaim(text: string): boolean {
  return /\b(I(?:'ve| have) (?:created|deleted|updated|added|moved|replaced|removed)|has been (?:created|deleted|updated|added|moved|replaced|removed)|Done!|successfully (?:created|deleted|updated|added|moved))\b/i.test(text)
}

const LONG_PASTE_CHAR_THRESHOLD = 3000
const LONG_PASTE_LINE_THRESHOLD = 80

function detectLongPaste(pasted: string): { label: string; lineCount: number; charCount: number } | null {
  const lineCount = pasted.split("\n").length
  const charCount = pasted.length
  if (charCount <= LONG_PASTE_CHAR_THRESHOLD && lineCount <= LONG_PASTE_LINE_THRESHOLD) return null
  const firstLine = pasted.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "Pasted content"
  return {
    label: firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine,
    lineCount,
    charCount,
  }
}

// Detects Shift+Enter pressed on an ordered ("1. ") or unordered ("- "/"* ")
// list line and returns what to do about it — continue the list with the
// next marker, or (if the current item is empty) strip the marker and drop
// out of the list, mirroring Claude/Slack/GitHub's textarea list behavior.
// Returns null when the current line isn't a list item, so the caller falls
// through to a plain newline.
function getListContinuation(
  text: string,
  cursorPos: number,
): { insertText: string; removeLine: boolean; lineStart: number } | null {
  const lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1
  const lineText  = text.slice(lineStart, cursorPos)

  const ordered   = lineText.match(/^(\s*)(\d+)\.\s(.*)$/)
  const unordered = lineText.match(/^(\s*)([-*])\s(.*)$/)
  if (!ordered && !unordered) return null

  const [, indent, marker, content] = ordered
    ? [ordered[0], ordered[1], ordered[2] + ".", ordered[3]]
    : (unordered as RegExpMatchArray)

  if (content.trim() !== "") {
    const nextMarker = ordered ? `${parseInt(ordered[2], 10) + 1}. ` : `${marker} `
    return { insertText: `\n${indent}${nextMarker}`, removeLine: false, lineStart }
  }

  // Empty item — only exit (strip the marker) if the line above is ALSO an
  // empty list item of the same kind (classic double-Enter-to-exit). Otherwise
  // this is just the first item with no content typed yet — leave it alone
  // and insert a plain newline instead of deleting anything.
  const prevLineEnd   = lineStart - 1
  const prevLineStart = prevLineEnd >= 0 ? text.lastIndexOf("\n", prevLineEnd - 1) + 1 : -1
  const prevLineText  = prevLineStart >= 0 ? text.slice(prevLineStart, prevLineEnd) : ""
  const prevWasEmptyListItem = /^(\s*)(\d+\.|[-*])\s*$/.test(prevLineText)

  if (prevWasEmptyListItem) {
    return { insertText: "", removeLine: true, lineStart }
  }
  return null
}

interface Props {
  noteId: string;
  paneId: 1 | 2 | 3;
  // embedded: true when rendered as the floating chat panel inside Thought
  // Graph mode (GraphView) rather than a normal docked pane. Suppresses the
  // outer width/border/background chrome (the parent already supplies its
  // own) and swaps the header close button from closeChat(paneId) to
  // onCloseEmbedded, since there is no real dockable pane being closed here.
  embedded?: boolean;
  onCloseEmbedded?: () => void;
}

interface MessageMeta {
  sourceTitles:        string[];
  sourceNoteIds:       string[];
  citationNumbers?:    number[];
  usedEmbeddings:      boolean;
  confidence:          "high" | "medium" | "low";
  relatedNotes:        RelatedNote[];
  tier1Results?:       Tier1ResultCard[];
  excludedNoteNotices?: ExcludedTitleMatch[];
  titleMatchedNoteIds?: string[];
  webNudge?:            "limited" | "zero";
  webGrounded?:         boolean;
}

// ─── Toast system ─────────────────────────────────────────────────────────────

interface Toast {
  id:        string;
  message:   string;
  prominent: boolean;
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, prominent = false) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, prominent }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, prominent ? 5000 : 3000);
  }, []);

  return { toasts, addToast };
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-10 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-3 py-2 rounded-lg shadow-lg border text-xs font-medium animate-fade-in ${
            toast.prominent
              ? "bg-violet-500 text-white border-violet-600"
              : "bg-idemora-bg-primary text-idemora-text-normal border-idemora-border"
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

 

// ─── Quota exhausted card ─────────────────────────────────────────────────────

function QuotaExhaustedCard({ onRetry }: { onRetry: () => void }) {
  const hasAnyValidKey = useAIStore((s) => s.hasAnyValidKey);
  return (
    <div className="mx-3 mt-2 rounded-lg border border-red-100 bg-red-50/40 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-red-400 shrink-0">
          <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5.5 3.5v2.5M5.5 7.5v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <p className="text-xs font-semibold text-red-600">All providers exhausted</p>
      </div>
      <p className="text-[11px] text-red-500 leading-relaxed">
        Daily quota reached on all configured providers. Add a new key or wait for quota reset.
      </p>
      <div className="flex items-center gap-2 pt-0.5">
        <button
          onClick={onRetry}
          disabled={!hasAnyValidKey()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-600 border border-red-200 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
        >
          Retry
        </button>
        <p className="text-[10px] text-red-400">
          {hasAnyValidKey()
            ? "A key is available — tap retry to try again."
            : "Add a key in Settings → AI to continue."}
        </p>
      </div>
    </div>
  );
}

// ─── WebNudge component ──────────────────────────────────────────────────────

function WebNudge({
  messageId,
  nudge,
  query,
  onSearchComplete,
  onDismiss,
}: {
  messageId:        string;
  nudge:            "limited" | "zero";
  query:            string;
  onSearchComplete: (messageId: string, results: WebSearchResult[]) => void;
  onDismiss:        (messageId: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const { settings }              = useAppSettings();

  const provider = WEB_SEARCH_PROVIDERS.find(
    (p) => p.id === (settings.web_search_provider ?? "tinyfish")
  ) ?? WEB_SEARCH_PROVIDERS[0];

  const missingKey = provider.requiresKey && !(settings.web_search_api_key ?? "").trim();

  async function handleSearch() {
    if (missingKey) {
      setError(`Web search requires a ${provider.label.split(" ")[0]} API key. Add it in Settings → Web Search.`);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const p       = getWebSearchProvider();
      const results = await p.search(query);
      onSearchComplete(messageId, results);
    } catch {
      setError("Search failed. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  const copy = nudge === "zero"
    ? "Nothing found in your notes."
    : "Limited results from your notes.";

  return (
    <div className="mx-4 mb-2 ml-9 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="text-sky-400 shrink-0">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1"/>
            <path d="M4.5 1.5C3.8 2.5 3.4 3.4 3.4 4.5s.4 2 1.1 3M4.5 1.5C5.2 2.5 5.6 3.4 5.6 4.5s-.4 2-1.1 3M1.5 4.5h6"
              stroke="currentColor" strokeWidth="0.7" strokeLinecap="round"/>
          </svg>
          <span className="text-[11px] text-idemora-text-muted">{copy}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSearch}
            disabled={searching}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-50/40 text-sky-500 border border-sky-200 hover:bg-sky-100/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
          >
            {searching ? (
              <svg width="9" height="9" viewBox="0 0 9 9" className="animate-spin" fill="none">
                <circle cx="4.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="9 4" strokeLinecap="round"/>
              </svg>
            ) : "Search the web"}
          </button>
          <button
            onClick={() => onDismiss(messageId)}
            className="px-2 py-0.5 rounded text-[10px] text-idemora-text-muted hover:text-idemora-text-normal border border-transparent hover:border-idemora-border transition-colors duration-100"
          >
            Dismiss
          </button>
        </div>
      </div>
      {error && (
        <p className="text-[10px] text-amber-500 leading-relaxed">{error}</p>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatPanel({ noteId, paneId, embedded = false, onCloseEmbedded }: Props) {
  // messages and persistedMeta live in the store — not local state
  const [runtimeMetaMap, setRuntimeMetaMap] = useState<Map<string, Partial<MessageMeta>>>(new Map());
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [callError, setCallError]   = useState<AICallError | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [indexingPaused, setIndexingPaused] = useState(false);
  const [allExhausted, setAllExhausted]     = useState(false);
  // retryCountdown removed — auto-retry replaced with manual retry button
  // Track which user message triggered the current error (for inline error placement)
  const [errorAfterMessageId, setErrorAfterMessageId] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [embeddingWarningDismissed, setEmbeddingWarningDismissed] = useState(false);
  const [oneTimeInclusions, setOneTimeInclusions] = useState<Set<string>>(new Set());
  const [selectedMessage, setSelectedMessage] = useState<{
    user:      { role: "user" | "assistant"; content: string };
    assistant: { role: "user" | "assistant"; content: string };
  } | null>(null);
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());
  // Message ids currently running a manually-triggered thought extraction pass —
  // drives the button's loading state so a double-click can't fire it twice.
  const [extractingThoughtIds, setExtractingThoughtIds] = useState<Set<string>>(new Set());
  const [pendingAttachments, setPendingAttachments] = useState<
    { id: string; label: string; lineCount: number; charCount: number; content: string }[]
  >([]);
  const MAX_PENDING_ATTACHMENTS = 5;
  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);
  const [webResultsMap, setWebResultsMap] = useState<Map<string, WebSearchResult[]>>(new Map());
  const [suppressedNudges, setSuppressedNudges] = useState<Set<string>>(new Set());
  const [pendingWrites, setPendingWrites] = useState<Map<string, PendingWrite>>(new Map());

  // Keep local pendingWrites in sync with gate store status changes
  useEffect(() => {
    // Seed with the store's CURRENT state immediately — subscribe() only fires
    // on future changes, so without this, any write already pending before
    // this mount (e.g. panel was closed/reopened) is invisible to this
    // component forever, even though the gate itself still blocks new writes.
    setPendingWrites(new Map(useConfirmationGate.getState().pendingWrites));

    return useConfirmationGate.subscribe((state) => {
      setPendingWrites(new Map(state.pendingWrites));
    });
  }, []);

  // Which batch's modal is currently open (at most one at a time). null means
  // "nothing forced open" — resolved/queued batches collapse to an inline
  // BatchSummaryChip in the message list and can be reopened anytime by
  // clicking it, for as long as the chat session is alive.
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  useEffect(() => {
    if (openBatchId) return; // don't steal focus from something the user is actively reviewing
    const groups = groupPendingWritesByBatch([...pendingWrites.values()]);
    const nextPendingBatch = groups
      .filter((g) => {
        const active = g.filter((w) => w.status !== "cancelled")
        return active.length > 1 && active.some((w) => w.status === "pending")
      })
      .sort((a, b) => a[0].createdAt - b[0].createdAt)[0];
    if (nextPendingBatch) setOpenBatchId(nextPendingBatch[0].batchId);
  }, [pendingWrites, openBatchId]);
  const { toasts, addToast } = useToasts();

  const messagesEndRef    = useRef<HTMLDivElement>(null);
  const inputRef          = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const prevProviderRef = useRef<string | null>(null);
  const prevModelRef    = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null)

  const ragScopeRef    = useRef<"all" | "note">("all");
  const linkedNoteRef  = useRef<string | null>(null);

  const notes          = useNoteStore((s) => s.notes);
  const openTab        = useUIStore((s) => s.openTab);
  const openTabInPane2 = useUIStore((s) => s.openTabInPane2);
  const closeChat      = useUIStore((s) => s.closeChat);
  const setProviderStatus = useAIStore((s) => s.setProviderStatus);
  const primarySlot    = useAIStore((s) => s.primarySlot);
  
  const aiReady    = isAIReady();
  const isFreeTier = !aiReady;
  const currentNote = notes.find((n) => n.id === noteId);

  const setPaneNote       = useChatSessionStore((s) => s.setPaneNote);
  const addMessage        = useChatSessionStore((s) => s.addMessage);
  const setMessageContent = useChatSessionStore((s) => s.setMessageContent);
  const setPersistedMeta  = useChatSessionStore((s) => s.setPersistedMeta);
  const saveSession       = useChatSessionStore((s) => s.saveSession);
  const setLinkedNote     = useChatSessionStore((s) => s.setLinkedNote);
  const stampSavedAt      = useChatSessionStore((s) => s.stampSavedAt);
  const clearSession      = useChatSessionStore((s) => s.clearSession);
  const setRagScope       = useChatSessionStore((s) => s.setRagScope);
  const paneNoteId      = useChatSessionStore((s) => s.paneNoteId[paneId])
  const _sessions       = useChatSessionStore((s) => s.sessions)
  const _session        = (paneNoteId ? _sessions[paneNoteId] : null) ?? emptySession()
  const messages        = _session.messages
  const ragScope        = _session.ragScope
  const persistedMeta   = _session.persistedMeta
  const linkedNoteId    = _session.linkedNoteId
  const linkedNoteTitle = _session.linkedNoteTitle
  const linkedNoteTrashed = _session.linkedNoteTrashed
  const linkedNoteDeleted = _session.linkedNoteDeleted
  const isLoading       = _session.isLoading

  // Merge persisted + runtime meta for rendering
  const metaMap = useMemo(() => {
    const map = new Map<string, MessageMeta>(
      persistedMeta.map((pm) => {
        const runtime = runtimeMetaMap.get(pm.messageId) ?? {}
        return [pm.messageId, {
          sourceTitles:        runtime.sourceTitles        ?? pm.citations?.map(c => c.title) ?? [],
          sourceNoteIds:       runtime.sourceNoteIds       ?? pm.citations?.map(c => c.noteId) ?? [],
          citationNumbers:     runtime.citationNumbers     ?? pm.citations?.map(c => c.citationNumber ?? 0) ?? [],
          usedEmbeddings:      pm.usedEmbeddings           ?? false,
          confidence:          pm.confidence               ?? "medium",
          relatedNotes:        runtime.relatedNotes        ?? [],
          tier1Results:        runtime.tier1Results,
          excludedNoteNotices: runtime.excludedNoteNotices ?? [],
          titleMatchedNoteIds: pm.citations?.filter(c => c.isTitleMatch).map(c => c.noteId) ?? [],
          webNudge:            runtime.webNudge,
          webGrounded:         pm.usedWeb                  ?? false,
        }]
      })
    )
    for (const [id, runtime] of runtimeMetaMap) {
      if (!map.has(id)) {
        map.set(id, {
          sourceTitles:        runtime.sourceTitles        ?? [],
          sourceNoteIds:       runtime.sourceNoteIds       ?? [],
          citationNumbers:     runtime.citationNumbers     ?? [],
          usedEmbeddings:      runtime.usedEmbeddings      ?? false,
          confidence:          runtime.confidence          ?? "medium",
          relatedNotes:        runtime.relatedNotes        ?? [],
          tier1Results:        runtime.tier1Results,
          excludedNoteNotices: runtime.excludedNoteNotices ?? [],
          titleMatchedNoteIds: runtime.titleMatchedNoteIds ?? [],
          webNudge:            runtime.webNudge,
          webGrounded:         runtime.webGrounded         ?? false,
        })
      }
    }
    return map
  }, [persistedMeta, runtimeMetaMap])

  const appWebSearch        = useAppSettings((s) => s.settings.web_search_enabled === 1)
  const { settings }        = useAppSettings()
  const autoSearch          = settings.web_search_auto_search === 1

useEffect(() => {
  if (!autoSearch || !appWebSearch) return

  const lastMsg = messages[messages.length - 1]
  if (!lastMsg || lastMsg.role !== "assistant") return
  const meta = metaMap.get(lastMsg.id)
  if (!meta || !meta.webNudge) return
  if (dismissedNudges.has(lastMsg.id)) return
  if (webResultsMap.has(lastMsg.id)) return

  // webNudge is derived from retrieval signals (pipeline confidence/chunk
  // count) in deriveWebNudge, not from whether the resulting answer was
  // actually thin — low retrieval confidence can still produce a full,
  // substantive answer (e.g. synthesized from adjacent vault content).
  // Without this guard, autoSearch fired unconditionally whenever webNudge
  // was set, silently appending an entire second full-pipeline answer as a
  // new assistant bubble underneath a first answer that was already
  // complete. Mirrors the looksLikeNonAnswer heuristic already used to gate
  // the equivalent case inside chat.ts's RELEVANT:no fallback.
  const looksLikeNonAnswer =
    lastMsg.content.trim().split(/\s+/).filter(Boolean).length < 60 ||
    /\b(i don'?t have|not found in|cannot find|no information|nothing in your notes)\b/i.test(lastMsg.content)
  if (!looksLikeNonAnswer) return

  const prevMsg = messages[messages.length - 2]
  const userQuery = prevMsg?.role === "user" ? prevMsg.content : ""
  if (!userQuery) return

  // Run async logic in a nested async IIFE — useEffect callbacks can't be async directly
  void (async () => {
    const { intent } = await detectIntent(userQuery)
    if (intent === "edit" || intent === "inventory" || intent === "exploration") return
    const words = userQuery.trim().split(/\s+/)
    const QUESTION_WORDS = /\b(what|who|how|why|when|where|does|is|can|which)\b/i
    if (words.length <= 8 && !QUESTION_WORDS.test(userQuery)) return

    // Skip auto-fire for queries with pasted content, quotes, or long lists —
    // there's no reliable way to compress these into one search phrase. The
    // manual "Search the web" nudge button is still available for the user.
    if (!isAutoSearchable(userQuery)) {
      console.log('[autoSearch] skipping — query not auto-searchable:', userQuery.slice(0, 60))
      return
    }

    console.log('[autoSearch] firing auto web search for:', userQuery)
    setSuppressedNudges((prev) => new Set(prev).add(lastMsg.id))
    const provider = getWebSearchProvider()
    provider.search(userQuery).then((results) => {
      console.log('[autoSearch] search results:', results.length, results[0])
      if (results.length === 0) {
        setDismissedNudges((prev) => new Set(prev).add(lastMsg.id))
        return
      }
      handleWebSearch(userQuery, results)
    }).catch(console.error)
  })()
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [messages, metaMap, autoSearch, dismissedNudges, webResultsMap])

  useEffect(() => {
    console.log('[ragScope sync] ragScope changed to:', ragScope)
    ragScopeRef.current = ragScope;
  }, [ragScope]);
  useEffect(() => { linkedNoteRef.current = linkedNoteId; }, [linkedNoteId]);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return subscribeToIndexerStatus((status) => setIndexingPaused(status.paused));
  }, []);

useEffect(() => {
  return onRecovery(() => {
    setAllExhausted(false);
    setCallError(null);                 
    setErrorAfterMessageId(null);       
    addToast("Connection restored — ready to chat", true);
  });
}, [addToast]);

  const primaryRotation = useAIStore((s) => s.primaryRotation);
  useEffect(() => {
    if (prevProviderRef.current === null) {
      prevProviderRef.current = primaryRotation.provider;
      prevModelRef.current    = primaryRotation.model;
      return;
    }
    if (primaryRotation.provider !== prevProviderRef.current) {
      addToast(`Switched to ${primaryRotation.provider} — previous provider quota reached`, true);
    } else if (primaryRotation.model !== prevModelRef.current) {
      addToast(`Switched to ${primaryRotation.model}`);
    }
    prevProviderRef.current = primaryRotation.provider;
    prevModelRef.current    = primaryRotation.model;
  }, [primaryRotation, addToast]);

  useEffect(() => {
    if (callError?.code === "ALL_EXHAUSTED") setAllExhausted(true);
  }, [callError]);

  // ── Network error: auto-retry with countdown, but also allow immediate retry ──
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);



  useEffect(() => {
    if (!streamingId) return
    const el = scrollContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom < 100) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, streamingId]);

  useEffect(() => {
    if (!streamingId) return
    const el = scrollContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom < 100) {
      const t = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      }, 80)
      return () => clearTimeout(t)
    }
  }, [streamingId]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [noteId]);

  useEffect(() => {
    setPaneNote(paneId, noteId)
    setCallError(null)
    setErrorAfterMessageId(null)
    setDismissedNudges(new Set())
    setWebResultsMap(new Map())
    setSuppressedNudges(new Set())
    setRuntimeMetaMap(new Map())
  }, [noteId]);

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    function onScroll() {
      const distFromBottom = el!.scrollHeight - el!.scrollTop - el!.clientHeight
      setShowScrollBtn(distFromBottom > 100)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, []);

  useEffect(() => {
    if (!linkedNoteId) return;
    return useNoteStore.subscribe((state) => {
      const linkedId = useChatSessionStore.getState().getSession(paneId).linkedNoteId;
      if (!linkedId) return;
      const { markLinkedNoteTrashed, markLinkedNoteDeleted, markLinkedNoteRestored, setLinkedNoteTitle } =
        useChatSessionStore.getState();
      const activeNote = state.notes.find((n) => n.id === linkedId);
      if (activeNote) {
        if (linkedNoteTrashed) markLinkedNoteRestored(noteId, activeNote.title);
        if (activeNote.title !== linkedNoteTitle) setLinkedNoteTitle(noteId, activeNote.title);
        return;
      }
      const trashedNote = state.trashedNotes?.find((n) => n.id === linkedId);
      if (trashedNote) { markLinkedNoteTrashed(noteId); return; }
      if (!linkedNoteDeleted) markLinkedNoteDeleted(noteId);
    });
  }, [paneId, linkedNoteId, linkedNoteTrashed, linkedNoteDeleted, linkedNoteTitle]);

  // ── Scope resolution ───────────────────────────────────────────────────────

  const resolveScopeNoteIds = useCallback(async (extraNoteIds?: string[]): Promise<string[] | undefined> => {
    console.log('[scope] ragScope:', ragScopeRef.current, 'noteId:', noteId, 'currentNote:', currentNote?.title)
    if (ragScopeRef.current === "all" && (!extraNoteIds || extraNoteIds.length === 0)) return undefined
    let base: string[] = []
    if (ragScopeRef.current === "note") {
      const descendants = await getAllDescendants(noteId)
      base = [noteId, ...descendants.map((d: { id: string }) => d.id)]
      console.log('[scope] resolved noteIds:', base)
    }
    const merged = [...new Set([...base, ...(extraNoteIds ?? [])])]
    return merged.length > 0 ? merged : undefined
  }, [noteId])

  // ── Thought Graph extraction ─────────────────────────────────────────────
  //
  // Called after every streamChatWithNotes-based reply (handleSend, handleRetry,
  // handleWebSearch, handleOneTimeInclusion) resolves — thought extraction is
  // about the CONTENT of a chat answer, not about which pipeline produced it,
  // so it stays orthogonal to the action-intent routing. streamChatWithTools
  // already runs its own extraction pass internally for action-mode turns —
  // this covers everything else.
  const maybeRunThoughtExtraction = useCallback(async (
    query:           string,
    assistantId:     string,
    historyMessages: ChatMessage[],
  ) => {
    try {
      const { intent, isFollowUp } = await detectIntent(query)
      if (intent === "edit" || intent === "inventory" || isFollowUp) return

      const answerContent = useChatSessionStore.getState().getSessionByNoteId(noteId)
        .messages.find((m) => m.id === assistantId)?.content ?? ""
      if (!answerContent) return

      const providerMessages: ProviderMessage[] = [
        ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user",      content: query },
        { role: "assistant", content: answerContent },
      ]

      await runThoughtExtractionPass({
        noteId,
        currentNote,
        messages:           providerMessages,
        batchId:            crypto.randomUUID(),
        assistantMessageId: assistantId,
        onPendingWrite:     (pw) => setPendingWrites((prev) => new Map(prev).set(pw.id, pw)),
      })
    } catch (err) {
      console.warn("[maybeRunThoughtExtraction] failed:", err)
    }
  }, [noteId, currentNote])

  // ── Manual thought-graph trigger ──────────────────────────────────────────
  //
  // Unlike maybeRunThoughtExtraction (fired automatically after every RAG
  // answer), this is invoked explicitly via the message footer button and
  // deliberately skips the intent/isFollowUp guard — those guards exist to
  // stop AUTOMATIC extraction from firing on routine exchanges, but a user
  // who explicitly clicks "add to thought graph" has already made that
  // judgment call themselves. This covers two real gaps: (1) messages where
  // automatic extraction was skipped (edit/inventory/follow-up intent, or the
  // model simply proposed nothing), and (2) letting the user override the
  // model's own "nothing worth tracking" judgment.
  const handleManualThoughtExtraction = useCallback(async (assistantId: string) => {
    if (extractingThoughtIds.has(assistantId)) return

    const currentMessages = useChatSessionStore.getState().getSessionByNoteId(noteId).messages
    const assistantIndex  = currentMessages.findIndex((m) => m.id === assistantId)
    if (assistantIndex <= 0) return

    const assistantMsg = currentMessages[assistantIndex]
    if (!assistantMsg.content) return

    // Standard alternation assumption (user directly precedes its assistant
    // reply) — holds for every message-adding path in this file.
    const userMsg = currentMessages[assistantIndex - 1]
    if (userMsg.role !== "user") return

    const historyMessages = currentMessages.slice(0, assistantIndex - 1)

    setExtractingThoughtIds((prev) => new Set(prev).add(assistantId))
    try {
      const providerMessages: ProviderMessage[] = [
        ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user",      content: userMsg.content },
        { role: "assistant", content: assistantMsg.content },
      ]

      await runThoughtExtractionPass({
        noteId,
        currentNote,
        messages:           providerMessages,
        batchId:            crypto.randomUUID(),
        assistantMessageId: assistantId,
        onPendingWrite:     (pw) => setPendingWrites((prev) => new Map(prev).set(pw.id, pw)),
      })
      addToast("Checked for thought nodes")
    } catch (err) {
      console.warn("[handleManualThoughtExtraction] failed:", err)
      addToast("Couldn't extract thought nodes — try again")
    } finally {
      setExtractingThoughtIds((prev) => {
        const next = new Set(prev)
        next.delete(assistantId)
        return next
      })
    }
  }, [noteId, currentNote, extractingThoughtIds, addToast])

  // ── handleWebSearch ────────────────────────────────────────────────────────
  async function handleDirectWebSearch() {
    const typed = input.trim()
    const attachmentText = pendingAttachments.map((a) => a.content).join("\n\n")
    const q = attachmentText
      ? (typed ? `${attachmentText}\n\n${typed}` : attachmentText)
      : typed
    if (!q || loading) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: "user", content: q, createdAt: Date.now(),
      ...(pendingAttachments.length > 0 ? { attachments: pendingAttachments } : {}),
    }
    addMessage(noteId, userMsg)
    setInput("")
    clearPendingAttachments()
    if (inputRef.current) inputRef.current.style.height = "auto"
    setLoading(true)
    setStreamStatus("Searching…")

    try {
      const scopeNoteIds = await resolveScopeNoteIds()

      const [webResults, pipeline] = await Promise.all([
        getWebSearchProvider().search(q).catch(() => [] as WebSearchResult[]),
        runPipeline(q, currentNote, scopeNoteIds, undefined, setStreamStatus),
      ])

      await handleWebSearch(q, webResults, scopeNoteIds, pipeline)
    } catch {
      setLoading(false)
      setStreamStatus(null)
    }
  }

  async function handleWebSearch(
    userQuery:             string,
    webResults:            WebSearchResult[],
    resolvedScopeNoteIds?: string[],
    prebuiltPipeline?:     PipelineResult,
  ) {
    const assistantId = crypto.randomUUID()
    setWebResultsMap((prev) => new Map(prev).set(assistantId, webResults))
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
    }

    addMessage(noteId, assistantMsg)
    await saveSession(noteId)
    setLoading(true)
    setStreamingId(assistantId)
    setCallError(null)
    setErrorAfterMessageId(null)
    setStreamStatus(prebuiltPipeline ? "Generating answer…" : "Searching the web…")

    const scopeNoteIds = resolvedScopeNoteIds ?? await resolveScopeNoteIds()

    try {
      const meta = await streamChatWithNotes(
        userQuery,
        notes,
        noteId,
        currentNote,
        scopeNoteIds,
        {
          onChunk: (token) => {
            const current  = useChatSessionStore.getState().getSessionByNoteId(noteId)
            const existing = current.messages.find(m => m.id === assistantId)
            setMessageContent(noteId, assistantId, (existing?.content ?? "") + token)
            setStreamStatus(null)
          },
          onDone:  () => { setStreamStatus(null); setStreamingId(null); setLoading(false) },
          onError: (err) => { setStreamStatus(null); setStreamingId(null); setLoading(false); setCallError(err) },
          onStatus: (msg) => setStreamStatus(msg),
        },
        undefined,
        webResults,
        prebuiltPipeline,
        useChatSessionStore.getState().getSessionByNoteId(noteId).messages.slice(0, -2),
      )

      const pm: PersistedMeta = {
        messageId:      assistantId,
        confidence:     meta.confidence,
        citations:      meta.sourceTitles.map((title, i) => ({
          noteId:         meta.sourceNoteIds[i],
          title,
          isTitleMatch:   meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
          citationNumber: meta.citationNumbers?.[i],
        })),
        usedWeb:        meta.webNudge !== undefined,
        usedEmbeddings: meta.usedEmbeddings,
      }
      setPersistedMeta(noteId, assistantId, pm)
      await saveSession(noteId)

      setRuntimeMetaMap((prev) => new Map(prev).set(assistantId, {
        sourceTitles:        meta.sourceTitles,
        sourceNoteIds:       meta.sourceNoteIds,
        citationNumbers:     meta.citationNumbers,
        relatedNotes:        meta.relatedNotes,
        tier1Results:        meta.tier1Results,
        excludedNoteNotices: meta.excludedNoteNotices,
        titleMatchedNoteIds: meta.titleMatchedNoteIds,
        webNudge:            meta.webNudge,
      }))

      // A response that already used web search should never show its own
      // "search the web" nudge — mirrors the suppression handleSend applies.
      if (meta.webGrounded) {
        setSuppressedNudges((prev) => new Set(prev).add(assistantId))
      }

      void maybeRunThoughtExtraction(
        userQuery,
        assistantId,
        useChatSessionStore.getState().getSessionByNoteId(noteId).messages.slice(0, -2),
      )
    } catch { /* errors handled by onError above */ }
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    console.log('[handleSend] ragScopeRef:', ragScopeRef.current, 'ragScope:', ragScope)
    const typed = input.trim();
    const attachmentText = pendingAttachments.map((a) => a.content).join("\n\n");
    const q = attachmentText
      ? (typed ? `${attachmentText}\n\n${typed}` : attachmentText)
      : typed;
    if (!q || loading || isFreeTier) return;

    const userMsgId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: userMsgId, role: "user", content: q, createdAt: Date.now(),
      ...(pendingAttachments.length > 0 ? { attachments: pendingAttachments } : {}),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
    };

    addMessage(noteId, userMsg);
    addMessage(noteId, assistantMsg);
    await saveSession(noteId);
    setInput("");
    clearPendingAttachments();
    if (inputRef.current) {
      inputRef.current.style.height = "auto"
    }
    setLoading(true);
    setCallError(null);
    setErrorAfterMessageId(null);
    setStreamingId(assistantId);  // set LAST — this is what gates the typing indicator
    // streamStatus will be set by onStatus callback from the pipeline

    let errorHandled = false;

    try {
      const scopeNoteIds = await resolveScopeNoteIds();

      // ── Action intent routing (Phase 15 Milestone 5) ───────────────────────
      // Same slice used below for streamChatWithNotes/streamChatWithTools —
      // excludes the user message + assistant placeholder just added above,
      // so the classifier sees exactly the history those calls will see.
      const classifierSessionMessages = useChatSessionStore.getState().getSessionByNoteId(noteId).messages.slice(0, -2);
      const { intent, confidence } = await classifyActionIntent(q, classifierSessionMessages);
      console.log("[classifyActionIntent]", { intent, confidence, isActionMode: intent === "action" && confidence >= 0.85 });
      const isActionMode = intent === "action" && confidence >= 0.85;

      if (isActionMode) {
        await streamChatWithTools(
          q,
          noteId,
          currentNote,
          {
            onChunk: (token) => {
              const current = useChatSessionStore.getState().getSessionByNoteId(noteId)
              const existing = current.messages.find(m => m.id === assistantId)
              setMessageContent(noteId, assistantId, (existing?.content ?? "") + token)
              setStreamStatus(null)
            },
            onDone: () => {
              setStreamStatus(null)
              setStreamingId(null)
              setLoading(false)
            },
            onError: (err: AICallError) => {
              errorHandled = true
              setStreamStatus(null)
              useChatSessionStore.setState((s) => {
                const sess = s.sessions[noteId]
                if (!sess) return s
                return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: sess.messages.filter(m => m.id !== assistantId) } } }
              })
              setCallError(err)
              setErrorAfterMessageId(userMsgId)
              setStreamingId(null)
              setLoading(false)
            },
            onStatus: (msg) => setStreamStatus(msg),
          },
          useChatSessionStore.getState().getSessionByNoteId(noteId).messages.slice(0, -2),
          (pw) => setPendingWrites((prev) => new Map(prev).set(pw.id, pw)),
          assistantId,
          handleOpenNote,
        );

        // Persist session and AI history after tool loop completes
        let finalContent = useChatSessionStore.getState().getSessionByNoteId(noteId)
          .messages.find(m => m.id === assistantId)?.content ?? "";

        // Trust-but-verify: if the model's text claims a write succeeded but
        // nothing was ever registered at the gate for this message, the claim
        // is false — narrated success with no actual tool call (or a call
        // that silently failed to register, e.g. HMR/module-load issues).
        const registeredWrites = [...useConfirmationGate.getState().pendingWrites.values()]
          .filter((w) => w.assistantMessageId === assistantId);
        if (registeredWrites.length === 0 && containsUnverifiedWriteClaim(finalContent)) {
          finalContent += "\n\n---\n\n⚠️ *No changes were actually made — no confirmation card appeared for this request. Please try again.*";
          setMessageContent(noteId, assistantId, finalContent);
        }

        await appendAIHistory(noteId, "user", q);
        await appendAIHistory(noteId, "assistant", finalContent);
        await saveSession(noteId);
        return;
      }

      console.log('[handleSend] sessionMessages being passed:', 
        useChatSessionStore.getState().getSessionByNoteId(noteId).messages.slice(0, -2).length,
        'paneNoteId:', paneNoteId,
        'noteId:', noteId
      )
      const meta = await streamChatWithNotes(
        q,
        notes,
        noteId,
        currentNote,
        scopeNoteIds,
        {
          onChunk: (token) => {
            const current = useChatSessionStore.getState().getSessionByNoteId(noteId)
            const existing = current.messages.find(m => m.id === assistantId)
            setMessageContent(noteId, assistantId, (existing?.content ?? "") + token)
            setStreamStatus(null)
          },
          onDone: () => {
            setStreamStatus(null)
            setStreamingId(null)
            setLoading(false)
          },
          onError: (err: AICallError) => {
            errorHandled = true
            setStreamStatus(null)
            // Remove empty assistant placeholder on error
            useChatSessionStore.setState((s) => {
              const sess = s.sessions[noteId]
              if (!sess) return s
              return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: sess.messages.filter(m => m.id !== assistantId) } } }
            })
            if (err.code === "AUTH_FAILED" || err.code === "QUOTA_EXCEEDED") {
              setProviderStatus(primarySlot.provider, "error", err.message)
            }
            setCallError(err)
            // Track which user message this error belongs to for inline rendering
            setErrorAfterMessageId(userMsgId)
            setStreamingId(null)
            setLoading(false)
          },
          onStatus: (msg) => setStreamStatus(msg),
        },
        undefined,
        undefined,
        undefined,
        useChatSessionStore.getState().getSessionByNoteId(noteId).messages.slice(0, -2),
      )

      const pm: PersistedMeta = {
        messageId:      assistantId,
        confidence:     meta.confidence,
        citations:      meta.sourceTitles.map((title, i) => ({
          noteId:         meta.sourceNoteIds[i],
          title,
          isTitleMatch:   meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
          citationNumber: meta.citationNumbers?.[i],
        })),
        usedWeb:        meta.webNudge !== undefined,
        usedEmbeddings: meta.usedEmbeddings,
      }
      setPersistedMeta(noteId, assistantId, pm)
      await saveSession(noteId)

// AFTER:
      setRuntimeMetaMap((prev) => new Map(prev).set(assistantId, {
        sourceTitles:        meta.sourceTitles,
        sourceNoteIds:       meta.sourceNoteIds,
        citationNumbers:     meta.citationNumbers,
        relatedNotes:        meta.relatedNotes,
        tier1Results:        meta.tier1Results,
        excludedNoteNotices: meta.excludedNoteNotices,
        titleMatchedNoteIds: meta.titleMatchedNoteIds,
        webNudge:            meta.webNudge,
      }))

      if (meta.webGrounded) {
        setSuppressedNudges((prev) => new Set(prev).add(assistantId))
      }

      void maybeRunThoughtExtraction(
        q,
        assistantId,
        useChatSessionStore.getState().getSessionByNoteId(noteId).messages.slice(0, -2),
      )
    } catch (rawErr) {
      if (!errorHandled) {
        useChatSessionStore.setState((s) => {
          const sess = s.sessions[noteId]
          if (!sess) return s
          return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: sess.messages.filter(m => m.id !== assistantId) } } }
        })
        const err = rawErr as Partial<AICallError>;
        setCallError(err?.code ? (rawErr as AICallError) : {
          code: "UNKNOWN", provider: primarySlot.provider, model: primarySlot.model,
          message: "Something went wrong. Please try again.", retryable: false, name: "AICallError",
        } as AICallError);
        setErrorAfterMessageId(userMsgId)
        setStreamingId(null);
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, isFreeTier, notes, noteId, currentNote, primarySlot, setProviderStatus, resolveScopeNoteIds, pendingAttachments, clearPendingAttachments, maybeRunThoughtExtraction]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); return; }

    if (e.key === "Enter" && e.shiftKey) {
      const textarea   = e.currentTarget
      const cursorPos   = textarea.selectionStart
      const continuation = getListContinuation(input, cursorPos)
      if (!continuation) return // not on a list line — let the default newline happen

      e.preventDefault()
      const { insertText, removeLine, lineStart } = continuation
      const newValue     = removeLine
        ? input.slice(0, lineStart) + input.slice(cursorPos)
        : input.slice(0, cursorPos) + insertText + input.slice(cursorPos)
      const newCursorPos = removeLine ? lineStart : cursorPos + insertText.length

      setInput(newValue)
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = newCursorPos
        textarea.style.height = "auto"
        textarea.style.height = textarea.scrollHeight + "px"
      })
    }
  }

  async function handleClear() {
    setCallError(null)
    setErrorAfterMessageId(null)
    setOneTimeInclusions(new Set())
    setDismissedNudges(new Set())
    setWebResultsMap(new Map())
    setSuppressedNudges(new Set())
    setRuntimeMetaMap(new Map())
    setPendingWrites(new Map())
    useConfirmationGate.getState().clearAll()
    await clearSession(noteId)
    await Promise.all([
      clearAIHistory(noteId),
      clearConversationSummary(noteId),
      onExplicitClear(noteId),
    ])
  }

  function handleStop() {
    abortRef.current?.abort()
    abortRef.current = null
    setStreamingId(null)
    setLoading(false)
  }

const handleRetry = useCallback(async (userMessageId?: string, userMessageContent?: string) => {
  // Cancel any pending auto-retry countdown
  if (retryTimerRef.current) {
    clearInterval(retryTimerRef.current)
    retryTimerRef.current = null
  }

  const currentMessages = useChatSessionStore.getState().getSessionByNoteId(noteId).messages

  // If a specific message was passed (retry from a user bubble), use it.
  // Otherwise fall back to the last user message (error card retry).
  const targetUser = userMessageId
    ? currentMessages.find((m) => m.id === userMessageId)
    : [...currentMessages].reverse().find((m) => m.role === "user")
  if (!targetUser) return

  const targetContent = userMessageContent ?? targetUser.content

  // Find the assistant message that directly follows THIS user message
  const targetUserIndex = currentMessages.findIndex((m) => m.id === targetUser.id)
  const nextMsg = currentMessages[targetUserIndex + 1]
  const directAssistant = nextMsg?.role === "assistant" ? nextMsg : null

  // DON'T clear error here — keep error card visible until first real token arrives
  // setCallError(null)
  // setErrorAfterMessageId(null)
  
  setLoading(true)

  let targetAssistantId: string

  if (directAssistant) {
    // Reuse existing assistant message directly below the user message
    targetAssistantId = directAssistant.id
    setStreamingId(directAssistant.id)
    // CRITICAL FIX: Clear the content directly in the store, not via setMessageContent which might batch
    useChatSessionStore.setState((s) => {
      const sess = s.sessions[noteId]
      if (!sess) return s
      const msgs = sess.messages.map(m => 
        m.id === directAssistant.id ? { ...m, content: "" } : m
      )
      return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: msgs } } }
    })
  } else {
    // No assistant message exists (was removed on error) — create a fresh one
    targetAssistantId = crypto.randomUUID()
    const newAssistantMsg: ChatMessage = {
      id: targetAssistantId, role: "assistant", content: "", createdAt: Date.now(),
    }
    
    // Insert directly after the target user message, not at the end
    useChatSessionStore.setState((s) => {
      const sess = s.sessions[noteId]
      if (!sess) return s
      const msgs = [...sess.messages]
      msgs.splice(targetUserIndex + 1, 0, newAssistantMsg)
      return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: msgs } } }
    })
    await saveSession(noteId)
    setStreamingId(targetAssistantId)
  }

   const scopeNoteIds = await resolveScopeNoteIds()

  try {
    // Re-classify intent so retry re-attempts an action the same way the
    // original send would have, instead of silently downgrading every
    // retry to plain RAG chat regardless of what was originally asked.
    // Pass the same history slice used below for streamChatWithTools/
    // streamChatWithNotes — everything before the retried user message.
    const { intent, confidence } = await classifyActionIntent(targetContent, currentMessages.slice(0, targetUserIndex));
    const isActionMode = intent === "action" && confidence >= 0.85;

    if (isActionMode) {
      await streamChatWithTools(
        targetContent,
        noteId,
        currentNote,
        {
          onChunk: (token) => {
            setCallError(null)
            setErrorAfterMessageId(null)
            useChatSessionStore.setState((s) => {
              const sess = s.sessions[noteId]
              if (!sess) return s
              const msgs = sess.messages.map(m =>
                m.id === targetAssistantId ? { ...m, content: m.content + token } : m
              )
              return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: msgs } } }
            })
            setStreamStatus(null)
          },
          onDone: () => {
            setStreamStatus(null)
            setStreamingId(null)
            setLoading(false)
            saveSession(noteId)
          },
          onError: (err) => {
            setStreamStatus(null)
            setStreamingId(null)
            setLoading(false)
            setCallError(err)
            setErrorAfterMessageId(targetUser.id)
          },
          onStatus: (msg) => setStreamStatus(msg),
        },
        currentMessages.slice(0, targetUserIndex),
        (pw) => setPendingWrites((prev) => new Map(prev).set(pw.id, pw)),
        targetAssistantId,
        handleOpenNote,
      );

      let finalContent = useChatSessionStore.getState().getSessionByNoteId(noteId)
        .messages.find(m => m.id === targetAssistantId)?.content ?? "";

      const registeredWrites = [...useConfirmationGate.getState().pendingWrites.values()]
        .filter((w) => w.assistantMessageId === targetAssistantId);
      if (registeredWrites.length === 0 && containsUnverifiedWriteClaim(finalContent)) {
        finalContent += "\n\n---\n\n⚠️ *No changes were actually made — no confirmation card appeared for this request. Please try again.*";
        setMessageContent(noteId, targetAssistantId, finalContent);
      }

      await appendAIHistory(noteId, "user", targetContent);
      await appendAIHistory(noteId, "assistant", finalContent);
      await saveSession(noteId);
      return;
    }

    const meta = await streamChatWithNotes(
      targetContent,
      notes,
      noteId,
      currentNote,
      scopeNoteIds,
      {
        onChunk: (token) => {
          console.log('[retry:onChunk] token received:', token.slice(0, 20))
          // Clear error on first real token — assistant bubble is now growing below error card
          setCallError(null)
          setErrorAfterMessageId(null)
          
          // CRITICAL FIX: Use functional update to append content
          useChatSessionStore.setState((s) => {
            const sess = s.sessions[noteId]
            if (!sess) return s
            const msgs = sess.messages.map(m => 
              m.id === targetAssistantId ? { ...m, content: m.content + token } : m
            )
            return { sessions: { ...s.sessions, [noteId]: { ...sess, messages: msgs } } }
          })
          setStreamStatus(null)
        },
        onDone: () => { 
          console.log('[retry:onDone]')
          setStreamStatus(null)
          setStreamingId(null)
          setLoading(false)
          saveSession(noteId)
        },
        onError: (err) => {
          console.log('[retry:onError]', err)
          setStreamStatus(null)
          setStreamingId(null)
          setLoading(false)
          setCallError(err)
          setErrorAfterMessageId(targetUser.id)
        },
        onStatus: (msg) => setStreamStatus(msg),
      },
      undefined,
      undefined,
      undefined,
      currentMessages.slice(0, targetUserIndex),
    )

    const pm: PersistedMeta = {
      messageId: targetAssistantId,
      confidence: meta.confidence,
      citations: meta.sourceTitles.map((title, i) => ({
        noteId: meta.sourceNoteIds[i],
        title,
        isTitleMatch: meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
        citationNumber: meta.citationNumbers?.[i],
      })),
      usedWeb: meta.webNudge !== undefined,
      usedEmbeddings: meta.usedEmbeddings,
    }
    setPersistedMeta(noteId, targetAssistantId, pm)
    await saveSession(noteId)

    setRuntimeMetaMap((prev) => new Map(prev).set(targetAssistantId, {
      sourceTitles: meta.sourceTitles,
      sourceNoteIds: meta.sourceNoteIds,
      citationNumbers: meta.citationNumbers,
      relatedNotes: meta.relatedNotes,
      tier1Results: meta.tier1Results,
      excludedNoteNotices: meta.excludedNoteNotices,
      titleMatchedNoteIds: meta.titleMatchedNoteIds,
      webNudge: meta.webNudge,
    }))

    void maybeRunThoughtExtraction(
      targetContent,
      targetAssistantId,
      currentMessages.slice(0, targetUserIndex),
    )
  } catch { 
    /* handled by onError */ 
  }
}, [notes, noteId, currentNote, resolveScopeNoteIds, setMessageContent, setPersistedMeta, saveSession, addMessage, maybeRunThoughtExtraction])
function handleOpenNote(id: string) {
    if (paneId === 2) openTabInPane2(id);
    else openTab(id);
  }

  const handleOneTimeInclusion = useCallback(async (inclusionNoteId: string) => {
    const allInclusions = [...oneTimeInclusions, inclusionNoteId];
    setOneTimeInclusions(new Set(allInclusions));

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId, role: "assistant", content: "", createdAt: Date.now(),
    };
    addMessage(noteId, assistantMsg);
    await saveSession(noteId);
    setLoading(true);
    setStreamingId(assistantId);

    const scopeNoteIds = await resolveScopeNoteIds(allInclusions);

    try {
const meta = await streamChatWithNotes(
      lastUserMsg.content,
      notes,
      noteId,
      currentNote,
      scopeNoteIds,
      {
        onChunk: (token) => {
          const current = useChatSessionStore.getState().getSessionByNoteId(noteId)
          const existing = current.messages.find(m => m.id === assistantId)
          setMessageContent(noteId, assistantId, (existing?.content ?? "") + token)
          setStreamStatus(null)
        },
        onDone:  () => { setStreamStatus(null); setStreamingId(null); setLoading(false) },
        onError: (err) => { setStreamStatus(null); setStreamingId(null); setLoading(false); setCallError(err) },
        onStatus: (msg) => setStreamStatus(msg),
      },
      allInclusions,
      undefined,
      undefined,
      messages.slice(0, -1),
    )
      const pm: PersistedMeta = {
        messageId:      assistantId,
        confidence:     meta.confidence,
        citations:      meta.sourceTitles.map((title, i) => ({
          noteId:         meta.sourceNoteIds[i],
          title,
          isTitleMatch:   meta.titleMatchedNoteIds?.includes(meta.sourceNoteIds[i]),
          citationNumber: meta.citationNumbers?.[i],
        })),
        usedWeb:        meta.webNudge !== undefined,
        usedEmbeddings: meta.usedEmbeddings,
      }
      setPersistedMeta(noteId, assistantId, pm)
      await saveSession(noteId)

      setRuntimeMetaMap((prev) => new Map(prev).set(assistantId, {
        sourceTitles:        meta.sourceTitles,
        sourceNoteIds:       meta.sourceNoteIds,
        citationNumbers:     meta.citationNumbers,
        relatedNotes:        meta.relatedNotes,
        tier1Results:        meta.tier1Results,
        excludedNoteNotices: meta.excludedNoteNotices,
        titleMatchedNoteIds: meta.titleMatchedNoteIds,
        webNudge:            meta.webNudge,
      }))

      void maybeRunThoughtExtraction(lastUserMsg.content, assistantId, messages.slice(0, -1))
    } catch { /* errors handled by onError above */ }
  }, [messages, notes, noteId, currentNote, oneTimeInclusions, maybeRunThoughtExtraction]);

  function handleScopeToggle() {
    if (ragScope === "note") {
      setRagScope(noteId, "all");
    } else {
      setRagScope(noteId, "note");
    }
  }

  const hasNoEmbeddingMessage = [...metaMap.values()].some((m) => !m.usedEmbeddings);

  useEffect(() => {
    setEmbeddingWarningDismissed(false);
  }, [messages.length]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={embedded
      ? "flex flex-col h-full w-full"
      : "flex flex-col h-full w-[480px] shrink-0 border-l border-idemora-border bg-idemora-bg-primary"}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-idemora-border/60">
        <div className="flex items-center min-w-0">
          {isFreeTier && (
            <span className="text-sm font-medium text-idemora-text-muted truncate">
              Ask your notes
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {messages.length > 0 && (
            <>
              <button
                onClick={() => {
                  setSelectedMessage(null)
                  setSaveDialogOpen(true)
                }}
                title="Save conversation to note"
                className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <rect x="2" y="2" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="4.5" y="2" width="6" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1"/>
                  <rect x="4" y="8.5" width="7" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                </svg>
              </button>
              <button
                onClick={handleClear}
                title="Clear conversation"
                className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M2.5 4.5h10M6 4.5V3.5h3v1M6.5 7v4M8.5 7v4M3.5 4.5l.7 8h6.6l.7-8"
                    stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </>
          )}
          <button
            onClick={() => (embedded ? onCloseEmbedded?.() : closeChat(paneId as 1 | 2))}
            title="Close chat"
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M2.5 2.5l10 10M12.5 2.5l-10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Indexing paused banner ── */}
      {indexingPaused && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg bg-amber-50/40 border border-amber-100 flex items-center gap-2 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-600">Indexing paused — embedding quota reached</p>
        </div>
      )}

      {/* ── Body ── */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto relative">
        {isFreeTier ? (
          <FreeTierState />
        ) : isLoading ? (
          <div className="py-6 px-4 space-y-3 animate-pulse">
            {[1,2,3].map(i => (
              <div key={i} className="h-3 rounded bg-idemora-border" style={{ width: `${60 + i * 10}%` }} />
            ))}
          </div>
        ) : messages.length === 0 && !callError ? (
          <EmptyState currentNoteTitle={currentNote?.title} onSuggest={(text) => { setInput(text); inputRef.current?.focus(); }} />
        ) : (
          <div className="py-3 space-y-1">
            {allExhausted && (
              <QuotaExhaustedCard onRetry={() => { setAllExhausted(false); handleSend(); }} />
            )}
            {hasNoEmbeddingMessage && messages.length > 0 && !embeddingWarningDismissed && (
              <div className="mx-3 mb-1 px-3 py-2 rounded-lg bg-amber-50/40 border border-amber-100 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-amber-400 shrink-0 mt-0.5">
                    <path d="M5.5 1L10 9.5H1L5.5 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
                    <path d="M5.5 4.5v2M5.5 8v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <p className="text-[10px] text-amber-600 leading-relaxed">
                    Running keyword search only — enable an embedding provider in{" "}
                    <span className="font-medium">Settings → AI</span> for better results.
                  </p>
                </div>
                <button
                  onClick={() => setEmbeddingWarningDismissed(true)}
                  className="text-amber-300 hover:text-amber-500 transition-colors duration-75 shrink-0 mt-0.5"
                >
                  <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
                    <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            )}

            {messages.map((msg, idx) => {
              const meta        = metaMap.get(msg.id)
              const isStreaming = msg.id === streamingId
              const isLatest    = idx === messages.length - 1
              const prevMsg     = idx > 0 ? messages[idx - 1] : null

              // Does this user message have an inline error after it?
              const hasInlineError = msg.role === "user" && callError && !allExhausted && msg.id === errorAfterMessageId

              return (
                <div key={msg.id} className="group/msg relative">
                  <MessageBubble
                    message={msg}
                    isStreaming={isStreaming}
                    isLatest={isLatest}
                    streamStatus={isStreaming ? streamStatus : null}
                    onCopy={(content) => {
                      const plain = content
                        .replace(/\[web:[^\]]+\]/g, "")
                        .replace(/\[\d+\]/g, "")
                        // Convert \[...\] block math → unwrapped LaTeX (readable when pasted)
                        .replace(/\\\[([^]*?)\\\]/g, (_: string, m: string) => m.trim())
                        // Convert \(...\) inline math → unwrapped LaTeX
                        .replace(/\\\(([^]*?)\\\)/g, (_: string, m: string) => m.trim())
                        .trim()
                      navigator.clipboard.writeText(plain).catch(console.error)
                      addToast("Copied")
                    }}
                    onEdit={msg.role === "user" ? (content) => {
                      if (msg.attachments && msg.attachments.length > 0) {
                        setInput("");
                        setPendingAttachments(msg.attachments);
                      } else {
                        setInput(content);
                        clearPendingAttachments();
                      }
                    } : undefined}
                    // Pass retry to user bubbles so the icon shows on hover
onRetry={msg.role === "user" ? () => handleRetry(msg.id, msg.content) : undefined}
                  />

                  {/* ── Inline error card — shown directly after the offending user message ── */}
                  {hasInlineError && (
                    <div className="mx-3 mt-1 mb-1">
                                           <ErrorCard
                        error={callError!}
                        onDismiss={() => { setCallError(null); setErrorAfterMessageId(null) }}
                        onRetry={handleRetry}
                      />
                    </div>
                  )}

                  {/* ── Pending writes triggered by this message ──
                       Every write — single or batched — renders through the
                       modal/chip pair below. No inline card anymore. ── */}
                  {(() => {
                    const groups = groupPendingWritesByBatch(
                      [...pendingWrites.values()].filter((pw) => pw.assistantMessageId === msg.id)
                    )
                    // Stale-cancelled writes (auto-cancelled after 5min with no
                    // decision — see clearStalePending in confirmationGate.ts)
                    // must not count toward batch size, or a single card can
                    // silently flip into a batch modal once a later write lands
                    // under the same batchId after the original went stale.
                    const activeGroups = groups
                      .map((g) => g.filter((w) => w.status !== "cancelled"))
                      .filter((g) => g.length > 0)

                    return (
                      <>
                        {activeGroups.map((group) => {
                          const batchId = group[0].batchId
                          const isOpen  = batchId === openBatchId

                          // Modal for whichever batch is currently open — either the
                          // auto-opened oldest-pending one, or one the user reopened
                          // by clicking its chip.
                          if (isOpen) {
                            return (
                              <BatchConfirmationModal
                                key={batchId}
                                writes={group}
                                onConfirm={(id) => useConfirmationGate.getState().confirmWrite(id)}
                                onCancel={(id) => {
                                  useConfirmationGate.getState().cancelWrite(id)
                                }}
                                onApproveAll={(bId) => useConfirmationGate.getState().confirmBatch(bId)}
                                onOpenNote={handleOpenNote}
                                onUndo={(id) => useConfirmationGate.getState().undoWrite(id)}
                                onClose={() => {
                                  // Collapse to a chip — do NOT delete from pendingWrites.
                                  // The batch (and its previews) stays reachable for the
                                  // rest of the session via the chip's "View" click.
                                  setOpenBatchId(null)
                                }}
                              />
                            )
                          }

                          // Every non-open batch — whether fully resolved or still
                          // pending-but-queued — collapses to a persistent chip.
                          return (
                            <BatchSummaryChip
                              key={batchId}
                              writes={group}
                              onOpen={() => setOpenBatchId(batchId)}
                            />
                          )
                        })}
                        </>
                    )
                  })()}

                  {/* Source footer */}
                  {msg.role === "assistant" && meta && !isStreaming && (
                    <MessageFooter
                      meta={meta}
                      onOpenNote={handleOpenNote}
                      onOneTimeInclusion={handleOneTimeInclusion}
                      webSources={webResultsMap.get(msg.id)}
                      onCopy={() => {
                        const plain = msg.content.replace(/\[web:[^\]]+\]/g, "").replace(/\[\d+\]/g, "").trim()
                        navigator.clipboard.writeText(plain).catch(console.error)
                        addToast("Copied")
                      }}
                      onSave={!isFreeTier ? (() => {
                        const prevMsg = idx > 0 ? messages[idx - 1] : null
                        const userMsg = prevMsg?.role === "user" ? prevMsg : null
                        setSelectedMessage(userMsg ? {
                          user:      { role: "user",      content: userMsg.content },
                          assistant: { role: "assistant", content: msg.content },
                        } : null)
                        setSaveDialogOpen(true)
                      }) : undefined}
                      onRetry={isLatest && msg.content === "" ? handleRetry : undefined}
                      onAddToThoughtGraph={!isFreeTier ? () => handleManualThoughtExtraction(msg.id) : undefined}
                      addingToThoughtGraph={extractingThoughtIds.has(msg.id)}
                      isLatest={isLatest}
                      createdAt={msg.createdAt}
                    />
                  )}

                  {/* Web nudge */}
                  {msg.role === "assistant" && meta && !isStreaming && meta.webNudge &&
                   !dismissedNudges.has(msg.id) && !suppressedNudges.has(msg.id) && (
                    <WebNudge
                      messageId={msg.id}
                      nudge={meta.webNudge}
                      query={prevMsg?.role === "user" ? prevMsg.content : ""}
                      onSearchComplete={(id, results) => {
                        setSuppressedNudges((prev) => new Set(prev).add(id))
                        const userQuery = prevMsg?.role === "user" ? prevMsg.content : ""
                        if (userQuery) handleWebSearch(userQuery, results)
                      }}
                      onDismiss={(id) => {
                        setDismissedNudges((prev) => new Set(prev).add(id))
                      }}
                    />
                  )}
                </div>
              )
            })}

            <div ref={messagesEndRef} />
          </div>
        )}
        {showScrollBtn && (
          <div className="sticky bottom-3 flex justify-center pointer-events-none">
            <button
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
              className="pointer-events-auto w-8 h-8 flex items-center justify-center rounded-full bg-idemora-bg-secondary border border-idemora-border/60 text-idemora-text-muted hover:text-idemora-text-normal hover:border-idemora-border shadow-sm transition-all duration-150 cursor-pointer"
              title="Scroll to bottom"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 2v9M3 8l3.5 3.5L10 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      {!isFreeTier && (
        <div className="shrink-0 px-3 pt-2 pb-3">
          <div className="rounded-2xl border border-idemora-border/60 bg-idemora-bg-secondary transition-all duration-150 focus-within:border-violet-500/30 focus-within:shadow-[0_0_0_1px_rgba(139,92,246,0.15)]">

            {/* Pending-paste chip — shown when a large paste was intercepted */}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mx-3 mt-2">
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-idemora-bg-primary border border-idemora-border/70 max-w-[160px]"
                  >
                    <svg width="11" height="11" viewBox="0 0 15 15" fill="none" className="text-idemora-text-muted shrink-0">
                      <rect x="3" y="2" width="9" height="11" rx="1.3" stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M5.5 2V1.3a.8.8 0 01.8-.8h2.4a.8.8 0 01.8.8V2M5.5 6h4M5.5 8.5h4M5.5 11h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-idemora-text-normal truncate leading-tight">{att.label}</p>
                      <p className="text-[9px] text-idemora-text-muted leading-tight">
                        {att.lineCount}L · {att.charCount.toLocaleString()}c
                      </p>
                    </div>
                    <button
                      onClick={() => removePendingAttachment(att.id)}
                      title="Remove"
                      className="w-4 h-4 flex items-center justify-center rounded text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 shrink-0"
                    >
                      <svg width="7" height="7" viewBox="0 0 9 9" fill="none">
                        <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (!pasted) return;
                const detected = detectLongPaste(pasted);
                if (detected) {
                  e.preventDefault();
                  if (pendingAttachments.length >= MAX_PENDING_ATTACHMENTS) {
                    addToast(`Max ${MAX_PENDING_ATTACHMENTS} pasted items — remove one to add another`);
                    return;
                  }
                  setPendingAttachments((prev) => [...prev, { id: crypto.randomUUID(), ...detected, content: pasted }]);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your notes…"
              rows={1}
              className="w-full resize-none px-3 pt-3 pb-1 text-sm bg-transparent text-idemora-text-normal placeholder-idemora-text-muted/50 focus:outline-none leading-relaxed"
              style={{ height: "auto", minHeight: "38px", maxHeight: "45vh", overflowY: "auto" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
            />

            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1">

              {/* Left — context controls */}
              <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                <button
                  onClick={handleScopeToggle}
                  title={
                    ragScope === "note"
                      ? `Scoped to "${currentNote?.title ?? "this note"}" — click to search all notes`
                      : `Searching all notes — click to scope to "${currentNote?.title ?? "this note"}"`
                  }
                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all duration-150 shrink-0 ${
                    ragScope === "note"
                      ? "text-violet-400 border-violet-400/40 bg-violet-500/10 hover:bg-violet-500/20"
                      : "text-idemora-text-muted border-idemora-border/60 hover:text-violet-400 hover:border-violet-400/40"
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 9 9" fill="none" className="shrink-0" aria-hidden="true">
                    {ragScope === "note" ? (
                      <><circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1"/><path d="M4.5 2.5v4M2.5 4.5h4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/></>
                    ) : (
                      <><rect x="1" y="1" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1"/><path d="M2.5 3h4M2.5 4.5h4M2.5 6h2.5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/></>
                    )}
                  </svg>
                  {ragScope === "note" && currentNote?.title
                    ? `${currentNote.title.slice(0, 16)}${currentNote.title.length > 16 ? "…" : ""}`
                    : "All notes"}
                </button>

                {linkedNoteId && !linkedNoteDeleted && (
                  <button
                    onClick={() => {
                      if (linkedNoteId) {
                        if (paneId === 2) openTabInPane2(linkedNoteId);
                        else openTab(linkedNoteId);
                      }
                    }}
                    title={`Saves going to "${linkedNoteTitle ?? "note"}"`}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-violet-400 border border-violet-400/40 bg-violet-500/10 hover:bg-violet-500/20 transition-all duration-150 min-w-0 max-w-[120px]"
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0" aria-hidden="true">
                      <rect x="1" y="1" width="6" height="6" rx="0.8" stroke="currentColor" strokeWidth="1"/>
                      <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
                    </svg>
                    <span className="truncate">{linkedNoteTitle ?? "Saved"}</span>
                    <svg width="7" height="7" viewBox="0 0 7 7" fill="none" className="shrink-0 opacity-60" aria-hidden="true">
                      <path d="M1.5 5.5L5.5 1.5M5.5 1.5H2.5M5.5 1.5V4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}

                {linkedNoteTrashed && (
                  <span className="text-[10px] text-amber-500 shrink-0">Linked note in trash</span>
                )}
                {linkedNoteDeleted && (
                  <span className="text-[10px] text-idemora-text-muted shrink-0">Note deleted</span>
                )}
              </div>

              {/* Right — execution controls */}
              <div className="flex items-center gap-1 shrink-0">

                {/* Web search */}
                <button
                  onClick={handleDirectWebSearch}
                  disabled={!input.trim() || loading}
                  title="Search the web directly"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-idemora-text-muted hover:text-sky-400 hover:bg-white/[0.04] border border-idemora-border/60 hover:border-sky-400/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M6 1.5C5 3 4.5 4.5 4.5 6s.5 3 1.5 4.5M6 1.5C7 3 7.5 4.5 7.5 6S7 9 6 10.5M1.5 6h9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                </button>

                {/* Model picker */}
                <QuickSwitch />

                {/* Send / Stop */}
                <button
                  onClick={loading ? handleStop : handleSend}
                  disabled={!loading && !input.trim()}
                  title={loading ? "Stop" : "Send (Enter)"}
                  className={`w-7 h-7 flex items-center justify-center rounded-lg text-white transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed ${
                    loading ? "bg-violet-600 hover:bg-violet-700" : "bg-violet-500 hover:bg-violet-400"
                  }`}
                >
                  {loading ? (
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1"/>
                      <rect x="3.5" y="3.5" width="5" height="5" rx="0.8" fill="currentColor"/>
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Save dialog ── */}
      {saveDialogOpen && (
        <SaveNoteDialog
          paneId={paneId === 2 ? 2 : 1}
          messages={messages}
          selectedMessage={selectedMessage ?? undefined}
          onClose={() => { setSaveDialogOpen(false); setSelectedMessage(null); }}
          onSaveSuccess={(savedNoteId, savedNoteTitle) => {
            const isFirstSave = !linkedNoteId;
            setLinkedNote(noteId, savedNoteId, savedNoteTitle);
            stampSavedAt(noteId);
            if (isFirstSave) {
              setRagScope(noteId, "note");
              addToast("Search scoped to this note and sub-notes — change anytime above");
            }
          }}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}





// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message, isStreaming, isLatest, onCopy, onEdit, onRetry, streamStatus,
}: {
  message:       ChatMessage
  isStreaming:   boolean
  isLatest:      boolean
  onCopy:        (content: string) => void
  onEdit?:       (content: string) => void
  onRetry?:      () => void
  streamStatus?: string | null
}) {
  const isUser = message.role === "user"


// Rendered by MessageRenderer — handles markdown, math, code, tables
// Math rendering is deferred while streaming to avoid per-token KaTeX cost

// Then in the render section, replace the call site.
// Instead of:
//   {renderWithCitations(message.content)}
// Replace with:
//   {renderedContent}
  const [copied, setCopied] = useState(false)
  const [openAttachmentId, setOpenAttachmentId] = useState<string | null>(null)

  // ── User bubble ────────────────────────────────────────────────────────────
  if (isUser) {
    const attachments = message.attachments ?? []
    const attachmentBlock = attachments.map((a) => a.content).join("\n\n")
    const leftoverText = attachments.length > 0
      ? message.content.slice(attachmentBlock.length).replace(/^\n\n/, "")
      : message.content
    const openAttachment = attachments.find((a) => a.id === openAttachmentId)

    return (
      <div className="px-4 py-1.5 flex justify-end">
        <div className="flex flex-col items-end gap-1 max-w-[85%]">
          {attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {attachments.map((att) => (
                <button
                  key={att.id}
                  onClick={() => setOpenAttachmentId(att.id)}
                  className="flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-left transition-colors duration-100 max-w-[180px]"
                >
                  <div className="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center shrink-0">
                    <svg width="12" height="12" viewBox="0 0 15 15" fill="none" className="text-white">
                      <rect x="3" y="2" width="9" height="11" rx="1.3" stroke="currentColor" strokeWidth="1.1"/>
                      <path d="M5.5 2V1.3a.8.8 0 01.8-.8h2.4a.8.8 0 01.8.8V2M5.5 6h4M5.5 8.5h4M5.5 11h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-white truncate leading-tight">{att.label}</p>
                    <p className="text-[10px] text-violet-100/70 leading-tight">
                      {att.lineCount}L · {att.charCount.toLocaleString()}c
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {leftoverText && (
            <div className="w-full px-3 py-2 rounded-2xl bg-violet-500 text-white text-sm leading-relaxed break-words whitespace-pre-wrap">
              {leftoverText}
            </div>
          )}
          {openAttachment && (
            <PastedContentOverlay
              label={openAttachment.label}
              content={openAttachment.content}
              onClose={() => setOpenAttachmentId(null)}
            />
          )}
          <div className={`flex items-center gap-0.5 transition-opacity duration-150 ${
            isLatest ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
          }`}>
            <span className="text-[10px] text-idemora-text-faint mr-1 select-none">
              {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            {/* Copy */}
            <button
              onClick={() => { onCopy(message.content); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              title={copied ? "Copied!" : "Copy"}
              className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
            >
              {copied ? (
                <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
                  <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                  <path d="M2 7H1.5A.5.5 0 011 6.5v-5A.5.5 0 011.5 1h5a.5.5 0 01.5.5V2" stroke="currentColor" strokeWidth="1.1"/>
                </svg>
              )}
            </button>
            {/* Edit */}
            {onEdit && (
              <button
                onClick={() => onEdit(message.content)}
                title="Edit and resend"
                className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
              >
                <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
                  <path d="M6.5 1.5l2 2L3 9H1V7L6.5 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M5.5 2.5l2 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            {/* Retry — always present on user bubbles, shown on hover */}
            {onRetry && (
              <button
                onClick={onRetry}
                title="Retry this message"
                className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
              >
                <svg width="13" height="13" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5a3.5 3.5 0 103.5-3.5c-1 0-1.9.4-2.5 1L1 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M1 1v2.5h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Assistant bubble ───────────────────────────────────────────────────────
  return (
    <div className="px-4 py-1.5 overflow-x-hidden">
      <div className="space-y-1 min-w-0">

        {/* Typing indicator — only shown when streaming and no content yet */}
        {isStreaming && message.content === "" && (
          <div className="flex items-center gap-2.5 py-2">
            <div className="flex items-center gap-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
            </div>
            <span className="text-sm text-idemora-text-normal/70">
              {streamStatus ?? "Thinking…"}
            </span>
          </div>
        )}

        {/* Content */}
        {message.content !== "" && (
  <div className="leading-relaxed">
    <MessageRenderer content={message.content} isStreaming={isStreaming} />
    {isStreaming && (
      <span className="inline-block w-0.5 h-3.5 bg-violet-400 ml-0.5 align-middle animate-pulse" />
    )}
  </div>
)}
      </div>
    </div>
  )
}

function PastedContentOverlay({
  label, content, onClose,
}: { label: string; content: string; onClose: () => void }) {
  const isCode = looksLikeCodeBlob(content)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose() }
    }
    document.addEventListener("keydown", handleKey, true)
    return () => document.removeEventListener("keydown", handleKey, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onClose}
      data-overlay-sentinel
    >
      <div
        className="w-full max-w-lg mx-4 max-h-[80vh] rounded-xl bg-idemora-bg-secondary border border-idemora-border shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-idemora-border shrink-0">
          <span className="text-sm font-semibold text-idemora-text-normal truncate pr-2">{label}</span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="w-6 h-6 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.07] transition-colors duration-100 shrink-0"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          {isCode ? (
            <MessageRenderer content={wrapAsCodeFence(content)} isStreaming={false} />
          ) : (
            <p className="text-sm text-idemora-text-normal whitespace-pre-wrap break-words leading-relaxed">
              {content}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Message footer ───────────────────────────────────────────────────────────

function formatWebUrl(url: string, title: string): string {
  try {
    const u = new URL(url)
    const domain = u.hostname.replace(/^www\./, "")
    const shortTitle = title.length > 35 ? title.slice(0, 35) + "…" : title
    return `${domain} · ${shortTitle}`
  } catch {
    return title
  }
}

function WebSourceChips({ sources }: { sources: WebSearchResult[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? sources : sources.slice(0, 1)

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((source, i) => (
        <button
          key={i}
          onClick={() => window.open(source.url, "_blank", "noreferrer")}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bg-sky-500/8 text-sky-400 border border-sky-400/20 hover:bg-sky-500/15 hover:border-sky-400/40 transition-all duration-100 max-w-[16rem]"
          title={source.url}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
            <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="0.9"/>
            <path d="M4 1.5C3.5 2.5 3.2 3.2 3.2 4s.3 1.5.8 2.5M4 1.5C4.5 2.5 4.8 3.2 4.8 4s-.3 1.5-.8 2.5M1.5 4h5"
              stroke="currentColor" strokeWidth="0.7" strokeLinecap="round"/>
          </svg>
          <span className="truncate">{formatWebUrl(source.url, source.title)}</span>
          <svg width="6" height="6" viewBox="0 0 7 7" fill="none" className="shrink-0 opacity-50">
            <path d="M1.5 5.5L5.5 1.5M5.5 1.5H2.5M5.5 1.5V4.5"
              stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      ))}
      {sources.length > 1 && (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] text-idemora-text-muted border border-idemora-border/60 hover:text-sky-400 hover:border-sky-400/30 transition-all duration-100"
        >
          {expanded ? "show less" : `+${sources.length - 1} more`}
        </button>
      )}
    </div>
  )
}

function NoteSourceChips({
  titles, noteIds, citationNumbers, titleMatchedNoteIds, onOpenNote,
}: {
  titles:               string[];
  noteIds:              string[];
  citationNumbers?:     number[];
  titleMatchedNoteIds?: string[];
  onOpenNote:           (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? titles : titles.slice(0, 2)

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((title, i) => {
        const isTitleMatch = titleMatchedNoteIds?.includes(noteIds[i])
        // Fall back to position+1 only for sessions persisted before this fix
        // (where citationNumbers wasn't recorded) — new messages always have it.
        const displayNumber = citationNumbers?.[i] ?? (i + 1)
        return (
          <button
            key={noteIds[i]}
            onClick={() => onOpenNote(noteIds[i])}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] transition-all duration-100 max-w-[11rem] border ${
              isTitleMatch
                ? "bg-violet-500/10 text-violet-400 border-violet-400/30 hover:bg-violet-500/20"
                : "text-idemora-text-muted border-idemora-border/50 hover:text-violet-400 hover:border-violet-400/30 hover:bg-violet-500/5"
            }`}
            title={`Open note: ${title}`}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
              <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
              <path d="M2.5 3h3M2.5 5h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round"/>
            </svg>
            <span className="truncate">[{displayNumber}] {title}</span>
          </button>
        )
      })}
      {titles.length > 2 && (
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] text-idemora-text-muted border border-idemora-border/60 hover:text-violet-400 hover:border-violet-400/30 transition-all duration-100"
        >
          {expanded ? "show less" : `+${titles.length - 2} more`}
        </button>
      )}
    </div>
  )
}

function MessageFooter({
  meta, onOpenNote, onOneTimeInclusion, webSources, onCopy, onSave, onRetry,
  onAddToThoughtGraph, addingToThoughtGraph, isLatest, createdAt,
}: {
  meta:                  MessageMeta;
  onOpenNote:            (id: string) => void;
  onOneTimeInclusion:    (noteId: string) => void;
  webSources?:           WebSearchResult[];
  onCopy:                () => void;
  onSave?:               () => void;
  onRetry?:              () => void;
  onAddToThoughtGraph?:  () => void;
  addingToThoughtGraph?: boolean;
  isLatest:              boolean;
  createdAt:             number;
}) {
  const [relatedExpanded, setRelatedExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  if (meta.tier1Results && meta.tier1Results.length > 0) {
    return <Tier1ResultCards cards={meta.tier1Results} onOpenNote={onOpenNote} />;
  }

  const hasNoteSources = meta.sourceTitles.length > 0 && !(meta.webNudge && meta.confidence === "low")
  const hasWebSources  = webSources && webSources.length > 0
  const hasRelated     = meta.relatedNotes.length > 0 && meta.confidence !== "low"
  const hasExcluded    = meta.excludedNoteNotices && meta.excludedNoteNotices.length > 0

  return (
    <div className="px-4 pb-3 space-y-2">

      {/* Low confidence warning */}
      {meta.confidence === "low" && !meta.webGrounded && (
        <div className="flex items-center gap-1.5">
          <svg width="9" height="9" viewBox="0 0 8 8" fill="none" className="text-amber-400 shrink-0">
            <path d="M4 1L7 7H1L4 1z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
            <path d="M4 3.5v2M4 6v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          <p className="text-[10px] text-amber-500">Limited matches — answer may be incomplete</p>
        </div>
      )}

      {/* Web sources */}
      {hasWebSources && (
        <WebSourceChips sources={webSources!.slice(0, 6)} />
      )}

      {/* Divider between web and note sources when both present */}
      {hasWebSources && hasNoteSources && (
        <div className="border-t border-idemora-border/30" />
      )}

      {/* Note source chips */}
      {hasNoteSources && (
        <NoteSourceChips
          titles={meta.sourceTitles}
          noteIds={meta.sourceNoteIds}
          citationNumbers={meta.citationNumbers}
          titleMatchedNoteIds={meta.titleMatchedNoteIds}
          onOpenNote={onOpenNote}
        />
      )}

      {/* Excluded note notices */}
      {hasExcluded && (
        <div className="pl-2 border-l border-idemora-border/40 space-y-1">
          {meta.excludedNoteNotices!.map((n) => (
            <p key={n.note_id} className="text-[10px] text-idemora-text-muted/70 leading-relaxed">
              <span className="font-medium">"{n.note_title}"</span> may be relevant but excluded.{" "}
              <button onClick={() => onOneTimeInclusion(n.note_id)} className="text-violet-400 hover:underline">
                Include it?
              </button>
            </p>
          ))}
        </div>
      )}

      {/* Related notes */}
      {hasRelated && (
        <div>
          <button
            onClick={() => setRelatedExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-[10px] text-idemora-text-muted/60 hover:text-idemora-text-muted transition-colors duration-100 mb-1"
          >
            <svg
              width="8" height="8" viewBox="0 0 8 8" fill="none"
              className={`shrink-0 transition-transform duration-150 ${relatedExpanded ? "rotate-90" : ""}`}
            >
              <path d="M2.5 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {relatedExpanded ? "hide related" : `${meta.relatedNotes.length} related`}
          </button>
          {relatedExpanded && (
            <div className="flex flex-wrap gap-1">
              {meta.relatedNotes.map((note) => (
                <button
                  key={note.noteId}
                  onClick={() => onOpenNote(note.noteId)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-idemora-text-muted border border-idemora-border/50 hover:text-violet-400 hover:border-violet-400/30 hover:bg-violet-500/5 transition-all duration-100 max-w-[11rem]"
                  title={note.title}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0">
                    <path d="M1 4h6M4 1l3 3-3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="truncate">{note.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action row */}
      <div className={`flex items-center gap-0.5 pt-1 border-t border-idemora-border/20 transition-opacity duration-150 ${
        isLatest ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
      }`}>
        <span className="text-[10px] text-idemora-text-faint mr-1 select-none">
          {new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <button
          onClick={() => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          title={copied ? "Copied!" : "Copy"}
          className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
        >
          {copied ? (
            <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
              <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M2 7H1.5A.5.5 0 011 6.5v-5A.5.5 0 011.5 1h5a.5.5 0 01.5.5V2" stroke="currentColor" strokeWidth="1.1"/>
            </svg>
          )}
        </button>
        {onSave && (
          <button
            onClick={onSave}
            title="Save to note"
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-violet-400 hover:bg-violet-500/5 transition-colors duration-100"
          >
            <svg width="15" height="15" viewBox="0 0 9 9" fill="none">
              <path d="M1.5 6.5V8h6V6.5M4.5 1v5M2.5 4l2 2 2-2"
                stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            title="Retry"
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-idemora-text-normal hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors duration-100"
          >
            <svg width="15" height="15" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5a3.5 3.5 0 103.5-3.5c-1 0-1.9.4-2.5 1L1 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 1v2.5h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {onAddToThoughtGraph && (
          <button
            onClick={onAddToThoughtGraph}
            disabled={addingToThoughtGraph}
            title={addingToThoughtGraph ? "Checking for thought nodes…" : "Add to thought graph"}
            className="w-7 h-7 flex items-center justify-center rounded-md text-idemora-text-muted hover:text-violet-400 hover:bg-violet-500/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
          >
            {addingToThoughtGraph ? (
              <svg width="13" height="13" viewBox="0 0 12 12" className="animate-spin" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="12 6" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
                <circle cx="2" cy="2" r="1.3" stroke="currentColor" strokeWidth="1"/>
                <circle cx="8" cy="2" r="1.3" stroke="currentColor" strokeWidth="1"/>
                <circle cx="5" cy="8" r="1.3" stroke="currentColor" strokeWidth="1"/>
                <path d="M3.1 2.8L4.2 6.8M6.9 2.8L5.8 6.8M3.3 2h3.4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        )}
      </div>

    </div>
  );
}

// ─── Tier 1 result cards ──────────────────────────────────────────────────────

const CONFIDENCE_COLORS: Record<Tier1ResultCard["confidence"], string> = {
  strong:   "text-violet-500 bg-violet-50/40",
  possible: "text-blue-500 bg-blue-50/30",
  weak:     "text-idemora-text-muted bg-idemora-bg-primary",
};

const BLOCK_TYPE_ICONS: Record<string, ReactElement> = {
  codeBlock: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M2.5 3L1 4.5l1.5 1.5M6.5 3L8 4.5 6.5 6M5 2l-1 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  heading: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M1.5 2v5M7.5 2v5M1.5 4.5h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  ),
  callout: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M4.5 3v2.5M4.5 6.5v.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
  paragraph: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M1.5 3h6M1.5 5h6M1.5 7h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  ),
};

function Tier1ResultCards({ cards, onOpenNote }: { cards: Tier1ResultCard[]; onOpenNote: (id: string) => void }) {
  const shown    = cards.slice(0, 8);
  const lowCount = shown.filter((c) => c.confidence !== "weak").length < 3;
  return (
    <div className="px-3 pb-3 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-idemora-text-muted px-0.5 pt-1">
        Found in your notes
      </p>
      {shown.map((card, i) => (
        <button
          key={`${card.noteId}-${i}`}
          onClick={() => onOpenNote(card.noteId)}
          className="w-full text-left rounded-lg border border-idemora-border bg-idemora-bg-primary p-2.5 space-y-1 hover:border-violet-300 transition-colors duration-100 group"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-idemora-text-normal truncate group-hover:text-violet-500 transition-colors duration-100">
              {card.noteTitle}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium border border-idemora-border text-idemora-text-muted">
                {card.sourceType === "vault_entry" ? "vault" : "note"}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${CONFIDENCE_COLORS[card.confidence]}`}>
                {card.confidence}
              </span>
            </div>
          </div>
          {card.chunkHeading && (
            <p className="text-[10px] text-idemora-text-muted truncate">§ {card.chunkHeading}</p>
          )}
          <p className="text-[11px] text-idemora-text-normal leading-relaxed line-clamp-3">{card.excerpt}</p>
          <div className="flex items-center gap-1 pt-0.5">
            <span className="text-idemora-text-muted">
              {BLOCK_TYPE_ICONS[card.blockType] ?? BLOCK_TYPE_ICONS.paragraph}
            </span>
            <span className="text-[9px] text-idemora-text-muted">{card.blockType}</span>
          </div>
        </button>
      ))}
      {lowCount && (
        <p className="text-[10px] text-idemora-text-muted px-0.5">
          Low match confidence — try rephrasing or narrowing your scope.
        </p>
      )}
    </div>
  );
}

// ─── Error card ───────────────────────────────────────────────────────────────

function ErrorCard({ error, onDismiss, onRetry, onCancelRetry, retryCountdown }: {
  error:            AICallError;
  onDismiss:        () => void;
  onRetry?:         () => void;
  onCancelRetry?:   () => void;
  retryCountdown?:  number | null;
}) {
  const configs: Record<string, { title: string; body: string; showSwitch: boolean; showRetry: boolean }> = {
    NETWORK_ERROR: { title: "No connection",        body: "Couldn't reach the provider. Check your internet and try again.", showSwitch: false, showRetry: true },
    AUTH_FAILED:   { title: "Invalid API key",     body: `The API key for ${error.provider} was rejected. Check your key in Settings → AI, or switch providers.`, showSwitch: true, showRetry: false },
    QUOTA_EXCEEDED:{ title: "Quota exhausted",      body: `You've hit your ${error.provider} limit. Switch providers or upgrade your plan.`, showSwitch: true, showRetry: false },
    RATE_LIMITED:  { title: "Rate limited",         body: `Too many requests to ${error.provider}. Wait a moment, or switch to another provider.`, showSwitch: true, showRetry: true },
    OVERLOADED:    { title: "Provider overloaded",  body: `${error.provider} is under heavy load right now. Try again or switch.`, showSwitch: true, showRetry: true },
    NO_KEY:        { title: "No API key",           body: `No key is configured for ${error.provider}. Add one in Settings → AI, or switch provider.`, showSwitch: true, showRetry: false },
    NO_PROVIDER:   { title: "No provider assigned", body: "The primary slot has no provider set. Configure it in Settings → AI.", showSwitch: false, showRetry: false },
    UNKNOWN:       { title: "Something went wrong", body: error.message || "An unexpected error occurred. Please try again.", showSwitch: false, showRetry: true },
  };
  const cfg = configs[error.code] ?? configs.UNKNOWN;
  return (
    <div className="rounded-lg border border-red-100 bg-red-50/40 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="text-red-400 shrink-0 mt-px">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M5.5 3.5v2.5M5.5 7.5v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <p className="text-xs font-semibold text-red-600">{cfg.title}</p>
        </div>
        <button onClick={onDismiss} className="text-red-300 hover:text-red-500 transition-colors duration-75 shrink-0">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <p className="text-[11px] text-red-500 leading-relaxed">{cfg.body}</p>
      {cfg.showSwitch && (
        <div className="pt-0.5">
          <p className="text-[10px] text-red-400 mb-1.5">Switch provider:</p>
          <QuickSwitch defaultOpen={false} />
        </div>
      )}
      {cfg.showRetry && error.retryable && (
        <div className="flex items-center gap-2 pt-0.5">
          {/* Retry button — clickable even during countdown to skip the wait */}
          <button
            onClick={() => { onDismiss(); onRetry?.(); }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-600 border border-red-200 hover:bg-red-200 active:bg-red-300 transition-colors duration-100"
          >
            {retryCountdown != null ? `Retry now (${retryCountdown}s)` : "Retry"}
          </button>
          {retryCountdown != null && onCancelRetry && (
            <button
              onClick={onCancelRetry}
              className="text-[10px] text-red-400 hover:text-red-600 transition-colors duration-100"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Free tier state ──────────────────────────────────────────────────────────

function FreeTierState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-idemora-bg-primary flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-idemora-text-muted">
          <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M8 9.5c0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.5-1 2.5-2.5 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <circle cx="11" cy="16" r=".7" fill="currentColor"/>
        </svg>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-idemora-text-normal">Keyword search only</p>
        <p className="text-xs text-idemora-text-muted leading-relaxed">
          You're on the free tier. Chat and semantic search require an API key.
        </p>
        <p className="text-xs text-idemora-text-muted leading-relaxed">
          Add a key in <span className="font-medium text-violet-500">Settings → AI</span> to unlock everything.
        </p>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ currentNoteTitle, onSuggest }: { currentNoteTitle?: string; onSuggest: (text: string) => void }) {
  const suggestions = [
    "What do I know about this topic?",
    "Summarize the key themes across my notes",
    currentNoteTitle ? "How does this relate to my other notes?" : "What connections exist between my notes?",
    "What gaps exist in my understanding?",
  ];

  return (
    <div className="flex flex-col px-5 py-6 gap-5">
      <div className="space-y-2">
        <p className="text-lg font-bold text-idemora-text-normal leading-snug">
          Ask your notes anything
        </p>
        <p className="text-sm text-idemora-text-muted leading-relaxed">
          Search your vault, or the web — your choice.
        </p>
      </div>

      <div className="border-t border-idemora-border/30" />

      <div className="space-y-1">
        <p className="text-sm font-bold text-idemora-text-normal mb-2">Try asking</p>
        {suggestions.map((s, i) => (
          <SuggestionChip key={i} text={s} onClick={() => onSuggest(s)} />
        ))}
      </div>

      <div className="border-t border-idemora-border/30" />

      <div className="space-y-1.5">
        <p className="text-sm font-bold text-idemora-text-normal">Tip</p>
        <p className="text-sm text-idemora-text-muted leading-relaxed">
          Run <span className="font-semibold text-idemora-text-normal">Summarize</span> on a note first — it builds context that makes answers much richer.
        </p>
      </div>
    </div>
  );
}

function SuggestionChip({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-1 py-1.5 rounded-md text-sm text-idemora-text-muted hover:text-idemora-text-normal hover:bg-white/[0.03] transition-all duration-150 text-left group"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-idemora-text-muted/40 shrink-0 mt-px group-hover:bg-violet-400 transition-colors duration-150" />
      <span className="leading-snug">{text}</span>
    </button>
  );
}